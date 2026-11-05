import { AsyncLocalStorage } from 'node:async_hooks'
import { and, desc, eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { getDb, schema } from '../db'
import { announceChange } from '../live'
import type { Role } from '../types'

export interface Actor {
  userId: string
  name: string
  role: Role
  personId: string | null
  /** Set when the caller is an API token rather than a signed-in person. */
  tokenId?: string
  review?: boolean
  /** The app's built-in assistant, acting for this person. */
  assistant?: boolean
  /** Came through a link and has no account. `only`: the people of the view that link shows, or null for everyone. */
  guest?: { viewId: string | null; only: Set<string> | null }
  /** When the assistant last read the archive: anything newer from someone else makes it look again. */
  since?: number
}

/** Sees only people who have died: a reader, or a model the data would be sent to. */
export const seesOnlyPublic = (a: Actor) => a.role === 'reader'

export class OpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

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
const changedFields = (before: Row, after: Row) => Object.keys(before).filter((k) => before[k] !== after[k])
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

export function undo(actor: Actor, historyId: string, summary: string) {
  const db = getDb()
  db.transaction(() => {
    const entry = db.select().from(schema.history).where(eq(schema.history.id, historyId)).get()
    if (!entry) throw new OpError(404, 'not found')
    if (entry.undoneAt) throw new OpError(409, 'already undone')
    // A token may take back its own changes, never a person's.
    if (actor.tokenId && entry.tokenId !== actor.tokenId) throw new OpError(403, 'a token can undo only its own changes')
    const c = new Changes()
    const changes = JSON.parse(entry.changes) as Change[]
    for (const ch of [...changes].reverse()) {
      if (!ch.before) c.remove(ch.table, ch.id)
      else if (!ch.after) {
        const exists = db.select({ id: TRACKED[ch.table].id }).from(TRACKED[ch.table]).where(eq(TRACKED[ch.table].id, ch.id)).get()
        if (!exists && !pairTaken(ch.table, ch.before)) c.insert(ch.table, ch.before)
      } else {
        const now = db.select().from(TRACKED[ch.table]).where(eq(TRACKED[ch.table].id, ch.id)).get() as Row | undefined
        if (!now) continue
        // Only what this entry changed goes back, and only if nobody has changed it since.
        const fields = changedFields(ch.before, ch.after).filter((k) => k !== 'updatedAt')
        if (fields.some((k) => now[k] !== ch.after![k])) throw new OpError(409, 'changed later: undo the newer edit first')
        if (fields.length) c.update(ch.table, ch.id, { ...pick(ch.before, fields), ...('updatedAt' in now ? { updatedAt: Math.max(Date.now(), (now.updatedAt as number) + 1) } : {}) })
      }
    }
    purgeOrphans(c)
    db.update(schema.history).set({ undoneAt: Date.now() }).where(eq(schema.history.id, historyId)).run()
    writeHistory(actor, { summary, personIds: JSON.parse(entry.personIds) }, c.list, historyId)
  })
  announceChange()
}
