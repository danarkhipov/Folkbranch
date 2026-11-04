import { and, eq, or } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { Certainty, Fact, Graph, ParentKind, Person, Sex, UnionKind } from '../types'
import { personName, yearOf } from '../types'
import { translate } from '../i18n'
import { Actor, Changes, can, mutate, newId, OpError, requireRole } from './core'
import { getSetting } from './settings'

const say = (key: string) => translate(getSetting('language') === 'en' ? 'en' : 'ru', key)
const label = (p: { givenName: string; surname: string } | undefined) => (p && personName(p)) || say('Без названия')

function isLikelyLiving(birthYear: number | null, deathDate: string, deathYear: number | null) {
  if (deathDate || deathYear) return false
  return !(birthYear && birthYear < new Date().getFullYear() - 110)
}

export function hiddenFor(actor: Actor, p: { id: string; living: boolean }) {
  return actor.role === 'reader' && p.living && p.id !== actor.personId
}

export function getGraph(actor: Actor): Graph {
  const db = getDb()
  const rows = db.select().from(schema.persons).all() as unknown as (Omit<Person, 'tags' | 'facts'> & { tags: string; facts: string })[]
  return {
    persons: rows.map((r) => {
      const p = { ...r, tags: JSON.parse(r.tags ?? '[]') as string[], facts: JSON.parse(r.facts ?? '[]') as Fact[] }
      return hiddenFor(actor, p)
        ? { ...p, givenName: '', surname: '', maidenName: '', patronymic: '', otherNames: '', birthDate: '', birthYear: null, birthPlace: '', deathDate: '', deathPlace: '', sex: 'U' as Sex, avatarMediaId: null, avatarCrop: null, tags: [], facts: [], hidden: true }
        : p
    }),
    parentChild: db.select().from(schema.parentChild).all() as Graph['parentChild'],
    unions: db.select().from(schema.unions).all() as Graph['unions'],
  }
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
}

function normalize(input: PersonInput) {
  const { tags, facts, ...rest } = input
  const row: Record<string, unknown> = { ...rest, updatedAt: Date.now() }
  if (tags !== undefined) row.tags = JSON.stringify(tags)
  if (facts !== undefined) row.facts = JSON.stringify(facts)
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
  return mutate(actor, { summary: `${say('Добавить')}: ${name}`, personIds: relation ? [relation.to] : [] }, (c) => {
    const sex: Sex | undefined = relation?.type === 'father' || relation?.type === 'son' ? 'M' : relation?.type === 'mother' || relation?.type === 'daughter' ? 'F' : undefined
    const id = insertPerson(c, { ...input, sex: input.sex ?? sex })
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
  const db = getDb()
  const seen = new Set<string>()
  const stack = [of]
  while (stack.length) {
    const cur = stack.pop()!
    if (cur === candidate) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    db.select().from(schema.parentChild).where(eq(schema.parentChild.childId, cur)).all().forEach((r) => stack.push(r.parentId))
  }
  return false
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

const FIELD: Record<string, string> = {
  givenName: 'Имя', surname: 'Фамилия', maidenName: 'Девичья фамилия', patronymic: 'Отчество', otherNames: 'Другие имена', tags: 'Группа или метка', facts: 'Факты', sex: 'Пол', birthDate: 'Рождение', birthPlace: 'Место рождения',
  deathDate: 'Смерть', deathPlace: 'Место смерти', living: 'Жив', certainty: 'Уверенность',
}

export function updatePerson(actor: Actor, id: string, input: PersonInput) {
  requireRole(actor, 'editor')
  const p = getPersonRow(id)
  return mutate(actor, { summary: `${label(p)}: ${Object.keys(input).map((k) => say(FIELD[k] ?? k)).join(', ')}`, personIds: [id], key: `person:${id}` }, (c) => {
    const row = normalize(input)
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
    c.remove('persons', id)
  })
}

export function updateRelation(actor: Actor, type: 'parent' | 'union', id: string, patch: Record<string, string>) {
  requireRole(actor, 'editor')
  const table = type === 'parent' ? 'parentChild' : 'unions'
  mutate(actor, { summary: `${say('Связь')}: ${Object.values(patch).filter(Boolean).join(', ')}` }, (c) => c.update(table, id, patch))
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
