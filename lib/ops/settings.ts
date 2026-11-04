import { translate } from '../i18n'
import { createHash, randomBytes } from 'node:crypto'
import { desc, eq, isNull } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { HistoryEntry, Role } from '../types'
import { Actor, newId, OpError, requireRole, seesOnlyPublic } from './core'
import { getGraph } from './people'

/** A label in the archive's language, for summaries written on the server. */
export const say = (key: string) => translate(getSetting('language') === 'en' ? 'en' : 'ru', key)

export function getSetting(key: string): string | null {
  return getDb().select().from(schema.settings).where(eq(schema.settings.key, key)).get()?.value ?? null
}

export function setSetting(key: string, value: string) {
  getDb().insert(schema.settings).values({ key, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } }).run()
}

export const hasUsers = () => !!getDb().select({ id: schema.user.id }).from(schema.user).limit(1).get()

const hash = (t: string) => createHash('sha256').update(t).digest('hex')
const INVITE_TTL = 30 * 24 * 3600 * 1000

const isAlive = (personId: string) => {
  const p = getDb().select({ living: schema.persons.living, deathDate: schema.persons.deathDate }).from(schema.persons).where(eq(schema.persons.id, personId)).get()
  return !!p && p.living && !p.deathDate
}

function assertAlive(personId: string | null | undefined) {
  if (personId && !isAlive(personId)) throw new OpError(400, say('Выбрать можно только живого человека'))
}

/** A card stops being someone's when its person turns out to have died; an undo brings the link back. */
export const ownCard = (personId: string | null | undefined) => (personId && isAlive(personId) ? personId : null)

export function createInvite(actor: Actor, input: { name: string; role: Role; personId?: string | null; userId?: string | null }) {
  requireRole(actor, 'owner')
  assertAlive(input.personId)
  const token = randomBytes(24).toString('base64url')
  const now = Date.now()
  getDb().insert(schema.invites).values({
    id: newId(),
    tokenHash: hash(token),
    name: input.name,
    role: input.role,
    personId: input.personId ?? null,
    userId: input.userId ?? null,
    createdBy: actor.userId,
    createdAt: new Date(now),
    expiresAt: new Date(now + INVITE_TTL),
  }).run()
  return { token }
}

export function findInvite(token: string) {
  const row = getDb().select().from(schema.invites).where(eq(schema.invites.tokenHash, hash(token))).get()
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) return null
  return row
}

/** RECOVERY_TOKEN in the environment gets the owner back in after losing the session cookie. */
export function isRecoveryToken(token: string) {
  const expected = process.env.RECOVERY_TOKEN
  return !!expected && hash(token) === hash(expected)
}

export function findOwnerId() {
  return getDb().select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.role, 'owner')).limit(1).get()?.id ?? null
}

export function listInvites(actor: Actor) {
  requireRole(actor, 'owner')
  return getDb().select({
    id: schema.invites.id, name: schema.invites.name, role: schema.invites.role, expiresAt: schema.invites.expiresAt,
  }).from(schema.invites).where(isNull(schema.invites.usedAt)).orderBy(desc(schema.invites.createdAt)).all()
    .filter((i) => i.expiresAt.getTime() > Date.now())
}

export function revokeInvite(actor: Actor, id: string) {
  requireRole(actor, 'owner')
  getDb().delete(schema.invites).where(eq(schema.invites.id, id)).run()
}

export function listUsers(actor: Actor) {
  requireRole(actor, 'owner')
  return getDb().select({ id: schema.user.id, name: schema.user.name, role: schema.user.role, personId: schema.user.personId }).from(schema.user).all()
}

export function setUserRole(actor: Actor, id: string, role: Role) {
  requireRole(actor, 'owner')
  if (id === actor.userId) throw new OpError(400, 'cannot change your own role')
  getDb().update(schema.user).set({ role }).where(eq(schema.user.id, id)).run()
}

export function removeUser(actor: Actor, id: string) {
  requireRole(actor, 'owner')
  if (id === actor.userId) throw new OpError(400, 'cannot remove yourself')
  getDb().delete(schema.user).where(eq(schema.user.id, id)).run()
}

export function setMyPerson(actor: Actor, personId: string | null) {
  // A reader's card decides which living person they may see, so only the owner links it.
  if (personId && actor.role === 'reader') throw new OpError(403, 'ask the owner to link your card')
  assertAlive(personId)
  getDb().update(schema.user).set({ personId }).where(eq(schema.user.id, actor.userId)).run()
}

export function listHistory(actor: Actor, limit = 100): HistoryEntry[] {
  const db = getDb()
  const rows = db.select().from(schema.history).orderBy(desc(schema.history.at)).limit(limit).all()
  const hidden = seesOnlyPublic(actor) ? new Set(getGraph(actor).persons.filter((p) => p.hidden).map((p) => p.id)) : new Set<string>()
  return rows
    .map((r) => ({ id: r.id, at: r.at, actorName: r.actorName, summary: r.summary, personIds: JSON.parse(r.personIds) as string[], undoOf: r.undoOf, undoneAt: r.undoneAt }))
    // Summaries contain names, so a reader sees only entries about people visible to them
    // and never entries with no named subject, which could be about anyone.
    .filter((e) => !seesOnlyPublic(actor) || (e.personIds.length > 0 && e.personIds.every((id) => !hidden.has(id))))
}
