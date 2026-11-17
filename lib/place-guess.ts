// Where a place with no point probably is: candidates from the GeoNames extract shipped with the app, ranked by what
// the archive already says. Nothing here leaves the machine, and nothing is set: the owner picks a candidate or none.

/** One town of the extract. `names` holds every other spelling; a name used only in some years carries them. */
export interface GazName { n: string; from?: number | null; to?: number | null; historic?: boolean }
export interface GazPlace { id: number; name: string; ru: string; lat: number; lon: number; cc: string; region: string; pop: number; names: GazName[] }
/**
 * The extract in memory. Rows stay as the file has them, and a town is made into an object only when it is a candidate:
 * the whole world is a quarter of a million towns, and an object for each with its names cost hundreds of megabytes.
 */
export interface Gazetteer {
  /** One town per line, fields split by tabs (see `encodeRow`); `starts` holds where each line begins, plus the end. */
  text: string
  starts: Int32Array
  count: number
  /** Region code ("RU.77") → its names in every language the extract keeps. */
  regions: Record<string, string[]>
  /** Country code → its names. */
  countries: Record<string, string[]>
  snapshot: string
}

/** What the archive knows around a place: words naming what it belongs to, points near it, the years it is written for. */
export interface GuessContext {
  /** The text after a comma and the names of the parent places: "Тверская губерния", "Россия". */
  hints?: string[]
  /** Points of the other places in the same lives. */
  near?: { lat: number; lon: number }[]
  /** Years of the events written with this place. */
  years?: number[]
}

export interface Candidate {
  id: number; name: string; ru: string; lat: number; lon: number; cc: string; region: string; regionRu: string; pop: number
  /** The spelling that matched, when it is not the main name: an old name or another language's. */
  matched: string
  /** Why it ranks where it does, said in short codes the page turns into words. */
  why: ('exact' | 'spelling' | 'typo' | 'region' | 'other-region' | 'near' | 'far' | 'in-years' | 'out-of-years')[]
  score: number
}

// ---------------------------------------------------------------------------------------------------------------
// Spelling

/** Russian, Ukrainian and Belarusian letters in one Latin spelling; what differs between schemes is levelled after. */
const CYR: Record<string, string> = Object.fromEntries([
  // From U+0430 to U+044F in alphabet order, written by code point so the table is not read as interface text.
  ...'a b v g d e zh z i i k l m n o p r s t u f kh ts ch sh shch _ y _ e iu ia'.split(' ').map((l, i) => [String.fromCharCode(0x430 + i), l === '_' ? '' : l]),
  // Yo, Ukrainian ye, i and yi, Belarusian short u, ghe with upturn, and the pre-1918 yat, fita and izhitsa.
  ['\u0451', 'e'], ['\u0454', 'ie'], ['\u0456', 'i'], ['\u0457', 'i'], ['\u045E', 'v'], ['\u0491', 'g'], ['\u0463', 'e'], ['\u0473', 'f'], ['\u0475', 'i'],
])

/**
 * A spelling-blind form of a name: Cyrillic in Latin letters, then the ways Russian, Polish, German and English write
 * one sound made one. "Шклов", "Shklov", "Szkłów" and "Schklow" come out the same.
 */
export function skeleton(s: string): string {
  let t = s.toLowerCase().replace(/ł/g, 'l').replace(/ß/g, 'ss').replace(CYR_LETTER, (c) => CYR[c])
  t = t.normalize('NFD').replace(/\p{M}/gu, '')
  // Digits stay: "Leningrad-300" is a different place from Leningrad.
  t = t.replace(/[^a-z0-9]+/g, '')
  t = t.replace(SOUNDS, (m) => SOUND[m]).replace(/i(?=[aeou])/g, '').replace(/ou/g, 'u').replace(/ie/g, 'e')
  return t.replace(/(.)\1+/g, '$1')
}

const CYR_LETTER = new RegExp(`[${Object.keys(CYR).join('')}]`, 'g')
/** Letters written differently for one sound, longest first so "shch" is read before "sh". */
const SOUND: Record<string, string> = {
  schtsch: 's', shch: 's', szcz: 's', tsch: 'c', sch: 's', tch: 'c', cz: 'c', sh: 's', sz: 's', zh: 'z', rz: 'z', zs: 'z',
  kh: 'h', ch: 'c', ts: 'c', tz: 'c', ph: 'f', ck: 'k', q: 'k', x: 'ks', w: 'v', j: 'i', y: 'i',
}
const SOUNDS = new RegExp(Object.keys(SOUND).join('|'), 'g')

/** What people write before or after a name that is not the name: "г.", "с.", "деревня", "village". */
const KIND_WORDS = /^(г|гор|город|с|село|сел|д|дер|деревня|п|пос|посёлок|поселок|пгт|м|мест|местечко|ст|станция|х|хутор|слобода|сл|станица|аул|кишлак|city|town|village|of)$/i

/** The name itself out of a place as written: the part before the first comma, without "г." and the like. */
export function bareName(text: string): string {
  const first = (text.split(',')[0] ?? '').replace(/[«»"()]/g, ' ')
  const words = first.split(/[\s.]+/).filter(Boolean)
  const kept = words.filter((w) => !KIND_WORDS.test(w))
  return (kept.length ? kept : words).join(' ').trim()
}

/** The words that say what a region is, dropped so "Тверская губерния" and "Tver Oblast" meet on "tver". */
const REGION_WORDS = /^(губерния|губ|уезд|у|область|обл|край|район|р-н|волость|вол|республика|респ|автономная|ао|oblast|oblast'|governorate|gubernia|guberniya|province|region|raion|rayon|district|krai|kray|republic|of|okrug|uyezd|uezd|voivodeship|województwo|wojewodztwo|powiat|gmina)$/i

/** The stem of a region's word: an adjective's ending off, so "Тверская", "Tverskaya" and "Tver" share "tver". */
const stem = (w: string) => skeleton(w).replace(/(skaia|ckaia|skoi|ckoi|skii|ckii|ska|cka|ski|cki|skie|kaia|kii|aia|oi|ii|ka|ia|a)$/, '')

/** A short word in capitals is an abbreviation ("США", "USA", "UK"): kept, and compared only whole. */
export const regionStems = (text: string) =>
  text.split(/[\s,.;:()«»"-]+/).filter((w) => w && !REGION_WORDS.test(w)).flatMap((w) => {
    if (w.length >= 2 && w.length <= 4 && w === w.toUpperCase() && /\p{L}/u.test(w)) return [skeleton(w)]
    const s = stem(w)
    return s.length >= 3 ? [s] : []
  })

/** How many single-letter changes turn one word into the other, giving up once it passes `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (cur[j] < best) best = cur[j]
    }
    if (best > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

/** A typo allowed: one letter in a short name, two in a long one. */
const allowed = (len: number) => (len <= 4 ? 0 : len <= 8 ? 1 : 2)

// ---------------------------------------------------------------------------------------------------------------
// Index

const loose = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** Every spelling-blind name → the rows that go by it; a single row is kept as a number, so most keys cost no array. */
interface Index { bySkel: Map<string, number | number[]>; byFirst: Map<string, string[]>; regionStems: Map<string, Set<string>>; countryStems: Map<string, Set<string>> }

const line = (g: Gazetteer, i: number) => g.text.slice(g.starts[i], g.starts[i + 1] - 1).split('\t')
/** The main name, the Russian one and every other name of a row, as text. */
const rowNames = (g: Gazetteer, i: number) => {
  const f = line(g, i)
  return [f[1], f[2], ...(f[8] ? f[8].split(NAME_SEP).map((n) => n.split(PART_SEP)[0]) : [])].filter(Boolean)
}

const built = new WeakMap<Gazetteer, Index>()
function index(g: Gazetteer): Index {
  let ix = built.get(g)
  if (ix) return ix
  ix = { bySkel: new Map(), byFirst: new Map(), regionStems: new Map(), countryStems: new Map() }
  const bySkel = ix.bySkel
  for (let i = 0; i < g.count; i++) {
    for (const n of rowNames(g, i)) {
      const k = skeleton(n)
      if (!k) continue
      const was = bySkel.get(k)
      if (was === undefined) bySkel.set(k, i)
      else if (typeof was === 'number') { if (was !== i) bySkel.set(k, [was, i]) }
      else if (was[was.length - 1] !== i) was.push(i)
    }
  }
  for (const k of bySkel.keys()) {
    const f = k.slice(0, 1)
    const list = ix.byFirst.get(f)
    if (list) list.push(k)
    else ix.byFirst.set(f, [k])
  }
  for (const [code, names] of Object.entries(g.regions)) ix.regionStems.set(code, new Set(names.flatMap(regionStems)))
  for (const [code, names] of Object.entries(g.countries)) ix.countryStems.set(code, new Set(names.flatMap(regionStems)))
  built.set(g, ix)
  return ix
}
/** Builds the index now, so the first person to ask does not wait for it. */
export const prepare = (g: Gazetteer) => void index(g)

const rowsOf = (v: number | number[] | undefined) => (v === undefined ? [] : typeof v === 'number' ? [v] : v)

/** A row as a town, with its names. */
function placeAt(g: Gazetteer, i: number): GazPlace {
  const [id, name, ru, lat, lon, cc, region, pop, names] = line(g, i)
  const year = (s: string | undefined) => (s ? Number(s) : null)
  return {
    id: Number(id), name, ru, lat: Number(lat), lon: Number(lon), cc, region, pop: Number(pop),
    names: names ? names.split(NAME_SEP).map((n) => {
      const [text, from, to, historic] = n.split(PART_SEP)
      return from || to || historic ? { n: text, from: year(from), to: year(to), historic: true } : { n: text }
    }) : [],
  }
}

/** The town with this GeoNames number, or null. */
export function gazPlace(g: Gazetteer, id: number): GazPlace | null {
  const head = `${id}\t`
  for (let i = 0; i < g.count; i++) if (g.text.startsWith(head, g.starts[i])) return placeAt(g, i)
  return null
}

// ---------------------------------------------------------------------------------------------------------------
// Ranking

const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r
  return 6371 * 2 * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2))
}

/** Whether a name was in use in a year: an open end on either side counts as in use. */
const inYears = (n: GazName, y: number) => (n.from == null || y >= n.from) && (n.to == null || y <= n.to)

/** The places of the extract a name could mean, best first; at most `limit`. Empty when nothing is close enough. */
export function guessPlace(text: string, g: Gazetteer, ctx: GuessContext = {}, limit = 3): Candidate[] {
  const name = bareName(text)
  if (!name) return []
  const ix = index(g)
  const hits = new Map<number, { place: GazPlace; name: GazName; dist: number; how: 'exact' | 'spelling' | 'typo' }>()
  const ln = loose(name)
  /** The row's name that matched the key: the one written the same if there is one, so an old name with years is found. */
  const offer = (i: number, key: string, dist: number) => {
    if (hits.has(i)) return
    const place = placeAt(g, i)
    const all = [{ n: place.name }, ...(place.ru ? [{ n: place.ru }] : []), ...place.names]
    const same = all.find((n) => loose(n.n) === ln)
    const hit = same ?? all.find((n) => skeleton(n.n) === key) ?? all[0]
    hits.set(i, { place, name: hit, dist, how: dist ? 'typo' : same ? 'exact' : 'spelling' })
  }
  const sk = skeleton(name)
  for (const i of rowsOf(ix.bySkel.get(sk))) offer(i, sk, 0)
  const max = allowed(sk.length)
  if (max && hits.size === 0) {
    // A typo is looked for only when no spelling of the name matched: a real town of that name beats a near one.
    for (const k of ix.byFirst.get(sk.slice(0, 1)) ?? []) {
      if (k === sk || Math.abs(k.length - sk.length) > max) continue
      const d = editDistance(sk, k, max)
      if (d <= max) for (const i of rowsOf(ix.bySkel.get(k))) offer(i, k, d)
    }
  }
  if (!hits.size) return []

  const hintStems = [...new Set([...text.split(',').slice(1), ...(ctx.hints ?? [])].flatMap(regionStems))]
  const meets = (stems: string[], own: Set<string> | undefined) => stems.some((s) => [...(own ?? [])].some((o) => o === s || (s.length >= 4 && o.length >= 4 && (o.startsWith(s) || s.startsWith(o)))))
  // Words naming a country ("Россия", "Poland") are not a region; what is left is.
  const regionHints = hintStems.filter((s) => ![...ix.countryStems.values()].some((own) => meets([s], own)))
  const years = (ctx.years ?? []).filter(Number.isFinite)
  const near = ctx.near ?? []
  const out: Candidate[] = []
  for (const { place: p, ...h } of hits.values()) {
    const why: Candidate['why'] = [h.how]
    let score = 100 - 25 * h.dist - (h.how === 'spelling' ? 2 : 0)
    if (hintStems.length) {
      // The region says more than the country: every Ivanovka of Russia is in Russia. A region written that this town is
      // not in counts against it, even when the country fits.
      if (meets(regionHints, ix.regionStems.get(`${p.cc}.${p.region}`))) { score += 40; why.push('region') }
      else if (regionHints.length) { score -= 15 - (meets(hintStems, ix.countryStems.get(p.cc)) ? 10 : 0); why.push('other-region') }
      else if (meets(hintStems, ix.countryStems.get(p.cc))) score += 10
      else { score -= 15; why.push('other-region') }
    }
    if (near.length) {
      const d = Math.min(...near.map((n) => km(n, p)))
      if (d < 60) { score += 30; why.push('near') } else if (d < 200) { score += 20; why.push('near') } else if (d < 500) score += 8
      else if (d > 1500) { score -= 15; why.push('far') }
    }
    if (years.length && (h.name.from != null || h.name.to != null)) {
      if (years.some((y) => inYears(h.name, y))) { score += 15; why.push('in-years') } else { score -= 25; why.push('out-of-years') }
    }
    score += Math.min(12, Math.log10(p.pop + 1) * 2)
    const matched = [p.name, p.ru].some((n) => loose(n) === loose(h.name.n)) ? '' : h.name.n
    const regionNames = g.regions[`${p.cc}.${p.region}`] ?? []
    out.push({
      id: p.id, name: p.name, ru: p.ru, lat: p.lat, lon: p.lon, cc: p.cc, pop: p.pop, matched, why, score: Math.round(score * 10) / 10,
      region: regionNames[0] ?? '', regionRu: regionNames.find((n) => /[а-яё]/i.test(n)) ?? '',
    })
  }
  return out.sort((a, b) => b.score - a.score || b.pop - a.pop).slice(0, limit)
}

// ---------------------------------------------------------------------------------------------------------------
// The file

/**
 * The extract as stored: rows of [id, name, Russian name, lat, lon, country, region, population, other names], where
 * an other name is a string, or [name, from, to] when it was used only in those years (from or to may be null), or
 * [name, null, null, 1] when GeoNames calls it historic without saying when.
 */
export interface GazFile {
  snapshot: string
  regions: Record<string, string[]>
  countries: Record<string, string[]>
  rows: [number, string, string, number, number, string, string, number, (string | [string, number | null, number | null, 1?])[]][]
}

/** Between the names of a town, and between a name and its years: characters no place name contains. */
const NAME_SEP = '\u001f', PART_SEP = '\u001e'

/** A row as one line of the stored text: tabs between fields, and an old name written with its years and mark. */
export function encodeRow([id, name, ru, lat, lon, cc, region, pop, names]: GazFile['rows'][number]): string {
  const clean = (s: string) => s.replace(/[\t\n\u001e\u001f]/g, ' ')
  const other = names.map((n) => (typeof n === 'string' ? clean(n) : [clean(n[0]), n[1] ?? '', n[2] ?? '', n[3] ? '1' : ''].join(PART_SEP)))
  return [id, clean(name), clean(ru), lat, lon, cc, region, pop, other.join(NAME_SEP)].join('\t')
}

/**
 * The stored extract: a first line of JSON (snapshot, regions, countries), then one town per line. Read as one string
 * with the start of each line, about a third of the memory the same towns take as parsed JSON.
 */
export function parseGazetteer(text: string): Gazetteer {
  const first = text.indexOf('\n')
  const head = JSON.parse(text.slice(0, first)) as Omit<GazFile, 'rows'>
  const starts: number[] = []
  for (let at = first + 1; at < text.length; at = text.indexOf('\n', at) + 1 || text.length) starts.push(at)
  starts.push(text.length + 1)
  return { snapshot: head.snapshot, regions: head.regions, countries: head.countries, text, starts: Int32Array.from(starts), count: starts.length - 1 }
}

export const writeGazetteer = (f: GazFile) => `${JSON.stringify({ snapshot: f.snapshot, regions: f.regions, countries: f.countries })}\n${f.rows.map(encodeRow).join('\n')}`
export const readGazetteer = (f: GazFile): Gazetteer => parseGazetteer(writeGazetteer(f))
