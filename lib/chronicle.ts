// The chronicle: what was going on around the family, written by its agents and drawn by the app under the people.
// Shared by the server and the browser, and pure: dates, the order entries stand in, the text in a reader's language,
// and how a zone's dated outlines blend from one to the next.

export const LANGS = ['ru', 'en', 'es', 'ca'] as const
export type Lang = (typeof LANGS)[number]
/** Words in one or more languages: at least one. */
export type Text = Partial<Record<Lang, string>>
export type Tone = 1 | 2 | 3
/** A point as GeoJSON gives it: longitude, then latitude. */
export type LonLat = [number, number]
export type Ring = LonLat[]
export type Polygon = { type: 'Polygon'; coordinates: Ring[] }
export type MultiPolygon = { type: 'MultiPolygon'; coordinates: Ring[][] }
/** A zone's outline from a date on. `year` is worked out from `at` by the server. */
export interface Stage { at: string; year: number; outline: Polygon | MultiPolygon; label?: LonLat; hold?: boolean }
export interface Zone { id: string; name: Text; tone: Tone; stages: Stage[] }
/** A place of the register. Its name and point are filled in by the server on read. */
export interface PlaceRef { place: string; name?: string; lat?: number; lon?: number }
export interface FreeStop { at: LonLat; name?: Text }
export type RouteStop = PlaceRef | FreeStop
export type Shape =
  | { kind: 'places'; places: PlaceRef[] }
  | { kind: 'route'; stops: RouteStop[]; unsure?: number[] }
  | { kind: 'zones'; zones: Zone[] }
/** One relative's sentence. `year` is worked out from `at` by the server. */
export interface PersonLine { personId: string; at?: string; year?: number; text: Text }
export interface Entry {
  key: string; from: string; to: string; fromYear: number; toYear: number
  lead: boolean; namesPeople: boolean
  title: Text; body: Text; link: Text
  hasShape: boolean; people: PersonLine[]
  /** What the shape is, known before it is fetched (null when there is none): the bar paces a moving front at once. */
  kind: Shape['kind'] | null
  by: string; updatedAt: number
}
export interface ChronicleList { show?: 'owner' | 'all'; entries: Entry[] }
/**
 * The owner's two switches under Settings > Map, as this person gets them: `history` draws the entries' shapes on the
 * map, `chronicle` shows their words (the marks on the bar, the chip, the card, the front page). Both are false for
 * someone the chronicle is not shown to. The owner also gets who sees it, and how many entries there are.
 */
export interface ChronicleSwitches { history: boolean; chronicle: boolean; show?: 'owner' | 'all'; entries?: number }

/** The weight a year gets in playback while an entry with zones is going on: about two seconds a year at 1x. */
export const ERA_WEIGHT = 3
/** The stretches playback slows through: entries that move a front. */
export const erasOf = (entries: Pick<Entry, 'kind' | 'fromYear' | 'toYear'>[]) =>
  entries.filter((e) => e.kind === 'zones').map((e) => ({ from: e.fromYear, to: e.toYear, weight: ERA_WEIGHT }))

/** A date the chronicle accepts: a year, a month or a day, nothing else. */
export const DATE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/
export const MIN_YEAR = 1000, MAX_YEAR = 2200

const utc = (y: number, m = 0, d = 1) => {
  const t = new Date(0)
  t.setUTCFullYear(y, m, d)
  t.setUTCHours(0, 0, 0, 0)
  return t.getTime()
}
/** A moment as a decimal year: the share of its own year passed. */
const decimal = (ms: number) => {
  const y = new Date(ms).getUTCFullYear()
  const a = utc(y), b = utc(y + 1)
  return y + (ms - a) / (b - a)
}

/** The parts of a date, or null when it is not one (a free text, a 30 February, a year out of range). */
function parts(s: string): { y: number; m?: number; d?: number } | null {
  const hit = DATE.exec(s)
  if (!hit) return null
  const y = Number(hit[1])
  if (y < MIN_YEAR || y > MAX_YEAR) return null
  if (hit[2] === undefined) return { y }
  const m = Number(hit[2])
  if (m < 1 || m > 12) return null
  if (hit[3] === undefined) return { y, m }
  const d = Number(hit[3])
  if (d < 1 || new Date(utc(y, m - 1, d)).getUTCDate() !== d) return null
  return { y, m, d }
}

export const isDate = (s: string) => parts(s) !== null

/** The decimal year a date starts at: `1856` → 1856, `1856-07-17` → 1856.54…; NaN for anything else. */
export function parseDate(s: string): number {
  const p = parts(s)
  if (!p) return NaN
  if (p.m === undefined) return p.y
  return decimal(utc(p.y, p.m - 1, p.d ?? 1))
}

/** Where a date ends, exclusive, as a decimal year: the next year, month or day. */
export function endOfDate(s: string): number {
  const p = parts(s)
  if (!p) return NaN
  if (p.m === undefined) return p.y + 1
  if (p.d === undefined) return decimal(utc(p.y, p.m, 1))
  return decimal(utc(p.y, p.m - 1, p.d + 1))
}

/** The years an entry covers: from the start of `from` to the end of `to`, or of `from` itself when there is no `to`. */
export function spanYears(from: string, to?: string | null): { fromYear: number; toYear: number } {
  return { fromYear: parseDate(from), toYear: endOfDate(to || from) }
}

/** The entries going on at a moment. */
export const activeAt = <E extends Pick<Entry, 'fromYear' | 'toYear'>>(entries: E[], y: number) => entries.filter((e) => e.fromYear <= y && y < e.toYear)

/** The entries going on at some point of a whole year: what the bar's chip and the front page show for it. */
export const activeIn = <E extends Pick<Entry, 'fromYear' | 'toYear'>>(entries: E[], year: number) => entries.filter((e) => e.fromYear < year + 1 && year < e.toYear)

/**
 * The nearest entries outside a whole year: the one that ended last before it, and the one that starts first after it.
 * Entries going on in the year itself are neither.
 */
export function around<E extends Pick<Entry, 'fromYear' | 'toYear' | 'key'>>(entries: E[], year: number): { before: E | null; after: E | null } {
  let before: E | null = null, after: E | null = null
  for (const e of entries) {
    if (e.fromYear < year + 1 && year < e.toYear) continue
    if (e.toYear <= year && (!before || e.toYear > before.toYear || (e.toYear === before.toYear && e.fromYear > before.fromYear))) before = e
    if (e.fromYear >= year + 1 && (!after || e.fromYear < after.fromYear)) after = e
  }
  return { before, after }
}

/** The order entries stand in when several are going on: framing ones first, then the one that started latest. */
export const byStanding = (a: Pick<Entry, 'lead' | 'fromYear' | 'key'>, b: Pick<Entry, 'lead' | 'fromYear' | 'key'>) =>
  Number(b.lead) - Number(a.lead) || b.fromYear - a.fromYear || a.key.localeCompare(b.key)

/** The one entry that speaks for a moment, or null. */
export function topEntry<E extends Pick<Entry, 'lead' | 'fromYear' | 'key'>>(active: E[]): E | null {
  return active.length ? [...active].sort(byStanding)[0] : null
}

/** The words in the reader's language, else the archive's, else English, else the first there are. */
export function pickText(text: Text | undefined, lang: string, archiveLang?: string): string {
  if (!text) return ''
  for (const l of [lang, archiveLang, 'en']) if (l && text[l as Lang]) return text[l as Lang]!
  for (const l of LANGS) if (text[l]) return text[l]!
  return ''
}

/** A date as a reader reads it, to the precision it was written with. */
function formatDate(s: string, lang: string): string {
  const p = parts(s)
  if (!p) return s
  if (p.m === undefined) return String(p.y)
  const at = new Date(utc(p.y, p.m - 1, p.d ?? 1))
  const opts: Intl.DateTimeFormatOptions = p.d === undefined ? { month: 'short', year: 'numeric', timeZone: 'UTC' } : { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }
  return new Intl.DateTimeFormat(lang, opts).format(at)
}

/** An entry's dates: `1856–1859` for whole years, `17 jul 1856 – 1 abr 1859` with months or days. */
export function formatSpan(from: string, to: string | undefined | null, lang: string): string {
  if (!to || to === from) return formatDate(from, lang)
  const years = !from.includes('-') && !to.includes('-')
  return years ? `${from}–${to}` : `${formatDate(from, lang)} – ${formatDate(to, lang)}`
}

export interface Blend { a: Stage; b?: Stage; u: number }

/**
 * How a zone stands at a moment: the last stage begun, and while the next has not come, how far towards it (0–1).
 * Null before the first stage. The last stage, or one that holds, stands alone.
 */
export function zoneBlend(zone: Pick<Zone, 'stages'>, y: number): Blend | null {
  const s = zone.stages
  let i = -1
  for (let k = 0; k < s.length; k++) if (s[k].year <= y) i = k
  if (i < 0) return null
  const a = s[i], b = s[i + 1]
  if (!b || a.hold || b.year <= a.year) return { a, u: 0 }
  return { a, b, u: Math.min(1, Math.max(0, (y - a.year) / (b.year - a.year))) }
}

/** How long an entry takes to come in and to go, in years. */
export const FADE = 0.08
/** How strongly an entry is drawn at a moment: 0 outside its years, rising over its first FADE and falling over its last. */
export function entryFade(e: Pick<Entry, 'fromYear' | 'toYear'>, y: number): number {
  if (y < e.fromYear || y >= e.toYear) return 0
  const span = Math.max(1e-6, Math.min(FADE, (e.toYear - e.fromYear) / 2))
  return Math.min(1, (y - e.fromYear) / span, (e.toYear - y) / span)
}

const isPlaceRef = (s: RouteStop): s is PlaceRef => 'place' in s

/** Where a stop is, as latitude and longitude, or null when the server could not say. */
export function stopPoint(s: RouteStop): [number, number] | null {
  if (isPlaceRef(s)) return s.lat !== undefined && s.lon !== undefined ? [s.lat, s.lon] : null
  return [s.at[1], s.at[0]]
}

/** Every point an outline has, as latitude and longitude. */
function* outlinePoints(o: Polygon | MultiPolygon): Generator<[number, number]> {
  const polys = o.type === 'Polygon' ? [o.coordinates] : o.coordinates
  for (const poly of polys) for (const ring of poly) for (const [lon, lat] of ring) yield [lat, lon]
}

/** The box a shape covers, as [[south, west], [north, east]], or null when it has no point. */
export function entryBounds(shape: Shape): [[number, number], [number, number]] | null {
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity
  const add = ([lat, lon]: [number, number]) => { s = Math.min(s, lat); n = Math.max(n, lat); w = Math.min(w, lon); e = Math.max(e, lon) }
  if (shape.kind === 'places') for (const p of shape.places) { const at = stopPoint(p); if (at) add(at) }
  else if (shape.kind === 'route') for (const st of shape.stops) { const at = stopPoint(st); if (at) add(at) }
  else for (const z of shape.zones) for (const st of z.stages) for (const at of outlinePoints(st.outline)) add(at)
  return s === Infinity ? null : [[s, w], [n, e]]
}

/** A mention of a relative in an entry's text, as the app writes it: `[@Name](person:<id>)`. */
export const MENTION = /\[@[^\]]*\]\(person:([^)\s]*)\)/g
/** The ids a text mentions, in every language. */
export const mentionedIn = (text: Text | undefined) => Object.values(text ?? {}).flatMap((v) => [...(v ?? '').matchAll(MENTION)].map((m) => m[1]))
