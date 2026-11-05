// What people told. A story is someone's words, never a fact; a fact can name a story as its source.
// Who may hear it follows the same rule as a photo: nobody hidden from you is in it or told it.
import { and, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '../db'
import { personName, type Story } from '../types'
import { Actor, Changes, mutate, newId, OpError, requireRole, seesOnlyPublic } from './core'
import * as media from './media'
import { personFor } from './op-defs'
import { getPersonRow, hiddenPeople } from './people'
import { say } from './settings'

const fields = {
  title: z.string().trim().max(200).default(''),
  body: z.string().trim().max(20000).default(''),
  tellerId: z.string().max(40).nullish(),
  tellerName: z.string().trim().max(120).default(''),
  toldOn: z.string().trim().max(60).default(''),
  about: z.array(z.string().max(40)).min(1).max(30),
  durationSec: z.number().int().min(0).max(86400).nullish(),
}
export const newStory = z.object(fields)
const editStory = z.object({ ...fields, baseUpdatedAt: z.number() })

type Row = typeof schema.stories.$inferSelect

function linkPeople(c: Changes, storyId: string, about: string[], tellerId?: string | null) {
  for (const personId of new Set(about)) c.insert('storyPeople', { id: newId(), storyId, personId, role: 'about' })
  if (tellerId) c.insert('storyPeople', { id: newId(), storyId, personId: tellerId, role: 'teller' })
}

/** Applied directly for an editor, and when someone accepts a reader's story. */
export function createStory(actor: Actor, x: z.infer<typeof newStory> & { audio?: media.StoredUpload | null; createdBy?: string }) {
  requireRole(actor, 'editor')
  const about = [...new Set(x.about)].map(getPersonRow)
  if (x.tellerId) getPersonRow(x.tellerId)
  const id = newId()
  const now = Date.now()
  mutate(actor, { summary: `${personName(about[0])}: ${say('Рассказ')}${x.title ? ` «${x.title}»` : ''}`, personIds: about.map((p) => p.id) }, (c) => {
    if (x.audio) c.insert('media', x.audio as never)
    c.insert('stories', { id, title: x.title, body: x.body, tellerName: x.tellerName, toldOn: x.toldOn, mediaId: x.audio?.id ?? null, durationSec: x.durationSec ?? null, createdBy: x.createdBy ?? actor.name, createdAt: now, updatedAt: now })
    linkPeople(c, id, x.about, x.tellerId)
  })
  return { id }
}

export function updateStory(actor: Actor, id: string, raw: unknown) {
  requireRole(actor, 'editor')
  const { baseUpdatedAt, about, tellerId, ...patch } = editStory.parse(raw)
  const db = getDb()
  const story = row(id)
  if (baseUpdatedAt !== story.updatedAt) throw new OpError(409, 'the story changed since this copy was read')
  const people = [...new Set(about)].map(getPersonRow)
  if (tellerId) getPersonRow(tellerId)
  const updatedAt = Math.max(Date.now(), story.updatedAt + 1)
  mutate(actor, { summary: `${personName(people[0])}: ${say('Рассказ')}${patch.title ? ` «${patch.title}»` : ''}`, personIds: people.map((p) => p.id) }, (c) => {
    c.update('stories', id, { ...patch, updatedAt })
    for (const r of db.select({ id: schema.storyPeople.id }).from(schema.storyPeople).where(eq(schema.storyPeople.storyId, id)).all()) c.remove('storyPeople', r.id)
    linkPeople(c, id, about, tellerId)
  })
  return { updatedAt }
}

/** The file stays on disk, as with a photo, so the deletion can be undone. */
export function deleteStory(actor: Actor, id: string) {
  requireRole(actor, 'editor')
  const db = getDb()
  const story = row(id)
  const links = db.select().from(schema.storyPeople).where(eq(schema.storyPeople.storyId, id)).all()
  mutate(actor, { summary: `${say('Удалить')}: ${say('Рассказ')}${story.title ? ` «${story.title}»` : ''}`, personIds: links.map((l) => l.personId) }, (c) => {
    links.forEach((l) => c.remove('storyPeople', l.id))
    if (story.mediaId) c.remove('media', story.mediaId)
    c.remove('stories', id)
  })
}

function row(id: string): Row {
  const r = getDb().select().from(schema.stories).where(eq(schema.stories.id, id)).get()
  if (!r) throw new OpError(404, 'not found')
  return r
}

function shape(actor: Actor, r: Row, links: { personId: string; role: string }[]): Story | null {
  const about = links.filter((l) => l.role === 'about').map((l) => l.personId)
  const tellerId = links.find((l) => l.role === 'teller')?.personId ?? null
  const base = { id: r.id, title: r.title, body: r.body, toldOn: r.toldOn, durationSec: r.durationSec, about, tellerId, createdAt: r.createdAt, updatedAt: r.updatedAt }
  if (!seesOnlyPublic(actor)) return { ...base, tellerName: r.tellerName, createdBy: r.createdBy, hasAudio: !!r.mediaId }
  const hidden = hiddenPeople(actor)
  if (links.some((l) => hidden.has(l.personId))) return null
  // A name with no card behind it may be a living person's, and so may a voice nobody can place.
  return { ...base, tellerName: '', createdBy: '', hasAudio: !!r.mediaId && !!tellerId }
}

const linksOf = (ids: string[]) => Map.groupBy(ids.length ? getDb().select().from(schema.storyPeople).where(inArray(schema.storyPeople.storyId, ids)).all() : [], (l) => l.storyId)

export function listStories(actor: Actor, personId: string): Story[] {
  // Someone's own words stay among people until the family decides otherwise.
  if (actor.tokenId || actor.assistant) throw new OpError(403, 'not available to tokens')
  personFor(actor, personId)
  const db = getDb()
  const sp = schema.storyPeople
  const ids = db.select({ id: sp.storyId }).from(sp).where(and(eq(sp.personId, personId), eq(sp.role, 'about'))).all().map((r) => r.id)
  if (!ids.length) return []
  const links = linksOf(ids)
  return db.select().from(schema.stories).where(inArray(schema.stories.id, ids)).orderBy(desc(schema.stories.createdAt)).all().flatMap((r) => shape(actor, r, links.get(r.id) ?? []) ?? [])
}

export function storyAudio(actor: Actor, id: string) {
  const r = row(id)
  if (actor.tokenId || actor.assistant || !shape(actor, r, linksOf([id]).get(id) ?? [])?.hasAudio) throw new OpError(404, 'not found')
  const file = getDb().select().from(schema.media).where(eq(schema.media.id, r.mediaId!)).get()
  if (!file) throw new OpError(404, 'not found')
  return { filename: file.filename, mime: file.mime }
}

export function voiceUsage(actor: Actor) {
  requireRole(actor, 'owner')
  return { used: media.audioUsed(), limit: media.audioLimit() }
}
