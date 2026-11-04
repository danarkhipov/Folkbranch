import { and, desc, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { getDb, schema } from '../db'
import type { Role } from '../types'

export interface Actor {
  userId: string
  name: string
  role: Role
  personId: string | null
  /** Set when the caller is an API token rather than a signed-in person. */
  tokenId?: string
  review?: boolean
}

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

const TRACKED = {
  persons: schema.persons,
  parentChild: schema.parentChild,
  unions: schema.unions,
  pages: schema.pages,
  media: schema.media,
  mediaTags: schema.mediaTags,
} as const
export type Tracked = keyof typeof TRACKED

type Row = Record<string, unknown> & { id: string }
export interface Change {
  table: Tracked
  id: string
  before: Row | null
  after: Row | null
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
    const after = this.get(table, id)
    this.list.push({ table, id, before, after })
    return after as never
  }

  remove(table: Tracked, id: string) {
    const before = this.get(table, id)
    if (!before) return
    this.db.delete(TRACKED[table]).where(eq(TRACKED[table].id, id)).run()
    this.list.push({ table, id, before, after: null })
  }

  private get(table: Tracked, id: string) {
    return (this.db.select().from(TRACKED[table]).where(eq(TRACKED[table].id, id)).get() as Row | undefined) ?? null
  }
}

export const newId = () => nanoid(12)

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
  return db.transaction(() => {
    const c = new Changes()
    const result = fn(c)
    if (group) {
      group.changes.push(...c.list)
      meta.personIds?.forEach((id) => group!.personIds.add(id))
    } else if (c.list.length) writeHistory(actor, meta, c.list)
    return result
  })
}

let group: { changes: Change[]; personIds: Set<string> } | null = null

/** Several operations become one transaction and one history entry, undone with one click. */
export function mutateGroup<T>(actor: Actor, summary: string, fn: () => T): { result: T; historyId: string | null } {
  return getDb().transaction(() => {
    group = { changes: [], personIds: new Set() }
    try {
      const result = fn()
      const historyId = group.changes.length ? writeHistory(actor, { summary, personIds: [...group.personIds] }, group.changes) : null
      return { result, historyId }
    } finally {
      group = null
    }
  })
}

function writeHistory(actor: Actor, meta: Meta, changes: Change[], undoOf?: string): string {
  const db = getDb()
  const now = Date.now()
  if (meta.key) {
    const last = db.select().from(schema.history)
      .where(and(eq(schema.history.key, meta.key), eq(schema.history.userId, actor.userId)))
      .orderBy(desc(schema.history.at)).limit(1).get()
    if (last && !last.undoneAt && now - last.at < COALESCE_MS) {
      const prev = JSON.parse(last.changes) as Change[]
      const merged = changes.map((ch) => ({ ...ch, before: prev.find((p) => p.id === ch.id)?.before ?? ch.before }))
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

/** Removes rows that point at deleted people or photos. */
export function purgeOrphans(c: Changes) {
  const db = getDb()
  const people = new Set(db.select({ id: schema.persons.id }).from(schema.persons).all().map((r) => r.id))
  const photos = new Set(db.select({ id: schema.media.id }).from(schema.media).all().map((r) => r.id))
  for (const r of db.select().from(schema.parentChild).all())
    if (!people.has(r.parentId) || !people.has(r.childId)) c.remove('parentChild', r.id)
  for (const r of db.select().from(schema.unions).all())
    if (!people.has(r.aId) || !people.has(r.bId)) c.remove('unions', r.id)
  for (const r of db.select().from(schema.pages).all())
    if (!people.has(r.personId)) c.remove('pages', r.id)
  for (const r of db.select().from(schema.mediaTags).all())
    if (!people.has(r.personId) || !photos.has(r.mediaId)) c.remove('mediaTags', r.id)
  for (const r of db.select().from(schema.persons).all())
    if (r.avatarMediaId && !photos.has(r.avatarMediaId)) c.update('persons', r.id, { avatarMediaId: null, avatarCrop: null })
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
        if (!exists) c.insert(ch.table, ch.before)
      } else {
        const exists = db.select({ id: TRACKED[ch.table].id }).from(TRACKED[ch.table]).where(eq(TRACKED[ch.table].id, ch.id)).get()
        if (exists) c.update(ch.table, ch.id, ch.before)
      }
    }
    purgeOrphans(c)
    db.update(schema.history).set({ undoneAt: Date.now() }).where(eq(schema.history.id, historyId)).run()
    writeHistory(actor, { summary, personIds: JSON.parse(entry.personIds) }, c.list, historyId)
  })
}
