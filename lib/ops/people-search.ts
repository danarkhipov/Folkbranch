// What the search looks through for each person, seen as this person is allowed to see it.
import { dataStamp, getDb, schema } from '../db'
import { blocksToMarkdown } from '../markdown'
import { buildIndex, search, type SearchDoc, type SearchField, type SearchIndex, type SearchResult } from '../search/engine'
import { normal } from '../search/words'
import { personName, type Person, type Sex } from '../types'
import { say } from './app-config'
import { seesOnlyPublic, type Actor } from './core'
import { listAllMedia } from './media'
import { readablePages } from './pages'
import { getGraph } from './people'
import { listStories } from './stories'

const plain = (markdown: string) => markdown.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#*_`>]+/g, ' ').replace(/(^|\s)@/g, '$1').replace(/\s+/g, ' ').trim()

function personFields(p: Person): SearchField[] {
  const field = (key: string, label: string, text: string, weight: number, target?: string, refId?: string): SearchField[] => (text.trim() ? [{ key, label: say(label), text, tab: 'details', weight, target, refId }] : [])
  const shown = new Set([p.givenName, p.surname, p.patronymic, p.maidenName, p.birthDate, p.birthPlace, p.deathDate, p.deathPlace].map(normal))
  return [
    ...field('givenName', 'Имя', p.givenName, 1),
    ...field('surname', 'Фамилия', p.surname, 1),
    ...field('patronymic', 'Отчество', p.patronymic, 0.9, 'f-patronymic'),
    ...field('maidenName', 'Девичья фамилия', p.maidenName, 0.9),
    ...field('otherNames', 'Другие имена', p.otherNames, 0.85),
    ...field('birthDate', 'Рождение', p.birthDate, 0.95, 'f-birth-date'),
    ...field('birthPlace', 'Место рождения', p.birthPlace, 0.8, 'f-birth-place'),
    ...field('deathDate', 'Смерть', p.deathDate, 0.95, 'f-death-date'),
    ...field('deathPlace', 'Место смерти', p.deathPlace, 0.8, 'f-death-place'),
    ...field('tags', 'Группы', p.tags.join(', '), 0.75),
    ...p.facts.flatMap((f) => field('fact', 'Факты', [f.kind, f.date, f.place, f.note].filter(Boolean).join(', '), 0.7)),
    ...p.sources.flatMap((s) => field('source', 'Источники', [s.title, s.ref, s.page].filter(Boolean).join(', '), 0.55, 'f-sources')),
    ...p.claims.flatMap((c) => field('claim', 'Другая версия', [shown.has(normal(c.value)) ? '' : c.value, c.reason].filter(Boolean).join(', '), 0.5)),
  ]
}

function buildDocs(actor: Actor): SearchDoc[] {
  const people = getGraph(actor).persons.filter((p) => !p.hidden)
  const docs = new Map(people.map((p): [string, SearchDoc] => [p.id, { id: p.id, fields: personFields(p) }]))
  for (const page of readablePages(actor)) {
    const doc = docs.get(page.personId)
    if (!doc) continue
    if (page.title) doc.fields.push({ key: 'pageTitle', label: say('Биография'), text: page.title, tab: 'pages', weight: 0.6, refId: page.id })
    const text = plain(blocksToMarkdown(JSON.parse(page.content)))
    if (text) doc.fields.push({ key: 'page', label: say('Биография'), text, tab: 'pages', weight: 0.5, refId: page.id })
  }
  for (const m of listAllMedia(actor, 100_000)) {
    const text = [m.caption, m.date, m.place].filter(Boolean).join(', ')
    if (!text) continue
    for (const t of m.tags) docs.get(t.personId ?? '')?.fields.push({ key: 'photo', label: say('Фото'), text, tab: 'photos', weight: 0.5, refId: m.id })
  }
  // Someone's own words stay among people, as they do in the card.
  if (!actor.tokenId && !actor.assistant) {
    const sp = schema.storyPeople
    const about = new Set(getDb().select({ id: sp.personId, role: sp.role }).from(sp).all().filter((r) => r.role === 'about').map((r) => r.id))
    for (const id of about) {
      const doc = docs.get(id)
      if (!doc) continue
      for (const s of listStories(actor, id)) {
        const text = [s.title, s.body, s.tellerName, s.toldOn].filter(Boolean).join('. ')
        if (text) doc.fields.push({ key: 'story', label: say('Рассказы'), text, tab: 'stories', weight: 0.5, refId: s.id })
      }
    }
  }
  return [...docs.values()]
}

interface Indexes { index: SearchIndex; names: SearchIndex }
const shared = globalThis as unknown as { __folkbranchSearch?: Indexes & { stamp: string } }
const NAME_KEYS = new Set(['givenName', 'surname', 'patronymic', 'maidenName', 'otherNames'])

/** Readers and links see less, so only the full view is kept between searches. */
function indexFor(actor: Actor): Indexes {
  const stamp = dataStamp()
  const full = !seesOnlyPublic(actor) && !actor.guest && !actor.tokenId && !actor.assistant
  if (full && stamp && shared.__folkbranchSearch?.stamp === stamp) return shared.__folkbranchSearch
  const docs = buildDocs(actor)
  const indexes = { index: buildIndex(docs), names: buildIndex(docs.map((d) => ({ id: d.id, fields: d.fields.filter((f) => NAME_KEYS.has(f.key)) }))) }
  if (full && stamp) shared.__folkbranchSearch = { stamp, ...indexes }
  return indexes
}

type Who = (id: string) => string[]
const ROLES: [RegExp, 'parents' | 'children' | 'spouses' | 'siblings' | 'grandchildren' | 'grandparents', Sex | null, string][] = [
  [/^(жен[аыуе]|женой|супруга|супруги|wife)$/, 'spouses', 'F', 'жена'], [/^(муж|мужа|мужу|мужем|супруг|husband)$/, 'spouses', 'M', 'муж'],
  [/^(мать|матери|матерью|мама|мамы|маме|mother)$/, 'parents', 'F', 'мать'], [/^(отец|отца|отцу|отцом|папа|папы|father)$/, 'parents', 'M', 'отец'], [/^(родители|родителей|родителя|родитель|parents)$/, 'parents', null, 'родитель'],
  [/^(сын|сына|сыну|сыном|сыновья|son)$/, 'children', 'M', 'сын'], [/^(дочь|дочери|дочка|дочки|дочерью|daughter)$/, 'children', 'F', 'дочь'], [/^(дети|детей|ребенок|ребенка|children)$/, 'children', null, 'ребёнок'],
  [/^(брат|брата|брату|братом|brother)$/, 'siblings', 'M', 'брат'], [/^(сестра|сестры|сестре|сестру|sister)$/, 'siblings', 'F', 'сестра'],
  [/^(внучка|внучки|granddaughter)$/, 'grandchildren', 'F', 'внучка'], [/^(внук|внука|grandson)$/, 'grandchildren', 'M', 'внук'],
  [/^(бабушка|бабушки|бабка|grandmother)$/, 'grandparents', 'F', 'бабушка'], [/^(дед|деда|дедушка|дедушки|grandfather)$/, 'grandparents', 'M', 'дедушка'],
]

/** "жена Ивана": finds Ivan, then answers with his wife. */
function byRelation(actor: Actor, names: SearchIndex, query: string): SearchResult[] {
  const words = normal(query).trim().split(/\s+/)
  if (words.length < 2) return []
  const at = words.findIndex((w) => ROLES.some(([re]) => re.test(w)))
  if (at < 0) return []
  const [, kind, sex, word] = ROLES.find(([re]) => re.test(words[at]))!
  const sure = search(names, words.filter((_, i) => i !== at).join(' '), 10).filter((r) => !r.partial)
  if (!sure.length) return []
  const g = getGraph(actor)
  const people = new Map(g.persons.filter((p) => !p.hidden).map((p) => [p.id, p]))
  const parents: Who = (id) => g.parentChild.filter((l) => l.childId === id).map((l) => l.parentId)
  const children: Who = (id) => g.parentChild.filter((l) => l.parentId === id).map((l) => l.childId)
  const related: Record<typeof kind, Who> = {
    parents, children,
    spouses: (id) => g.unions.flatMap((u) => (u.aId === id ? [u.bId] : u.bId === id ? [u.aId] : [])),
    siblings: (id) => parents(id).flatMap(children).filter((c) => c !== id),
    grandchildren: (id) => children(id).flatMap(children),
    grandparents: (id) => parents(id).flatMap(parents),
  }
  const out = new Map<string, SearchResult>()
  for (const base of sure) {
    const baseName = personName(people.get(base.personId)!)
    for (const id of related[kind](base.personId)) {
      const p = people.get(id)
      if (!p || (sex && p.sex !== sex) || out.has(id)) continue
      const text = `${say(word)}: ${baseName}`
      out.set(id, { personId: id, score: 3 + base.score, partial: false, terms: [baseName], matches: [{ key: 'relation', label: say('Семья'), tab: 'family', text, ranges: [[0, text.length]] }] })
    }
  }
  return [...out.values()]
}

export function searchPeople(actor: Actor, query: string, limit = 30): SearchResult[] {
  const { index, names } = indexFor(actor)
  const related = byRelation(actor, names, query)
  const found = search(index, query, limit)
  if (!related.length) return found
  // The answer to "whose wife" comes alone, with only what really has all the words after it.
  const seen = new Set(related.map((r) => r.personId))
  return [...related, ...found.filter((r) => !r.partial && !seen.has(r.personId))].slice(0, limit)
}

