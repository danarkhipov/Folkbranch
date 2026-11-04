// Every write that the UI, REST and MCP can make, described once. A token's writes wait in
// a draft for a person to accept; everyone else's apply at once.
import { desc, eq, and } from 'drizzle-orm'
import { customAlphabet } from 'nanoid'
import { z } from 'zod'
import { getDb, schema } from '../db'
import { translate } from '../i18n'
import { markdownToBlocks } from '../markdown'
import { parseFamilyText, planFamilyText, type PlannedOp } from '../textformat'
import { personName, type Certainty, type ParentKind, type UnionKind } from '../types'
import { Actor, mutateGroup, newId, OpError, requireRole, undo } from './core'
import { importGedcom } from './gedcom'
import * as media from './media'
import * as pages from './pages'
import * as people from './people'
import { getSetting } from './settings'

const say = (key: string) => translate(getSetting('language') === 'en' ? 'en' : 'ru', key)
const tmpId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 10)
const MAX_DRAFT_OPS = 5000

const certainty = z.enum(['documented', 'family', 'assumed'])
const personInput = z.object({
  givenName: z.string(), surname: z.string(), maidenName: z.string(), patronymic: z.string(), otherNames: z.string().describe('Nicknames and other spellings'), sex: z.enum(['M', 'F', 'U']),
  birthDate: z.string().describe('Free text: "1890", "~1876", "12.03.1890", "1883 или 1886"'), birthPlace: z.string(),
  deathDate: z.string(), deathPlace: z.string(), living: z.boolean(), certainty,
  tags: z.array(z.string().min(1).max(40)).max(30).describe('Groups or labels, e.g. "Соколовы", "Фронт"'),
  facts: z.array(z.object({
    kind: z.string().max(80).describe('What happened: "Профессия", "Переезд", "Служба"'),
    date: z.string().max(60), place: z.string().max(120), note: z.string().max(800), source: z.string().max(300).optional(),
  })).max(100),
}).partial()
const relationType = z.enum(['father', 'mother', 'son', 'daughter', 'spouse'])
const box = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0).max(1), h: z.number().min(0).max(1) })
const blocks = z.array(z.record(z.string(), z.unknown()))
const markdown = z.string().describe('Page text in Markdown. Mention a person as [@Name](person:ID), a photo as ![caption](/api/v1/media/ID/file?size=medium).')

type Table = 'persons' | 'pages' | 'media' | 'mediaTags' | 'history'
interface Ctx { name: (id: unknown) => string }
interface Def<S extends z.ZodType = z.ZodType> {
  description: string
  input: S
  /** Top-level ids to check when queuing, so a model hears about a bad id right away. */
  refs?: Partial<Record<string, Table>>
  /** Turns the validated input into what apply needs; runs before queuing. */
  prepare?: (actor: Actor, args: any) => unknown | Promise<unknown>
  apply: (actor: Actor, args: any) => any
  describe: (args: any, ctx: Ctx) => { text: string; details?: string[] }
  /** The result's id can be referred to by a temporary id until the draft is accepted. */
  creates?: boolean
  /** Mass change: queued even for tokens allowed to write directly. */
  bulk?: boolean
  /** Never queued. */
  direct?: boolean
  /** Replaces the operation by several smaller ones. */
  expand?: (actor: Actor, args: any) => PlannedOp[]
}

const def = <S extends z.ZodType>(d: Def<S>) => d as Def

/** A token may only embed our own photos: an outside image would report every viewer to a stranger. */
function assertSafeBlocks(actor: Actor, content: unknown) {
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk)
    if (!n || typeof n !== 'object') return
    const o = n as Record<string, any>
    if (typeof o.href === 'string' && !/^(https?:|mailto:|\/)/i.test(o.href)) throw new OpError(400, `link not allowed: ${o.href}`)
    const url = o.props?.url
    if (typeof url === 'string' && url) {
      if (actor.tokenId && !url.startsWith('/api/v1/media/')) throw new OpError(400, 'files in a page must be uploaded with upload_photo first')
      if (!/^(https?:|\/)/i.test(url)) throw new OpError(400, `url not allowed: ${url}`)
    }
    Object.values(o).forEach(walk)
  }
  walk(content)
}

function pageContent(actor: Actor, args: { markdown?: string; content?: unknown[] }) {
  const { markdown: md, ...rest } = args
  const content = md !== undefined ? markdownToBlocks(md) : args.content
  if (content !== undefined) assertSafeBlocks(actor, content)
  return { ...rest, ...(content !== undefined ? { content } : {}) }
}

const FIELD: Record<string, string> = {
  givenName: 'Имя', surname: 'Фамилия', maidenName: 'Девичья фамилия', sex: 'Пол', birthDate: 'Рождение', birthPlace: 'Место рождения',
  deathDate: 'Смерть', deathPlace: 'Место смерти', living: 'Жив', certainty: 'Уверенность',
}
const REL: Record<string, string> = { father: 'отец', mother: 'мать', son: 'сын', daughter: 'дочь', spouse: 'супруг' }

export const OPS: Record<string, Def> = {
  create_person: def({
    description: 'Create a person, optionally linked to someone at once.',
    input: z.object({ person: personInput, relation: z.object({ type: relationType.describe('What the new person is to `to`'), to: z.string(), otherParentId: z.string().nullish() }).optional() }),
    creates: true,
    apply: (a, x) => people.createPerson(a, x.person, x.relation),
    describe: (x, c) => ({
      text: `${say('Добавить')}: ${[x.person.givenName, x.person.surname].filter(Boolean).join(' ')}`,
      details: [x.person.birthDate && `${say('Рождение')}: ${x.person.birthDate}`, x.person.deathDate && `${say('Смерть')}: ${x.person.deathDate}`, x.relation && `${say(REL[x.relation.type])} — ${c.name(x.relation.to)}`].filter(Boolean),
    }),
  }),
  update_person: def({
    description: 'Change fields of a person. Only the given fields change.',
    input: z.object({ id: z.string(), patch: personInput }),
    refs: { id: 'persons' },
    apply: (a, x) => people.updatePerson(a, x.id, x.patch),
    describe: (x, c) => {
      const cur = x.id.startsWith('tmp_') ? null : people.getPersonRow(x.id) as Record<string, unknown>
      return { text: c.name(x.id), details: Object.entries(x.patch).map(([k, v]) => `${say(FIELD[k] ?? k)}: ${cur?.[k] ?? ''} → ${v}`) }
    },
  }),
  delete_person: def({
    description: 'Delete a person with their relations, pages and photo tags. Can be undone.',
    input: z.object({ id: z.string() }),
    refs: { id: 'persons' },
    apply: (a, x) => people.deletePerson(a, x.id),
    describe: (x, c) => ({ text: `${say('Удалить человека')}: ${c.name(x.id)}` }),
  }),
  add_relation: def({
    description: 'Link two existing people: `other` becomes the father, mother, son, daughter or spouse of `to`.',
    input: z.object({
      type: relationType, to: z.string(), other: z.string(), otherParentId: z.string().nullish(),
      kind: z.enum(['birth', 'adopted', 'step']).optional(), certainty: certainty.optional(),
      unionKind: z.enum(['marriage', 'civil']).optional(), startDate: z.string().optional(), endDate: z.string().optional(),
    }),
    refs: { to: 'persons', other: 'persons' },
    apply: (a, x) => people.linkPeople(a, x.type, x.to, x.other, x.otherParentId, { kind: x.kind as ParentKind, certainty: x.certainty as Certainty, unionKind: x.unionKind as UnionKind, startDate: x.startDate, endDate: x.endDate }),
    describe: (x, c) => ({ text: `${c.name(x.other)} — ${say(REL[x.type])}: ${c.name(x.to)}`, details: [x.startDate, x.kind && x.kind !== 'birth' && x.kind, x.certainty === 'assumed' && say('предположение')].filter(Boolean) }),
  }),
  update_relation: def({
    description: 'Change a link: kind, certainty and, for a union, its dates and place. Link ids come from get_person.',
    input: z.object({ type: z.enum(['parent', 'union']), id: z.string(), kind: z.string().optional(), certainty: certainty.optional(), startDate: z.string().max(60).optional(), endDate: z.string().max(60).optional(), place: z.string().max(120).optional() }),
    apply: (a, { type, id, ...patch }) => people.updateRelation(a, type, id, patch),
    describe: (x) => ({ text: `${say('Связь')}: ${[x.kind, x.certainty, x.startDate, x.endDate, x.place].filter(Boolean).join(', ')}` }),
  }),
  remove_relation: def({
    description: 'Remove a link. Link ids come from get_person.',
    input: z.object({ type: z.enum(['parent', 'union']), id: z.string() }),
    apply: (a, x) => people.removeRelation(a, x.type, x.id),
    describe: (x) => {
      const db = getDb()
      const r = x.type === 'parent' ? db.select().from(schema.parentChild).where(eq(schema.parentChild.id, x.id)).get() : db.select().from(schema.unions).where(eq(schema.unions.id, x.id)).get()
      const ids = !r ? [] : 'parentId' in r ? [r.parentId, r.childId] : [r.aId, r.bId]
      return { text: `${say('Удалить связь')}: ${ids.map(nameOfReal).join(' — ')}` }
    },
  }),
  remove_parent_links: def({
    description: 'Take a child off several parents at once, as one change. Link ids come from get_person.',
    input: z.object({ ids: z.array(z.string()).min(1) }),
    apply: (a, x) => people.removeParentLinks(a, x.ids),
    describe: (x) => ({ text: `${say('Удалить связь')}: ${x.ids.length}` }),
  }),
  create_page: def({
    description: 'Create a page about a person. Give the text as `markdown` (preferred) or BlockNote `content`.',
    input: z.object({ personId: z.string(), title: z.string().optional(), parentPageId: z.string().nullish(), icon: z.string().optional(), markdown: markdown.optional(), content: blocks.optional() }),
    refs: { personId: 'persons', parentPageId: 'pages' },
    creates: true,
    prepare: pageContent,
    apply: (a, x) => pages.createPage(a, { personId: x.personId, title: x.title, parentPageId: x.parentPageId, icon: x.icon, content: x.content }),
    describe: (x, c) => ({ text: `${c.name(x.personId)}: ${say('Новая страница')} «${x.title ?? ''}»`, details: x.content ? [`${x.content.length} ${say('блоков')}`] : [] }),
  }),
  update_page: def({
    description: 'Change the title, icon or text of a page. New text replaces the old one entirely.',
    input: z.object({ id: z.string(), title: z.string().optional(), icon: z.string().optional(), markdown: markdown.optional(), content: blocks.optional() }),
    refs: { id: 'pages' },
    prepare: pageContent,
    apply: (a, { id, ...patch }) => pages.updatePage(a, id, patch),
    describe: (x, c) => ({ text: `${say('Страница')}: ${pageName(x.id, c)}`, details: [x.title !== undefined && `${say('Название')}: ${x.title}`, x.content && `${x.content.length} ${say('блоков')}`].filter(Boolean) as string[] }),
  }),
  move_page: def({
    description: 'Put a page under another page, or at the top level with parentPageId null.',
    input: z.object({ id: z.string(), parentPageId: z.string().nullable().optional(), position: z.number().optional() }),
    refs: { id: 'pages', parentPageId: 'pages' },
    apply: (a, { id, ...patch }) => pages.updatePage(a, id, patch),
    describe: (x, c) => ({ text: `${say('Страница')}: ${pageName(x.id, c)}` }),
  }),
  delete_page: def({
    description: 'Delete a page with its subpages. Can be undone.',
    input: z.object({ id: z.string() }),
    refs: { id: 'pages' },
    apply: (a, x) => pages.deletePage(a, x.id),
    describe: (x, c) => ({ text: `${say('Удалить')}: ${pageName(x.id, c)}` }),
  }),
  upload_photo: def({
    description: 'Add a photo or file, by link or as base64, optionally tagged with a person.',
    input: z.object({ url: z.string().url().optional(), base64: z.string().optional(), filename: z.string().optional(), personId: z.string().nullish() }).refine((x) => !!x.url !== !!x.base64, 'give either url or base64'),
    refs: { personId: 'persons' },
    creates: true,
    prepare: async (a, x) => {
      const got = x.url ? await media.fetchRemote(x.url) : { buf: Buffer.from(x.base64, 'base64'), name: x.filename ?? 'photo' }
      return { row: await media.storeUpload(got.buf, x.filename ?? got.name, a.userId), personId: x.personId ?? null }
    },
    apply: (a, x) => media.commitUpload(a, x.row, x.personId),
    describe: (x, c) => ({ text: `${say('Загрузить фото')}: ${x.row.originalName}`, details: x.personId ? [c.name(x.personId)] : [] }),
  }),
  update_photo: def({
    description: 'Change the caption, date or place of a photo.',
    input: z.object({ id: z.string(), caption: z.string().optional(), date: z.string().optional(), place: z.string().optional() }),
    refs: { id: 'media' },
    apply: (a, { id, ...patch }) => media.updateMedia(a, id, patch),
    describe: (x) => ({ text: `${say('Подпись')}: ${x.caption ?? ''}`, details: [x.date, x.place].filter(Boolean) }),
  }),
  delete_photo: def({
    description: 'Delete a photo. Can be undone.',
    input: z.object({ id: z.string() }),
    refs: { id: 'media' },
    apply: (a, x) => media.deleteMedia(a, x.id),
    describe: (x) => ({ text: `${say('Удалить')}: ${say('Фото')} ${x.id}` }),
  }),
  tag_photo: def({
    description: 'Mark a person on a photo. The box is in fractions of the photo size; without a box the person is simply linked.',
    input: z.object({ mediaId: z.string(), personId: z.string(), box: box.nullish() }),
    refs: { mediaId: 'media', personId: 'persons' },
    apply: (a, x) => media.addTag(a, x.mediaId, x.personId, x.box ?? null),
    describe: (x, c) => ({ text: `${say('Фото')}: ${c.name(x.personId)}` }),
  }),
  untag_photo: def({
    description: 'Remove a person mark from a photo. Tag ids come from list_photos.',
    input: z.object({ id: z.string() }),
    refs: { id: 'mediaTags' },
    apply: (a, x) => media.removeTag(a, x.id),
    describe: () => ({ text: `${say('Удалить')}: ${say('Фото')}` }),
  }),
  set_avatar: def({
    description: "Use a photo, or a part of it, as a person's avatar. Null mediaId removes the avatar.",
    input: z.object({ personId: z.string(), mediaId: z.string().nullable(), crop: box.nullish() }),
    refs: { personId: 'persons' },
    apply: (a, x) => people.setAvatar(a, x.personId, x.mediaId, x.crop),
    describe: (x, c) => ({ text: `${c.name(x.personId)}: ${say('Сделать аватаркой')}` }),
  }),
  import_text: def({
    description: 'Add people and links from the text graph format (see export_text). Only adds and changes, never deletes. Always goes to review for tokens.',
    input: z.object({ text: z.string().min(1), resolutions: z.record(z.string(), z.string()).optional().describe('For ambiguous names reported in an error: reference → person id, or "new"') }),
    bulk: true,
    expand: (a, x) => {
      const plan = planFamilyText(parseFamilyText(x.text), people.getGraph(a), x.resolutions)
      if (plan.errors.length || plan.ambiguous.length) throw new OpError(422, JSON.stringify({ errors: plan.errors, ambiguous: plan.ambiguous }))
      return plan.ops
    },
    apply: () => { throw new OpError(500, 'import_text is expanded before applying') },
    describe: () => ({ text: '' }),
  }),
  import_gedcom: def({
    description: 'Import a GEDCOM 5.5.1 or 7.0 file as text. Always goes to review for tokens.',
    input: z.object({ text: z.string().min(1) }),
    bulk: true,
    apply: (a, x) => importGedcom(a, x.text),
    describe: (x) => {
      const n = (x.text.match(/^0 @[^@]+@ INDI/gm) ?? []).length
      return { text: `${say('Импорт GEDCOM')}: ${n} ${say('людей')}` }
    },
  }),
  undo: def({
    description: 'Roll back a change from the history. A token can undo only its own changes.',
    input: z.object({ historyId: z.string() }),
    direct: true,
    apply: (a, x) => undo(a, x.historyId, say('Отменено')),
    describe: () => ({ text: say('Отменено') }),
  }),
}

function nameOfReal(id: string) {
  const p = getDb().select().from(schema.persons).where(eq(schema.persons.id, id)).get()
  return p ? personName(p) || say('Без названия') : id
}

function pageName(id: string, c: Ctx) {
  if (id.startsWith('tmp_')) return c.name(id)
  return getDb().select({ title: schema.pages.title }).from(schema.pages).where(eq(schema.pages.id, id)).get()?.title || say('Без названия')
}

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
    return applyOps(actor, ops, {}, say('Импорт и экспорт')).result
  }
  // Ids a model got earlier may be temporary ones from a draft that has since been accepted.
  const args = await (d.prepare ? d.prepare(actor, withKnownIds(actor, parsed)) : withKnownIds(actor, parsed))
  if (queue) return enqueue(actor, [{ op: name, args: args as PlannedOp['args'] }])
  return d.apply(actor, args)
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
