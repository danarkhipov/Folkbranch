import { desc, eq, and } from 'drizzle-orm'
import { customAlphabet } from 'nanoid'
import { getDb, schema } from '../db'
import { type PlannedOp } from '../textformat'
import { personName } from '../types'
import { Actor, mutateGroup, newId, OpError, requireRole,  } from './core'
import * as media from './media'
import * as people from './people'
import { say } from './settings'
import { type Ctx, type Def, nameOfReal } from './op-defs'
import { announceChange } from '../live'
import { OPS } from './registry'

const tmpId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 10)

const MAX_DRAFT_OPS = 5000

export interface QueuedOp { op: string; args: any; tempId?: string; text: string; details?: string[] }

export interface Proposal {
  id: string
  tokenName: string
  status: string
  error: string | null
  createdAt: number
  ops: { op: string; text: string; details?: string[] }[]
}

const TABLES = { persons: schema.persons, pages: schema.pages, media: schema.media, mediaTags: schema.mediaTags, history: schema.history }

/** In words, what a call would do: shown to the person before they allow it. */
export function describeOp(actor: Actor, name: string, raw: unknown): string {
  const d = OPS[name]
  const parsed = d?.input.safeParse(raw)
  if (!parsed?.success) return ''
  const ctx = (queued: QueuedOp[] = []): Ctx => ({ name: (id) => nameInDraft(String(id), queued) })
  const line = (x: { text: string; details?: string[] }) => [x.text, ...(x.details ?? []).filter(Boolean)].join(', ')
  const args = parsed.data as any
  try {
    if (name === 'undo') return getDb().select({ summary: schema.history.summary }).from(schema.history).where(eq(schema.history.id, args.historyId)).get()?.summary ?? ''
    if (d.expand) {
      const ops = d.expand(actor, args)
      const lines = ops.slice(0, 8).map((o) => line(OPS[o.op].describe(o.args, { name: (id) => String((o.args as any)?.person?.givenName ?? nameInDraft(String(id), [])) })))
      return [`${say('Операций')}: ${ops.length}`, ...lines, ...(ops.length > 8 ? ['…'] : [])].join('\n')
    }
    return line(d.describe(args, ctx()))
  } catch {
    return ''
  }
}

/** The single entrance for writes. */
export async function dispatch(actor: Actor, name: string, raw: unknown) {
  const d = OPS[name]
  if (!d) throw new OpError(404, 'unknown operation')
  requireRole(actor, 'editor')
  const parsed = d.input.parse(raw)
  const queue = !!actor.tokenId && !d.direct && (actor.review || d.bulk)

  if (d.expand) {
    const ops = d.expand(actor, parsed)
    if (queue) return enqueue(actor, ops.map((o) => ({ ...o, args: OPS[o.op].input.parse(o.args) as PlannedOp['args'] })))
    const { result, historyId, map } = applyOps(actor, ops, {}, d.summary?.(parsed) ?? say('Загрузка и скачивание'))
    return { ...result, ...readback(actor, ops, map), historyId }
  }
  // Ids a model got earlier may be temporary ones from a draft that has since been accepted.
  const args = await (d.prepare ? d.prepare(actor, withKnownIds(actor, parsed)) : withKnownIds(actor, parsed))
  if (queue) return enqueue(actor, [{ op: name, args: args as PlannedOp['args'] }])
  return d.apply(actor, args)
}

/** What now stands for each new person, read from the graph: the model checks its work against this for free. */
function readback(actor: Actor, ops: PlannedOp[], map: Record<string, string>) {
  const made = ops.flatMap((o) => (o.op === 'create_person' && o.tempId ? [map[o.tempId]] : []))
  if (!made.length) return {}
  const g = people.getGraph(actor)
  const name = (id: string) => { const p = g.persons.find((x) => x.id === id); return p ? personName(p) : id }
  const list = made.map((id) => ({
    name: name(id), id,
    parents: g.parentChild.filter((l) => l.childId === id).map((l) => name(l.parentId)),
    spouses: g.unions.filter((u) => u.aId === id || u.bId === id).map((u) => name(u.aId === id ? u.bId : u.aId)),
  }))
  const hasChild = (id: string) => g.parentChild.some((l) => l.parentId === id)
  return { people: list, check: { unlinked: list.filter((p) => !p.parents.length && !p.spouses.length && !hasChild(p.id)).map((p) => p.name) } }
}

function withKnownIds(actor: Actor, args: unknown) {
  if (!actor.tokenId) return args
  const db = getDb()
  const rows = db.select({ idMap: schema.proposals.idMap }).from(schema.proposals).where(and(eq(schema.proposals.tokenId, actor.tokenId), eq(schema.proposals.status, 'applied'))).all()
  return swapIds(args, Object.assign({}, ...rows.map((r) => JSON.parse(r.idMap))))
}

/** Temporary ids can sit anywhere, including inside a page mention, so the whole value is rewritten. */
function swapIds<T>(args: T, map: Record<string, string>): T {
  const json = JSON.stringify(args)
  if (!json?.includes('tmp_')) return args
  return JSON.parse(json.replace(/tmp_[a-z0-9]+/g, (m) => map[m] ?? m))
}

function draftOf(tokenId: string) {
  const p = schema.proposals
  return getDb().select().from(p).where(and(eq(p.tokenId, tokenId), eq(p.status, 'pending'))).orderBy(desc(p.createdAt)).get()
}

function enqueue(actor: Actor, ops: PlannedOp[]) {
  const db = getDb()
  return db.transaction(() => {
    const token = db.select().from(schema.apiTokens).where(eq(schema.apiTokens.id, actor.tokenId!)).get()!
    let draft = draftOf(actor.tokenId!)
    if (!draft) {
      const id = newId()
      db.insert(schema.proposals).values({ id, tokenId: token.id, tokenName: token.name, createdAt: Date.now() }).run()
      draft = draftOf(token.id)!
    }
    const queued: QueuedOp[] = JSON.parse(draft.ops)
    if (queued.length + ops.length > MAX_DRAFT_OPS) throw new OpError(413, 'draft is full, wait for review')
    const known = new Set(queued.map((q) => q.tempId))
    const temps: string[] = []
    // A text import plans with its own placeholder ids; they become this draft's temporary ids.
    const renames: Record<string, string> = {}
    for (const o of ops) {
      const d = OPS[o.op]
      const tempId = d.creates ? `tmp_${tmpId()}` : undefined
      if (tempId) {
        if (o.tempId) renames[o.tempId] = tempId
        known.add(tempId)
        temps.push(tempId)
      }
      const args = swapIds(o.args, renames)
      checkRefs(d, args, known)
      queued.push({ op: o.op, args, tempId, ...d.describe(args, { name: (id) => nameInDraft(String(id), queued) }) })
    }
    announceChange()
    db.update(schema.proposals).set({ ops: JSON.stringify(queued), error: null }).where(eq(schema.proposals.id, draft.id)).run()
    return { status: 'pending_review', proposalId: draft.id, ...(temps.length === 1 ? { tempId: temps[0], id: temps[0] } : temps.length ? { tempIds: temps } : {}), message: 'Waiting for a person to accept the draft. Temporary ids work in further calls.' }
  })
}

function checkRefs(d: Def, args: Record<string, unknown>, known: Set<string | undefined>) {
  for (const [key, table] of Object.entries(d.refs ?? {})) {
    const v = args[key]
    if (typeof v !== 'string' || !v || !table) continue
    if (v.startsWith('tmp_')) {
      if (!known.has(v)) throw new OpError(400, `${key}: unknown temporary id ${v}`)
      continue
    }
    const t = TABLES[table]
    if (!getDb().select({ id: t.id }).from(t).where(eq(t.id, v)).get()) throw new OpError(404, `${key}: ${v} not found`)
  }
}

function nameInDraft(id: string, queued: QueuedOp[]) {
  if (!id.startsWith('tmp_')) return nameOfReal(id)
  const q = queued.find((x) => x.tempId === id)
  if (!q) return id
  if (q.op === 'create_person') return [q.args.person.givenName, q.args.person.surname].filter(Boolean).join(' ')
  return q.args.title ?? q.args.row?.originalName ?? id
}

/** Runs operations in order as one undoable change; any failure rolls back all of them. */
function applyOps(actor: Actor, ops: { op: string; args: any; tempId?: string }[], start: Record<string, string>, summary: string) {
  const map = { ...start }
  const { result, historyId } = mutateGroup(actor, summary, () => {
    for (const o of ops) {
      const r = OPS[o.op].apply(actor, swapIds(o.args, map))
      if (o.tempId) {
        if (!r?.id) throw new OpError(500, `${o.op} returned no id`)
        map[o.tempId] = r.id
      }
    }
    return { applied: ops.length, ids: map }
  })
  return { result, historyId, map }
}

const humanOnly = (actor: Actor) => {
  requireRole(actor, 'editor')
  if (actor.tokenId) throw new OpError(403, 'a token cannot review proposals')
}

const toPublic = (r: typeof schema.proposals.$inferSelect): Proposal => ({
  id: r.id, tokenName: r.tokenName, status: r.status, error: r.error, createdAt: r.createdAt,
  ops: (JSON.parse(r.ops) as QueuedOp[]).map(({ op, text, details }) => ({ op, text, details })),
})

export function listProposals(actor: Actor): Proposal[] {
  humanOnly(actor)
  const p = schema.proposals
  return getDb().select().from(p).where(eq(p.status, 'pending')).orderBy(desc(p.createdAt)).all().map(toPublic)
}

export function myProposals(actor: Actor): Proposal[] {
  if (!actor.tokenId) throw new OpError(400, 'for tokens')
  const p = schema.proposals
  return getDb().select().from(p).where(eq(p.tokenId, actor.tokenId)).orderBy(desc(p.createdAt)).limit(20).all().map(toPublic)
}

function pending(id: string) {
  const r = getDb().select().from(schema.proposals).where(eq(schema.proposals.id, id)).get()
  if (!r) throw new OpError(404, 'not found')
  if (r.status !== 'pending') throw new OpError(409, 'already resolved')
  return r
}

export function acceptProposal(actor: Actor, id: string) {
  humanOnly(actor)
  const db = getDb()
  const r = pending(id)
  const ops = JSON.parse(r.ops) as QueuedOp[]
  const author: Actor = { ...actor, name: `${r.tokenName} → ${actor.name}`, tokenId: r.tokenId }
  try {
    const { historyId, map } = applyOps(author, ops, {}, `${r.tokenName}: ${ops.length} ${say('правок')}`)
    db.update(schema.proposals).set({ status: 'applied', idMap: JSON.stringify(map), resolvedAt: Date.now(), resolvedBy: actor.name, historyId, error: null }).where(eq(schema.proposals.id, id)).run()
    return { applied: ops.length, historyId }
  } catch (e) {
    // Nothing was applied. The draft stays, with the reason, so a person can drop the bad line.
    const message = e instanceof Error ? e.message : String(e)
    db.update(schema.proposals).set({ error: message }).where(eq(schema.proposals.id, id)).run()
    throw new OpError(409, message)
  }
}

export async function rejectProposal(actor: Actor, id: string) {
  humanOnly(actor)
  const r = pending(id)
  await discardFiles(JSON.parse(r.ops))
  getDb().update(schema.proposals).set({ status: 'rejected', resolvedAt: Date.now(), resolvedBy: actor.name }).where(eq(schema.proposals.id, id)).run()
}

export async function removeProposalOp(actor: Actor, id: string, index: number) {
  humanOnly(actor)
  const r = pending(id)
  const ops = JSON.parse(r.ops) as QueuedOp[]
  if (!ops[index]) throw new OpError(404, 'not found')
  const [removed] = ops.splice(index, 1)
  await discardFiles([removed])
  getDb().update(schema.proposals).set(ops.length ? { ops: JSON.stringify(ops), error: null } : { ops: '[]', status: 'rejected', resolvedAt: Date.now(), resolvedBy: actor.name }).where(eq(schema.proposals.id, id)).run()
}

async function discardFiles(ops: QueuedOp[]) {
  await Promise.all(ops.filter((o) => o.op === 'upload_photo').map((o) => media.discardUpload(o.args.row.id)))
}
