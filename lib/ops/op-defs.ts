import { and, desc, eq, gt, like } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '../db'
import { markdownToBlocks } from '../markdown'
import { type PlannedOp } from '../textformat'
import * as claims from '../claims'
import { lifeYears, personName, yearOf, type ClaimField, type Person } from '../types'
import { Actor, newId, OpError } from './core'
import * as people from './people'
import { say } from './settings'

export const certainty = z.enum(['documented', 'family', 'assumed'])

export const personInput = z.object({
  givenName: z.string().max(120), surname: z.string().max(120), maidenName: z.string().max(120), patronymic: z.string().max(120), otherNames: z.string().max(300).describe('Nicknames and other spellings'), sex: z.enum(['M', 'F', 'U']),
  birthDate: z.string().max(120).describe('Free text: "1890", "~1876", "12.03.1890", "1883 or 1886"'), birthPlace: z.string().max(200),
  deathDate: z.string().max(120), deathPlace: z.string().max(200), living: z.boolean(), certainty,
  tags: z.array(z.string().min(1).max(40)).max(30).describe('Groups or labels, e.g. "The Walkers", "Front line"'),
  facts: z.array(z.object({
    kind: z.string().max(80).describe('What happened: "Occupation", "Move", "Service"'),
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

export const claimField = z.enum(['birthDate', 'birthPlace', 'deathDate', 'deathPlace', 'givenName', 'patronymic', 'surname', 'maidenName'])

export const sourceInput = z.object({
  title: z.string().min(1).max(200).describe('Archive, book or who told it'), ref: z.string().max(120).optional().describe('Fond, inventory, file'),
  page: z.string().max(40).optional(), url: z.string().max(500).optional(),
  reliability: z.enum(['original', 'copy', 'transcript', 'witness', 'hearsay', 'guess']).default('copy'),
})

export const relationType = z.enum(['father', 'mother', 'son', 'daughter', 'spouse'])

/** What an agent sends: versions and sources change through add_version, so a model cannot rewrite them whole. */
export const agentCreate = personInput.omit({ claims: true, sources: true })

export const agentPatch = personInput.omit({ claims: true, sources: true }).extend({ facts: personInput.shape.facts.describe('Replaces the whole list: include the facts to keep') })

export const relationInput = z.object({ type: relationType.describe('What the new person is to `to`'), to: z.string(), otherParentId: z.string().nullish() })

export const box = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0).max(1), h: z.number().min(0).max(1) })

export const blocks = z.array(z.record(z.string(), z.unknown()))

export const markdown = z.string().describe('Page text in Markdown. Mention a person as [@Name](person:ID), a photo as ![caption](/api/v1/media/ID/file?size=medium).')

type Table = 'persons' | 'pages' | 'media' | 'mediaTags' | 'history'

export interface Ctx { name: (id: unknown) => string }

export interface Def<S extends z.ZodType = z.ZodType> {
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
  /** Only for people's own suggestions: no model and no token is offered it. */
  internal?: boolean
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

export const def = <S extends z.ZodType>(d: Def<S>) => d as Def

export function personFor(actor: Actor, id: string) {
  const p = people.getGraph(actor).persons.find((x) => x.id === id)
  if (!p || p.hidden) throw new OpError(404, `person ${id} not found`)
  return p
}

export const isAgent = (a: Actor) => !!(a.assistant || a.tokenId)

export const same = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/ё/g, 'е')

export const isTemp = (id: unknown) => typeof id === 'string' && id.startsWith('tmp_')

function assertDates(birth?: string | null, death?: string | null) {
  const b = yearOf(birth ?? ''), d = yearOf(death ?? '')
  if (b && d && d < b) throw new OpError(400, `death year ${d} is before birth year ${b}`)
}

/** People or models would get a chart that lies; better a refusal the model can explain. */
export function assertLink(a: Actor, type: string, to: string, other: { id?: string; sex?: string; birthDate?: string; name: string }, kind = 'birth') {
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
export function assertPlanSound(a: Actor, ops: PlannedOp[]) {
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

export function assertSpouses(a: Actor, one: string, two: string) {
  const g = people.getGraph(a)
  const parentsOf = (id: string) => g.parentChild.filter((l) => l.childId === id).map((l) => l.parentId)
  const p1 = parentsOf(one), p2 = parentsOf(two)
  if (p1.includes(two) || p2.includes(one)) throw new OpError(400, 'a parent and their child cannot be spouses')
  if (p1.some((p) => p2.includes(p))) throw new OpError(400, 'siblings cannot be spouses')
}

export function checkNewPerson(a: Actor, x: { person: Record<string, any>; relation?: { type: string; to: string; otherParentId?: string | null }; notDuplicate?: boolean }) {
  if (!isAgent(a)) return x
  const p = x.person
  // Versions and removals refer to a source by id, so every source has one from the start.
  if (p.sources) p.sources = p.sources.map((s: { id?: string }) => ({ ...s, id: s.id ?? newId() }))
  if (!p.givenName?.trim() && !p.surname?.trim()) throw new OpError(400, 'a person needs a given name or a surname: {"person":{"givenName":"John","surname":"Walker","birthDate":"1900"},"relation":{"type":"father","to":"<id>"}}')
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

/** Someone edited this person after the assistant read them. It reads again, then decides; it never writes over that blind. */
export function assertUnchanged(a: Actor, id: string) {
  if (!a.since || isTemp(id)) return
  const h = schema.history
  const newer = getDb().select({ actorName: h.actorName, userId: h.userId }).from(h).where(and(gt(h.at, a.since), like(h.personIds, `%"${id}"%`))).orderBy(desc(h.at)).all()
    .find((e) => !(e.userId === a.userId && e.actorName.includes('→')))
  if (!newer) return
  a.since = Date.now()
  throw new OpError(409, `${newer.actorName} has just changed this person. Read them again, then decide whether your change still applies.`)
}

export function checkPatch(a: Actor, id: string, patch: Record<string, any>) {
  if (!isAgent(a) || isTemp(id)) return
  assertUnchanged(a, id)
  if (!Object.keys(patch).length) throw new OpError(400, 'nothing to change: the patch is empty')
  const cur = personFor(a, id)
  const given = patch.givenName ?? cur.givenName, surname = patch.surname ?? cur.surname
  if (!given?.trim() && !surname?.trim()) throw new OpError(400, 'a person needs a given name or a surname')
  assertDates(patch.birthDate ?? cur.birthDate, patch.deathDate ?? cur.deathDate)
  if (patch.living === true && (patch.deathDate ?? cur.deathDate)) throw new OpError(400, 'someone with a death date cannot be marked living')
}

/** A value with versions changes through them, so the card and its versions never disagree. */
export function withVersions(p: Person, patch: Record<string, any>) {
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

export function assertVersion(p: Person, field: ClaimField, id: string) {
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

export function pageContent(actor: Actor, args: { markdown?: string; content?: unknown[] }) {
  const { markdown: md, ...rest } = args
  const content = md !== undefined ? markdownToBlocks(md) : args.content
  if (content !== undefined) assertSafeBlocks(actor, content)
  return { ...rest, ...(content !== undefined ? { content } : {}) }
}

export const FIELD: Record<string, string> = {
  givenName: 'Имя', surname: 'Фамилия', maidenName: 'Девичья фамилия', sex: 'Пол', birthDate: 'Рождение', birthPlace: 'Место рождения',
  deathDate: 'Смерть', deathPlace: 'Место смерти', living: 'Жив', certainty: 'Уверенность',
}

export const REL: Record<string, string> = { father: 'отец', mother: 'мать', son: 'сын', daughter: 'дочь', spouse: 'супруг' }

const personFull = (p: { givenName: string; patronymic: string; surname: string; birthDate: string; deathDate: string }) => {
  const name = [p.givenName, p.patronymic, p.surname].filter(Boolean).join(' ')
  const years = lifeYears(p as Person)
  return years ? `${name} (${years})` : name
}

/** With patronymic and years: on a confirmation card two namesakes must look different. */
export function nameOfReal(id: string) {
  const p = getDb().select().from(schema.persons).where(eq(schema.persons.id, id)).get()
  return p ? personFull(p) || say('Без названия') : id
}

export function pageName(id: string, c: Ctx) {
  if (id.startsWith('tmp_')) return c.name(id)
  return getDb().select({ title: schema.pages.title }).from(schema.pages).where(eq(schema.pages.id, id)).get()?.title || say('Без названия')
}
