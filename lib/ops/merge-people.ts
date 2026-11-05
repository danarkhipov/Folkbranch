// Two cards that turn out to be one person. Everything either card held survives on the one that stays: a value
// that lost becomes a version, nothing is thrown away, and one undo brings both cards back as they were.
import { eq, or } from 'drizzle-orm'
import { z } from 'zod'
import { mergeClaims } from '../claims'
import { getDb, schema } from '../db'
import { personName, yearOf, type Claim, type ClaimField, type Fact, type Source } from '../types'
import { Actor, Changes, mutate, mutateGroup, newId, OpError, requireRole } from './core'
import { getPersonRow } from './people'
import { getSetting, say, setSetting } from './settings'

export const MERGE_FIELDS = ['givenName', 'patronymic', 'surname', 'maidenName', 'birthDate', 'birthPlace', 'deathDate', 'deathPlace', 'sex', 'otherNames'] as const
export type MergeField = (typeof MERGE_FIELDS)[number]
const VERSIONED: ClaimField[] = ['givenName', 'patronymic', 'surname', 'maidenName', 'birthDate', 'birthPlace', 'deathDate', 'deathPlace']
const NOT_SAME = 'notDuplicates'
const MAX_CANDIDATES = 100

type Row = typeof schema.persons.$inferSelect
const list = <T>(s: string | null) => JSON.parse(s ?? '[]') as T[]
const blank = (f: MergeField, v: unknown) => !v || (f === 'sex' && v === 'U')

/** Who is above and below someone, as if the two cards were already one. */
function relatives(keepId: string, dropId: string) {
  const db = getDb()
  const one = (id: string) => (id === dropId ? keepId : id)
  const up = new Map<string, string[]>(), down = new Map<string, string[]>()
  for (const l of db.select().from(schema.parentChild).all()) {
    const parent = one(l.parentId), child = one(l.childId)
    up.set(child, [...(up.get(child) ?? []), parent])
    down.set(parent, [...(down.get(parent) ?? []), child])
  }
  const walk = (next: Map<string, string[]>) => {
    const seen = new Set<string>()
    const stack = [...(next.get(keepId) ?? [])]
    while (stack.length) {
      const id = stack.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      stack.push(...(next.get(id) ?? []))
    }
    return seen
  }
  return { above: walk(up), below: walk(down) }
}

/** Why these two cannot be one person, in words, or null when they can. */
function whyNot(keepId: string, dropId: string) {
  if (keepId === dropId) return say('Это одна и та же карточка')
  const { above, below } = relatives(keepId, dropId)
  if (above.has(keepId) || below.has(keepId)) return say('Один из них предок другого: человек стал бы своим собственным предком')
  if ([...above].some((id) => below.has(id))) return say('Человек оказался бы и предком, и потомком одного родственника')
  const u = schema.unions
  const unions = getDb().select().from(u).where(or(eq(u.aId, keepId), eq(u.bId, keepId), eq(u.aId, dropId), eq(u.bId, dropId))).all()
  const partners = unions.map((x) => ({ a: x.aId === dropId ? keepId : x.aId, b: x.bId === dropId ? keepId : x.bId }))
  if (partners.some((p) => p.a === p.b)) return say('Они указаны супругами: человек не может быть женат на себе')
  const spouses = partners.map((p) => (p.a === keepId ? p.b : p.a))
  if (spouses.some((id) => above.has(id) || below.has(id))) return say('Супругом человека оказался бы его предок или потомок')
  return null
}

function counts(id: string) {
  const db = getDb()
  const pc = schema.parentChild, u = schema.unions
  return {
    parents: db.select({ id: pc.id }).from(pc).where(eq(pc.childId, id)).all().length,
    children: db.select({ id: pc.id }).from(pc).where(eq(pc.parentId, id)).all().length,
    unions: db.select({ id: u.id }).from(u).where(or(eq(u.aId, id), eq(u.bId, id))).all().length,
    pages: db.select({ id: schema.pages.id }).from(schema.pages).where(eq(schema.pages.personId, id)).all().length,
    photos: db.select({ id: schema.mediaTags.id }).from(schema.mediaTags).where(eq(schema.mediaTags.personId, id)).all().length,
    stories: db.select({ id: schema.storyPeople.id }).from(schema.storyPeople).where(eq(schema.storyPeople.personId, id)).all().length,
  }
}

const birthParents = (id: string) => getDb().select().from(schema.parentChild).where(eq(schema.parentChild.childId, id)).all().filter((l) => l.kind === 'birth').map((l) => l.parentId)

/** What the merge would do, for a person to read before saying yes. */
export function previewMerge(actor: Actor, keepId: string, dropId: string) {
  requireRole(actor, 'editor')
  const keep = getPersonRow(keepId), drop = getPersonRow(dropId)
  const warnings: string[] = []
  const parents = new Set([...birthParents(keepId), ...birthParents(dropId)])
  if (parents.size > 2) warnings.push(say('У человека станет больше двух родных родителей. Проверьте их после объединения.'))
  if (keep.sex !== drop.sex && !blank('sex', keep.sex) && !blank('sex', drop.sex)) warnings.push(say('На карточках разный пол'))
  const a = keep.birthYear, b = drop.birthYear
  if (a && b && Math.abs(a - b) > 10) warnings.push(`${say('Годы рождения расходятся на')} ${Math.abs(a - b)}`)
  const accounts = getDb().select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.personId, dropId)).all()
  if (accounts.length) warnings.push(say('К убираемой карточке привязан аккаунт: он перейдёт на оставшуюся'))
  return {
    blocked: whyNot(keepId, dropId),
    warnings,
    fields: MERGE_FIELDS.map((field) => ({ field, keep: String(keep[field] ?? ''), drop: String(drop[field] ?? '') })),
    keep: { id: keepId, name: personName(keep as never), updatedAt: keep.updatedAt, ...counts(keepId) },
    drop: { id: dropId, name: personName(drop as never), updatedAt: drop.updatedAt, ...counts(dropId) },
  }
}

const input = z.object({
  keepId: z.string().max(40),
  dropId: z.string().max(40),
  choose: z.partialRecord(z.enum(MERGE_FIELDS), z.enum(['keep', 'drop'])).default({}),
  seen: z.object({ keep: z.number(), drop: z.number() }),
})

const sameFact = (f: Fact) => JSON.stringify([f.kind, f.date, f.place, f.note, f.source ?? ''])
const sameSource = (s: Source) => s.id ?? JSON.stringify([s.title, s.ref, s.page, s.url])
const unite = <T>(a: T[], b: T[], key: (x: T) => string) => { const seen = new Set(a.map(key)); return [...a, ...b.filter((x) => !seen.has(key(x)))] }

/** A mention in a text names the person by id, wherever it sits in the document. */
const renamed = (content: string, dropId: string, keepId: string) => (content.includes(dropId) ? content.split(`"personId":"${dropId}"`).join(`"personId":"${keepId}"`) : content)

function movePeopleLinks(c: Changes, keepId: string, dropId: string) {
  const db = getDb()
  const pc = schema.parentChild
  for (const [col, other] of [['parentId', 'childId'], ['childId', 'parentId']] as const) {
    const mine = new Set(db.select().from(pc).where(eq(pc[col], keepId)).all().map((l) => l[other]))
    for (const l of db.select().from(pc).where(eq(pc[col], dropId)).all()) {
      if (mine.has(l[other])) c.remove('parentChild', l.id)
      else c.update('parentChild', l.id, { [col]: keepId })
    }
  }
  const u = schema.unions
  const pair = (x: { aId: string; bId: string }) => (x.aId === keepId ? x.bId : x.aId)
  const mine = new Map(db.select().from(u).where(or(eq(u.aId, keepId), eq(u.bId, keepId))).all().map((x) => [pair(x), x]))
  for (const x of db.select().from(u).where(or(eq(u.aId, dropId), eq(u.bId, dropId))).all()) {
    const partner = x.aId === dropId ? x.bId : x.aId
    const twin = mine.get(partner)
    if (!twin) {
      c.update('unions', x.id, x.aId === dropId ? { aId: keepId } : { bId: keepId })
      continue
    }
    // The same marriage twice becomes one, and what only the second one knew stays.
    const fill: Record<string, string> = {}
    for (const k of ['startDate', 'endDate', 'place'] as const) if (!twin[k] && x[k]) fill[k] = x[k]
    c.remove('unions', x.id)
    if (Object.keys(fill).length) c.update('unions', twin.id, fill)
  }
}

function moveContent(c: Changes, keepId: string, dropId: string) {
  const db = getDb()
  for (const p of db.select({ id: schema.pages.id }).from(schema.pages).where(eq(schema.pages.personId, dropId)).all()) c.update('pages', p.id, { personId: keepId })
  for (const p of db.select({ id: schema.pages.id, content: schema.pages.content }).from(schema.pages).all()) {
    const next = renamed(p.content, dropId, keepId)
    if (next !== p.content) c.update('pages', p.id, { content: next })
  }
  const t = schema.mediaTags
  const onPhoto = new Map(db.select().from(t).where(eq(t.personId, keepId)).all().map((x) => [x.mediaId, x]))
  for (const x of db.select().from(t).where(eq(t.personId, dropId)).all()) {
    const twin = onPhoto.get(x.mediaId)
    if (!twin) { c.update('mediaTags', x.id, { personId: keepId }); continue }
    // Marked twice on one photo: the frame someone drew is what stays.
    if (twin.x === null && x.x !== null) c.update('mediaTags', twin.id, { x: x.x, y: x.y, w: x.w, h: x.h })
    c.remove('mediaTags', x.id)
  }
  const s = schema.storyPeople
  const told = new Set(db.select().from(s).where(eq(s.personId, keepId)).all().map((x) => `${x.storyId}:${x.role}`))
  for (const x of db.select().from(s).where(eq(s.personId, dropId)).all()) {
    if (told.has(`${x.storyId}:${x.role}`)) c.remove('storyPeople', x.id)
    else c.update('storyPeople', x.id, { personId: keepId })
  }
}

/** Not facts about the family, so not in the history: they follow the person and stay valid after an undo too. */
function moveOutsideHistory(keepId: string, dropId: string) {
  const db = getDb()
  db.update(schema.user).set({ personId: keepId }).where(eq(schema.user.personId, dropId)).run()
  db.update(schema.invites).set({ personId: keepId }).where(eq(schema.invites.personId, dropId)).run()
  for (const v of db.select().from(schema.views).all()) {
    const pins = JSON.parse(v.pins) as Record<string, number>
    const collapsed = JSON.parse(v.collapsed) as string[]
    if (v.focusId !== dropId && !(dropId in pins) && !collapsed.includes(dropId)) continue
    if (dropId in pins) { pins[keepId] ??= pins[dropId]; delete pins[dropId] }
    db.update(schema.views).set({ focusId: v.focusId === dropId ? keepId : v.focusId, pins: JSON.stringify(pins), collapsed: JSON.stringify([...new Set(collapsed.map((id) => (id === dropId ? keepId : id)))]) }).where(eq(schema.views.id, v.id)).run()
  }
  // A draft waiting for review may name the card that is going away.
  for (const p of db.select().from(schema.proposals).where(eq(schema.proposals.status, 'pending')).all()) {
    if (p.ops.includes(dropId)) db.update(schema.proposals).set({ ops: p.ops.split(dropId).join(keepId) }).where(eq(schema.proposals.id, p.id)).run()
  }
}

/** A person's say, always: no model and no token is offered this. */
export function mergePeople(actor: Actor, raw: unknown) {
  requireRole(actor, 'editor')
  if (actor.tokenId || actor.assistant) throw new OpError(403, 'only a person can merge')
  const { keepId, dropId, choose, seen } = input.parse(raw)
  const summary = `${say('Объединить')}: ${personName(getPersonRow(dropId) as never)} → ${personName(getPersonRow(keepId) as never)}`
  const { historyId } = mutateGroup(actor, summary, () => mutate(actor, { summary, personIds: [keepId, dropId] }, (c) => {
    // Read inside the write: what was shown for confirmation must still be true.
    const keep = getPersonRow(keepId), drop = getPersonRow(dropId)
    if (keep.updatedAt !== seen.keep || drop.updatedAt !== seen.drop) throw new OpError(409, say('Карточку только что изменили. Посмотрите сравнение ещё раз.'))
    const why = whyNot(keepId, dropId)
    if (why) throw new OpError(409, why)
    const chosen: Record<string, unknown> = {}
    for (const f of MERGE_FIELDS) {
      const pick = choose[f] ?? (blank(f, keep[f]) ? 'drop' : 'keep')
      chosen[f] = pick === 'drop' && !blank(f, drop[f]) ? drop[f] : keep[f]
    }
    // Other names are not a choice between two: a card keeps every name it was ever known by.
    chosen.otherNames = [...new Set([keep.otherNames, drop.otherNames].filter(Boolean))].join(', ')
    const row: Record<string, unknown> = {
      ...chosen,
      birthYear: yearOf(String(chosen.birthDate ?? '')),
      deathYear: yearOf(String(chosen.deathDate ?? '')),
      living: keep.living && drop.living && !chosen.deathDate,
      avatarMediaId: keep.avatarMediaId ?? drop.avatarMediaId,
      avatarCrop: keep.avatarMediaId ? keep.avatarCrop : drop.avatarCrop,
      tags: JSON.stringify([...new Set([...list<string>(keep.tags), ...list<string>(drop.tags)])]),
      facts: JSON.stringify(unite(list<Fact>(keep.facts), list<Fact>(drop.facts), sameFact)),
      sources: JSON.stringify(unite(list<Source>(keep.sources), list<Source>(drop.sources), sameSource)),
      claims: JSON.stringify(mergeClaims(list<Claim>(keep.claims), list<Claim>(drop.claims), VERSIONED.map((field) => ({ field, keep: String(keep[field] ?? ''), drop: String(drop[field] ?? ''), chosen: String(chosen[field] ?? '') })), newId)),
      updatedAt: Math.max(Date.now(), keep.updatedAt + 1),
    }
    movePeopleLinks(c, keepId, dropId)
    moveContent(c, keepId, dropId)
    c.update('persons', keepId, row)
    c.remove('persons', dropId)
    moveOutsideHistory(keepId, dropId)
  }))
  return { keepId, historyId }
}

const plain = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е')

/** How alike two cards are, and why. Relatives never qualify: a father and son often share every name. */
function likeness(a: Row, b: Row) {
  let score = 0
  const why: string[] = []
  const surnames = (p: Row) => [p.surname, p.maidenName].map(plain).filter(Boolean)
  if (surnames(a).some((s) => surnames(b).includes(s))) { score += 3; why.push('фамилия') }
  const ga = plain(a.givenName), gb = plain(b.givenName)
  if (ga && ga === gb) { score += 3; why.push('имя') }
  else if (ga.length > 2 && gb.length > 2 && (ga.startsWith(gb.slice(0, 3)) || gb.startsWith(ga.slice(0, 3)))) score += 1
  else if (ga && gb) score -= 2
  const pa = plain(a.patronymic), pb = plain(b.patronymic)
  if (pa && pa === pb) { score += 2; why.push('отчество') } else if (pa && pb) score -= 2
  if (a.birthYear && b.birthYear) {
    const d = Math.abs(a.birthYear - b.birthYear)
    if (d === 0) { score += 3; why.push('год рождения') } else if (d <= 2) score += 1
    else if (d > 5) score -= 4
  }
  if (a.deathYear && a.deathYear === b.deathYear) { score += 1; why.push('год смерти') }
  if (a.sex !== 'U' && b.sex !== 'U' && a.sex !== b.sex) score -= 5
  return { score, why }
}

const pairKey = (a: string, b: string) => [a, b].sort().join('|')
const notSame = () => new Set(JSON.parse(getSetting(NOT_SAME) ?? '[]') as string[])

export function duplicateCandidates(actor: Actor) {
  requireRole(actor, 'editor')
  const db = getDb()
  const people = db.select().from(schema.persons).all()
  const skip = notSame()
  const linked = new Set(db.select().from(schema.parentChild).all().map((l) => pairKey(l.parentId, l.childId)))
  for (const u of db.select().from(schema.unions).all()) linked.add(pairKey(u.aId, u.bId))
  const parentsOf = Map.groupBy(db.select().from(schema.parentChild).all(), (l) => l.childId)
  // Only people who share a surname or a first name and birth year are compared, so a big family stays quick.
  const buckets = new Map<string, Row[]>()
  const add = (key: string, p: Row) => { const b = buckets.get(key); if (b) b.push(p); else buckets.set(key, [p]) }
  for (const p of people) {
    for (const s of [p.surname, p.maidenName].map(plain).filter(Boolean)) add(`s:${s}:${plain(p.givenName)[0] ?? ''}`, p)
    if (p.birthYear && plain(p.givenName)) add(`b:${plain(p.givenName)}:${p.birthYear}`, p)
  }
  const found = new Map<string, { a: string; b: string; score: number; why: string[] }>()
  for (const group of buckets.values()) {
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const a = group[i], b = group[j]
      const key = pairKey(a.id, b.id)
      if (a.id === b.id || found.has(key) || linked.has(key) || skip.has(key)) continue
      const { score, why } = likeness(a, b)
      const sharedParent = (parentsOf.get(a.id) ?? []).some((l) => (parentsOf.get(b.id) ?? []).some((m) => m.parentId === l.parentId))
      const total = score + (sharedParent ? 1 : 0)
      if (total >= 6) found.set(key, { a: a.id, b: b.id, score: total, why: why.map(say) })
    }
  }
  return [...found.values()].sort((x, y) => y.score - x.score).slice(0, MAX_CANDIDATES)
}

/** "These are two different people" is remembered, so the same pair is not offered again. */
export function dismissDuplicate(actor: Actor, a: string, b: string) {
  requireRole(actor, 'editor')
  setSetting(NOT_SAME, JSON.stringify([...notSame(), pairKey(a, b)]))
}
