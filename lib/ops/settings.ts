import { createHash, randomBytes } from 'node:crypto'
import { and, desc, eq, inArray, isNull, like, ne, or } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { personName, setOpenEnd, type HistoryEntry, type Role } from '../types'
import { Actor, newId, OpError, requireRole, seesOnlyPublic } from './core'
import { say } from './app-config'
import { changeDetails, readableSummary } from './history-text'
import { getGraph, hiddenPeople } from './people'

export { archiveLang, getSetting, say, setSetting } from './app-config'

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
  // An owner's own sign-in link from the command line is not someone invited.
  }).from(schema.invites).where(and(isNull(schema.invites.usedAt), ne(schema.invites.createdBy, 'cli'))).orderBy(desc(schema.invites.createdAt)).all()
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

export function listHistory(actor: Actor, limit = 100, personId?: string): HistoryEntry[] {
  const db = getDb()
  const h = schema.history
  // A person's id is in the entry itself or, for older ones, in what the entry changed.
  const about = personId ? or(like(h.personIds, `%"${personId}"%`), like(h.changes, `%"${personId}"%`)) : undefined
  const rows = db.select({ id: h.id, at: h.at, actorName: h.actorName, userId: h.userId, tokenId: h.tokenId, summary: h.summary, personIds: h.personIds, changes: h.changes, undoOf: h.undoOf, undoneAt: h.undoneAt }).from(h).where(about).orderBy(desc(h.at)).limit(limit).all()
  const hidden = hiddenPeople(actor)
  const reader = seesOnlyPublic(actor)
  // From the graph already in memory: a person this actor may not see has no name here either.
  const graph = getGraph(actor)
  const names = new Map(graph.persons.map((p) => [p.id, personName(p)]))
  const nameOf = (id: string) => names.get(id) || say('Без названия')
  const relations = new Map([
    ...graph.parentChild.map((r): [string, string[]] => [r.id, [r.parentId, r.childId]]),
    ...graph.unions.map((r): [string, string[]] => [r.id, [r.aId, r.bId]]),
  ])
  const relationEnds = (id: string) => relations.get(id) ?? []
  // Older relation entries named nobody; for those who may see them, the two people make the line clickable.
  const people = (stored: string, changes: { table: string; id: string }[]) => {
    const ids = JSON.parse(stored) as string[]
    if (ids.length || reader) return ids
    return relationEnds(changes.find((c) => c.table === 'parentChild' || c.table === 'unions')?.id ?? '')
  }
  const undone = rows.map((r) => r.undoOf).filter((id): id is string => !!id)
  const originals = new Map(undone.length ? db.select({ id: h.id, summary: h.summary, changes: h.changes }).from(h).where(inArray(h.id, undone)).all().map((o) => [o.id, readableSummary(o.summary, JSON.parse(o.changes), nameOf, undefined, relationEnds)]) : [])
  return rows
    .map((r) => {
      const changes = JSON.parse(r.changes)
      const original = r.undoOf ? originals.get(r.undoOf) : undefined
      const details = reader || r.undoOf ? undefined : changeDetails(changes)
      const summary = reader ? r.summary : readableSummary(r.summary, changes, nameOf, original, relationEnds)
      // The lines below say which fields changed, so the first line need not list them too.
      const person = details?.length && changes.every((c: { table: string }) => c.table === 'persons') ? summary.split(': ')[0] : summary
      return {
        id: r.id, at: r.at, actorName: r.actorName, userId: r.userId, byAgent: !!r.tokenId, personIds: people(r.personIds, changes), undoOf: r.undoOf, undoneAt: r.undoneAt,
        // Readers get only the entries about people they can see, and never the values.
        summary: person,
        ...(details ? { details } : {}),
      }
    })
    // Summaries contain names, so a reader sees only entries about people visible to them
    // and never entries with no named subject, which could be about anyone.
    // Someone deleted since is in no list, so they count as unseen, not as visible.
    .filter((e) => !reader || (e.personIds.length > 0 && e.personIds.every((id) => names.has(id) && !hidden.has(id))))
    // In a person's card, not what merely passed through them, such as a whole family loaded at once.
    .filter((e) => !personId || e.personIds.includes(personId))
}

// What the server writes for a living person's open range follows the archive's language.
setOpenEnd(() => say('н. в.'))
