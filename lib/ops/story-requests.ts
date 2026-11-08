// A link that asks someone to tell a story. Whoever holds it can only send a recording, which waits for review: they
// read nothing from the archive beyond the name they were asked about, and they never get a session.
import { createHash, randomBytes } from 'node:crypto'
import { desc, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '../db'
import { personName } from '../types'
import { Actor, newId, OpError, requireRole } from './core'
import * as media from './media'
import { getPersonRow } from './people'
import { enqueue } from './proposals'
import { getSetting, say } from './settings'

const DAY = 24 * 3600 * 1000
/** Enough for a long talk in many parts, not enough to fill the disk if a link goes astray. */
const MAX_PER_LINK = 30

/** Up to five, each on its own line, none empty. */
export const questionsOf = (s: string) => s.split('\n').map((q) => q.trim()).filter(Boolean).slice(0, 5)

const hash = (s: string) => createHash('sha256').update(s).digest('hex')
type Row = typeof schema.storyRequests.$inferSelect
const live = (r: Row | undefined): r is Row => !!r && !r.revokedAt && (!r.expiresAt || r.expiresAt > Date.now())
const byToken = (token: string) => getDb().select().from(schema.storyRequests).where(eq(schema.storyRequests.tokenHash, hash(token))).get()

const input = z.object({
  personId: z.string().max(40),
  tellerName: z.string().trim().max(120).default(''),
  // One question a line: the teller picks one before each recording, and it names what they send.
  question: z.string().trim().max(1200).default('').transform((s) => questionsOf(s).join('\n')),
  expiresInDays: z.number().int().min(1).max(365).default(60),
})

export function createRequest(actor: Actor, raw: unknown) {
  requireRole(actor, 'owner')
  const v = input.parse(raw)
  getPersonRow(v.personId)
  const token = randomBytes(24).toString('base64url')
  const now = Date.now()
  getDb().insert(schema.storyRequests).values({ id: newId(), tokenHash: hash(token), personId: v.personId, tellerName: v.tellerName, question: v.question, createdBy: actor.userId, createdAt: now, expiresAt: now + v.expiresInDays * DAY }).run()
  return { token }
}

export function listRequests(actor: Actor) {
  requireRole(actor, 'owner')
  const q = schema.storyRequests
  return getDb().select().from(q).where(isNull(q.revokedAt)).orderBy(desc(q.createdAt)).all().filter(live).flatMap((r) => {
    try { return [{ id: r.id, about: personName(getPersonRow(r.personId)), tellerName: r.tellerName, received: r.received, expiresAt: r.expiresAt }] } catch { return [] }
  })
}

export function closeRequest(actor: Actor, id: string) {
  requireRole(actor, 'owner')
  getDb().update(schema.storyRequests).set({ revokedAt: Date.now() }).where(eq(schema.storyRequests.id, id)).run()
}

/** What the page shows: the family's name, who it is about, and the question. Nothing else leaves. */
export function requestInfo(token: string) {
  const r = byToken(token)
  if (!live(r)) return null
  try {
    return { about: personName(getPersonRow(r.personId)), tellerName: r.tellerName, question: r.question, familyName: getSetting('familyName') ?? '' }
  } catch {
    return null
  }
}

export async function submitRecording(token: string, file: { buf: Buffer; name: string }, seconds: number | null, topic: number | null = null) {
  const r = byToken(token)
  if (!live(r)) throw new OpError(404, say('Ссылка недействительна'))
  if (r.received >= MAX_PER_LINK) throw new OpError(429, say('По этой ссылке уже много записей. Попросите новую.'))
  const person = getPersonRow(r.personId)
  // Its own author, so one link's recordings wait together and can be told from anyone else's.
  const actor: Actor = { userId: `request:${r.id}`, name: r.tellerName || say('Запись по ссылке'), role: 'reader', personId: null }
  const audio = await media.storeAudio(file.buf, file.name || 'voice', actor.userId)
  try {
    // Only a question the link asks can name the story: anything else from the page is ignored.
    const asked = questionsOf(r.question)
    const title = (topic !== null && asked[topic]) || asked[0] || ''
    enqueue(actor, [{ op: 'create_story', args: { title, body: '', tellerName: r.tellerName, about: [person.id], toldOn: '', durationSec: seconds, audio, createdBy: actor.name }, details: [] }] as never)
  } catch (e) {
    await media.discardUpload(audio.id)
    throw e
  }
  getDb().update(schema.storyRequests).set({ received: sql`${schema.storyRequests.received} + 1` }).where(eq(schema.storyRequests.id, r.id)).run()
  return { ok: true }
}
