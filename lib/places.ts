// What a place written on a card means: the record for it, the levels above it, and every name it went by.
import { yearOf, type Graph, type Person, type Place } from './types'

const key = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()
/** The first part is the place itself; what follows a comma is usually what it belonged to. */
export const placeKey = (text: string) => key(text.split(',')[0] ?? '')

/** The record for a place as written, by its name or any of its other names. */
export function findPlace(text: string, places: Place[]): Place | null {
  if (!text.trim()) return null
  const whole = key(text), first = placeKey(text)
  const names = (p: Place) => [p.name, ...p.otherNames.map((n) => n.name)].map(key)
  return places.find((p) => names(p).includes(whole)) ?? places.find((p) => names(p).includes(first)) ?? null
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
export const placeWords = (text: string, places: Place[]) => {
  const p = findPlace(text, places)
  return p ? placeChain(p, places).flatMap((x) => [x.name, ...x.otherNames.map((n) => n.name)]).join(' ') : ''
}

export interface PlaceUse { text: string; people: string[] }

/** The places the archive mentions, as written, with who they are about: births, deaths, facts, marriages. */
export function placesInUse(graph: Graph): PlaceUse[] {
  const uses = new Map<string, { text: string; people: Set<string> }>()
  const add = (text: string, id: string) => {
    if (!text.trim()) return
    const k = key(text)
    const u = uses.get(k) ?? { text: text.trim(), people: new Set<string>() }
    u.people.add(id)
    uses.set(k, u)
  }
  for (const p of graph.persons) {
    if (p.hidden) continue
    add(p.birthPlace, p.id)
    add(p.deathPlace, p.id)
    for (const f of p.facts) add(f.place, p.id)
  }
  for (const u of graph.unions) { add(u.place, u.aId); add(u.place, u.bId) }
  return [...uses.values()].map((u) => ({ text: u.text, people: [...u.people] })).sort((a, b) => b.people.length - a.people.length || a.text.localeCompare(b.text))
}

/** A place with its point on a map. */
export const onMap = (p: Place | null): p is Place & { lat: number; lon: number } => !!p && p.lat !== null && p.lon !== null

export interface LifeStop { place: Place & { lat: number; lon: number }; date: string; what: string; withId: string | null }

/**
 * Where one life went, in order, as far as the places written on it have a point on a map: birth,
 * marriages, facts, death. The same place twice in a row is one stop.
 */
export function lifeStops(person: Person, graph: Graph, places: Place[]): LifeStop[] {
  const byId = new Map(graph.persons.map((p) => [p.id, p]))
  const raw: (Omit<LifeStop, 'place'> & { text: string; order: number; year: number | null })[] = []
  const add = (text: string, date: string, what: string, order: number, withId: string | null = null) => { if (text.trim()) raw.push({ text, date, what, order, withId, year: yearOf(date) }) }
  add(person.birthPlace, person.birthDate, 'Рождение', 0)
  for (const u of graph.unions) {
    if (u.aId !== person.id && u.bId !== person.id) continue
    const other = byId.get(u.aId === person.id ? u.bId : u.aId)
    add(u.place, u.startDate, u.kind === 'civil' ? 'Союз' : 'Брак', 1, other && !other.hidden ? other.id : null)
  }
  for (const f of person.facts) add(f.place, f.date, f.kind, 1)
  add(person.deathPlace, person.deathDate, 'Смерть', 2)
  // Birth first and death last whatever their dates; a stop with no date goes just before death.
  const key = (r: (typeof raw)[number]) => (r.order === 0 ? -Infinity : r.order === 2 ? Infinity : r.year ?? Number.MAX_SAFE_INTEGER)
  raw.sort((a, b) => key(a) - key(b))
  const out: LifeStop[] = []
  for (const r of raw) {
    const place = findPlace(r.text, places)
    if (!onMap(place)) continue
    if (out.at(-1)?.place.id === place.id) continue
    out.push({ place, date: r.date, what: r.what, withId: r.withId })
  }
  return out
}

export interface MapSpot { place: Place & { lat: number; lon: number }; people: string[] }

/** Every place with a point on a map, with who is born, married, lived or died there. */
export function mapSpots(graph: Graph, places: Place[]): MapSpot[] {
  const spots = new Map<string, MapSpot>()
  for (const use of placesInUse(graph)) {
    const place = findPlace(use.text, places)
    if (!onMap(place)) continue
    const spot = spots.get(place.id) ?? { place, people: [] }
    for (const id of use.people) if (!spot.people.includes(id)) spot.people.push(id)
    spots.set(place.id, spot)
  }
  for (const p of places) if (onMap(p) && !spots.has(p.id)) spots.set(p.id, { place: p, people: [] })
  return [...spots.values()].sort((a, b) => b.people.length - a.people.length)
}

export const PLACE_KINDS = ['Деревня', 'Село', 'Посёлок', 'Город', 'Приход', 'Волость', 'Уезд', 'Губерния', 'Район', 'Область', 'Страна']
