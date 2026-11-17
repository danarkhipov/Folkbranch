// A point for a place that has none, suggested from the GeoNames extract shipped with the app (public/gazetteer).
// Matching runs here, on the archive's own server: no place name is sent to any outside service. Nothing is set until
// an editor presses a candidate, and the point then says where it came from.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { gazPlace, guessPlace, parseGazetteer, prepare, type Candidate, type Gazetteer } from '../place-guess'
import { findPlace, onMap, placeChain, placeMatches } from '../places'
import { yearOf, type Graph, type Place } from '../types'
import { type Actor, OpError, requireRole } from './core'
import { getGraph } from './people'
import { getPlace, listPlaces, savePlace } from './places'
import { say } from './settings'

let loaded: Gazetteer | null | undefined
let release: ReturnType<typeof setTimeout> | undefined
/** How long the extract stays in memory after the last use: it is large, and most days nobody asks for a point. */
const KEEP_MS = 10 * 60_000
/** The extract, read when first asked for and let go after ten idle minutes; null when the file is missing. */
export function gazetteer(): Gazetteer | null {
  if (loaded === undefined) {
    try {
      const file = path.join(/*turbopackIgnore: true*/ process.cwd(), 'public', 'gazetteer', 'places.tsv.gz')
      loaded = parseGazetteer(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'))
      prepare(loaded)
    } catch {
      loaded = null
    }
  }
  if (loaded) {
    clearTimeout(release)
    release = setTimeout(() => { loaded = undefined }, KEEP_MS)
    release.unref?.()
  }
  return loaded
}
/** For tests: a small extract in place of the shipped one. */
export const useGazetteer = (g: Gazetteer | null) => { clearTimeout(release); loaded = g }

export interface PointGuess {
  /** The record without a point, or null for a place written on cards that has no record yet. */
  placeId: string | null
  text: string
  people: number
  candidates: Candidate[]
}

interface Event { text: string; placeId: string | null; year: number | null; people: string[] }

/** Every event that names a place, with its year and whose life it is in. Hidden people are already masked out. */
function events(g: Graph): Event[] {
  const out: Event[] = []
  for (const p of g.persons) {
    if (p.hidden) continue
    const add = (text: string, placeId: string | null | undefined, date: string) => { if (text.trim()) out.push({ text: text.trim(), placeId: placeId ?? null, year: yearOf(date), people: [p.id] }) }
    add(p.birthPlace, p.birthPlaceId, p.birthDate)
    add(p.deathPlace, p.deathPlaceId, p.deathDate)
    for (const f of p.facts) add(f.place, f.placeId, f.date)
  }
  const hidden = new Set(g.persons.filter((p) => p.hidden).map((p) => p.id))
  for (const u of g.unions) if (u.place.trim() && !hidden.has(u.aId) && !hidden.has(u.bId)) out.push({ text: u.place.trim(), placeId: u.placeId ?? null, year: yearOf(u.startDate), people: [u.aId, u.bId] })
  return out
}

/**
 * Each place the map cannot draw for want of a point, with its best candidates: records with no point, and places
 * written on cards that have no record. A text two records answer to is left to the person to choose, not guessed.
 */
export function placePointGuesses(actor: Actor): { snapshot: string | null; guesses: PointGuess[] } {
  requireRole(actor, 'editor')
  const gz = gazetteer()
  if (!gz) return { snapshot: null, guesses: [] }
  const places = listPlaces(actor)
  const graph = getGraph(actor)
  const evs = events(graph)
  // Where each person is already on the map: a village near them is likelier than one of its name across the country.
  const points = new Map<string, { lat: number; lon: number }[]>()
  const targets = new Map<string, { placeId: string | null; text: string; place: Place | null; hints: Set<string>; years: number[]; people: Set<string> }>()
  for (const e of evs) {
    const place = findPlace(e.text, places, e.placeId)
    if (onMap(place)) {
      for (const id of e.people) points.set(id, [...(points.get(id) ?? []), { lat: place.lat, lon: place.lon }])
      continue
    }
    if (!place && placeMatches(e.text, places).length > 1) continue
    const k = place ? place.id : `text:${e.text.split(',')[0].trim().toLowerCase().replace(/ё/g, 'е')}`
    const t = targets.get(k) ?? { placeId: place?.id ?? null, text: place ? place.name : e.text.split(',')[0].trim(), place, hints: new Set<string>(), years: [], people: new Set<string>() }
    for (const part of e.text.split(',').slice(1)) if (part.trim()) t.hints.add(part.trim())
    if (e.year !== null) t.years.push(e.year)
    e.people.forEach((id) => t.people.add(id))
    targets.set(k, t)
  }
  // A record nobody's card names yet still lacks a point; it is offered too, with what it belongs to as its only clue.
  for (const p of places) if (!onMap(p) && !targets.has(p.id)) targets.set(p.id, { placeId: p.id, text: p.name, place: p, hints: new Set(), years: [], people: new Set() })
  const guesses: PointGuess[] = []
  for (const t of targets.values()) {
    // Countries and provinces have no single point a family lived at; only what holds no other place is guessed.
    if (t.place && places.some((p) => p.parentId === t.place!.id)) continue
    const hints = [...t.hints, ...(t.place ? placeChain(t.place, places).slice(1).flatMap((x) => [x.name, ...x.otherNames.map((n) => n.name)]) : [])]
    const near = [...t.people].flatMap((id) => points.get(id) ?? [])
    const names = t.place ? [t.place.name, ...t.place.otherNames.map((n) => n.name)] : [t.text]
    let candidates: Candidate[] = []
    for (const n of names) {
      for (const c of guessPlace(n, gz, { hints, near, years: t.years })) if (!candidates.some((x) => x.id === c.id)) candidates.push(c)
      if (candidates.length >= 3) break
    }
    candidates = candidates.sort((a, b) => b.score - a.score).slice(0, 3)
    guesses.push({ placeId: t.placeId, text: t.text, people: t.people.size, candidates })
  }
  return { snapshot: gz.snapshot, guesses: guesses.sort((a, b) => b.people - a.people || a.text.localeCompare(b.text)) }
}

/**
 * Sets the point of a place from a GeoNames candidate an editor chose: the candidate is looked up here, never taken
 * from the page, and the place's note says where the point came from. A place written on cards with no record gets one.
 */
export function applyPointGuess(actor: Actor, raw: unknown) {
  requireRole(actor, 'editor')
  const body = (raw ?? {}) as { placeId?: unknown; text?: unknown; geonameId?: unknown }
  const gz = gazetteer()
  if (!gz) throw new OpError(503, 'the GeoNames extract is not installed')
  const id = Number(body.geonameId)
  const c = gazPlace(gz, id)
  if (!c) throw new OpError(400, 'no such GeoNames place')
  const region = gz.regions[`${c.cc}.${c.region}`]?.find((n) => /[а-яё]/i.test(n)) ?? gz.regions[`${c.cc}.${c.region}`]?.[0] ?? ''
  const credit = `${say('Точка взята из GeoNames')} (${gz.snapshot}): ${[c.ru || c.name, region, c.cc].filter(Boolean).join(', ')}, geonames.org/${c.id}`
  const summary = (name: string) => `${say('Место')}: ${name} — ${say('точка из GeoNames')}`
  if (typeof body.placeId === 'string' && body.placeId) {
    const p = getPlace(body.placeId)
    if (onMap(p)) throw new OpError(409, 'this place already has a point')
    return savePlace(actor, p.id, { name: p.name, kind: p.kind, parentId: p.parentId, otherNames: p.otherNames, lat: c.lat, lon: c.lon, note: [p.note, credit].filter(Boolean).join('\n').slice(0, 2000) }, summary(p.name))
  }
  const text = typeof body.text === 'string' ? body.text.split(',')[0].trim() : ''
  if (!text) throw new OpError(400, 'a place or its text is needed')
  return savePlace(actor, null, { name: text, lat: c.lat, lon: c.lon, note: credit }, summary(text))
}
