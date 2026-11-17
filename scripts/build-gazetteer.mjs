// Builds the offline list of towns that suggests a map point for a family place with none: public/gazetteer/ from
// GeoNames (CC BY 4.0, geonames.org). Nothing is fetched at run time and no family place name is ever sent anywhere:
// this script downloads public GeoNames dumps once, by hand, when the extract should change.
//   node scripts/build-gazetteer.mjs [cache-dir]      (needs network and `unzip` once)
// Kept: cities500, every populated place of 500 people or more and every seat, in the whole world, with its other names
// in Latin and Cyrillic letters (the scripts the matching reads), in the languages family records are written in, and
// the years an old name was used. alternateNamesV2 is about 200 MB to download, once. Written as
// gzipped text (a JSON first line, then one town per line), with the snapshot date, row count, size and sha256 beside it.
import { execFileSync, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import zlib from 'node:zlib'
import { skeleton, writeGazetteer } from '../lib/place-guess.ts'

const SRC = 'https://download.geonames.org/export/dump'
const OUT = path.resolve('public/gazetteer')
/**
 * Languages family records are written in, across Europe, the former Russian Empire and where its families moved;
 * '' is a name GeoNames gives with no language. Names are kept only in Latin and Cyrillic letters, which the matching reads.
 */
const LANGS = new Set(['', 'en', 'ru', 'uk', 'be', 'pl', 'lt', 'lv', 'et', 'fi', 'ro', 'mo', 'hu', 'sk', 'cs', 'de', 'yi', 'fr', 'es', 'ca', 'it', 'pt',
  'nl', 'sv', 'da', 'no', 'nb', 'is', 'sl', 'hr', 'sr', 'bs', 'bg', 'mk', 'tr', 'ka', 'hy', 'az', 'kk', 'uz', 'ky', 'tg', 'tk', 'mn', 'tt', 'ba', 'cv', 'la'])
/** Region and country names: only the languages a person writes a guberniya or a country in. */
const REGION_LANGS = new Set(['', 'ru', 'uk', 'be', 'pl', 'en', 'de', 'lt', 'lv', 'fr', 'es', 'ca', 'it', 'pt', 'cs', 'hu', 'ro', 'nl', 'sv'])

const cache = path.resolve(process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'geonames-')))
fs.mkdirSync(cache, { recursive: true })
fs.mkdirSync(OUT, { recursive: true })

async function get(rel) {
  const file = path.join(cache, rel.replace(/\//g, '_'))
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return file
  const res = await fetch(`${SRC}/${rel}`)
  if (!res.ok) throw new Error(`${rel}: ${res.status}`)
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  return file
}
const unzip = (zip, member) => execFileSync('unzip', ['-p', zip, member], { maxBuffer: 2 ** 31 - 1 }).toString('utf8')
const lines = (text) => text.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t'))
const year = (s) => { const m = /^-?\d{3,4}/.exec(s ?? ''); return m ? Number(m[0]) : null }
const r4 = (n) => Math.round(n * 1e4) / 1e4

// cities500: geonameid, name, asciiname, alternatenames, lat, lon, feature class, feature code, country, cc2, admin1, …, population
/** Latin (with its accented letters) and Cyrillic: names in other scripts cannot be matched against what a person types. */
const READABLE = /^[\u0020-\u024F\u1E00-\u1EFF\u0400-\u04FF\u2019\u02BC]+$/
const towns = lines(unzip(await get('cities500.zip'), 'cities500.txt'))
/**
 * The world's names with their language and years are one 200 MB file. When it is not in the cache, the countries of the
 * former Russian Empire and their neighbours are read from GeoNames' per-country lists (small), and other countries
 * keep the names cities500 gives itself, without language or years.
 */
const full = fs.existsSync(path.join(cache, 'alternateNamesV2.zip')) || process.env.GEONAMES_FULL === '1'
const DETAIL = ['RU', 'UA', 'BY', 'PL', 'LT', 'LV', 'EE', 'FI', 'MD', 'GE', 'AM', 'AZ', 'KZ', 'UZ', 'KG', 'TJ', 'TM', 'RO', 'SK', 'HU', 'MN']
const detail = new Set(DETAIL)
const byId = new Map(towns.map((c) => {
  const t = { id: Number(c[0]), name: c[1], lat: r4(Number(c[4])), lon: r4(Number(c[5])), cc: c[8], region: c[10], pop: Number(c[14]) || 0, ru: '', ruPreferred: false, names: new Map() }
  if (!full && !detail.has(t.cc)) for (const n of c[3].split(',')) {
    const name = n.trim()
    if (name && name.length <= 60 && READABLE.test(name)) t.names.set(name, { from: null, to: null, historic: false })
  }
  return [t.id, t]
}))

const admin1 = lines(fs.readFileSync(await get('admin1CodesASCII.txt'), 'utf8'))
const regions = Object.fromEntries(admin1.map((a) => [a[0], [...new Set([a[1], a[2]].filter(Boolean))]]))
const regionById = new Map(admin1.map((a) => [Number(a[3]), a[0]]))
const countryInfo = lines(fs.readFileSync(await get('countryInfo.txt'), 'utf8'))
// A country is named in the languages its families' records are written in: "Германия", "Deutschland", "Allemagne".
const NAMING = ['en', 'ru', 'uk', 'be', 'pl', 'de', 'fr', 'es', 'ca', 'it', 'pt', 'nl', 'sv', 'fi', 'lt', 'lv', 'et', 'ro', 'hu', 'cs', 'sk', 'sr', 'bg', 'el', 'tr']
const shown = NAMING.map((l) => new Intl.DisplayNames([l], { type: 'region', fallback: 'none' }))
const countries = Object.fromEntries(countryInfo.map((c) => [c[0], [...new Set([c[4], ...shown.map((d) => { try { return d.of(c[0]) } catch { return undefined } })].filter((n) => n && READABLE.test(n)))]]))
const countryById = new Map(countryInfo.map((c) => [Number(c[16]), c[0]]))

// alternateNamesV2, the whole world in one file of about 700 MB, read line by line:
// id, geonameid, language, name, preferred, short, colloquial, historic, from, to
const ruSeen = new Set()
const skip = /^(post|iata|icao|faac|link|wkdt|unlc|abbr|tcid|fr_1793|phon|piny)$/
const sources = full ? [[await get('alternateNamesV2.zip'), 'alternateNamesV2.txt']] : await Promise.all(DETAIL.map(async (cc) => [await get(`alternatenames/${cc}.zip`), `${cc}.txt`]))
for (const [zip, member] of sources) for await (const l of readline.createInterface({ input: spawn('unzip', ['-p', zip, member]).stdout })) {
  const a = l.split('\t')
  const gid = Number(a[1]), lang = a[2] ?? '', name = (a[3] ?? '').trim()
  if (!name || name.length > 60 || skip.test(lang) || !READABLE.test(name)) continue
  const region = regionById.get(gid), country = countryById.get(gid)
  if ((region || country) && REGION_LANGS.has(lang)) {
    const list = region ? regions[region] : countries[country]
    // The Russian name goes second, right after GeoNames' own, so a Russian page names the region in Russian.
    if (lang === 'ru' && (a[4] === '1' || !ruSeen.has(list))) { const at = list.indexOf(name); if (at > 0) list.splice(at, 1); list.splice(1, 0, name) }
    else if (!list.includes(name)) list.push(name)
    if (lang === 'ru') ruSeen.add(list)
  }
  const t = byId.get(gid)
  if (!t || !LANGS.has(lang)) continue
  if (lang === 'ru' && (!t.ru || (a[4] === '1' && !t.ruPreferred))) { t.ru = name; t.ruPreferred = a[4] === '1' }
  const from = year(a[8]), to = year(a[9]), historic = a[7] === '1'
  const was = t.names.get(name)
  // One spelling in several languages is one name; years, when any row gives them, are kept.
  if (!was || (from ?? to) !== null || (historic && !was.historic)) t.names.set(name, { from: from ?? was?.from ?? null, to: to ?? was?.to ?? null, historic: historic || !!was?.historic })
}

// A name the matching would read the same as one already kept says nothing new: "Kraków", "Krakow" and "Krakov" are one.
const rows = [...byId.values()].sort((a, b) => b.pop - a.pop || a.id - b.id).map((t) => {
  const seen = new Set([skeleton(t.name), skeleton(t.ru)])
  const names = []
  for (const [n, v] of [...t.names].sort((a, b) => Number(b[1].from !== null || b[1].to !== null || b[1].historic) - Number(a[1].from !== null || a[1].to !== null || a[1].historic))) {
    const dated = v.from !== null || v.to !== null
    const k = skeleton(n)
    if (!k || (!dated && !v.historic && seen.has(k))) continue
    seen.add(k)
    names.push(dated ? [n, v.from, v.to] : v.historic ? [n, null, null, 1] : n)
  }
  return [t.id, t.name, t.ru === t.name ? '' : t.ru, t.lat, t.lon, t.cc, t.region, t.pop, names]
})

const snapshot = new Date().toISOString().slice(0, 10)
const json = writeGazetteer({ snapshot, regions, countries, rows })
const gz = zlib.gzipSync(json, { level: 9 })
fs.rmSync(path.join(OUT, 'places.json.gz'), { force: true })
fs.writeFileSync(path.join(OUT, 'places.tsv.gz'), gz)
const meta = {
  source: 'GeoNames cities500, admin1CodesASCII, countryInfo and alternateNamesV2, https://download.geonames.org/export/dump/',
  license: 'CC BY 4.0, https://creativecommons.org/licenses/by/4.0/',
  snapshot, countries: 'all', languages: [...LANGS].filter(Boolean), namesWithLanguage: full ? 'all countries' : DETAIL, rows: rows.length, names: rows.reduce((n, r) => n + r[8].length + 1, 0),
  bytes: gz.length, textBytes: Buffer.byteLength(json), sha256: crypto.createHash('sha256').update(gz).digest('hex'),
}
fs.writeFileSync(path.join(OUT, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`)
fs.writeFileSync(path.join(OUT, 'LICENSE.txt'), [
  'Place names and points: GeoNames (https://www.geonames.org), licensed under Creative Commons Attribution 4.0',
  '(https://creativecommons.org/licenses/by/4.0/). Extract of cities500 and alternate names, all countries,',
  `built ${snapshot} by scripts/build-gazetteer.mjs. Changes: names limited to Latin and Cyrillic letters and to the`,
  'languages listed in the script, names that read alike dropped, coordinates rounded to four decimals.', '',
].join('\n'))
console.log(meta)
