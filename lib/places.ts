// What a place written on a card means: the record for it, the levels above it, and every name it went by.
import { yearOf, type Graph, type Person, type Place } from './types'

const key = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()
/** The first part is the place itself; what follows a comma is usually what it belonged to. */
export const placeKey = (text: string) => key(text.split(',')[0] ?? '')
/**
 * A name with its spelling levelled: case, diacritics, punctuation and hyphens do not tell places apart, since one town
 * reaches the archive with and without a hyphen, or with a full stop typed at the end of its name on a card.
 */
const looseKey = (s: string) => key(s).replace(/[.,;:!?'"«»()]/g, ' ').replace(/[-–—]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Every place a text could mean: by its name or any other name, word for word first, then with spelling levelled.
 * Two villages of one name are told apart by what follows a comma, as GEDCOM writes places: "Ivanovka, Tver
 * Governorate" is the Ivanovka that belongs to it.
 */
export function placeMatches(text: string, places: Place[]): Place[] {
  if (!text.trim()) return []
  const { exact, loose } = nameIndex(places)
  let hits = exact.get(key(text)) ?? exact.get(placeKey(text)) ?? loose.get(looseKey(text)) ?? loose.get(looseKey(placeKey(text))) ?? []
  const rest = text.split(',').slice(1).map(looseKey).filter(Boolean)
  if (hits.length > 1 && rest.length) {
    const above = (p: Place) => placeChain(p, places).slice(1).flatMap((x) => [x.name, ...x.otherNames.map((n) => n.name)]).map(looseKey)
    const fits = (n: string, r: string) => n === r || n.startsWith(`${r} `) || r.startsWith(`${n} `)
    const narrowed = hits.filter((p) => rest.every((r) => above(p).some((n) => fits(n, r))))
    if (narrowed.length) hits = narrowed
  }
  return hits
}

/**
 * The record a place as written means, or null when no record answers to it or several do. A link saved with the
 * text (`id`) settles which of several it is, but only while that place still answers to the text: a text changed
 * since, by hand or by an older version of the app, no longer follows a link made for the old words.
 */
export function findPlace(text: string, places: Place[], id?: string | null): Place | null {
  if (!text.trim()) return null
  if (id) {
    const linked = nameIndex(places).byId.get(id)
    if (linked && answersTo(text, linked)) return linked
  }
  const hits = placeMatches(text, places)
  return hits.length === 1 ? hits[0] : null
}

/** Whether a place goes by the text written, whole or its first part, in any spelling. */
const answersTo = (text: string, p: Place) => {
  const names = [p.name, ...p.otherNames.map((n) => n.name)].map(looseKey)
  return names.includes(looseKey(text)) || names.includes(looseKey(placeKey(text)))
}

/** The link to keep beside a place as written: the one record it means, or none while it is unknown or ambiguous. */
export const placeLink = (text: string, places: Place[], id?: string | null): string | null => findPlace(text, places, id)?.id ?? null

/**
 * Every name of every place, looked up instead of searched: the map asks for each event of each life, and a search
 * through the whole list each time took seconds once an archive had thousands of places. Built once per list.
 */
const indexes = new WeakMap<Place[], { exact: Map<string, Place[]>; loose: Map<string, Place[]>; byId: Map<string, Place> }>()
function nameIndex(places: Place[]) {
  let ix = indexes.get(places)
  if (ix) return ix
  ix = { exact: new Map(), loose: new Map(), byId: new Map() }
  const put = (m: Map<string, Place[]>, k: string, p: Place) => { const list = m.get(k) ?? m.set(k, []).get(k)!; if (!list.includes(p)) list.push(p) }
  for (const p of places) {
    ix.byId.set(p.id, p)
    for (const n of [p.name, ...p.otherNames.map((o) => o.name)]) { put(ix.exact, key(n), p); put(ix.loose, looseKey(n), p) }
  }
  indexes.set(places, ix)
  return ix
}

/** The place and what it belonged to, from small to large. */
export function placeChain(place: Place, places: Place[]): Place[] {
  const byId = new Map(places.map((p) => [p.id, p]))
  const chain = [place]
  for (let at = place.parentId; at && chain.length < 12; ) {
    const up = byId.get(at)
    if (!up || chain.includes(up)) break
    chain.push(up)
    at = up.parentId
  }
  return chain
}

/** Every word a place answers to, its own names and those of what it belonged to: for search. */
export const placeWords = (text: string, places: Place[], id?: string | null) => {
  // Two villages of one name and no choice made: a search should find the person by either's region.
  const found = findPlace(text, places, id)
  const hits = found ? [found] : placeMatches(text, places)
  return [...new Set(hits.flatMap((p) => placeChain(p, places)))].flatMap((x) => [x.name, ...x.otherNames.map((n) => n.name)]).join(' ')
}

export interface PlaceUse { text: string; people: string[]; /** The record this text was linked to, when one was chosen. */ placeId?: string | null }

/**
 * The places the archive mentions, as written, with who they are about: births, deaths, facts, marriages. One text
 * linked to two different villages is two uses, so each finds its own record.
 */
export function placesInUse(graph: Graph): PlaceUse[] {
  const uses = new Map<string, { text: string; placeId: string | null; people: Set<string> }>()
  const add = (text: string, placeId: string | null | undefined, id: string) => {
    if (!text.trim()) return
    const k = `${key(text)}|${placeId ?? ''}`
    const u = uses.get(k) ?? { text: text.trim(), placeId: placeId ?? null, people: new Set<string>() }
    u.people.add(id)
    uses.set(k, u)
  }
  for (const p of graph.persons) {
    if (p.hidden) continue
    add(p.birthPlace, p.birthPlaceId, p.id)
    add(p.deathPlace, p.deathPlaceId, p.id)
    for (const f of p.facts) add(f.place, f.placeId, p.id)
  }
  for (const u of graph.unions) { add(u.place, u.placeId, u.aId); add(u.place, u.placeId, u.bId) }
  return [...uses.values()].map((u) => ({ text: u.text, people: [...u.people], ...(u.placeId ? { placeId: u.placeId } : {}) })).sort((a, b) => b.people.length - a.people.length || a.text.localeCompare(b.text))
}

/**
 * A place with a point the map can stand on: a latitude and longitude in range, and not 0,0 — the empty point that
 * imports and hurried edits leave behind, which sits in the Gulf of Guinea and is nobody's birthplace.
 */
export const onMap = (p: Place | null): p is Place & { lat: number; lon: number } =>
  !!p && p.lat !== null && p.lon !== null && Number.isFinite(p.lat) && Number.isFinite(p.lon) &&
  Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && !(p.lat === 0 && p.lon === 0)

/** Coordinates that are written but cannot be a place on the map: out of range, or 0,0. */
export const badCoords = (p: Place) => p.lat !== null && p.lon !== null && !onMap(p)

export type CoordIssueKind = 'range' | 'zero' | 'swapped' | 'sea'
/** What a typed point can get wrong, and whether that stops the save. */
export interface CoordIssue { kind: CoordIssueKind; block: boolean }
export type LandAt = (lat: number, lon: number) => boolean

/** A point is stored to the metre at most; six decimals keep a pasted pair from showing a tail of digits. */
const round6 = (n: number) => Math.round(n * 1e6) / 1e6

/** The side of the world as people write it after the degrees: Latin N, S, E, W and the Cyrillic letters beside them. */
const NORTH = 'N\u0421', SOUTH = 'S\u042E', EAST = 'E\u0412', WEST = 'W\u0417'
/** One half of a point: degrees, minutes and seconds, and the letter naming the side of the world. */
const DMS = new RegExp(`(-?\\d+(?:[.,]\\d+)?)\\s*(?:°\\s*(?:(\\d+(?:[.,]\\d+)?)\\s*'?\\s*(?:(\\d+(?:[.,]\\d+)?)\\s*")?)?)?\\s*([${NORTH}${SOUTH}${EAST}${WEST}])?`, 'g')
const SIDE = (letter: string) => (NORTH.includes(letter) ? 'n' : SOUTH.includes(letter) ? 's' : EAST.includes(letter) ? 'e' : WEST.includes(letter) ? 'w' : null)

/** Degrees with minutes and seconds, each half carrying its own letter: "55°45′N 37°37′E". */
function dmsPair(s: string): [number, number] | null {
  const atoms: { value: number; side: string | null }[] = []
  let at = 0
  DMS.lastIndex = 0
  for (let m = DMS.exec(s); m; m = DMS.exec(s)) {
    if (!/^[\s,;]*$/.test(s.slice(at, m.index))) return null
    const deg = Number(m[1].replace(',', '.')), min = m[2] ? Number(m[2].replace(',', '.')) : 0, sec = m[3] ? Number(m[3].replace(',', '.')) : 0
    if (min >= 60 || sec >= 60) return null
    atoms.push({ value: Math.sign(deg || 1) * (Math.abs(deg) + min / 60 + sec / 3600), side: m[4] ? SIDE(m[4]) : null })
    at = m.index + m[0].length
  }
  if (atoms.length !== 2 || !/^[\s,;]*$/.test(s.slice(at))) return null
  let lat: number | null = null, lon: number | null = null
  const plain: number[] = []
  for (const a of atoms) {
    if (!a.side) { plain.push(a.value); continue }
    if (a.side === 'n' || a.side === 's') lat = a.side === 's' ? -Math.abs(a.value) : Math.abs(a.value)
    else lon = a.side === 'w' ? -Math.abs(a.value) : Math.abs(a.value)
  }
  if (lat !== null && lon !== null) return [lat, lon]
  if (plain.length === 2) return [plain[0], plain[1]]
  if (plain.length !== 1) return null
  return lat === null ? [plain[0], lon!] : [lat, plain[0]]
}

/**
 * Two plain numbers: "55.7558, 37.6173". A comma between digits is a decimal mark unless the number already has one,
 * so a person typing "56,86" keeps the comma as the decimal mark they meant.
 */
function plainPair(s: string): [number, number] | null {
  const parts: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i], digit = c >= '0' && c <= '9'
    if (digit) { cur += c; continue }
    if (c === '-' && !cur) { cur = '-'; continue }
    if ((c === '.' || c === ',') && /\d$/.test(cur) && /\d/.test(s[i + 1] ?? '') && !/[.,]/.test(cur)) { cur += c; continue }
    if ((c === '.' || c === ',') && !cur) return null
    if (/[\s,;.]/.test(c)) { if (cur) { parts.push(cur); cur = '' } continue }
    return null
  }
  if (cur) parts.push(cur)
  if (parts.length !== 2) return null
  const nums = parts.map((p) => Number(p.replace(',', '.')))
  return nums.every(Number.isFinite) ? [nums[0], nums[1]] : null
}

/**
 * A point pasted into one field, as two numbers: "55.7558, 37.6173" or "55°45′N 37°37′E". Null for a single
 * number, so what a person types into one field by hand is left where it is.
 */
export function parseCoords(text: string): { lat: number; lon: number } | null {
  const s = text.trim().replace(/[−–—]/g, '-').replace(/[’′`]/g, "'").replace(/[″”“]/g, '"').toUpperCase()
  if (!s) return null
  const pair = new RegExp(`[°${NORTH}${SOUTH}${EAST}${WEST}]`).test(s) ? dmsPair(s) : plainPair(s)
  return pair && { lat: round6(pair[0]), lon: round6(pair[1]) }
}

/**
 * What is wrong with a point typed by hand. Out of range and 0,0 cannot be right, so the save stops; a swap and the
 * open sea may still be what the person meant — a ship, an island — so they are said out loud and let through.
 */
export function coordinateIssue(lat: number | null, lon: number | null, onLand?: LandAt | null): CoordIssue | null {
  if (lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (lat === 0 && lon === 0) return { kind: 'zero', block: true }
  // A pole-sized first number beside one that fits a latitude is the pair written the other way round.
  if (Math.abs(lat) > 90 && Math.abs(lat) <= 180 && Math.abs(lon) <= 90) return { kind: 'swapped', block: true }
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return { kind: 'range', block: true }
  if (!onLand || onLand(lat, lon)) return null
  if (Math.abs(lon) <= 90 && onLand(lon, lat)) return { kind: 'swapped', block: false }
  return { kind: 'sea', block: false }
}

export interface LifeStop { place: Place & { lat: number; lon: number }; date: string; what: string; withId: string | null }

/** What is written on a life that the little map cannot draw, and why. */
export interface UnplacedStop { text: string; what: string; date: string; why: 'unknown' | 'no-coords' | 'no-date' | 'ambiguous' }

/**
 * Why a place as written cannot be put on a map: the archive has no such place, or its point was never
 * filled in. Null when it can be drawn, and for an empty field, which is no place rather than a wrong one.
 */
export const placeProblem = (text: string, places: Place[], id?: string | null): 'unknown' | 'no-coords' | 'ambiguous' | null => {
  if (!text.trim()) return null
  const place = findPlace(text, places, id)
  // Two records answer and nothing says which: the person picks one, the map does not guess.
  if (!place) return placeMatches(text, places).length > 1 ? 'ambiguous' : 'unknown'
  return onMap(place) ? null : 'no-coords'
}

/**
 * Places written in a file being imported that the map cannot use yet: unknown to the archive, or without
 * coordinates. Named once each, so a preview says "these will not be on the map" rather than repeating a town.
 */
export function placesOffMap(texts: string[], places: Place[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const text of texts) {
    const value = text.trim()
    const k = placeKey(value)
    if (!value || seen.has(k) || !placeProblem(value, places)) continue
    seen.add(k)
    out.push(value)
  }
  return out
}

interface RawStop { text: string; placeId: string | null; date: string; what: string; withId: string | null; order: number; year: number | null }

/** Everything written on a life that names a place, in the order the life reads: birth, the rest, death. */
function lifeRawStops(person: Person, graph: Graph): RawStop[] {
  const byId = new Map(graph.persons.map((p) => [p.id, p]))
  const raw: RawStop[] = []
  const add = (text: string, placeId: string | null | undefined, date: string, what: string, order: number, withId: string | null = null) => { if (text.trim()) raw.push({ text, placeId: placeId ?? null, date, what, order, withId, year: yearOf(date) }) }
  add(person.birthPlace, person.birthPlaceId, person.birthDate, 'Рождение', 0)
  for (const u of graph.unions) {
    if (u.aId !== person.id && u.bId !== person.id) continue
    const other = byId.get(u.aId === person.id ? u.bId : u.aId)
    add(u.place, u.placeId, u.startDate, u.kind === 'civil' ? 'Союз' : 'Брак', 1, other && !other.hidden ? other.id : null)
  }
  for (const f of person.facts) add(f.place, f.placeId, f.date, f.kind, 1)
  add(person.deathPlace, person.deathPlaceId, person.deathDate, 'Смерть', 2)
  // Birth first and death last whatever their dates; a stop with no date goes just before death.
  const key = (r: RawStop) => (r.order === 0 ? -Infinity : r.order === 2 ? Infinity : r.year ?? Number.MAX_SAFE_INTEGER)
  return raw.sort((a, b) => key(a) - key(b))
}

/** Birth and death keep their place in a life without a date; anything between needs its year to be put in order. */
const undated = (r: RawStop) => r.order === 1 && r.year === null

/**
 * Where one life went, in order, as far as the places written on it have a point on a map: birth,
 * marriages, facts, death. The same place twice in a row is one stop.
 */
export function lifeStops(person: Person, graph: Graph, places: Place[]): LifeStop[] {
  const out: LifeStop[] = []
  for (const r of lifeRawStops(person, graph)) {
    const place = findPlace(r.text, places, r.placeId)
    if (!onMap(place)) continue
    // A move with no year has no place in the order of a life: the map with a clock leaves it out, so this one does
    // too, rather than guessing it in just before the death. The card lists it with the reason.
    if (undated(r)) continue
    if (out.at(-1)?.place.id === place.id) continue
    out.push({ place, date: r.date, what: r.what, withId: r.withId })
  }
  return out
}

/**
 * The stops of a life the map leaves out, in the same order and without repeats: a place the archive does
 * not have, or one whose point was never filled in. The card can then say why a move is not on the map.
 */
export function unplacedStops(person: Person, graph: Graph, places: Place[]): UnplacedStop[] {
  const out: UnplacedStop[] = []
  // An undated stop at a place the route reaches anyway is no missing place: the town is on the map.
  const drawn = new Set(lifeStops(person, graph, places).map((s) => s.place.id))
  for (const r of lifeRawStops(person, graph)) {
    const why = placeProblem(r.text, places, r.placeId) ?? (undated(r) && !drawn.has(findPlace(r.text, places, r.placeId)!.id) ? 'no-date' : null)
    if (!why) continue
    const text = r.text.trim()
    if (out.some((u) => u.text.toLowerCase() === text.toLowerCase() && u.why === why)) continue
    out.push({ text, what: r.what, date: r.date, why })
  }
  return out
}

export interface MapSpot { place: Place & { lat: number; lon: number }; people: string[] }

/** Every place with a point on a map, with who is born, married, lived or died there. */
export function mapSpots(graph: Graph, places: Place[]): MapSpot[] {
  const spots = new Map<string, MapSpot>()
  for (const use of placesInUse(graph)) {
    const place = findPlace(use.text, places, use.placeId)
    if (!onMap(place)) continue
    const spot = spots.get(place.id) ?? { place, people: [] }
    for (const id of use.people) if (!spot.people.includes(id)) spot.people.push(id)
    spots.set(place.id, spot)
  }
  for (const p of places) if (onMap(p) && !spots.has(p.id)) spots.set(p.id, { place: p, people: [] })
  return [...spots.values()].sort((a, b) => b.people.length - a.people.length)
}

/** How far apart two points may be and still be one place written twice, in kilometres. */
const SAME_SPOT_KM = 2

/**
 * Records that are probably one place entered twice: one name (in any spelling) under the same parent, or two
 * points closer than 2 km with a shared name. Offered to be merged; never merged without a person saying so.
 */
export function similarPlaces(all: Place[]): [Place, Place][] {
  const loose = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const names = (p: Place) => new Set([p.name, ...p.otherNames.map((n) => n.name)].map(loose))
  const km = (a: Place, b: Place) => {
    if (a.lat === null || a.lon === null || b.lat === null || b.lon === null) return Infinity
    const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r
    return 6371 * 2 * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2))
  }
  const out: [Place, Place][] = []
  const byName = new Map<string, Place[]>()
  for (const p of all) for (const n of names(p)) byName.set(n, [...(byName.get(n) ?? []), p])
  const seen = new Set<string>()
  for (const group of byName.values()) {
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const [a, b] = group[i].id < group[j].id ? [group[i], group[j]] : [group[j], group[i]]
      const k = `${a.id}|${b.id}`
      if (seen.has(k)) continue
      if (a.parentId === b.parentId || km(a, b) < SAME_SPOT_KM) { seen.add(k); out.push([a, b]) }
    }
  }
  return out
}

export const PLACE_KINDS = ['Деревня', 'Село', 'Посёлок', 'Город', 'Приход', 'Волость', 'Уезд', 'Губерния', 'Район', 'Область', 'Страна']
