import { AsyncLocalStorage } from 'node:async_hooks'
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { getDb, schema } from '../db'
import { announceChange } from '../live'
import { checkDemoPeople } from '../demo-mode'
import { OpError } from '../op-error'
import type { Role } from '../types'

export interface Actor {
  userId: string
  name: string
  role: Role
  personId: string | null
  /** Set when the caller is an API token rather than a signed-in person. */
  tokenId?: string
  review?: boolean
  /** The owner trusts this token's bulk edits (not imports) to apply at once, even though a bulk change normally waits for review. */
  trustBulk?: boolean
  /** The app's built-in assistant, acting for this person. */
  assistant?: boolean
  /** Came through a link and has no account. `only`: the people of the view that link shows, or null for everyone. */
  guest?: { viewId: string | null; only: Set<string> | null }
  /** When the assistant last read the archive: anything newer from someone else makes it look again. */
  since?: number
}

/** Sees only people who have died: a reader, or a model the data would be sent to. */
export const seesOnlyPublic = (a: Actor) => a.role === 'reader'

export { OpError }

const RANK: Record<Role, number> = { reader: 0, editor: 1, owner: 2 }
export const can = (a: Actor, role: Role) => RANK[a.role] >= RANK[role]
export function requireRole(a: Actor, role: Role) {
  if (!can(a, role)) throw new OpError(403, 'forbidden')
}

export const TRACKED = {
  persons: schema.persons,
  parentChild: schema.parentChild,
  unions: schema.unions,
  pages: schema.pages,
  media: schema.media,
  mediaTags: schema.mediaTags,
  stories: schema.stories,
  storyPeople: schema.storyPeople,
  places: schema.places,
  repositories: schema.repositories,
  contacts: schema.contacts,
  // What pointed at a card when the tree was replaced: an undo puts the accounts, invitations and views back too.
  user: schema.user,
  invites: schema.invites,
  views: schema.views,
} as const
export type Tracked = keyof typeof TRACKED

type Row = Record<string, unknown> & { id: string }
export interface Change {
  table: Tracked
  id: string
  before: Row | null
  after: Row | null
}

/** Every change reads its row back, so the query is built once per table. */
const rowQueries = new Map<Tracked, { db: unknown; query: { get: (args: { id: string }) => unknown } }>()
function rowQuery(db: ReturnType<typeof getDb>, table: Tracked) {
  const ready = rowQueries.get(table)
  if (ready?.db === db) return ready.query
  const query = db.select().from(TRACKED[table] as typeof schema.persons).where(eq(TRACKED[table].id, sql.placeholder('id'))).prepare()
  rowQueries.set(table, { db, query })
  return query
}

/** Records each row change so that any operation can be rolled back generically. */
export class Changes {
  list: Change[] = []
  private db = getDb()

  insert(table: Tracked, row: Row) {
    // Every way a person appears passes here: adding, importing, and undoing a delete.
    if (table === 'persons') checkDemoPeople()
    this.db.insert(TRACKED[table]).values(row as never).run()
    const after = this.get(table, row.id)
    this.list.push({ table, id: row.id, before: null, after })
    return after as never
  }

  update(table: Tracked, id: string, patch: Record<string, unknown>) {
    const before = this.get(table, id)
    if (!before) throw new OpError(404, 'not found')
    this.db.update(TRACKED[table]).set(patch as never).where(eq(TRACKED[table].id, id)).run()
    const after = this.get(table, id)!
    // History keeps only what changed: undo needs no more, and a page's text is not stored again for a new title.
    const fields = changedFields(before, after)
    if (fields.length) this.list.push({ table, id, before: pick(before, ['id', ...fields]), after: pick(after, ['id', ...fields]) })
    return after as never
  }

  remove(table: Tracked, id: string) {
    const before = this.get(table, id)
    if (!before) return
    this.db.delete(TRACKED[table]).where(eq(TRACKED[table].id, id)).run()
    this.list.push({ table, id, before, after: null })
  }

  private get(table: Tracked, id: string) {
    return (rowQuery(this.db, table).get({ id }) as Row | undefined) ?? null
  }
}

export const newId = () => nanoid(12)

const pick = (row: Row, fields: string[]) => Object.fromEntries(fields.map((k) => [k, row[k]])) as Row
/** Two readings of one timestamp are two dates; only the moment they hold says whether the field changed. */
const sameValue = (a: unknown, b: unknown) => a === b || (a instanceof Date && b instanceof Date && a.getTime() === b.getTime())
const changedFields = (before: Row, after: Row) => Object.keys(before).filter((k) => !sameValue(before[k], after[k]))
/** Two people can be linked once, so a link cannot return when it was made again meanwhile. */
function pairTaken(table: Tracked, row: Row) {
  const db = getDb()
  if (table === 'parentChild') return !!db.select({ id: schema.parentChild.id }).from(schema.parentChild).where(and(eq(schema.parentChild.parentId, row.parentId as string), eq(schema.parentChild.childId, row.childId as string))).get()
  if (table === 'unions') return !!db.select({ id: schema.unions.id }).from(schema.unions).where(and(eq(schema.unions.aId, row.aId as string), eq(schema.unions.bId, row.bId as string))).get()
  return false
}

interface Meta {
  summary: string
  personIds?: string[]
  /** Consecutive edits with the same key by one user merge into a single history entry. */
  key?: string
}

const COALESCE_MS = 10 * 60 * 1000

/** The one write path: UI, REST and (later) MCP all go through here. */
export function mutate<T>(actor: Actor, meta: Meta, fn: (c: Changes) => T): T {
  const db = getDb()
  const result = db.transaction(() => {
    const c = new Changes()
    const out = fn(c)
    if (group) {
      group.changes.push(...c.list)
      meta.personIds?.forEach((id) => group!.personIds.add(id))
    } else if (c.list.length) writeHistory(actor, meta, c.list)
    return out
  })
  announceChange()
  return result
}

let group: { changes: Change[]; personIds: Set<string> } | null = null

/** Several operations become one transaction and one history entry, undone with one click. */
export function mutateGroup<T>(actor: Actor, summary: string, fn: () => T): { result: T; historyId: string | null } {
  const done = getDb().transaction(() => {
    group = { changes: [], personIds: new Set() }
    try {
      const result = fn()
      const historyId = group.changes.length ? writeHistory(actor, { summary, personIds: [...group.personIds] }, group.changes) : null
      return { result, historyId }
    } finally {
      group = null
    }
  })
  announceChange()
  return done
}

const historyScope = new AsyncLocalStorage<{ id: string | null }>()

/** Runs one call and says which history entry it made, even with other calls running beside it. */
export async function withHistoryScope<T>(fn: () => T | Promise<T>) {
  const scope = { id: null as string | null }
  const result = await historyScope.run(scope, fn)
  return { result, historyId: scope.id }
}

function writeHistory(actor: Actor, meta: Meta, changes: Change[], undoOf?: string): string {
  const id = recordHistory(actor, meta, changes, undoOf)
  const scope = historyScope.getStore()
  if (scope) scope.id = id
  return id
}

function recordHistory(actor: Actor, meta: Meta, changes: Change[], undoOf?: string): string {
  const db = getDb()
  const now = Date.now()
  if (meta.key) {
    // Only onto the newest entry: merging past somebody else's edit would take it along on undo.
    const newest = db.select({ id: schema.history.id, key: schema.history.key }).from(schema.history).orderBy(desc(schema.history.at)).limit(1).get()
    const last = newest?.key === meta.key ? db.select().from(schema.history).where(eq(schema.history.id, newest.id)).get() : undefined
    // The assistant's edits stay apart: undoing one answer must not take the person's own edit along.
    if (!actor.assistant && last && !last.actorName.includes('→') && last.key === meta.key && last.userId === actor.userId && (last.tokenId ?? undefined) === actor.tokenId && !last.undoneAt && now - last.at < COALESCE_MS) {
      const prev = JSON.parse(last.changes) as Change[]
      const merged = [
        ...prev.filter((p) => !changes.some((ch) => ch.table === p.table && ch.id === p.id)),
        ...changes.map((ch) => {
          const p = prev.find((x) => x.table === ch.table && x.id === ch.id)
          return p ? { ...ch, before: p.before && ch.before ? { ...ch.before, ...p.before } : p.before, after: ch.after && { ...p.after, ...ch.after } } : ch
        }),
      ]
      db.update(schema.history).set({ at: now, changes: JSON.stringify(merged) }).where(eq(schema.history.id, last.id)).run()
      return last.id
    }
  }
  const id = newId()
  db.insert(schema.history).values({
    id,
    at: now,
    userId: actor.userId,
    actorName: actor.name,
    summary: meta.summary,
    personIds: JSON.stringify(meta.personIds ?? []),
    changes: JSON.stringify(changes),
    key: meta.key ?? null,
    undoOf: undoOf ?? null,
    tokenId: actor.tokenId ?? null,
  }).run()
  return id
}

/**
 * What points at what. The tracked tables have no foreign keys, on purpose: undo re-creates rows in any order.
 * A new table that refers to someone must be listed here; a test fails if it is not.
 */
export const REFERENCES: { table: Tracked; column: string; to: 'persons' | 'media' }[] = [
  { table: 'parentChild', column: 'parentId', to: 'persons' },
  { table: 'parentChild', column: 'childId', to: 'persons' },
  { table: 'unions', column: 'aId', to: 'persons' },
  { table: 'unions', column: 'bId', to: 'persons' },
  { table: 'pages', column: 'personId', to: 'persons' },
  { table: 'mediaTags', column: 'personId', to: 'persons' },
  { table: 'mediaTags', column: 'mediaId', to: 'media' },
  { table: 'storyPeople', column: 'personId', to: 'persons' },
  { table: 'contacts', column: 'personId', to: 'persons' },
]

/** A story is reached through the people it is about. With none left it could never be read or removed. */
export function dropStoriesAboutNobody(c: Changes) {
  const db = getDb()
  const about = new Set(db.select({ id: schema.storyPeople.storyId }).from(schema.storyPeople).where(eq(schema.storyPeople.role, 'about')).all().map((r) => r.id))
  for (const s of db.select({ id: schema.stories.id, mediaId: schema.stories.mediaId }).from(schema.stories).all()) {
    if (about.has(s.id)) continue
    for (const r of db.select({ id: schema.storyPeople.id }).from(schema.storyPeople).where(eq(schema.storyPeople.storyId, s.id)).all()) c.remove('storyPeople', r.id)
    if (s.mediaId) c.remove('media', s.mediaId)
    c.remove('stories', s.id)
  }
}

/** Removes rows that point at deleted people or photos. */
export function purgeOrphans(c: Changes) {
  const db = getDb()
  const known = {
    persons: new Set(db.select({ id: schema.persons.id }).from(schema.persons).all().map((r) => r.id)),
    media: new Set(db.select({ id: schema.media.id }).from(schema.media).all().map((r) => r.id)),
  }
  for (const [table, refs] of Map.groupBy(REFERENCES, (r) => r.table)) {
    const t = TRACKED[table] as unknown as Record<string, never>
    // Only the columns compared: this runs on every undo, and pages hold whole texts.
    const columns = Object.fromEntries(['id', ...refs.map((r) => r.column)].map((k) => [k, t[k]]))
    const rows = db.select(columns).from(TRACKED[table] as typeof schema.persons).all() as unknown as Record<string, string>[]
    for (const r of rows) if (refs.some((ref) => r[ref.column] !== null && !known[ref.to].has(r[ref.column]))) c.remove(table, r.id)
  }
  dropStoriesAboutNobody(c)
  // A missing portrait clears the field; the person stays.
  for (const r of db.select({ id: schema.persons.id, avatarMediaId: schema.persons.avatarMediaId }).from(schema.persons).all())
    if (r.avatarMediaId && !known.media.has(r.avatarMediaId)) c.update('persons', r.id, { avatarMediaId: null, avatarCrop: null })
}

type HistoryRow = typeof schema.history.$inferSelect

/** Puts back only what a change touched, and refuses when somebody has changed it since. */
function revertChanges(db: ReturnType<typeof getDb>, changes: Change[], c: Changes) {
  // Pages this entry removes. A child written after them, and not removed itself, goes to the top
  // level rather than pointing at a page that is no longer there.
  const removedPages = new Set(changes.filter((ch) => ch.table === 'pages' && !ch.before).map((ch) => ch.id))
  for (const ch of [...changes].reverse()) {
    if (!ch.before) {
      if (ch.table === 'pages') {
        for (const child of db.select({ id: schema.pages.id }).from(schema.pages).where(eq(schema.pages.parentPageId, ch.id)).all())
          if (!removedPages.has(child.id)) c.update('pages', child.id, { parentPageId: null })
      }
      c.remove(ch.table, ch.id)
    } else if (!ch.after) {
      const exists = db.select({ id: TRACKED[ch.table].id }).from(TRACKED[ch.table]).where(eq(TRACKED[ch.table].id, ch.id)).get()
      if (!exists && !pairTaken(ch.table, ch.before)) c.insert(ch.table, ch.before)
    } else {
      const now = db.select().from(TRACKED[ch.table]).where(eq(TRACKED[ch.table].id, ch.id)).get() as Row | undefined
      if (!now) throw new OpError(409, 'changed later: undo the newer edit first')
      // Only what this entry changed goes back, and only if nobody has changed it since.
      // A value already back at its old one was taken back by an earlier partial undo: leave it.
      const fields = changedFields(ch.before, ch.after).filter((k) => k !== 'updatedAt')
      const atAfter = fields.every((k) => now[k] === ch.after![k])
      const atBefore = fields.every((k) => now[k] === ch.before![k])
      if (!atAfter && !atBefore) throw new OpError(409, 'changed later: undo the newer edit first')
      if (atAfter && fields.length) c.update(ch.table, ch.id, { ...pick(ch.before, fields), ...('updatedAt' in now && typeof now.updatedAt === 'number' ? { updatedAt: Math.max(Date.now(), now.updatedAt + 1) } : {}) })
    }
  }
}

/** Takes back one stored entry. Runs inside the caller's transaction. */
function undoEntry(actor: Actor, entry: HistoryRow, summary: string) {
  const db = getDb()
  if (entry.undoneAt) throw new OpError(409, `already undone: ${entry.summary}`)
  // A token may take back its own changes, never a person's.
  if (actor.tokenId && entry.tokenId !== actor.tokenId) throw new OpError(403, 'a token can undo only its own changes')
  const c = new Changes()
  revertChanges(db, JSON.parse(entry.changes) as Change[], c)
  purgeOrphans(c)
  db.update(schema.history).set({ undoneAt: Date.now() }).where(eq(schema.history.id, entry.id)).run()
  // Undoing a rollback puts the entry it took back into effect again.
  if (entry.undoOf) db.update(schema.history).set({ undoneAt: null }).where(eq(schema.history.id, entry.undoOf)).run()
  writeHistory(actor, { summary, personIds: JSON.parse(entry.personIds) }, c.list, entry.id)
}

export function undo(actor: Actor, historyId: string, summary: string) {
  const db = getDb()
  db.transaction(() => {
    const entry = db.select().from(schema.history).where(eq(schema.history.id, historyId)).get()
    if (!entry) throw new OpError(404, 'not found')
    undoEntry(actor, entry, summary)
  })
  announceChange()
}

/** Takes the archive back to just before the chosen entry, newest first. */
export function rollbackTo(actor: Actor, historyId: string, summary: string) {
  const db = getDb()
  const h = schema.history
  let count = 0
  db.transaction(() => {
    // It takes back everyone's later changes, not only the caller's: the owner's call.
    if (actor.role !== 'owner' || actor.tokenId) throw new OpError(403, 'only the owner can roll the archive back')
    const target = db.select().from(h).where(eq(h.id, historyId)).get()
    if (!target) throw new OpError(404, 'not found')
    if (target.undoneAt) throw new OpError(409, `already undone: ${target.summary}`)
    if (target.undoOf) throw new OpError(409, 'a rollback is not a change to roll back to')
    // Same millisecond entries are ordered by when they were written.
    const rows = db.select().from(h).where(gte(h.at, target.at)).orderBy(desc(h.at), desc(sql`rowid`)).all()
    const at = rows.findIndex((r) => r.id === target.id)
    if (at < 0) throw new OpError(500, 'the chosen change is not in the history')
    for (const entry of rows.slice(0, at + 1)) {
      // Already undone changes and their rollback lines have no effect left to take back.
      if (entry.undoneAt || entry.undoOf) continue
      undoEntry(actor, entry, summary)
      count++
    }
  })
  announceChange()
  return { count }
}

function endsOf(row: Row | null) {
  if (!row) return []
  if ('parentId' in row) return [row.parentId, row.childId].filter((v): v is string => typeof v === 'string')
  if ('aId' in row) return [row.aId, row.bId].filter((v): v is string => typeof v === 'string')
  return []
}

/** Whether taking this change back also means touching that person's card or links. */
function touchesPerson(db: ReturnType<typeof getDb>, ch: Change, personId: string) {
  if (ch.table === 'persons') return ch.id === personId
  const row = (ch.after ?? ch.before) as Row | null
  if (!row) return false
  if (ch.table === 'parentChild' || ch.table === 'unions') {
    const ends = endsOf(row)
    if (ends.length) return ends.includes(personId)
    const now = db.select().from(TRACKED[ch.table]).where(eq(TRACKED[ch.table].id, ch.id)).get() as Row | undefined
    return endsOf(now ?? null).includes(personId)
  }
  if ('personId' in row) return row.personId === personId
  return false
}

/** Takes back one person's part of a larger entry, such as one card of an import. */
export function undoPart(actor: Actor, historyId: string, personId: string, summary: string) {
  const db = getDb()
  const h = schema.history
  let left = 0
  db.transaction(() => {
    const rid = db.select({ id: sql<number>`rowid` }).from(h).where(eq(h.id, historyId)).get()?.id
    const entry = db.select().from(h).where(eq(h.id, historyId)).get()
    if (!entry || rid === undefined) throw new OpError(404, 'not found')
    if (entry.undoneAt) throw new OpError(409, `already undone: ${entry.summary}`)
    if (actor.tokenId && entry.tokenId !== actor.tokenId) throw new OpError(403, 'a token can undo only its own changes')
    const changes = JSON.parse(entry.changes) as Change[]
    const part = changes.filter((ch) => touchesPerson(db, ch, personId))
    if (!part.length) throw new OpError(404, 'this change does not touch that person')
    // A newer change to the same person depends on this one still being there.
    const newer = db.select({ id: h.id, at: h.at, rid: sql<number>`rowid`, personIds: h.personIds, undoneAt: h.undoneAt, undoOf: h.undoOf }).from(h).where(gte(h.at, entry.at)).all()
      .some((e) => e.id !== entry.id && !e.undoneAt && !e.undoOf && (e.at > entry.at || e.rid > rid) && JSON.parse(e.personIds).includes(personId))
    if (newer) throw new OpError(409, 'changed later: undo the newer edit first')
    const c = new Changes()
    revertChanges(db, part, c)
    purgeOrphans(c)
    // What is left of the entry: changes about nobody taken back yet, by this part or an earlier one.
    const done = new Set([personId, ...db.select({ personIds: h.personIds }).from(h).where(eq(h.undoOf, historyId)).all().flatMap((e) => JSON.parse(e.personIds) as string[])])
    left = changes.filter((ch) => ![...done].some((id) => touchesPerson(db, ch, id))).length
    if (!left) db.update(h).set({ undoneAt: Date.now() }).where(eq(h.id, historyId)).run()
    writeHistory(actor, { summary, personIds: [personId] }, c.list, historyId)
  })
  announceChange()
  return { undone: !left, left }
}
