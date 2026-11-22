// How long each year lasts when the map plays: quiet years pass quickly, years with journeys get time. Only playback
// is warped; the timeline always shows true years. Pure, so the same schedule plays, scrubs and tests alike.
import { trackLegs, type Track } from './map-timeline'

/** A quiet year at 1×, in ms. */
export const BASE_MS = 520
/** Every year lasts at least this many base units, however quiet. */
const FLOOR = 1
/** What one event adds to its year: an arrival somewhere new most, any other event a little, a journey under way some. */
const ARRIVAL = 1.6, EVENT = 0.35, TRAVEL = 1.2
/** A typical busy year weighs this much, and a family is never thought busier than this per year. */
const TYPICAL_WEIGHT = 2.5, TYPICAL_MIN = 2
/** No year lasts longer than this many base units, however busy. */
const CAP = 7
/** A run of empty years together never lasts longer than this at 1×. */
const GAP_MS = 1500

/** A stretch of history the map plays slower through, such as a moving front: each year it touches weighs at least `weight`. */
export interface Era { from: number; to: number; weight: number }

export interface Schedule { min: number; max: number; /** ms at the start of each year from min, and one more for the end. */ start: number[] }

/** How busy each year is, from min to max (one number per year). */
export function yearWeights(tracks: Track[], min: number, max: number): number[] {
  // An empty or backwards span has no years, rather than an array of negative length.
  const w = new Array<number>(Math.max(0, max - min + 1)).fill(0)
  const add = (year: number, v: number) => { const i = Math.floor(year) - min; if (i >= 0 && i < w.length) w[i] += v }
  for (const tr of tracks) {
    for (const st of tr.stops) add(st.year, EVENT)
    for (const leg of trackLegs(tr)) {
      add(leg.arrive, ARRIVAL - EVENT)
      // The years spent on the way get time too, so a crossing is watched, not skipped.
      for (let y = Math.floor(leg.leave); y < leg.arrive; y++) add(y, TRAVEL * (Math.min(y + 1, leg.arrive) - Math.max(y, leg.leave)))
    }
  }
  // Busy is relative to the family: a big archive has events every year, so a year is weighed against the family's
  // own typical busy year (the upper quartile), and the length of playback hardly grows with the number of people.
  const busy = w.filter((v) => v > 0).sort((a, b) => a - b)
  const typical = Math.max(TYPICAL_MIN, busy[Math.floor(busy.length * 0.75)] ?? 0)
  return w.map((v) => Math.min(CAP, (v / typical) * TYPICAL_WEIGHT))
}

/** The schedule for a span: each year lasts BASE × (FLOOR + weight); a long empty stretch is squeezed to GAP_MS. */
export function schedule(tracks: Track[], min: number, max: number, eras: Era[] = []): Schedule {
  const w = yearWeights(tracks, min, max)
  // A year inside an era is never quieter than the era asks, even with nobody moving: the front moves instead.
  for (const e of eras) for (let i = Math.max(0, Math.floor(e.from) - min); i < w.length && min + i < e.to; i++) w[i] = Math.max(w[i], e.weight)
  const ms = w.map((v) => BASE_MS * (FLOOR + v))
  for (let i = 0; i < w.length;) {
    if (w[i] > 0) { i++; continue }
    let j = i
    while (j < w.length && w[j] === 0) j++
    const each = Math.min(BASE_MS * FLOOR, GAP_MS / (j - i))
    for (let k = i; k < j; k++) ms[k] = each
    i = j
  }
  const start = [0]
  for (const d of ms) start.push(start.at(-1)! + d)
  return { min, max, start }
}

/** Where in the playback (ms at 1×) a moment is. */
export function msAt(s: Schedule, year: number): number {
  const i = Math.floor(year) - s.min
  if (i < 0) return 0
  if (i >= s.start.length - 1) return s.start.at(-1)!
  return s.start[i] + (s.start[i + 1] - s.start[i]) * (year - Math.floor(year))
}

/** The moment shown at a point of the playback (ms at 1×): the inverse of msAt. */
export function yearAtMs(s: Schedule, ms: number): number {
  const { start } = s
  if (ms <= 0) return s.min
  if (ms >= start.at(-1)!) return s.max + 1
  let lo = 0, hi = start.length - 1
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (start[mid] <= ms) lo = mid; else hi = mid }
  return s.min + lo + (ms - start[lo]) / (start[lo + 1] - start[lo])
}

/** The whole playback at 1×, in ms. */
export const totalMs = (s: Schedule) => s.start.at(-1)!
