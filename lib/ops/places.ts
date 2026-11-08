// Places and repositories: what the words on the cards mean. Not personal, so anyone who reads the archive reads them,
// and only editors change them. Every change goes to the history and can be undone.
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '../db'
import { findPlace, placeChain, placesInUse } from '../places'
import type { Place, Repository } from '../types'
import { Actor, mutate, newId, OpError, requireRole, seesOnlyPublic } from './core'
import { getGraph } from './people'
import { say } from './settings'

export const placeInput = z.object({
  name: z.string().trim().min(1).max(160),
  kind: z.string().trim().max(40).default(''),
  parentId: z.string().max(40).nullable().default(null),
  otherNames: z.array(z.object({ name: z.string().trim().min(1).max(160), years: z.string().trim().max(40).default('') })).max(30).default([]),
  lat: z.number().min(-90).max(90).nullable().default(null),
  lon: z.number().min(-180).max(180).nullable().default(null),
  note: z.string().trim().max(2000).default(''),
})

/** A change to a place: only the fields given, with none filled in by default. */
export const placePatch = z.object({
  name: z.string().trim().min(1).max(160),
  kind: z.string().trim().max(40),
  parentId: z.string().max(40).nullable(),
  otherNames: z.array(z.object({ name: z.string().trim().min(1).max(160), years: z.string().trim().max(40).default('') })).max(30),
  lat: z.number().min(-90).max(90).nullable(),
  lon: z.number().min(-180).max(180).nullable(),
  note: z.string().trim().max(2000),
}).partial()

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

/** A place cannot sit inside itself, however many steps around. */
function checkParent(id: string | null, parentId: string | null) {
  const db = getDb()
  for (let at = parentId, steps = 0; at; steps++) {
    if (at === id || steps > 50) throw new OpError(400, 'a place cannot be inside itself')
    at = db.select({ p: schema.places.parentId }).from(schema.places).where(eq(schema.places.id, at)).get()?.p ?? null
  }
}

export function savePlace(actor: Actor, id: string | null, raw: unknown) {
  requireRole(actor, 'editor')
  const v = placeInput.parse(raw)
  if (v.parentId && !getDb().select().from(schema.places).where(eq(schema.places.id, v.parentId)).get()) throw new OpError(400, 'no such parent place')
  checkParent(id, v.parentId)
  const row = { ...v, otherNames: JSON.stringify(v.otherNames), updatedAt: Date.now() }
  return mutate(actor, { summary: `${say('Место')}: ${v.name}` }, (c) => {
    if (id) { if (!getDb().select().from(schema.places).where(eq(schema.places.id, id)).get()) throw new OpError(404, 'not found'); c.update('places', id, row); return { id } }
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
