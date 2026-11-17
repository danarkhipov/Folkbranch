// What the map shows, chosen by the viewer as layers, as map apps keep them: people, event marks, routes, which past
// moves stay, and which kinds of event count at all (births, marriages, moves, work, deaths). A preference of this
// device, remembered in this browser, not of the archive.
import { useSyncExternalStore } from 'react'
import type { EventKind } from './map-timeline'

export interface Layers {
  /** Faces of people on the map. */
  people: boolean
  /** Marks for events as they happen. */
  events: boolean
  /** Lines of journeys, past and under way. */
  trails: boolean
  /** Each person's last move, or every move so far. */
  routes: 'recent' | 'all'
  /** Kinds of event left out: no place of that kind is used, for the mark or for where a person stands. */
  hidden: EventKind[]
}

export const KINDS: EventKind[] = ['birth', 'union', 'move', 'work', 'death', 'other']
export const DEFAULT_LAYERS: Layers = { people: true, events: true, trails: true, routes: 'recent', hidden: [] }
const KEY = 'folkbranch.map.layers'
const listeners = new Set<() => void>()

/** What was saved, read back safely: anything unknown or damaged falls back to the default for that part. */
export function parseLayers(raw: string | null): Layers {
  let j: Partial<Layers> = {}
  try { j = raw ? JSON.parse(raw) : {} } catch { /* a damaged value is the default */ }
  const flag = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
  const hidden = Array.isArray(j.hidden) ? KINDS.filter((k) => (j.hidden as unknown[]).includes(k)) : []
  const l: Layers = {
    people: flag(j.people, true), events: flag(j.events, true), trails: flag(j.trails, true),
    routes: j.routes === 'all' ? 'all' : 'recent',
    // At least one kind stays: a map of nothing is not a choice anyone means.
    hidden: hidden.length >= KINDS.length ? [] : hidden,
  }
  // Faces or marks, never neither.
  return l.people || l.events ? l : { ...l, people: true }
}

let current: Layers | null = null
function read(): Layers {
  if (!current) { try { current = parseLayers(localStorage.getItem(KEY)) } catch { current = DEFAULT_LAYERS } }
  return current
}
/** Changes some layers and tells every listener; kept in this browser when it lets us. */
export function setLayers(patch: Partial<Layers>) {
  current = parseLayers(JSON.stringify({ ...read(), ...patch }))
  try { localStorage.setItem(KEY, JSON.stringify(current)) } catch { /* private window: kept for this page only */ }
  for (const l of listeners) l()
}
/** Back to the default: everything on, the last moves, every kind of event. */
export const resetLayers = () => setLayers(DEFAULT_LAYERS)
/** Whether anything differs from the default, for the button to say so. */
export const isChanged = (l: Layers) => JSON.stringify(l) !== JSON.stringify(DEFAULT_LAYERS)

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const useLayers = () => useSyncExternalStore(subscribe, read, () => DEFAULT_LAYERS)
