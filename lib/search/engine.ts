// Finds people by anything written about them, and says exactly where. Several ways of matching are tried on each word,
// strongest first; the guessing ones (sound, typos, part of a word) only speak when nothing certain was found.
import { dateMatches, datesIn, takeDates, type DateAt } from './dates'
import { distance, NAME_FORMS, normal, otherLayout, SIMILAR_WORDS, sound, stem, toCyrillic } from './words'

export type CardTab = 'details' | 'pages' | 'family' | 'photos' | 'stories'
export interface SearchField { key: string; label: string; text: string; tab: CardTab; weight: number; target?: string; refId?: string }
export interface SearchDoc { id: string; fields: SearchField[] }
export interface SearchMatch { key: string; label: string; tab: CardTab; target?: string; refId?: string; text: string; ranges: [number, number][] }
export interface SearchResult { personId: string; score: number; partial: boolean; matches: SearchMatch[]; terms: string[] }

const EXACT = 1, SAME_WORD = 0.92, START = 0.85, NAME_FORM = 0.8, SIMILAR = 0.6, SOUND = 0.62, TYPO = 0.5, INSIDE = 0.45
const FOREIGN = 0.9
const NOISE = new Set(['в', 'во', 'на', 'из', 'и', 'с', 'со', 'по', 'у', 'к', 'от', 'за', 'о', 'об', 'а', 'год', 'года', 'году', 'г', 'кто', 'где', 'когда', 'был', 'была', 'жил', 'жила', 'in', 'of', 'at', 'the', 'and'])
const BORN = /^(родил|рожд|рожден|урожд|born|birth)/
const DIED = /^(умер|скончал|смерт|погиб|died|death)/
const SNIPPET = 140
const ROOT = 5

interface Spot { doc: number; field: number; start: number; end: number }
interface Word { word: string; stem: string; sound: string; spots: Spot[] }

export interface SearchIndex {
  docs: SearchDoc[]
  words: Word[]
  byWord: Map<string, Word>
  dates: (DateAt & { doc: number; field: number })[]
}

export function buildIndex(docs: SearchDoc[]): SearchIndex {
  const byWord = new Map<string, Word>()
  const dates: SearchIndex['dates'] = []
  docs.forEach((d, doc) => d.fields.forEach((f, field) => {
    const low = normal(f.text)
    for (const m of low.matchAll(/[\p{L}\p{N}]+/gu)) {
      let w = byWord.get(m[0])
      if (!w) byWord.set(m[0], w = { word: m[0], stem: stem(m[0]), sound: sound(m[0]), spots: [] })
      w.spots.push({ doc, field, start: m.index, end: m.index + m[0].length })
    }
    for (const at of datesIn(f.text)) dates.push({ ...at, doc, field })
  }))
  return { docs, words: [...byWord.values()], byWord, dates }
}

/** Every word of the archive that this one could mean, with how sure we are. */
function wordsFor(index: SearchIndex, token: string, factor = 1) {
  const found = new Map<Word, number>()
  const s = stem(token), forms = NAME_FORMS.get(s), similar = SIMILAR_WORDS.get(s)
  const put = (w: Word, tier: number) => { if ((found.get(w) ?? 0) < tier * factor) found.set(w, tier * factor) }
  for (const w of index.words) {
    if (w.word === token) put(w, EXACT)
    else if (w.stem === s && token.length > 2) put(w, SAME_WORD)
    else if (w.word.startsWith(token) && token.length > 1) put(w, START)
    else if (forms?.has(w.stem)) put(w, NAME_FORM)
    else if (similar?.has(w.stem)) put(w, SIMILAR)
  }
  return found
}

/** Вологодская and Вологда: a long shared start, where endings alone do not explain the difference. */
const sharesRoot = (a: string, b: string) => {
  let same = 0
  while (same < a.length && a[same] === b[same]) same++
  return same >= ROOT && same >= Math.min(a.length, b.length) * 0.7
}

function weakWordsFor(index: SearchIndex, token: string) {
  const found = new Map<Word, number>()
  if (token.length < 3 || /^\d+$/.test(token)) return found
  const heard = sound(token), s = stem(token)
  const limit = token.length >= 8 ? 2 : token.length >= 4 ? 1 : 0
  for (const w of index.words) {
    if (/^\d+$/.test(w.word)) continue
    if (w.sound === heard || sound(w.stem) === sound(s)) found.set(w, SOUND)
    else if (limit && (distance(token, w.word, limit) <= limit || distance(s, w.stem, limit) <= limit)) found.set(w, TYPO)
    else if (w.word.includes(token) || sharesRoot(token, w.word)) found.set(w, INSIDE)
  }
  return found
}

/** The ways a typed word is tried: as typed; from Latin letters; by sound and typos; from the wrong keyboard. */
function matchToken(index: SearchIndex, token: string) {
  const latin = /[a-z]/.test(token) && !/[а-я]/.test(token)
  const direct = wordsFor(index, token)
  if (latin) for (const [w, t] of wordsFor(index, toCyrillic(token), FOREIGN)) if ((direct.get(w) ?? 0) < t) direct.set(w, t)
  if ([...direct.values()].some((t) => t >= NAME_FORM * FOREIGN)) return direct
  const weak = weakWordsFor(index, latin ? toCyrillic(token) : token)
  if (weak.size || direct.size) return new Map([...weak, ...direct])
  const swapped = otherLayout(token)
  const asTyped = wordsFor(index, swapped, FOREIGN)
  if (asTyped.size) return asTyped
  return /[a-z]/.test(swapped) ? wordsFor(index, toCyrillic(swapped), FOREIGN) : asTyped
}

interface Hit { doc: number; field: number; start: number; end: number; value: number }

export function search(index: SearchIndex, query: string, limit = 30): SearchResult[] {
  const asked = normal(query).trim()
  if (!asked) return []
  const { terms: dateTerms, rest } = takeDates(asked)
  const raw = rest.match(/[\p{L}\p{N}]+/gu) ?? []
  const born = raw.some((w) => BORN.test(w))
  const died = raw.some((w) => DIED.test(w))
  const hinted = raw.filter((w) => !BORN.test(w) && !DIED.test(w))
  const kept = hinted.filter((w) => !NOISE.has(w))
  const tokens = kept.length || dateTerms.length ? kept : hinted.length ? hinted : raw
  const parts = tokens.length + dateTerms.length
  if (!parts) return []

  // Someone "born in Tula" should come before someone who only moved there.
  const leaning = (key: string) => {
    if (!born && !died) return 1
    const fits = (born && key.startsWith('birth')) || (died && key.startsWith('death'))
    return fits ? 1.5 : /Date|Place/.test(key) ? 0.4 : 0.7
  }

  const covered = new Map<number, Map<number, number>>()
  const hits: Hit[] = []
  const note = (part: number, spot: { doc: number; field: number; start: number; end: number }, tier: number) => {
    const f = index.docs[spot.doc].fields[spot.field]
    const value = tier * f.weight * leaning(f.key)
    let doc = covered.get(spot.doc)
    if (!doc) covered.set(spot.doc, doc = new Map())
    if ((doc.get(part) ?? 0) < value) doc.set(part, value)
    hits.push({ doc: spot.doc, field: spot.field, start: spot.start, end: spot.end, value })
  }
  tokens.forEach((token, part) => { for (const [w, tier] of matchToken(index, token)) for (const spot of w.spots) note(part, spot, tier) })
  dateTerms.forEach((term, i) => { for (const d of index.dates) if (dateMatches(d, term)) note(tokens.length + i, d, EXACT) })

  const results = [...covered].map(([doc, values]) => {
    const own = hits.filter((h) => h.doc === doc)
    let score = [...values.values()].reduce((a, b) => a + b, 0)
    const fields = new Set(own.map((h) => h.field))
    // All in one field reads as one phrase; a field that is exactly the query is what was meant.
    if (parts > 1 && [...fields].some((f) => own.filter((h) => h.field === f).length >= parts)) score += 0.4
    if (index.docs[doc].fields.some((f) => normal(f.text) === asked)) score += 0.6
    return { doc, score, covers: values.size, own }
  })
  const full = results.filter((r) => r.covers === parts)
  const chosen = full.length ? full : results.filter((r) => r.covers >= Math.ceil(parts / 2))
  return chosen.sort((a, b) => b.score - a.score || a.doc - b.doc).slice(0, limit).map((r) => describe(index, r.doc, r.score, !full.length, r.own))
}

function describe(index: SearchIndex, doc: number, score: number, partial: boolean, own: Hit[]): SearchResult {
  const d = index.docs[doc]
  const byField = Map.groupBy(own, (h) => h.field)
  const terms = new Set<string>()
  const matches = [...byField].map(([field, list]) => {
    const f = d.fields[field]
    const ranges = merge(list.map((h): [number, number] => [h.start, h.end]))
    for (const [a, b] of ranges) terms.add(f.text.slice(a, b))
    return { order: Math.max(...list.map((h) => h.value)), match: { key: f.key, label: f.label, tab: f.tab, target: f.target, refId: f.refId, ...cut(f.text, ranges) } }
  }).sort((a, b) => b.order - a.order).map((m) => m.match)
  return { personId: d.id, score: Math.round(score * 100) / 100, partial, matches, terms: [...terms] }
}

function merge(ranges: [number, number][]) {
  const out: [number, number][] = []
  for (const r of ranges.sort((a, b) => a[0] - b[0])) {
    const last = out.at(-1)
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else out.push([r[0], r[1]])
  }
  return out
}

/** A long text is shown around what was found. */
function cut(text: string, ranges: [number, number][]) {
  if (text.length <= SNIPPET) return { text, ranges }
  const start = Math.max(0, ranges[0][0] - 50)
  const end = Math.min(text.length, start + SNIPPET)
  const lead = start > 0 ? '…' : ''
  return {
    text: `${lead}${text.slice(start, end)}${end < text.length ? '…' : ''}`,
    ranges: ranges.filter(([a, b]) => a >= start && b <= end).map(([a, b]): [number, number] => [a - start + lead.length, b - start + lead.length]),
  }
}
