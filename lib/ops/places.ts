// Places and repositories: what the words on the cards mean. Not personal, so anyone who reads the archive reads them,
// and only editors change them. Every change goes to the history and can be undone.
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '../db'
import { coordinateIssue, findPlace, placeChain, placeProblem, placesInUse } from '../places'
import type { Place, Repository } from '../types'
import { Actor, mutate, newId, OpError, requireRole, seesOnlyPublic } from './core'
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

const toPlace = (r: typeof schema.places.$inferSelect): Place => ({ id: r.id, name: r.name, kind: r.kind, parentId: r.parentId, otherNames: JSON.parse(r.otherNames), lat: r.lat, lon: r.lon, note: r.note })

export function listPlaces(actor: Actor): Place[] {
  const all = getDb().select().from(schema.places).all().map(toPlace).sort((a, b) => a.name.localeCompare(b.name))
  if (!seesOnlyPublic(actor)) return all
  // A place can be all that is left of a hidden relative, such as the town a living cousin was born in:
  // a reader or a link sees only the places of people shown to them, and what those places were part of.
  const g = getGraph(actor)
  const hidden = new Set(g.persons.filter((p) => p.hidden).map((p) => p.id))
  const shown = new Set<string>()
  for (const use of placesInUse({ ...g, unions: g.unions.filter((u) => !hidden.has(u.aId) && !hidden.has(u.bId)) })) {
    const place = findPlace(use.text, all)
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
export interface PlaceWarning { name: string; problem: 'unknown' | 'no-coords'; message: string }

/**
 * Writes name places; a place the archive does not know, or has no point for, leaves the move off the map,
 * and an answer that only said "ok" would let a model think it was there. Each one is said in words, with what to call.
 */
export function placeWarnings(names: string[]): PlaceWarning[] {
  if (!names.length) return []
  const all = getDb().select().from(schema.places).all().map(toPlace)
  const out: PlaceWarning[] = []
  for (const text of names) {
    const problem = placeProblem(text, all)
    const name = text.trim()
    if (!problem || !name || out.some((w) => w.problem === problem && w.name.toLowerCase() === name.toLowerCase())) continue
    out.push({ name, problem, message: problem === 'unknown'
      ? `No place "${name}" is in the archive, so this will not show on the map: add it with create_place, giving its name and point (lat, lon)`
      : `The archive has "${name}", but no usable point for it on the map: give it coordinates with update_place (lat, lon) if they are known` })
  }
  return out
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

export function savePlace(actor: Actor, id: string | null, raw: unknown) {
  requireRole(actor, 'editor')
  refuseBadPoint(raw)
  const v = placeInput.parse(raw)
  if (v.parentId && !getDb().select().from(schema.places).where(eq(schema.places.id, v.parentId)).get()) throw new OpError(400, 'no such parent place')
  checkParent(id, v.parentId)
  const row = { ...v, otherNames: JSON.stringify(v.otherNames), updatedAt: Date.now() }
  return mutate(actor, { summary: `${say('Место')}: ${v.name}` }, (c) => {
    if (id) {
      const was = getDb().select().from(schema.places).where(eq(schema.places.id, id)).get()
      if (!was) throw new OpError(404, 'not found')
      // Cards name a place by its text, not by this record: a renamed place keeps its old name among its other
      // names, as genealogy programs keep a place's earlier names, so no birth or move written with it drops off.
      const old = was.name.trim()
      if (old.toLowerCase() !== v.name.toLowerCase() && !v.otherNames.some((n) => n.name.toLowerCase() === old.toLowerCase()) && v.otherNames.length < 30) {
        row.otherNames = JSON.stringify([...v.otherNames, { name: old, years: '' }])
      }
      c.update('places', id, row)
      return { id }
    }
    const created = newId()
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
