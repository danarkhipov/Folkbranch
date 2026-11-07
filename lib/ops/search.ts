// Finding things in the archive: by what is written anywhere, or by exact conditions on people.
import MiniSearch from 'minisearch'
import { z } from 'zod'
import { dataStamp } from '../db'
import { blocksToMarkdown } from '../markdown'
import { lifeYears, shownTags, type Person } from '../types'
import { seesOnlyPublic, type Actor } from './core'
import { listAllMedia } from './media'
import { readablePages } from './pages'
import { getGraph } from './people'
import { searchPeople } from './people-search'

const normal = (s: string) => s.toLowerCase().replace(/ё/g, 'е')
const fullName = (p: Person) => [p.givenName, p.patronymic, p.surname].filter(Boolean).join(' ')
const personText = (p: Person) => [
  fullName(p), p.maidenName, p.otherNames, p.birthPlace, p.deathPlace, shownTags(p.tags).join(' '),
  p.facts.map((f) => `${f.kind} ${f.date} ${f.place} ${f.note}`).join(' '),
  p.sources.map((s) => `${s.title} ${s.ref}`).join(' '),
  p.claims.map((c) => `${c.value} ${c.reason}`).join(' '),
].join(' ')

interface Doc { id: string; kind: 'person' | 'page' | 'photo'; refId: string; personId: string | null; title: string; text: string }

const shared = globalThis as unknown as { __folkbranchArchive?: { stamp: string; index: MiniSearch<Doc> } }

/** Built once per change for those who see everything. Others see less, so theirs is built for them. */
function archiveIndex(actor: Actor) {
  const stamp = dataStamp()
  const reusable = !seesOnlyPublic(actor) && !actor.guest
  if (reusable && stamp && shared.__folkbranchArchive?.stamp === stamp) return shared.__folkbranchArchive.index
  const people = getGraph(actor).persons.filter((p) => !p.hidden)
  const docs: Doc[] = [
    ...people.map((p): Doc => ({ id: `person:${p.id}`, kind: 'person', refId: p.id, personId: p.id, title: fullName(p), text: personText(p) })),
    ...readablePages(actor).map((p): Doc => ({ id: `page:${p.id}`, kind: 'page', refId: p.id, personId: p.personId, title: p.title, text: blocksToMarkdown(JSON.parse(p.content)) })),
    ...listAllMedia(actor, 100_000).map((m): Doc => ({ id: `photo:${m.id}`, kind: 'photo', refId: m.id, personId: m.tags[0]?.personId ?? null, title: m.originalName, text: `${m.caption} ${m.date} ${m.place}` })),
  ]
  const index = new MiniSearch<Doc>({ fields: ['title', 'text'], storeFields: ['kind', 'refId', 'personId', 'title', 'text'], processTerm: (t) => normal(t) })
  index.addAll(docs)
  if (reusable && stamp) shared.__folkbranchArchive = { stamp, index }
  return index
}

/** Looks through people, pages and photo captions, forgiving typos and Russian word endings. */
export function searchArchive(actor: Actor, query: string, limit = 20) {
  const index = archiveIndex(actor)
  const options = { prefix: (t: string) => t.length > 2, fuzzy: (t: string) => (t.length > 3 ? 0.25 : false), boost: { title: 3 } }
  // Every word if possible, any word otherwise.
  const every = index.search(query, { ...options, combineWith: 'AND' })
  const hits = every.length ? every : index.search(query, options)
  return { total: hits.length, results: hits.slice(0, limit).map((h) => ({ kind: h.kind, id: h.refId, personId: h.personId, title: h.title, snippet: snippet(h.text, h.terms) })) }
}

function snippet(text: string, terms: string[]) {
  const low = normal(text)
  const at = terms.map((t) => low.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0
  const start = Math.max(0, at - 60)
  return `${start ? '…' : ''}${text.slice(start, at + 140).trim()}${at + 140 < text.length ? '…' : ''}`
}

const allWords = (value: string, query: string) => normal(query).split(/\s+/).filter(Boolean).every((w) => normal(value).includes(w))

/** People by words in any order; if none has them all, whoever comes closest, so a typo still finds them. */
export function findPeople(actor: Actor, query: string, limit: number) {
  const people = getGraph(actor).persons.filter((p) => !p.hidden)
  const exact = people.filter((p) => allWords(`${fullName(p)} ${p.maidenName} ${p.otherNames} ${p.birthPlace} ${p.deathPlace} ${p.tags.join(' ')} ${p.facts.map((f) => `${f.kind} ${f.place} ${f.note}`).join(' ')}`, query))
  if (exact.length || !query.trim()) return exact.slice(0, limit)
  return searchPeople(actor, query, limit).flatMap((r) => people.find((p) => p.id === r.personId) ?? [])
}

export const queryInput = z.object({
  name: z.string().optional().describe('Part of a given name, patronymic, surname, maiden or other name'),
  place: z.string().optional().describe('Part of a birth or death place'),
  sex: z.enum(['M', 'F', 'U']).optional(),
  tag: z.string().optional(),
  bornFrom: z.number().int().optional().describe('Birth year, inclusive'),
  bornTo: z.number().int().optional(),
  diedFrom: z.number().int().optional(),
  diedTo: z.number().int().optional(),
  living: z.boolean().optional(),
  hasSources: z.boolean().optional(),
  hasParents: z.boolean().optional(),
  sort: z.enum(['birth', 'death', 'name']).default('birth'),
  groupBy: z.enum(['birthPlace', 'surname', 'decade', 'sex']).optional().describe('Also count the matches by this'),
  limit: z.number().int().min(0).max(500).default(50).describe('How many to list. 0 when only the counts matter'),
})

/** Exact conditions and counts, for questions like "who was born in Tula before 1900". */
export function queryPeople(actor: Actor, x: z.infer<typeof queryInput>) {
  const g = getGraph(actor)
  const withParents = new Set(g.parentChild.map((l) => l.childId))
  const has = (value: string, part?: string) => !part || normal(value).includes(normal(part))
  const between = (year: number | null, from?: number, to?: number) => (from === undefined && to === undefined) || (year !== null && year >= (from ?? -Infinity) && year <= (to ?? Infinity))
  const found = g.persons.filter((p) => !p.hidden
    && (!x.name || allWords(`${fullName(p)} ${p.maidenName} ${p.otherNames}`, x.name))
    && has(`${p.birthPlace} ${p.deathPlace}`, x.place)
    && (!x.sex || p.sex === x.sex)
    && (!x.tag || p.tags.some((t) => has(t, x.tag)))
    && between(p.birthYear, x.bornFrom, x.bornTo)
    && between(p.deathYear, x.diedFrom, x.diedTo)
    && (x.living === undefined || p.living === x.living)
    && (x.hasSources === undefined || (p.sources.length > 0) === x.hasSources)
    && (x.hasParents === undefined || withParents.has(p.id) === x.hasParents))
  const year = (v: number | null) => v ?? Infinity
  found.sort(x.sort === 'name' ? (a, b) => fullName(a).localeCompare(fullName(b)) : x.sort === 'death' ? (a, b) => year(a.deathYear) - year(b.deathYear) : (a, b) => year(a.birthYear) - year(b.birthYear))
  const groupKey = (p: Person) => (x.groupBy === 'decade' ? (p.birthYear ? `${Math.floor(p.birthYear / 10) * 10}s` : '') : x.groupBy ? String(p[x.groupBy as 'birthPlace' | 'surname' | 'sex'] ?? '') : '') || 'unknown'
  return {
    total: found.length,
    people: found.slice(0, x.limit).map((p) => ({ id: p.id, name: fullName(p), years: lifeYears(p), sex: p.sex, living: p.living, birthPlace: p.birthPlace, deathPlace: p.deathPlace })),
    ...(x.groupBy ? { groups: [...Map.groupBy(found, groupKey)].map(([key, list]) => ({ key, count: list.length })).sort((a, b) => b.count - a.count) } : {}),
  }
}
