// Every write that the UI, REST and MCP can make, described once. A token's writes wait in
// a draft for a person to accept; everyone else's apply at once.
import { desc, eq, and } from 'drizzle-orm'
import { customAlphabet } from 'nanoid'
import { z } from 'zod'
import { getDb, schema } from '../db'
import { markdownToBlocks } from '../markdown'
import { parseFamilyText, planFamilyText, type PlannedOp } from '../textformat'
import * as claims from '../claims'
import { lifeYears, personName, yearOf, type Certainty, type ClaimField, type ParentKind, type Person, type UnionKind } from '../types'
import { Actor, mutateGroup, newId, OpError, requireRole, undo } from './core'
import { importGedcom } from './gedcom'
import * as media from './media'
import * as pages from './pages'
import * as people from './people'
import { say } from './settings'

const tmpId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 10)
const MAX_DRAFT_OPS = 5000

const certainty = z.enum(['documented', 'family', 'assumed'])
const personInput = z.object({
  givenName: z.string().max(120), surname: z.string().max(120), maidenName: z.string().max(120), patronymic: z.string().max(120), otherNames: z.string().max(300).describe('Nicknames and other spellings'), sex: z.enum(['M', 'F', 'U']),
  birthDate: z.string().max(120).describe('Free text: "1890", "~1876", "12.03.1890", "1883 или 1886"'), birthPlace: z.string().max(200),
  deathDate: z.string().max(120), deathPlace: z.string().max(200), living: z.boolean(), certainty,
  tags: z.array(z.string().min(1).max(40)).max(30).describe('Groups or labels, e.g. "Соколовы", "Фронт"'),
  facts: z.array(z.object({
    kind: z.string().max(80).describe('What happened: "Профессия", "Переезд", "Служба"'),
    date: z.string().max(60), place: z.string().max(120), note: z.string().max(800), source: z.string().max(300).optional(),
  })).max(100),
  sources: z.array(z.object({
    title: z.string().max(200).describe('Archive, book or who told it'), ref: z.string().max(120).describe('Fond, inventory, file'),
    page: z.string().max(40), url: z.string().max(500), id: z.string().max(40).optional(),
    reliability: z.enum(['original', 'copy', 'transcript', 'witness', 'hearsay', 'guess']).optional().describe('What kind of evidence the source is'),
  })).max(100),
  claims: z.array(z.object({
    id: z.string().max(40), field: z.enum(['birthDate', 'birthPlace', 'deathDate', 'deathPlace', 'givenName', 'patronymic', 'surname', 'maidenName']), value: z.string().max(120),
    sourceId: z.string().max(40).nullable(), status: z.enum(['accepted', 'possible', 'rejected']), reason: z.string().max(200), at: z.number(),
  })).max(200).describe('Versions of a value; the person field holds the accepted one'),
}).partial()
const claimField = z.enum(['birthDate', 'birthPlace', 'deathDate', 'deathPlace', 'givenName', 'patronymic', 'surname', 'maidenName'])
const sourceInput = z.object({
  title: z.string().min(1).max(200).describe('Archive, book or who told it'), ref: z.string().max(120).optional().describe('Fond, inventory, file'),
  page: z.string().max(40).optional(), url: z.string().max(500).optional(),
  reliability: z.enum(['original', 'copy', 'transcript', 'witness', 'hearsay', 'guess']).default('copy'),
})
const relationType = z.enum(['father', 'mother', 'son', 'daughter', 'spouse'])
/** What an agent sends: versions and sources change through add_version, so a model cannot rewrite them whole. */
const agentCreate = personInput.omit({ claims: true, sources: true })
const agentPatch = personInput.omit({ claims: true, sources: true }).extend({ facts: personInput.shape.facts.describe('Replaces the whole list: include the facts to keep') })
const relationInput = z.object({ type: relationType.describe('What the new person is to `to`'), to: z.string(), otherParentId: z.string().nullish() })
const box = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0).max(1), h: z.number().min(0).max(1) })
const blocks = z.array(z.record(z.string(), z.unknown()))
const markdown = z.string().describe('Page text in Markdown. Mention a person as [@Name](person:ID), a photo as ![caption](/api/v1/media/ID/file?size=medium).')

type Table = 'persons' | 'pages' | 'media' | 'mediaTags' | 'history'
interface Ctx { name: (id: unknown) => string }
interface Def<S extends z.ZodType = z.ZodType> {
  /** How far a person must be asked before it runs; see lib/ops/tools.ts. */
  risk: 'write' | 'danger'
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
  /** What agents see instead of `input`, when people may send more than a model should. */
  agentInput?: z.ZodObject
  /** The history entry for an expanded operation. */
  summary?: (args: any) => string
}

const def = <S extends z.ZodType>(d: Def<S>) => d as Def

function personFor(actor: Actor, id: string) {
  const p = people.getGraph(actor).persons.find((x) => x.id === id)
  if (!p || p.hidden) throw new OpError(404, `person ${id} not found`)
  return p
}

const isAgent = (a: Actor) => !!(a.assistant || a.tokenId)
const same = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/ё/g, 'е')
const isTemp = (id: unknown) => typeof id === 'string' && id.startsWith('tmp_')

function assertDates(birth?: string | null, death?: string | null) {
  const b = yearOf(birth ?? ''), d = yearOf(death ?? '')
  if (b && d && d < b) throw new OpError(400, `death year ${d} is before birth year ${b}`)
}

/** People or models would get a chart that lies; better a refusal the model can explain. */
function assertLink(a: Actor, type: string, to: string, other: { id?: string; sex?: string; birthDate?: string; name: string }, kind = 'birth') {
  if (type === 'spouse') return
  const toPerson = personFor(a, to)
  const parentIsOther = type === 'father' || type === 'mother'
  const wantsMale = type === 'father' || type === 'son'
  if (other.sex && other.sex !== 'U' && (other.sex === 'M') !== wantsMale) throw new OpError(400, `${other.name} has the wrong sex to be a ${type}. Check who is who, or correct their sex first.`)
  const parent = parentIsOther ? { birth: other.birthDate, name: other.name } : { birth: toPerson.birthDate, name: personName(toPerson) }
  const child = parentIsOther ? { birth: toPerson.birthDate, name: personName(toPerson) } : { birth: other.birthDate, name: other.name }
  const by = yearOf(parent.birth ?? ''), cy = yearOf(child.birth ?? '')
  if (kind === 'birth' && by && cy && cy - by < 12) throw new OpError(400, `${parent.name} (${by}) is too young to be the parent of ${child.name} (${cy}). Check who is who.`)
  const childId = parentIsOther ? to : other.id
  if (kind !== 'birth' || !childId) return
  const g = people.getGraph(a)
  const parents = g.parentChild.filter((l) => l.childId === childId && l.kind === 'birth' && l.parentId !== (parentIsOther ? other.id : to))
  if (parents.length >= 2) throw new OpError(400, `${child.name} already has two parents. Remove one with remove_relation first, or use kind adopted or step.`)
  const newSex = parentIsOther ? other.sex : toPerson.sex
  const twin = parents.map((l) => g.persons.find((p) => p.id === l.parentId)).find((p) => p && !p.hidden && p.sex !== 'U' && p.sex === newSex)
  if (twin) throw new OpError(400, `${child.name} already has a ${newSex === 'M' ? 'father' : 'mother'}: ${personName(twin)}. Remove that link first, or use kind adopted or step.`)
}

/** An import runs its links without the checks of a single add_relation, so the same ones run on the whole plan first. */
function assertPlanSound(a: Actor, ops: PlannedOp[]) {
  const g = people.getGraph(a)
  const birth = new Map<string, { year: number | null; name: string }>(g.persons.map((p) => [p.id, { year: p.birthYear, name: personName(p) }]))
  for (const o of ops) {
    const p = (o.args as any).person
    if (o.op === 'create_person' && o.tempId) {
      assertDates(p.birthDate, p.deathDate)
      birth.set(o.tempId, { year: yearOf(p.birthDate ?? ''), name: [p.givenName, p.surname].filter(Boolean).join(' ') })
    }
  }
  const parents = new Map<string, Set<string>>()
  for (const l of g.parentChild) if (l.kind === 'birth') parents.set(l.childId, (parents.get(l.childId) ?? new Set()).add(l.parentId))
  for (const o of ops) {
    const x = o.args as any
    if (o.op !== 'add_relation' || x.type !== 'son') continue
    const parent = birth.get(x.to), child = birth.get(x.other)
    if (parent?.year && child?.year && child.year - parent.year < 12) throw new OpError(400, `${parent.name} (${parent.year}) is too young to be the parent of ${child.name} (${child.year}). In this format an indented line is a child; a spouse goes on a line A + B. Otherwise check the text, and ask if unsure.`)
    if ((x.kind ?? 'birth') === 'birth') {
      const set = parents.get(x.other) ?? new Set<string>()
      set.add(x.to)
      if (set.size > 2) throw new OpError(400, `${child?.name} would have more than two parents`)
      parents.set(x.other, set)
    }
  }
}

function assertSpouses(a: Actor, one: string, two: string) {
  const g = people.getGraph(a)
  const parentsOf = (id: string) => g.parentChild.filter((l) => l.childId === id).map((l) => l.parentId)
  const p1 = parentsOf(one), p2 = parentsOf(two)
  if (p1.includes(two) || p2.includes(one)) throw new OpError(400, 'a parent and their child cannot be spouses')
  if (p1.some((p) => p2.includes(p))) throw new OpError(400, 'siblings cannot be spouses')
}

function checkNewPerson(a: Actor, x: { person: Record<string, any>; relation?: { type: string; to: string; otherParentId?: string | null }; notDuplicate?: boolean }) {
  if (!isAgent(a)) return x
  const p = x.person
  // Versions and removals refer to a source by id, so every source has one from the start.
  if (p.sources) p.sources = p.sources.map((s: { id?: string }) => ({ ...s, id: s.id ?? newId() }))
  if (!p.givenName?.trim() && !p.surname?.trim()) throw new OpError(400, 'a person needs a given name or a surname: {"person":{"givenName":"Иван","surname":"Орлов","birthDate":"1900"},"relation":{"type":"father","to":"<id>"}}')
  assertDates(p.birthDate, p.deathDate)
  const name = [p.givenName, p.surname].filter(Boolean).join(' ')
  const r = x.relation
  if (r && !isTemp(r.to)) {
    assertLink(a, r.type, r.to, { sex: p.sex ?? (r.type === 'father' || r.type === 'son' ? 'M' : r.type === 'spouse' ? undefined : 'F'), birthDate: p.birthDate, name })
    if (r.otherParentId && !isTemp(r.otherParentId)) personFor(a, r.otherParentId)
  }
  if (x.notDuplicate) return x
  const year = yearOf(p.birthDate ?? '')
  const twins = people.getGraph(a).persons.filter((o) => {
    if (o.hidden || same(o.givenName) !== same(p.givenName)) return false
    if (same(o.surname) !== same(p.surname) && same(o.maidenName) !== same(p.surname)) return false
    return !(year && o.birthYear && Math.abs(year - o.birthYear) > 3)
  })
  if (twins.length) throw new OpError(409, `Not added: this may be someone already in the archive: ${twins.map((o) => `${personFull(o)} (id ${o.id}${o.birthPlace ? `, ${o.birthPlace}` : ''})`).join('; ')}. Ask the person whether it is one of them. Only if they say it is someone new, call again with notDuplicate true.`)
  return x
}

function checkPatch(a: Actor, id: string, patch: Record<string, any>) {
  if (!isAgent(a) || isTemp(id)) return
  if (!Object.keys(patch).length) throw new OpError(400, 'nothing to change: the patch is empty')
  const cur = personFor(a, id)
  const given = patch.givenName ?? cur.givenName, surname = patch.surname ?? cur.surname
  if (!given?.trim() && !surname?.trim()) throw new OpError(400, 'a person needs a given name or a surname')
  assertDates(patch.birthDate ?? cur.birthDate, patch.deathDate ?? cur.deathDate)
  if (patch.living === true && (patch.deathDate ?? cur.deathDate)) throw new OpError(400, 'someone with a death date cannot be marked living')
}

/** A value with versions changes through them, so the card and its versions never disagree. */
function withVersions(p: Person, patch: Record<string, any>) {
  let out = { ...patch }
  let cur = p
  for (const field of [...claims.CLAIM_FIELDS, ...claims.NAME_FIELDS]) {
    if (patch[field] === undefined || !cur.claims.some((c) => c.field === field)) continue
    const change = claims.editValue(cur, field, patch[field])
    out = { ...out, ...change }
    cur = { ...cur, ...change } as Person
  }
  return out
}

function assertVersion(p: Person, field: ClaimField, id: string) {
  if (!claims.versions(p, field).some((c) => c.id === id)) throw new OpError(404, `version ${id} not found for ${field}`)
}

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
    risk: 'write',
    description: 'Create a person, optionally linked to someone at once.',
    input: z.object({ person: personInput, relation: relationInput.optional(), notDuplicate: z.boolean().optional() }),
    agentInput: z.object({ person: agentCreate, relation: relationInput.optional(), notDuplicate: z.boolean().optional().describe('Only after the person said this is someone new') }),
    creates: true,
    prepare: checkNewPerson,
    apply: (a, x) => people.createPerson(a, x.person, x.relation),
    describe: (x, c) => ({
      text: `${say('Добавить')}: ${[x.person.givenName, x.person.surname].filter(Boolean).join(' ')}`,
      details: [x.person.birthDate && `${say('Рождение')}: ${x.person.birthDate}`, x.person.deathDate && `${say('Смерть')}: ${x.person.deathDate}`, x.relation && `${say(REL[x.relation.type])} — ${c.name(x.relation.to)}`].filter(Boolean),
    }),
  }),
  update_person: def({
    risk: 'write',
    description: 'Change fields of a person. Only the given fields change.',
    input: z.object({ id: z.string(), patch: personInput }),
    agentInput: z.object({ id: z.string(), patch: agentPatch }),
    refs: { id: 'persons' },
    prepare: (a, x) => { checkPatch(a, x.id, x.patch); return x },
    apply: (a, x) => people.updatePerson(a, x.id, isAgent(a) ? withVersions(personFor(a, x.id), x.patch) : x.patch),
    describe: (x, c) => {
      const cur = x.id.startsWith('tmp_') ? null : people.getPersonRow(x.id) as Record<string, unknown>
      return { text: c.name(x.id), details: Object.entries(x.patch).map(([k, v]) => `${say(FIELD[k] ?? k)}: ${cur?.[k] ?? ''} → ${v}`) }
    },
  }),
  update_people: def({
    risk: 'danger',
    description: 'Change several people as one change, undone all at once. Use this instead of many update_person calls, and only after the person agreed to the whole list.',
    input: z.object({ changes: z.array(z.object({ id: z.string(), patch: personInput })).min(1).max(200) }),
    agentInput: z.object({ changes: z.array(z.object({ id: z.string(), patch: z.record(z.string(), z.unknown()).describe('Fields as in update_person') })).min(1).max(200) }),
    bulk: true,
    expand: (a, x) => {
      if (new Set(x.changes.map((c: { id: string }) => c.id)).size !== x.changes.length) throw new OpError(400, 'the same person is listed twice')
      for (const c of x.changes) {
        agentPatch.parse(c.patch)
        if (!isTemp(c.id)) personFor(a, c.id)
        checkPatch(a, c.id, c.patch)
      }
      return x.changes.map((c: { id: string; patch: unknown }) => ({ op: 'update_person', args: c }) as PlannedOp)
    },
    summary: (x) => `${say('Изменить сразу')}: ${x.changes.length}`,
    apply: () => { throw new OpError(500, 'update_people is expanded before applying') },
    describe: () => ({ text: '' }),
  }),
  delete_person: def({
    risk: 'danger',
    description: 'Delete a person with their relations, pages and photo tags. Can be undone.',
    input: z.object({ id: z.string() }),
    refs: { id: 'persons' },
    apply: (a, x) => people.deletePerson(a, x.id),
    describe: (x, c) => ({ text: `${say('Удалить человека')}: ${c.name(x.id)}` }),
  }),
  add_relation: def({
    risk: 'write',
    description: 'Link two existing people: `other` becomes the father, mother, son, daughter or spouse of `to`.',
    input: z.object({
      type: relationType, to: z.string(), other: z.string(), otherParentId: z.string().nullish(),
      kind: z.enum(['birth', 'adopted', 'step']).optional(), certainty: certainty.optional(),
      unionKind: z.enum(['marriage', 'civil']).optional(), startDate: z.string().optional(), endDate: z.string().optional(),
    }),
    refs: { to: 'persons', other: 'persons' },
    prepare: (a, x) => {
      if (!isAgent(a) || isTemp(x.to) || isTemp(x.other)) return x
      if (x.to === x.other) throw new OpError(400, 'same person')
      const other = personFor(a, x.other)
      personFor(a, x.to)
      if (x.type === 'spouse') assertSpouses(a, x.to, x.other)
      else assertLink(a, x.type, x.to, { id: x.other, sex: other.sex, birthDate: other.birthDate, name: personName(other) }, x.kind)
      if (x.otherParentId && !isTemp(x.otherParentId)) personFor(a, x.otherParentId)
      return x
    },
    apply: (a, x) => people.linkPeople(a, x.type, x.to, x.other, x.otherParentId, { kind: x.kind as ParentKind, certainty: x.certainty as Certainty, unionKind: x.unionKind as UnionKind, startDate: x.startDate, endDate: x.endDate }),
    describe: (x, c) => ({ text: `${c.name(x.other)} — ${say(REL[x.type])}: ${c.name(x.to)}`, details: [x.startDate, x.kind && x.kind !== 'birth' && x.kind, x.certainty === 'assumed' && say('предположение')].filter(Boolean) }),
  }),
  update_relation: def({
    risk: 'write',
    description: 'Change a link: kind, certainty and, for a union, its dates and place. Link ids come from get_person.',
    input: z.object({ type: z.enum(['parent', 'union']), id: z.string(), kind: z.string().optional(), certainty: certainty.optional(), startDate: z.string().max(60).optional(), endDate: z.string().max(60).optional(), place: z.string().max(120).optional() }),
    prepare: (_a, x) => {
      const { type, id, ...patch } = x
      if (!Object.keys(patch).length) throw new OpError(400, 'nothing to change')
      const table = type === 'parent' ? schema.parentChild : schema.unions
      if (!getDb().select({ id: table.id }).from(table).where(eq(table.id, id)).get()) throw new OpError(404, `link ${id} not found`)
      if (x.kind && !(type === 'parent' ? ['birth', 'adopted', 'step'] : ['marriage', 'civil']).includes(x.kind)) throw new OpError(400, `${x.kind} is not a kind of ${type} link`)
      if (type === 'parent' && (x.startDate !== undefined || x.endDate !== undefined || x.place !== undefined)) throw new OpError(400, 'dates and place belong to a union, not a parent link')
      return x
    },
    apply: (a, { type, id, ...patch }) => people.updateRelation(a, type, id, patch),
    describe: (x) => ({ text: `${say('Связь')}: ${[x.kind, x.certainty, x.startDate, x.endDate, x.place].filter(Boolean).join(', ')}` }),
  }),
  remove_relation: def({
    risk: 'danger',
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
    risk: 'danger',
    description: 'Take a child off several parents at once, as one change. Link ids come from get_person.',
    input: z.object({ ids: z.array(z.string()).min(1) }),
    apply: (a, x) => people.removeParentLinks(a, x.ids),
    describe: (x) => ({ text: `${say('Удалить связь')}: ${x.ids.length}` }),
  }),
  create_page: def({
    risk: 'write',
    description: 'Create a page about a person. Give the text as `markdown` (preferred) or BlockNote `content`.',
    input: z.object({ personId: z.string(), title: z.string().optional(), parentPageId: z.string().nullish(), icon: z.string().optional(), markdown: markdown.optional(), content: blocks.optional() }),
    refs: { personId: 'persons', parentPageId: 'pages' },
    creates: true,
    prepare: pageContent,
    apply: (a, x) => pages.createPage(a, { personId: x.personId, title: x.title, parentPageId: x.parentPageId, icon: x.icon, content: x.content }),
    describe: (x, c) => ({ text: `${c.name(x.personId)}: ${say('Новая страница')} «${x.title ?? ''}»`, details: x.content ? [`${x.content.length} ${say('блоков')}`] : [] }),
  }),
  update_page: def({
    risk: 'write',
    description: 'Change the title, icon or text of a page. New text replaces the old one entirely. Pass baseUpdatedAt from get_page to be refused if somebody changed the page meanwhile.',
    input: z.object({ id: z.string(), title: z.string().optional(), icon: z.string().optional(), markdown: markdown.optional(), content: blocks.optional(), baseUpdatedAt: z.number().optional() }),
    refs: { id: 'pages' },
    prepare: pageContent,
    apply: (a, { id, ...patch }) => pages.updatePage(a, id, patch),
    describe: (x, c) => ({ text: `${say('Страница')}: ${pageName(x.id, c)}`, details: [x.title !== undefined && `${say('Название')}: ${x.title}`, x.content && `${x.content.length} ${say('блоков')}`].filter(Boolean) as string[] }),
  }),
  move_page: def({
    risk: 'write',
    description: 'Put a page under another page, or at the top level with parentPageId null.',
    input: z.object({ id: z.string(), parentPageId: z.string().nullable().optional(), position: z.number().optional() }),
    refs: { id: 'pages', parentPageId: 'pages' },
    apply: (a, { id, ...patch }) => pages.updatePage(a, id, patch),
    describe: (x, c) => ({ text: `${say('Страница')}: ${pageName(x.id, c)}` }),
  }),
  delete_page: def({
    risk: 'danger',
    description: 'Delete a page with its subpages. Can be undone.',
    input: z.object({ id: z.string() }),
    refs: { id: 'pages' },
    apply: (a, x) => pages.deletePage(a, x.id),
    describe: (x, c) => ({ text: `${say('Удалить')}: ${pageName(x.id, c)}` }),
  }),
  upload_photo: def({
    risk: 'write',
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
    risk: 'write',
    description: 'Change the caption, date or place of a photo.',
    input: z.object({ id: z.string(), caption: z.string().optional(), date: z.string().optional(), place: z.string().optional() }),
    refs: { id: 'media' },
    apply: (a, { id, ...patch }) => media.updateMedia(a, id, patch),
    describe: (x) => ({ text: `${say('Подпись')}: ${x.caption ?? ''}`, details: [x.date, x.place].filter(Boolean) }),
  }),
  delete_photo: def({
    risk: 'danger',
    description: 'Delete a photo. Can be undone.',
    input: z.object({ id: z.string() }),
    refs: { id: 'media' },
    apply: (a, x) => media.deleteMedia(a, x.id),
    describe: (x) => ({ text: `${say('Удалить')}: ${say('Фото')} ${x.id}` }),
  }),
  tag_photo: def({
    risk: 'write',
    description: 'Mark a person on a photo. The box is in fractions of the photo size; without a box the person is simply linked.',
    input: z.object({ mediaId: z.string(), personId: z.string(), box: box.nullish() }),
    refs: { mediaId: 'media', personId: 'persons' },
    apply: (a, x) => media.addTag(a, x.mediaId, x.personId, x.box ?? null),
    describe: (x, c) => ({ text: `${say('Фото')}: ${c.name(x.personId)}` }),
  }),
  untag_photo: def({
    risk: 'danger',
    description: 'Remove a person mark from a photo. Tag ids come from list_photos.',
    input: z.object({ id: z.string() }),
    refs: { id: 'mediaTags' },
    apply: (a, x) => media.removeTag(a, x.id),
    describe: () => ({ text: `${say('Удалить')}: ${say('Фото')}` }),
  }),
  set_avatar: def({
    risk: 'write',
    description: "Use a photo, or a part of it, as a person's avatar. Null mediaId removes the avatar.",
    input: z.object({ personId: z.string(), mediaId: z.string().nullable(), crop: box.nullish() }),
    refs: { personId: 'persons', mediaId: 'media' },
    prepare: (a, x) => {
      if (x.mediaId && media.getMedia(a, x.mediaId).kind !== 'image') throw new OpError(400, 'only a picture can be an avatar')
      return x
    },
    apply: (a, x) => people.setAvatar(a, x.personId, x.mediaId, x.crop),
    describe: (x, c) => ({ text: `${c.name(x.personId)}: ${say('Сделать аватаркой')}` }),
  }),
  add_version: def({
    risk: 'write',
    description: 'Record a value found for a person: birth or death date or place, or a name. Keeps what was there; the first value of an empty field becomes the main one, otherwise a person chooses. Prefer this to update_person for anything found in a source. Give `source` to say where it comes from: reuse a source by `sourceId` from get_person.',
    input: z.object({
      personId: z.string(),
      field: claimField,
      value: z.string().min(1).max(120),
      sourceId: z.string().max(40).optional(),
      source: sourceInput.optional().describe('A new source for this person'),
    }),
    refs: { personId: 'persons' },
    apply: (a, x) => {
      const p = personFor(a, x.personId)
      const source = x.source ? { ...x.source, id: newId(), ref: x.source.ref ?? '', page: x.source.page ?? '', url: x.source.url ?? '' } : null
      const sources = source ? [...p.sources, source] : p.sources
      if (x.sourceId && !sources.some((s) => s.id === x.sourceId)) throw new OpError(404, `source ${x.sourceId} not found on this person`)
      return people.updatePerson(a, x.personId, { sources, ...claims.addVersion({ ...p, sources }, x.field, x.value, source?.id ?? x.sourceId ?? null) })
    },
    describe: (x, c) => ({ text: `${c.name(x.personId)}: ${x.field} = ${x.value}`, details: [x.source?.title].filter(Boolean) }),
  }),
  add_source: def({
    risk: 'write',
    description: 'Add a source to a person: an archive, a book or who told it. The answer has its sourceId, for add_version.',
    input: z.object({ personId: z.string() }).extend(sourceInput.shape),
    refs: { personId: 'persons' },
    apply: (a, { personId, ...s }) => {
      const p = personFor(a, personId)
      const source = { ...s, id: newId(), ref: s.ref ?? '', page: s.page ?? '', url: s.url ?? '' }
      people.updatePerson(a, personId, { sources: [...p.sources, source] })
      return { sourceId: source.id }
    },
    describe: (x, c) => ({ text: `${c.name(x.personId)}: ${x.title}`, details: [x.ref, x.page].filter(Boolean) }),
  }),
  remove_source: def({
    risk: 'danger',
    description: 'Remove a source from a person. Source ids come from get_person. Refused while a version of a value relies on it.',
    input: z.object({ personId: z.string(), sourceId: z.string() }),
    refs: { personId: 'persons' },
    apply: (a, x) => {
      const p = personFor(a, x.personId)
      if (!p.sources.some((s) => s.id === x.sourceId)) throw new OpError(404, `source ${x.sourceId} not found on this person`)
      const user = p.claims.find((c) => c.sourceId === x.sourceId)
      if (user) throw new OpError(409, `the version ${user.value} of ${user.field} relies on this source`)
      people.updatePerson(a, x.personId, { sources: p.sources.filter((s) => s.id !== x.sourceId) })
    },
    describe: (x, c) => ({ text: `${c.name(x.personId)}: ${say('Удалить')} ${x.sourceId}` }),
  }),
  restore_version: def({
    risk: 'write',
    description: 'Bring back a version marked as wrong. Version ids come from get_person (`claims`).',
    input: z.object({ personId: z.string(), field: claimField, versionId: z.string() }),
    refs: { personId: 'persons' },
    apply: (a, x) => {
      const p = personFor(a, x.personId)
      assertVersion(p, x.field, x.versionId)
      return people.updatePerson(a, x.personId, claims.restore(p, x.field, x.versionId))
    },
    describe: (x, c) => ({ text: `${c.name(x.personId)}: ${x.field} ← ${x.versionId}` }),
  }),
  choose_version: def({
    risk: 'write',
    description: 'Make one version of a value the main one. Version ids come from get_person (`claims`). A value not yet saved as a version has the id cur:<field>:<value>.',
    input: z.object({ personId: z.string(), field: claimField, versionId: z.string() }),
    refs: { personId: 'persons' },
    apply: (a, x) => {
      const p = personFor(a, x.personId)
      assertVersion(p, x.field, x.versionId)
      return people.updatePerson(a, x.personId, claims.accept(p, x.field, x.versionId))
    },
    describe: (x, c) => ({ text: `${c.name(x.personId)}: ${x.field} → ${x.versionId}` }),
  }),
  reject_version: def({
    risk: 'danger',
    description: 'Mark a version as wrong, with the reason. It is kept, so nobody accepts it again. If it was the main one, the next version takes over.',
    input: z.object({ personId: z.string(), field: claimField, versionId: z.string(), reason: z.string().min(1).max(200) }),
    refs: { personId: 'persons' },
    apply: (a, x) => {
      const p = personFor(a, x.personId)
      assertVersion(p, x.field, x.versionId)
      return people.updatePerson(a, x.personId, claims.reject(p, x.field, x.versionId, x.reason))
    },
    describe: (x, c) => ({ text: `${c.name(x.personId)}: ${x.field} ✕ ${x.reason}` }),
  }),
  import_text: def({
    risk: 'danger',
    description: `The way to add several people at once: one confirmation, one undo. Only adds and changes, never deletes. Always goes to review for tokens. One person per line: Name Surname b: 1880, bp: Tula, d: 1950, dp: Oryol, sex: m, maiden: Ivanova. "A + B m: 1905" is a couple, indented lines under it are their children, and a single person's indented lines are theirs. An indented line is always a child: a spouse is never indented, write A + B. A person named again later is the same person. Point at someone already in the archive with id: their id. Example:
Иван Соколов id: abc + Анна Соколова id: def
  Глеб Соколов b: 1950, d: 1995, sex: m
Глеб Соколов + Зоя Тарасова b: 1952, d: 2015, sex: f, m: 1974
  Инна Соколова b: 1975, d: 2020, sex: f
The answer lists each new person's id.`,
    input: z.object({ text: z.string().min(1), resolutions: z.record(z.string(), z.string()).optional().describe('For ambiguous names reported in an error: reference → person id, or "new"') }),
    bulk: true,
    expand: (a, x) => {
      const plan = planFamilyText(parseFamilyText(x.text), people.getGraph(a), x.resolutions)
      if (plan.errors.length || plan.ambiguous.length) throw new OpError(422, JSON.stringify({ errors: plan.errors, ambiguous: plan.ambiguous }))
      if (isAgent(a)) assertPlanSound(a, plan.ops)
      return plan.ops
    },
    apply: () => { throw new OpError(500, 'import_text is expanded before applying') },
    describe: () => ({ text: '' }),
  }),
  import_gedcom: def({
    risk: 'danger',
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
    risk: 'danger',
    description: 'Roll back a change from the history. A token can undo only its own changes.',
    input: z.object({ historyId: z.string() }),
    direct: true,
    apply: (a, x) => undo(a, x.historyId, say('Отменено')),
    describe: () => ({ text: say('Отменено') }),
  }),
}

const personFull = (p: { givenName: string; patronymic: string; surname: string; birthDate: string; deathDate: string }) => {
  const name = [p.givenName, p.patronymic, p.surname].filter(Boolean).join(' ')
  const years = lifeYears(p as Person)
  return years ? `${name} (${years})` : name
}

/** With patronymic and years: on a confirmation card two namesakes must look different. */
function nameOfReal(id: string) {
  const p = getDb().select().from(schema.persons).where(eq(schema.persons.id, id)).get()
  return p ? personFull(p) || say('Без названия') : id
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
    const { result, historyId, map } = applyOps(actor, ops, {}, d.summary?.(parsed) ?? say('Импорт и экспорт'))
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
