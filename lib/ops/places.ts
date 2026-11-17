// Places and repositories: what the words on the cards mean. Not personal, so anyone who reads the archive reads them,
// and only editors change them. Every change goes to the history and can be undone.
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '../db'
import { coordinateIssue, findPlace, placeChain, placeMatches, placeProblem, placesInUse } from '../places'
import type { Fact, Place, Repository } from '../types'
import { Actor, type Changes, mutate, newId, OpError, requireRole, seesOnlyPublic } from './core'
import { getGraph } from './people'
import { say } from './settings'

const lat = z.number().min(-90, 'latitude must be between -90 and 90').max(90, 'latitude must be between -90 and 90').nullable()
const lon = z.number().min(-180, 'longitude must be between -180 and 180').max(180, 'longitude must be between -180 and 180').nullable()

/** 0, 0 is the point an import or a hurried edit leaves when there is none: the Gulf of Guinea is nobody's village. */
const noEmptyPoint = (v: { lat?: number | null; lon?: number | null }, ctx: z.RefinementCtx) => {
  if (v.lat === 0 && v.lon === 0) ctx.addIssue({ code: 'custom', path: ['lat'], message: '0, 0 is not a place: leave the coordinates empty, or give the real ones' })
}

export const placeInput = z.object({
  name: z.string().trim().min(1).max(160),
  kind: z.string().trim().max(40).default(''),
  parentId: z.string().max(40).nullable().default(null),
  otherNames: z.array(z.object({ name: z.string().trim().min(1).max(160), years: z.string().trim().max(40).default('') })).max(30).default([]),
  lat: lat.default(null),
  lon: lon.default(null),
  note: z.string().trim().max(2000).default(''),
}).superRefine(noEmptyPoint)

/** A change to a place: only the fields given, with none filled in by default. */
export const placePatch = z.object({
  name: z.string().trim().min(1).max(160),
  kind: z.string().trim().max(40),
  parentId: z.string().max(40).nullable(),
  otherNames: z.array(z.object({ name: z.string().trim().min(1).max(160), years: z.string().trim().max(40).default('') })).max(30),
  lat,
  lon,
  note: z.string().trim().max(2000),
}).partial().superRefine(noEmptyPoint)

export const repositoryInput = z.object({
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().max(300).default(''),
  url: z.string().trim().max(500).default(''),
  note: z.string().trim().max(2000).default(''),
})

export const toPlace = (r: typeof schema.places.$inferSelect): Place => ({ id: r.id, name: r.name, kind: r.kind, parentId: r.parentId, otherNames: JSON.parse(r.otherNames), lat: r.lat, lon: r.lon, note: r.note })

export function listPlaces(actor: Actor): Place[] {
  const all = getDb().select().from(schema.places).all().map(toPlace).sort((a, b) => a.name.localeCompare(b.name))
  if (!seesOnlyPublic(actor)) return all
  // A place can be all that is left of a hidden relative, such as the town a living cousin was born in:
  // a reader or a link sees only the places of people shown to them, and what those places were part of.
  const g = getGraph(actor)
  const hidden = new Set(g.persons.filter((p) => p.hidden).map((p) => p.id))
  const shown = new Set<string>()
  for (const use of placesInUse({ ...g, unions: g.unions.filter((u) => !hidden.has(u.aId) && !hidden.has(u.bId)) })) {
    const place = findPlace(use.text, all, use.placeId)
    if (place) for (const p of placeChain(place, all)) shown.add(p.id)
  }
  return all.filter((p) => shown.has(p.id))
}

export function getPlace(id: string): Place {
  const r = getDb().select().from(schema.places).where(eq(schema.places.id, id)).get()
  if (!r) throw new OpError(404, `place ${id} not found`)
  return toPlace(r)
}

/** A place a write names, and why the map cannot show it: said in the tool's answer with the place's name. */
export interface PlaceWarning { name: string; problem: 'unknown' | 'no-coords' | 'ambiguous'; message: string; choices?: { id: string; name: string }[] }
/** A place as a write gave it: the text, and the record it was linked to, if any. */
export interface NamedPlace { text: string; id?: string | null }

/**
 * Writes name places; a place the archive does not know, has no point for, or has two records of, leaves the move
 * off the map, and an answer that only said "ok" would let a model think it was there. Each one is said in words,
 * with what to call; two records of one name are listed, so the model can say which.
 */
export function placeWarnings(names: (string | NamedPlace)[]): PlaceWarning[] {
  if (!names.length) return []
  const all = getDb().select().from(schema.places).all().map(toPlace)
  const out: PlaceWarning[] = []
  for (const n of names) {
    const { text, id } = typeof n === 'string' ? { text: n, id: null } : n
    const problem = placeProblem(text, all, id)
    const name = text.trim()
    if (!problem || !name || out.some((w) => w.problem === problem && w.name.toLowerCase() === name.toLowerCase())) continue
    if (problem === 'ambiguous') {
      const choices = placeMatches(text, all).map((p) => ({ id: p.id, name: placeChain(p, all).map((x) => x.name).join(', ') }))
      out.push({ name, problem, choices, message: `Several places are called "${name}": ${choices.map((c) => `${c.name} (${c.id})`).join('; ')}. Write the place with what it belongs to, e.g. "${choices[0].name}", and it is linked to that one` })
      continue
    }
    out.push({ name, problem, message: problem === 'unknown'
      ? `No place "${name}" is in the archive, so this will not show on the map: add it with create_place, giving its name and point (lat, lon)`
      : `The archive has "${name}", but no usable point for it on the map: give it coordinates with update_place (lat, lon) if they are known` })
  }
  return out
}

/**
 * Before a place is added or renamed: every place written on a card that today means one record, and would stop
 * meaning it once a second place of that name exists, is linked to it first. A second Ivanovka in another province
 * then leaves the people of the first where they were, instead of turning them all into a question.
 */
function pinLinks(c: Changes, before: Place[], after: Place[]) {
  const db = getDb()
  const moved = (text: string, id: string | null | undefined) => {
    const was = findPlace(text, before, id)
    return was && findPlace(text, after, id)?.id !== was.id ? was.id : null
  }
  for (const r of db.select().from(schema.persons).all()) {
    const patch: Record<string, unknown> = {}
    const b = moved(r.birthPlace, r.birthPlaceId), d = moved(r.deathPlace, r.deathPlaceId)
    if (b) patch.birthPlaceId = b
    if (d) patch.deathPlaceId = d
    const facts = JSON.parse(r.facts || '[]') as Fact[]
    let changed = false
    const next = facts.map((f) => { const to = f.place ? moved(f.place, f.placeId) : null; if (!to) return f; changed = true; return { ...f, placeId: to } })
    if (changed) patch.facts = JSON.stringify(next)
    if (Object.keys(patch).length) c.update('persons', r.id, patch)
  }
  for (const u of db.select().from(schema.unions).all()) {
    const to = u.place ? moved(u.place, u.placeId) : null
    if (to) c.update('unions', u.id, { placeId: to })
  }
}

/**
 * Two records of one place become one, as one change undone at once: the kept record takes the other's names and
 * whatever it lacked (a point, what it belongs to, a note), every card linked to the other is linked to it, and
 * places inside the other move inside it. The cards' texts stay as written.
 */
export function mergePlaces(actor: Actor, keepId: string, dropId: string) {
  requireRole(actor, 'editor')
  if (keepId === dropId) throw new OpError(400, 'a place cannot be merged into itself')
  const keep = getPlace(keepId), drop = getPlace(dropId)
  const before = getDb().select().from(schema.places).all().map(toPlace)
  const names = [...keep.otherNames]
  for (const n of [{ name: drop.name, years: '' }, ...drop.otherNames]) {
    const k = n.name.trim().toLowerCase()
    if (k !== keep.name.trim().toLowerCase() && !names.some((x) => x.name.trim().toLowerCase() === k)) names.push(n)
  }
  const merged: Place = {
    ...keep, otherNames: names.slice(0, 30),
    lat: keep.lat ?? drop.lat, lon: keep.lat === null ? drop.lon : keep.lon,
    parentId: keep.parentId ?? (drop.parentId === keepId ? null : drop.parentId), kind: keep.kind || drop.kind,
    note: [keep.note, drop.note].filter(Boolean).join('\n\n').slice(0, 2000),
  }
  const after = [...before.filter((p) => p.id !== keepId && p.id !== dropId), merged]
  const db = getDb()
  return mutate(actor, { summary: `${say('Объединить места')}: ${keep.name} ← ${drop.name}` }, (c) => {
    // Where a card meant the dropped record, by link or by its text alone, it now means the kept one.
    const to = (text: string, id: string | null | undefined) => (text && (id === dropId || findPlace(text, before, id)?.id === dropId) ? keepId : id === dropId ? null : undefined)
    for (const r of db.select().from(schema.persons).all()) {
      const patch: Record<string, unknown> = {}
      const b = to(r.birthPlace, r.birthPlaceId), d = to(r.deathPlace, r.deathPlaceId)
      if (b !== undefined) patch.birthPlaceId = b
      if (d !== undefined) patch.deathPlaceId = d
      const facts = JSON.parse(r.facts || '[]') as Fact[]
      let changed = false
      const next = facts.map((f) => { const x = to(f.place, f.placeId); if (x === undefined) return f; changed = true; return { ...f, placeId: x } })
      if (changed) patch.facts = JSON.stringify(next)
      if (Object.keys(patch).length) c.update('persons', r.id, patch)
    }
    for (const u of db.select().from(schema.unions).all()) { const x = to(u.place, u.placeId); if (x !== undefined) c.update('unions', u.id, { placeId: x }) }
    for (const child of db.select().from(schema.places).where(eq(schema.places.parentId, dropId)).all()) if (child.id !== keepId) c.update('places', child.id, { parentId: keepId })
    c.update('places', keepId, { otherNames: JSON.stringify(merged.otherNames), lat: merged.lat, lon: merged.lon, parentId: merged.parentId, kind: merged.kind, note: merged.note, updatedAt: Date.now() })
    c.remove('places', dropId)
    pinLinks(c, before, after)
    return { id: keepId }
  })
}

/** A place cannot sit inside itself, however many steps around. */
function checkParent(id: string | null, parentId: string | null) {
  const db = getDb()
  for (let at = parentId, steps = 0; at; steps++) {
    if (at === id || steps > 50) throw new OpError(400, 'a place cannot be inside itself')
    at = db.select({ p: schema.places.parentId }).from(schema.places).where(eq(schema.places.id, at)).get()?.p ?? null
  }
}

/** A point that cannot be right stops the write here too, whether it came from a page, a script or the assistant. */
function refuseBadPoint(raw: unknown) {
  const p = raw as { lat?: unknown; lon?: unknown } | null
  const lat = typeof p?.lat === 'number' ? p.lat : null
  const lon = typeof p?.lon === 'number' ? p.lon : null
  const bad = coordinateIssue(lat, lon)
  if (!bad?.block) return
  throw new OpError(400, bad.kind === 'zero' ? 'point 0,0 is not a place' : bad.kind === 'swapped' ? 'latitude and longitude look swapped' : 'coordinates out of range')
}

/** `summary` names a change the history should tell apart from a hand edit, such as a point taken from GeoNames. */
export function savePlace(actor: Actor, id: string | null, raw: unknown, summary?: string) {
  requireRole(actor, 'editor')
  refuseBadPoint(raw)
  const v = placeInput.parse(raw)
  if (v.parentId && !getDb().select().from(schema.places).where(eq(schema.places.id, v.parentId)).get()) throw new OpError(400, 'no such parent place')
  checkParent(id, v.parentId)
  const row = { ...v, otherNames: JSON.stringify(v.otherNames), updatedAt: Date.now() }
  const before = getDb().select().from(schema.places).all().map(toPlace)
  return mutate(actor, { summary: summary ?? `${say('Место')}: ${v.name}` }, (c) => {
    const keepLinks = (savedId: string, otherNames: string) => {
      const after = [...before.filter((p) => p.id !== savedId), toPlace({ id: savedId, ...row, otherNames, kind: v.kind, parentId: v.parentId, lat: v.lat, lon: v.lon, note: v.note, updatedAt: row.updatedAt })]
      pinLinks(c, before, after)
    }
    if (id) {
      const was = getDb().select().from(schema.places).where(eq(schema.places.id, id)).get()
      if (!was) throw new OpError(404, 'not found')
      // Cards name a place by its text, not by this record: a renamed place keeps its old name among its other
      // names, as genealogy programs keep a place's earlier names, so no birth or move written with it drops off.
      const old = was.name.trim()
      if (old.toLowerCase() !== v.name.toLowerCase() && !v.otherNames.some((n) => n.name.toLowerCase() === old.toLowerCase()) && v.otherNames.length < 30) {
        row.otherNames = JSON.stringify([...v.otherNames, { name: old, years: '' }])
      }
      keepLinks(id, row.otherNames)
      c.update('places', id, row)
      return { id }
    }
    const created = newId()
    keepLinks(created, row.otherNames)
    c.insert('places', { id: created, ...row })
    return { id: created }
  })
}

export function deletePlace(actor: Actor, id: string) {
  requireRole(actor, 'editor')
  const db = getDb()
  const p = db.select().from(schema.places).where(eq(schema.places.id, id)).get()
  if (!p) throw new OpError(404, 'not found')
  mutate(actor, { summary: `${say('Удалить')}: ${say('Место')} ${p.name}` }, (c) => {
    // What was inside moves up a level rather than vanishing with it.
    for (const child of db.select().from(schema.places).where(eq(schema.places.parentId, id)).all()) c.update('places', child.id, { parentId: p.parentId })
    c.remove('places', id)
  })
}

export function listRepositories(actor: Actor): Repository[] {
  void actor
  return getDb().select().from(schema.repositories).all().map(({ updatedAt: _, ...r }) => r).sort((a, b) => a.name.localeCompare(b.name))
}

export function saveRepository(actor: Actor, id: string | null, raw: unknown) {
  requireRole(actor, 'editor')
  const v = repositoryInput.parse(raw)
  return mutate(actor, { summary: `${say('Архив')}: ${v.name}` }, (c) => {
    if (id) { if (!getDb().select().from(schema.repositories).where(eq(schema.repositories.id, id)).get()) throw new OpError(404, 'not found'); c.update('repositories', id, { ...v, updatedAt: Date.now() }); return { id } }
    const created = newId()
    c.insert('repositories', { id: created, ...v, updatedAt: Date.now() })
    return { id: created }
  })
}

export function deleteRepository(actor: Actor, id: string) {
  requireRole(actor, 'editor')
  const r = getDb().select().from(schema.repositories).where(eq(schema.repositories.id, id)).get()
  if (!r) throw new OpError(404, 'not found')
  mutate(actor, { summary: `${say('Удалить')}: ${say('Архив')} ${r.name}` }, (c) => c.remove('repositories', id))
}
