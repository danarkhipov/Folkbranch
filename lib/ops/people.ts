import { and, eq, isNull, ne, or } from 'drizzle-orm'
import { dataStamp, getDb, schema } from '../db'
import type { Certainty, Claim, Fact, Graph, ParentKind, Person, Sex, Source, UnionEnd, UnionKind } from '../types'
import { personName, yearOf, type Place } from '../types'
import { placeLink } from '../places'
import { Actor, Changes, can, mutate, newId, OpError, requireRole, seesOnlyPublic, dropStoriesAboutNobody } from './core'
import { say } from './app-config'
import { reconcile } from './merge'
import { subgraph } from '../graph/select'
import { hiddenFor, hiddenIn, isPrivate, maskPerson } from './privacy'

export { hiddenFor }

const label = (p: { givenName: string; surname: string } | undefined) => (p && personName(p)) || say('Untitled')

/** Month names by their first letters, in the archive's languages: a written month is told from its stem, in any case. */
const MONTHS: [RegExp, number][] = [
  [/^(jan|янв|gen|ene|jän)/i, 1], [/^(feb|фев|fév|fev)/i, 2], [/^(mar|мар|mär)/i, 3], [/^(apr|апр|abr|avr)/i, 4], [/^(may|мая|май|mai|mag|maj|maig)/i, 5], [/^(jun|июн|giu|juin|juni)/i, 6],
  [/^(jul|июл|lug|juil|juli)/i, 7], [/^(aug|авг|ago|août|aout)/i, 8], [/^(sep|сен|set)/i, 9], [/^(oct|окт|ott|okt)/i, 10], [/^(nov|ноя)/i, 11], [/^(dec|дек|dic|déc|dez|des)/i, 12],
]
const monthOf = (w: string) => MONTHS.find(([re]) => re.test(w))?.[1] ?? 0

/** A day that is not on the calendar: 31 February, month 13. Written as 1900-02-31, 31.02.1900, 31 February 1900 or February 31, 1900; other forms are left alone. */
export function impossibleDate(date?: string | null): string | null {
  const s = (date ?? '').trim()
  let year = 0, month = 0, day = 0
  const num = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s) ?? /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s)
  if (num) [year, month, day] = s.includes('-') ? [+num[1], +num[2], +num[3]] : [+num[3], +num[2], +num[1]]
  else {
    const dm = /^(\d{1,2})\s+(?:de\s+|d')?(\p{L}+)\.?,?\s+(?:de\s+)?(\d{4})$/u.exec(s), md = /^(\p{L}+)\.?\s+(\d{1,2}),?\s+(\d{4})$/u.exec(s)
    if (dm && monthOf(dm[2])) [year, month, day] = [+dm[3], monthOf(dm[2]), +dm[1]]
    else if (md && monthOf(md[1])) [year, month, day] = [+md[3], monthOf(md[1]), +md[2]]
    else return null
  }
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] ? null : `${s} is not a day on the calendar`
}

/** A chart that shows a death before a birth lies, whichever way the card was saved. */
export function assertDates(birth?: string | null, death?: string | null) {
  for (const d of [birth, death]) { const bad = impossibleDate(d); if (bad) throw new OpError(400, bad) }
  const b = yearOf(birth ?? ''), d = yearOf(death ?? '')
  if (b && d && d < b) throw new OpError(400, `death year ${d} is before birth year ${b}`)
}

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
const maskedOf = (entry: GraphEntry) => (entry.hidden ??= new Map(entry.graph.persons.filter(isPrivate).map((p) => [p.id, maskPerson(p)])))

function maskedGraph(actor: Actor): Graph {
  const entry = wholeGraph()
  const { graph } = entry
  if (!seesOnlyPublic(actor)) return graph
  const hidden = maskedOf(entry)
  const unseen = new Set(graph.persons.filter((p) => hiddenFor(actor, p)).map((p) => p.id))
  // Someone hidden may be named at another person's event, as a godparent or a witness: there they lose their name too.
  const scrub = (p: Person): Person => (p.facts.some((f) => f.people?.some((x) => x.personId && unseen.has(x.personId)))
    ? { ...p, facts: p.facts.map((f) => (f.people ? { ...f, people: f.people.map((x) => (x.personId && unseen.has(x.personId) ? { ...x, personId: null, name: '' } : x)) } : f)) }
    : p)
  // A marriage says when and where the hidden person was: it stays as a line on the chart, without the dates or place.
  const unions = graph.unions.map((u) => (unseen.has(u.aId) || unseen.has(u.bId) ? { ...u, startDate: '', endDate: '', endKind: '' as const, place: '', placeId: null } : u))
  return { ...graph, unions, persons: graph.persons.map((p) => (unseen.has(p.id) ? hidden.get(p.id) ?? maskPerson(p) : scrub(p))) }
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
  birthPlaceId?: string | null
  deathPlaceId?: string | null
  living?: boolean
  keepPrivate?: boolean
  noChildren?: boolean
  neverMarried?: boolean
  certainty?: Certainty
  tags?: string[]
  facts?: Fact[]
  sources?: Source[]
  claims?: Claim[]
}

export function normalize(input: PersonInput) {
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

/**
 * Each place written on a card keeps beside it the record it means: the one that answers to the text, or the one the
 * person picked among several of one name. A link that no longer fits the text is dropped, so a corrected place is
 * never held to the old village. Only what this write touches is looked at; the text itself is never changed.
 */
export function linkPlaces(input: PersonInput, before?: Person): PersonInput {
  const touches = ['birthPlace', 'birthPlaceId', 'deathPlace', 'deathPlaceId', 'facts'].some((k) => k in input)
  if (!touches) return input
  const all = allPlaces()
  const out = { ...input }
  for (const f of ['birth', 'death'] as const) {
    const text = `${f}Place` as const, link = `${f}PlaceId` as const
    if (!(text in input) && !(link in input)) continue
    out[link] = placeLink(input[text] ?? before?.[text] ?? '', all, link in input ? input[link] : before?.[link])
  }
  if (input.facts) {
    const was = new Map((before?.facts ?? []).filter((f) => f.id).map((f) => [f.id, f.placeId]))
    out.facts = input.facts.map((f) => {
      const placeId = placeLink(f.place ?? '', all, f.placeId !== undefined ? f.placeId : f.id ? was.get(f.id) : null)
      const { placeId: _, ...rest } = f
      return placeId ? { ...rest, placeId } : rest
    })
  }
  return out
}

/** The Places list, as the links are checked against it. */
export const allPlaces = (): Place[] => getDb().select().from(schema.places).all().map((r) => ({ ...r, otherNames: JSON.parse(r.otherNames ?? '[]') }))

export type QuickRelation = 'father' | 'mother' | 'son' | 'daughter' | 'spouse'

export function insertPerson(c: Changes, input: PersonInput) {
  const id = newId()
  const row = normalize(linkPlaces(input))
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
  relation?: { type: QuickRelation; to: string; otherParentId?: string | null } & LinkOptions,
) {
  requireRole(actor, 'editor')
  const name = [input.givenName, input.surname].filter(Boolean).join(' ')
  const personIds = relation ? [relation.to] : []
  if (relation) {
    // The other end must exist, or the chart and the kinship walk carry a link to nobody.
    if (!relation.to.startsWith('tmp_')) getPersonRow(relation.to)
    if (relation.otherParentId && !relation.otherParentId.startsWith('tmp_')) getPersonRow(relation.otherParentId)
  }
  return mutate(actor, { summary: `${say('Add')}: ${name}`, personIds }, (c) => {
    const sex: Sex | undefined = relation?.type === 'father' || relation?.type === 'son' ? 'M' : relation?.type === 'mother' || relation?.type === 'daughter' ? 'F' : undefined
    const id = insertPerson(c, { ...input, sex: input.sex ?? sex })
    // A reader's history leaves out entries naming nobody, so the new person must be named here.
    personIds.push(id)
    if (relation) link(c, relation.type, relation.to, id, relation.otherParentId, { kind: relation.kind, certainty: relation.certainty, unionKind: relation.unionKind, startDate: relation.startDate, endDate: relation.endDate, endKind: relation.endKind })
    return getPersonRow(id)
  })
}

/** Attaches two existing people; `other` takes the role named by `type` relative to `to`. */
export interface LinkOptions { kind?: ParentKind; certainty?: Certainty; unionKind?: UnionKind; startDate?: string; endDate?: string; endKind?: UnionEnd }

export function linkPeople(actor: Actor, type: QuickRelation, to: string, other: string, otherParentId?: string | null, opts: LinkOptions = {}) {
  requireRole(actor, 'editor')
  const a = getPersonRow(to), b = getPersonRow(other)
  mutate(actor, { summary: `${label(a)} — ${label(b)}`, personIds: [to, other] }, (c) => link(c, type, to, other, otherParentId, opts))
}

function link(c: Changes, type: QuickRelation, to: string, other: string, otherParentId?: string | null, opts: LinkOptions = {}) {
  if (to === other) throw new OpError(400, 'same person')
  if (type === 'spouse') {
    // The dates of a union are checked as the dates of a person are: a day that is not on the calendar is refused.
    for (const d of [opts.startDate, opts.endDate]) { const bad = impossibleDate(d); if (bad) throw new OpError(400, bad) }
    return addUnion(c, to, other, opts.unionKind, opts.startDate, opts.endDate, '', undefined, opts.endKind)
  }
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

/** A marriage never joins siblings, or a parent and their child: the chart would draw a couple dot between them. */
function unionBlocked(aId: string, bId: string) {
  const db = getDb()
  const parentsOf = (id: string) => db.select({ p: schema.parentChild.parentId }).from(schema.parentChild).where(eq(schema.parentChild.childId, id)).all().map((r) => r.p)
  const pa = parentsOf(aId), pb = parentsOf(bId)
  return pa.some((p) => pb.includes(p)) || pa.includes(bId) || pb.includes(aId)
}

export function addUnion(c: Changes, aId: string, bId: string, kind: UnionKind = 'marriage', startDate = '', endDate = '', place = '', certainty?: Certainty, endKind: UnionEnd = '') {
  // One person is never a couple with themself, whatever the file says.
  if (aId === bId) return
  const db = getDb()
  const s = schema.unions
  if (unionBlocked(aId, bId)) return
  const dup = db.select().from(s).where(or(and(eq(s.aId, aId), eq(s.bId, bId)), and(eq(s.aId, bId), eq(s.bId, aId)))).get()
  if (!dup) c.insert('unions', { id: newId(), aId, bId, kind, startDate, endDate, ...(endKind ? { endKind } : {}), place, placeId: place ? placeLink(place, allPlaces()) : null, ...(certainty ? { certainty } : {}) })
}

export const FIELD: Record<string, string> = {
  givenName: 'Given name', surname: 'Surname', maidenName: 'Maiden name', patronymic: 'Patronymic', otherNames: 'Other names', tags: 'Group or label', facts: 'Facts', sources: 'Sources_plural', claims: 'Versions', sex: 'Sex', birthDate: 'Birth', birthPlace: 'Birthplace',
  deathDate: 'Death', deathPlace: 'Place of death', living: 'Living_male', keepPrivate: 'Hidden from readers', noChildren: 'Had no children', neverMarried: 'Never married', certainty: 'Certainty',
}

export function updatePerson(actor: Actor, id: string, input: PersonInput, seen?: Record<string, unknown>) {
  requireRole(actor, 'editor')
  const p = getPersonRow(id)
  return mutate(actor, { summary: `${label(p)}: ${Object.keys(input).map((k) => say(FIELD[k] ?? k)).join(', ')}`, personIds: [id], key: `person:${id}` }, (c) => {
    // Read here, inside the write: nothing can slip in between the comparison and the change.
    const row = normalize(linkPlaces(seen ? reconcile(getPersonRow(id), input as Record<string, unknown>, seen) as PersonInput : input, PERSON_JSON(getPersonRow(id)) as Person))
    // Only an edit of a date is checked: a card saved wrong by an older version can still have its other fields fixed.
    if ('birthDate' in row || 'deathDate' in row) assertDates((row.birthDate ?? p.birthDate) as string, (row.deathDate ?? p.deathDate) as string)
    if (input.deathDate && input.living === undefined) row.living = false
    return c.update('persons', id, row)
  }) as Person
}

export function deletePerson(actor: Actor, id: string) {
  requireRole(actor, 'editor')
  const db = getDb()
  const p = getPersonRow(id)
  mutate(actor, { summary: `${say('Delete person')}: ${label(p)}`, personIds: [id] }, (c) => {
    for (const r of db.select().from(schema.parentChild).where(or(eq(schema.parentChild.parentId, id), eq(schema.parentChild.childId, id))).all()) c.remove('parentChild', r.id)
    for (const r of db.select().from(schema.unions).where(or(eq(schema.unions.aId, id), eq(schema.unions.bId, id))).all()) c.remove('unions', r.id)
    for (const r of db.select().from(schema.mediaTags).where(eq(schema.mediaTags.personId, id)).all()) c.remove('mediaTags', r.id)
    for (const r of db.select().from(schema.pages).where(eq(schema.pages.personId, id)).all()) {
      // A page of another person nested below goes to the top level, rather than pointing at a page that is gone.
      for (const ch of db.select().from(schema.pages).where(eq(schema.pages.parentPageId, r.id)).all())
        if (ch.personId !== id) c.update('pages', ch.id, { parentPageId: null })
      c.remove('pages', r.id)
    }
    for (const r of db.select().from(schema.storyPeople).where(eq(schema.storyPeople.personId, id)).all()) c.remove('storyPeople', r.id)
    for (const r of db.select().from(schema.contacts).where(eq(schema.contacts.personId, id)).all()) c.remove('contacts', r.id)
    dropStoriesAboutNobody(c)
    c.remove('persons', id)
  })
  // As a merge and a replacing import do: accounts and invitations let go of the card, and a link asking for
  // a story about this person is closed, so nothing points at a card that is gone. An undo brings the card back,
  // and the owner links the account again.
  db.update(schema.user).set({ personId: null }).where(eq(schema.user.personId, id)).run()
  db.update(schema.invites).set({ personId: null }).where(eq(schema.invites.personId, id)).run()
  db.update(schema.storyRequests).set({ revokedAt: Date.now() }).where(and(eq(schema.storyRequests.personId, id), isNull(schema.storyRequests.revokedAt))).run()
}

export function updateRelation(actor: Actor, type: 'parent' | 'union', id: string, patch: Record<string, string | null | undefined>) {
  requireRole(actor, 'editor')
  const table = type === 'parent' ? 'parentChild' : 'unions'
  const db = getDb()
  const row = type === 'parent' ? db.select().from(schema.parentChild).where(eq(schema.parentChild.id, id)).get() : db.select().from(schema.unions).where(eq(schema.unions.id, id)).get()
  const ids = !row ? [] : 'parentId' in row ? [row.parentId, row.childId] : [row.aId, row.bId]
  // A marriage's place keeps its link as a card's places do: the record the text means, or the one picked.
  const linked: Record<string, unknown> = { ...patch }
  if (type === 'union' && row && ('place' in patch || 'placeId' in patch)) {
    const u = row as typeof schema.unions.$inferSelect
    linked.placeId = placeLink(patch.place ?? u.place, allPlaces(), 'placeId' in patch ? patch.placeId : u.placeId)
  }
  mutate(actor, { summary: `${say('Link_relation')}: ${Object.values(patch).filter(Boolean).join(', ')}`, personIds: ids }, (c) => c.update(table, id, linked))
}

/**
 * Moves one end of a link to another person, as one change: `end` is parent or child of a parent link, or a or b of a union.
 * `also` names more links of the same kind that move with it (the links of one child to both parents). The checks are
 * those of adding the same link new, so nothing can be made that drawing it could not.
 */
export function moveRelation(actor: Actor, type: 'parent' | 'union', id: string, end: 'parent' | 'child' | 'a' | 'b', to: string, also: string[] = []) {
  requireRole(actor, 'editor')
  const db = getDb()
  getPersonRow(to)
  const moves = [id, ...also].map((linkId) => {
    const row = type === 'parent' ? db.select().from(schema.parentChild).where(eq(schema.parentChild.id, linkId)).get() : db.select().from(schema.unions).where(eq(schema.unions.id, linkId)).get()
    if (!row) throw new OpError(404, 'not found')
    const ends: Record<string, string> = 'parentId' in row ? { parent: row.parentId, child: row.childId } : { a: row.aId, b: row.bId }
    if (!(end in ends)) throw new OpError(400, `${end} is not an end of a ${type} link`)
    const was = ends[end]
    if (was === to) throw new OpError(400, 'the link already ends there')
    let patch: Record<string, string>
    if ('parentId' in row) {
      const parentId = end === 'parent' ? to : row.parentId, childId = end === 'child' ? to : row.childId
      if (parentId === childId) throw new OpError(400, 'same person')
      if (db.select().from(schema.parentChild).where(and(eq(schema.parentChild.parentId, parentId), eq(schema.parentChild.childId, childId))).get()) throw new OpError(400, 'they are already linked')
      // The link itself is leaving, so the check must not count it.
      const up = db.$client.prepare(`
        with recursive up(id) as (select ? union select p.parent_id from parent_child p join up on p.child_id = up.id where p.id != ?)
        select 1 from up where id = ? limit 1`).get(parentId, linkId, childId)
      if (up) throw new OpError(400, 'a person cannot be their own ancestor')
      patch = { parentId, childId }
    } else {
      const aId = end === 'a' ? to : row.aId, bId = end === 'b' ? to : row.bId
      if (aId === bId) throw new OpError(400, 'same person')
      if (unionBlocked(aId, bId)) throw new OpError(400, 'a union cannot join siblings, or a parent and their child')
      if (db.select().from(schema.unions).where(and(ne(schema.unions.id, linkId), or(and(eq(schema.unions.aId, aId), eq(schema.unions.bId, bId)), and(eq(schema.unions.aId, bId), eq(schema.unions.bId, aId))))).get()) throw new OpError(400, 'they are already a couple')
      patch = { aId, bId }
    }
    return { linkId, patch, was, people: Object.values(ends).concat(Object.values(patch)) }
  })
  const names = [moves[0].was, to].map((i) => label(getPersonRow(i))).join(' → ')
  mutate(actor, { summary: `${say('Link_relation')}: ${names}`, personIds: [...new Set(moves.flatMap((m) => m.people))] }, (c) => {
    for (const m of moves) c.update(type === 'parent' ? 'parentChild' : 'unions', m.linkId, m.patch)
  })
}

/**
 * Makes `parentIds` (one or two people) the parents of a child, as one change: the missing links are added and any other
 * parent link is removed, whatever its kind. A link that stays keeps its kind, so an adopted or step parent is not turned
 * into a birth parent by being kept. Unions are not touched.
 */
export function setParents(actor: Actor, childId: string, parentIds: string[]) {
  requireRole(actor, 'editor')
  const db = getDb()
  const child = getPersonRow(childId)
  const wanted = [...new Set(parentIds)]
  if (wanted.length < 1 || wanted.length > 2) throw new OpError(400, 'a child has one or two parents')
  if (wanted.includes(childId)) throw new OpError(400, 'same person')
  const parents = wanted.map((id) => getPersonRow(id))
  const have = db.select().from(schema.parentChild).where(eq(schema.parentChild.childId, childId)).all()
  const drop = have.filter((l) => !wanted.includes(l.parentId))
  const add = wanted.filter((id) => !have.some((l) => l.parentId === id))
  if (!drop.length && !add.length) throw new OpError(400, 'nothing to change')
  for (const id of add) {
    const up = db.$client.prepare(`
      with recursive up(id) as (select ? union select p.parent_id from parent_child p join up on p.child_id = up.id)
      select 1 from up where id = ? limit 1`).get(id, childId)
    if (up) throw new OpError(400, 'a person cannot be their own ancestor')
  }
  const names = parents.map(label).join(wanted.length === 2 ? ' + ' : '')
  mutate(actor, { summary: `${say('Link_relation')}: ${label(child)} ← ${names}`, personIds: [childId, ...wanted, ...drop.map((l) => l.parentId)] }, (c) => {
    for (const l of drop) c.remove('parentChild', l.id)
    for (const id of add) c.insert('parentChild', { id: newId(), parentId: id, childId, kind: 'birth', certainty: 'family' })
  })
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
  mutate(actor, { summary: `${say('Remove relation')}: ${names}`, personIds: ids }, (c) => c.remove(type === 'parent' ? 'parentChild' : 'unions', id))
}

/** Takes a child off several parents as one change, so one undo brings it all back. */
export function removeParentLinks(actor: Actor, ids: string[]) {
  requireRole(actor, 'editor')
  const db = getDb()
  const rows = ids.map((id) => db.select().from(schema.parentChild).where(eq(schema.parentChild.id, id)).get())
  if (rows.some((r) => !r)) throw new OpError(404, 'not found')
  const people = [...new Set(rows.flatMap((r) => [r!.parentId, r!.childId]))]
  const names = [rows[0]!.childId, ...rows.map((r) => r!.parentId)].map((i) => label(db.select().from(schema.persons).where(eq(schema.persons.id, i)).get())).join(' — ')
  mutate(actor, { summary: `${say('Remove relation')}: ${names}`, personIds: people }, (c) => ids.forEach((id) => c.remove('parentChild', id)))
}

export function setAvatar(actor: Actor, personId: string, mediaId: string | null, crop: unknown) {
  if (!can(actor, 'editor')) throw new OpError(403, 'forbidden')
  const p = getPersonRow(personId)
  mutate(actor, { summary: `${label(p)}: ${say('Set as avatar')}`, personIds: [personId] }, (c) =>
    c.update('persons', personId, { avatarMediaId: mediaId, avatarCrop: crop ? JSON.stringify(crop) : null, updatedAt: Date.now() }),
  )
}
