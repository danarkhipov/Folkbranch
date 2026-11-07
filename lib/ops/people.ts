import { and, eq, or } from 'drizzle-orm'
import { dataStamp, getDb, schema } from '../db'
import type { Certainty, Claim, Fact, Graph, ParentKind, Person, Sex, Source, UnionKind } from '../types'
import { personName, yearOf } from '../types'
import { Actor, Changes, can, mutate, newId, OpError, requireRole, seesOnlyPublic, dropStoriesAboutNobody } from './core'
import { say } from './app-config'
import { reconcile } from './merge'
import { subgraph } from '../graph/select'
import { hiddenFor, hiddenIn, maskPerson } from './privacy'

export { hiddenFor }

const label = (p: { givenName: string; surname: string } | undefined) => (p && personName(p)) || say('Без названия')

function isLikelyLiving(birthYear: number | null, deathDate: string, deathYear: number | null) {
  if (deathDate || deathYear) return false
  return !(birthYear && birthYear < new Date().getFullYear() - 110)
}

const PERSON_JSON = (r: any) => ({ ...r, tags: JSON.parse(r.tags ?? '[]') as string[], facts: JSON.parse(r.facts ?? '[]') as Fact[], sources: JSON.parse(r.sources ?? '[]') as Source[], claims: JSON.parse(r.claims ?? '[]') })

const BOOT = Date.now().toString(36)
interface GraphEntry { stamp: string; graph: Graph; json?: string; hidden?: Map<string, Graph['persons'][number]> }
const shared = globalThis as unknown as { __folkbranch?: GraphEntry }

/** Everyone and all links as they stand, parsed once per change. Shared by all callers: read it, never change it. */
function wholeGraph() {
  const stamp = dataStamp()
  if (stamp && shared.__folkbranch?.stamp === stamp) return shared.__folkbranch
  const db = getDb()
  const graph = {
    persons: db.select().from(schema.persons).all().map(PERSON_JSON),
    parentChild: db.select().from(schema.parentChild).all(),
    unions: db.select().from(schema.unions).all(),
  } as unknown as Graph
  const entry: GraphEntry = { stamp: stamp ?? '', graph }
  if (process.env.VITEST) deepFreeze(graph)
  if (stamp) shared.__folkbranch = entry
  return entry
}

function deepFreeze(o: unknown) {
  if (!o || typeof o !== 'object' || Object.isFrozen(o)) return
  Object.freeze(o)
  Object.values(o).forEach(deepFreeze)
}

/** One masked copy of each living person per change, however many readers ask. */
const maskedOf = (entry: GraphEntry) => (entry.hidden ??= new Map(entry.graph.persons.filter((p) => p.living).map((p) => [p.id, maskPerson(p)])))

function maskedGraph(actor: Actor): Graph {
  const entry = wholeGraph()
  const { graph } = entry
  if (!seesOnlyPublic(actor)) return graph
  const hidden = maskedOf(entry)
  return { ...graph, persons: graph.persons.map((p) => (hiddenFor(actor, p) ? hidden.get(p.id) ?? maskPerson(p) : p)) }
}

/** A link to one branch does not say the rest exists: those people are gone, not masked. */
export function getGraph(actor: Actor): Graph {
  const graph = maskedGraph(actor)
  const only = actor.guest?.only
  return only ? subgraph(graph, (id) => only.has(id)) : graph
}

/** Everyone masked for this person. */
export const hiddenPeople = (actor: Actor) => hiddenIn(actor, maskedGraph(actor))

/** Whether this person may know that someone has a card open. Asked often, so it builds no graph. */
export function canSeePerson(actor: Actor, id: string) {
  if (!seesOnlyPublic(actor)) return true
  const entry = wholeGraph()
  return !maskedOf(entry).has(id) || id === actor.personId
}

/** The graph as sent to a page, with a tag that lets an unchanged one travel as a short "not modified". */
export function graphForPage(actor: Actor): { etag: string | null; body: () => string } {
  const entry = wholeGraph()
  const stamp = dataStamp()
  const etag = stamp ? `"${BOOT}.${stamp}.${seesOnlyPublic(actor) ? `r${actor.personId}${actor.guest ? `.${actor.userId}.${actor.guest.only?.size}` : ''}` : 'all'}"` : null
  return { etag, body: () => (seesOnlyPublic(actor) ? JSON.stringify(getGraph(actor)) : (entry.json ??= JSON.stringify(entry.graph))) }
}

export function getPersonRow(id: string) {
  const p = getDb().select().from(schema.persons).where(eq(schema.persons.id, id)).get()
  if (!p) throw new OpError(404, 'not found')
  return p
}

export interface PersonInput {
  givenName?: string
  surname?: string
  maidenName?: string
  patronymic?: string
  otherNames?: string
  sex?: Sex
  birthDate?: string
  birthPlace?: string
  deathDate?: string
  deathPlace?: string
  living?: boolean
  certainty?: Certainty
  tags?: string[]
  facts?: Fact[]
  sources?: Source[]
  claims?: Claim[]
}

function normalize(input: PersonInput) {
  const { tags, facts, sources, claims, ...rest } = input
  const row: Record<string, unknown> = { ...rest, updatedAt: Date.now() }
  if (tags !== undefined) row.tags = JSON.stringify(tags)
  if (facts !== undefined) row.facts = JSON.stringify(facts)
  if (sources !== undefined) row.sources = JSON.stringify(sources)
  if (claims !== undefined) row.claims = JSON.stringify(claims)
  if (input.birthDate !== undefined) row.birthYear = yearOf(input.birthDate)
  if (input.deathDate !== undefined) row.deathYear = yearOf(input.deathDate)
  return row
}

export type QuickRelation = 'father' | 'mother' | 'son' | 'daughter' | 'spouse'

export function insertPerson(c: Changes, input: PersonInput) {
  const id = newId()
  const row = normalize(input)
  const birthYear = (row.birthYear as number | null) ?? null
  const deathYear = (row.deathYear as number | null) ?? null
  const living = input.living ?? isLikelyLiving(birthYear, input.deathDate ?? '', deathYear)
  c.insert('persons', { id, ...row, living })
  return id
}

/** Creates a person, optionally linked to an existing one through a relation. */
export function createPerson(
  actor: Actor,
  input: PersonInput,
  relation?: { type: QuickRelation; to: string; otherParentId?: string | null },
) {
  requireRole(actor, 'editor')
  const name = [input.givenName, input.surname].filter(Boolean).join(' ')
  const personIds = relation ? [relation.to] : []
  return mutate(actor, { summary: `${say('Добавить')}: ${name}`, personIds }, (c) => {
    const sex: Sex | undefined = relation?.type === 'father' || relation?.type === 'son' ? 'M' : relation?.type === 'mother' || relation?.type === 'daughter' ? 'F' : undefined
    const id = insertPerson(c, { ...input, sex: input.sex ?? sex })
    // A reader's history leaves out entries naming nobody, so the new person must be named here.
    personIds.push(id)
    if (relation) link(c, relation.type, relation.to, id, relation.otherParentId)
    return getPersonRow(id)
  })
}

/** Attaches two existing people; `other` takes the role named by `type` relative to `to`. */
export interface LinkOptions { kind?: ParentKind; certainty?: Certainty; unionKind?: UnionKind; startDate?: string; endDate?: string }

export function linkPeople(actor: Actor, type: QuickRelation, to: string, other: string, otherParentId?: string | null, opts: LinkOptions = {}) {
  requireRole(actor, 'editor')
  const a = getPersonRow(to), b = getPersonRow(other)
  mutate(actor, { summary: `${label(a)} — ${label(b)}`, personIds: [to, other] }, (c) => link(c, type, to, other, otherParentId, opts))
}

function link(c: Changes, type: QuickRelation, to: string, other: string, otherParentId?: string | null, opts: LinkOptions = {}) {
  if (to === other) throw new OpError(400, 'same person')
  if (type === 'spouse') return addUnion(c, to, other, opts.unionKind, opts.startDate, opts.endDate)
  if (type === 'father' || type === 'mother') {
    addParent(c, other, to, opts.kind, opts.certainty)
    // A second parent next to an existing one forms a family: the pair gets its dot.
    const existing = getDb().select().from(schema.parentChild).where(eq(schema.parentChild.childId, to)).all().filter((r) => r.parentId !== other)
    if (existing.length === 1) addUnion(c, existing[0].parentId, other)
    return
  }
  addParent(c, to, other, opts.kind, opts.certainty)
  if (otherParentId) addParent(c, otherParentId, other, opts.kind, opts.certainty)
}

function isAncestor(candidate: string, of: string) {
  return !!getDb().$client.prepare(`
    with recursive up(id) as (select ? union select p.parent_id from parent_child p join up on p.child_id = up.id)
    select 1 from up where id = ? limit 1`).get(of, candidate)
}

export function addParent(c: Changes, parentId: string, childId: string, kind: ParentKind = 'birth', certainty: Certainty = 'family') {
  const db = getDb()
  const dup = db.select().from(schema.parentChild).where(and(eq(schema.parentChild.parentId, parentId), eq(schema.parentChild.childId, childId))).get()
  if (dup) return
  if (isAncestor(childId, parentId)) throw new OpError(400, 'a person cannot be their own ancestor')
  c.insert('parentChild', { id: newId(), parentId, childId, kind, certainty })
}

export function addUnion(c: Changes, aId: string, bId: string, kind: UnionKind = 'marriage', startDate = '', endDate = '', place = '') {
  const db = getDb()
  const s = schema.unions
  // A marriage never joins siblings, or a parent and their child: the chart would draw a couple dot between them.
  const parentsOf = (id: string) => db.select({ p: schema.parentChild.parentId }).from(schema.parentChild).where(eq(schema.parentChild.childId, id)).all().map((r) => r.p)
  const pa = parentsOf(aId), pb = parentsOf(bId)
  if (pa.some((p) => pb.includes(p)) || pa.includes(bId) || pb.includes(aId)) return
  const dup = db.select().from(s).where(or(and(eq(s.aId, aId), eq(s.bId, bId)), and(eq(s.aId, bId), eq(s.bId, aId)))).get()
  if (!dup) c.insert('unions', { id: newId(), aId, bId, kind, startDate, endDate, place })
}

export const FIELD: Record<string, string> = {
  givenName: 'Имя', surname: 'Фамилия', maidenName: 'Девичья фамилия', patronymic: 'Отчество', otherNames: 'Другие имена', tags: 'Название группы', facts: 'Факты', sources: 'Источники', claims: 'Версии', sex: 'Пол', birthDate: 'Рождение', birthPlace: 'Место рождения',
  deathDate: 'Смерть', deathPlace: 'Место смерти', living: 'Жив', certainty: 'Уверенность',
}

export function updatePerson(actor: Actor, id: string, input: PersonInput, seen?: Record<string, unknown>) {
  requireRole(actor, 'editor')
  const p = getPersonRow(id)
  return mutate(actor, { summary: `${label(p)}: ${Object.keys(input).map((k) => say(FIELD[k] ?? k)).join(', ')}`, personIds: [id], key: `person:${id}` }, (c) => {
    // Read here, inside the write: nothing can slip in between the comparison and the change.
    const row = normalize(seen ? reconcile(getPersonRow(id), input as Record<string, unknown>, seen) as PersonInput : input)
    if (input.deathDate && input.living === undefined) row.living = false
    return c.update('persons', id, row)
  }) as Person
}

export function deletePerson(actor: Actor, id: string) {
  requireRole(actor, 'editor')
  const db = getDb()
  const p = getPersonRow(id)
  mutate(actor, { summary: `${say('Удалить человека')}: ${label(p)}`, personIds: [id] }, (c) => {
    for (const r of db.select().from(schema.parentChild).where(or(eq(schema.parentChild.parentId, id), eq(schema.parentChild.childId, id))).all()) c.remove('parentChild', r.id)
    for (const r of db.select().from(schema.unions).where(or(eq(schema.unions.aId, id), eq(schema.unions.bId, id))).all()) c.remove('unions', r.id)
    for (const r of db.select().from(schema.mediaTags).where(eq(schema.mediaTags.personId, id)).all()) c.remove('mediaTags', r.id)
    for (const r of db.select().from(schema.pages).where(eq(schema.pages.personId, id)).all()) c.remove('pages', r.id)
    for (const r of db.select().from(schema.storyPeople).where(eq(schema.storyPeople.personId, id)).all()) c.remove('storyPeople', r.id)
    dropStoriesAboutNobody(c)
    c.remove('persons', id)
  })
}

export function updateRelation(actor: Actor, type: 'parent' | 'union', id: string, patch: Record<string, string>) {
  requireRole(actor, 'editor')
  const table = type === 'parent' ? 'parentChild' : 'unions'
  const db = getDb()
  const row = type === 'parent' ? db.select().from(schema.parentChild).where(eq(schema.parentChild.id, id)).get() : db.select().from(schema.unions).where(eq(schema.unions.id, id)).get()
  const ids = !row ? [] : 'parentId' in row ? [row.parentId, row.childId] : [row.aId, row.bId]
  mutate(actor, { summary: `${say('Связь')}: ${Object.values(patch).filter(Boolean).join(', ')}`, personIds: ids }, (c) => c.update(table, id, patch))
}

export function removeRelation(actor: Actor, type: 'parent' | 'union', id: string) {
  requireRole(actor, 'editor')
  const db = getDb()
  const row = type === 'parent'
    ? db.select().from(schema.parentChild).where(eq(schema.parentChild.id, id)).get()
    : db.select().from(schema.unions).where(eq(schema.unions.id, id)).get()
  if (!row) throw new OpError(404, 'not found')
  const ids = 'parentId' in row ? [row.parentId, row.childId] : [row.aId, row.bId]
  const names = ids.map((i) => label(db.select().from(schema.persons).where(eq(schema.persons.id, i)).get())).join(' — ')
  mutate(actor, { summary: `${say('Удалить связь')}: ${names}`, personIds: ids }, (c) => c.remove(type === 'parent' ? 'parentChild' : 'unions', id))
}

/** Takes a child off several parents as one change, so one undo brings it all back. */
export function removeParentLinks(actor: Actor, ids: string[]) {
  requireRole(actor, 'editor')
  const db = getDb()
  const rows = ids.map((id) => db.select().from(schema.parentChild).where(eq(schema.parentChild.id, id)).get())
  if (rows.some((r) => !r)) throw new OpError(404, 'not found')
  const people = [...new Set(rows.flatMap((r) => [r!.parentId, r!.childId]))]
  const names = [rows[0]!.childId, ...rows.map((r) => r!.parentId)].map((i) => label(db.select().from(schema.persons).where(eq(schema.persons.id, i)).get())).join(' — ')
  mutate(actor, { summary: `${say('Удалить связь')}: ${names}`, personIds: people }, (c) => ids.forEach((id) => c.remove('parentChild', id)))
}

export function setAvatar(actor: Actor, personId: string, mediaId: string | null, crop: unknown) {
  if (!can(actor, 'editor')) throw new OpError(403, 'forbidden')
  const p = getPersonRow(personId)
  mutate(actor, { summary: `${label(p)}: ${say('Сделать аватаркой')}`, personIds: [personId] }, (c) =>
    c.update('persons', personId, { avatarMediaId: mediaId, avatarCrop: crop ? JSON.stringify(crop) : null, updatedAt: Date.now() }),
  )
}
