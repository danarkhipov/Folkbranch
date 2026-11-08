// What a place written on a card means: the record for it, the levels above it, and every name it went by.
import type { Graph, Place } from './types'

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

export const PLACE_KINDS = ['Деревня', 'Село', 'Посёлок', 'Город', 'Приход', 'Волость', 'Уезд', 'Губерния', 'Район', 'Область', 'Страна']
