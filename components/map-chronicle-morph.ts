// The page's side of the moving fronts: asks the chronicle's worker for each stage-to-stage move and keeps every traced
// step it sends back. Drawing never waits: it takes the nearest step already here, and where none is (the first
// moments of a move, or a browser whose worker cannot start or fails) the caller cross-fades the two stages instead.
import { STEPS, type FlatPolygon, type Loops } from '@/lib/chronicle-morph'
import type { MultiPolygon, Polygon, Stage } from '@/lib/chronicle'
import { mercator } from '@/lib/map-motion'

interface Move { id: number; failed: boolean; same: boolean; asked: number; still: FlatPolygon[] | null; steps: Map<number, Loops> }
/** What a move looks like at a step: polygons that never move, and the traced edge. */
export interface MorphShape { still: FlatPolygon[]; loops: Loops; q: number }

const moves = new WeakMap<Stage, Map<Stage, Move>>()
const byId = new Map<number, Move>()
let nextId = 1
/** The worker: null until asked for, false once it cannot be had (then every move cross-fades). */
let worker: Worker | null | false = null
const listeners = new Set<() => void>()
let ready = false
const queue: unknown[] = []
const post = (w: Worker, msg: unknown) => { if (ready) w.postMessage(msg); else queue.push(msg) }

/** Called whenever a new step comes in, so the map can draw again if it shows that move. */
export function onMorph(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } }

/** A stage's polygons in the map's own pixels at zoom 0, outside rings one way round and holes the other. */
const flats = new WeakMap<Stage, FlatPolygon[]>()
export function flatOf(st: Stage): FlatPolygon[] {
  let f = flats.get(st)
  if (!f) {
    const o: Polygon | MultiPolygon = st.outline
    const polys = o.type === 'Polygon' ? [o.coordinates] : o.coordinates
    f = polys.map((p) => p.map((r, k) => {
      const flat = r.flatMap(([lon, lat]) => mercator([lat, lon]))
      let s = 0
      for (let i = 0, j = flat.length - 2; i < flat.length; j = i, i += 2) s += flat[j] * flat[i + 1] - flat[i] * flat[j + 1]
      // So that the two stages' rings together, filled non-zero, cover what either one covers.
      if ((s > 0) !== (k === 0)) {
        const rev: number[] = []
        for (let i = flat.length - 2; i >= 0; i -= 2) rev.push(flat[i], flat[i + 1])
        return rev
      }
      return flat
    }))
    flats.set(st, f)
  }
  return f
}

function start(): Worker | false {
  if (worker !== null) return worker
  if (typeof Worker === 'undefined') return (worker = false)
  try { worker = new Worker(new URL('./map-chronicle.worker.ts', import.meta.url), { type: 'module' }) } catch { return (worker = false) }
  worker.onmessage = ({ data }) => {
    // The worker says when it listens: what was asked before that waits, rather than being lost while it loads.
    if (data.type === 'ready') { const w = worker; ready = true; if (w) for (const msg of queue.splice(0)) w.postMessage(msg); return }
    const m = byId.get(data.id)
    if (!m) return
    if (data.type === 'still') { m.still = data.still; m.same = data.same }
    else if (data.type === 'step') m.steps.set(data.q, { xy: data.xy, starts: data.starts })
    else if (data.type === 'error') m.failed = true
    listeners.forEach((fn) => fn())
  }
  // A worker that cannot start or breaks: every move cross-fades from then on, as it did before fronts moved.
  worker.onerror = fail
  return worker
}
function fail() { if (worker) worker.terminate(); worker = false; queue.length = 0; listeners.forEach((fn) => fn()) }

function moveOf(a: Stage, b: Stage): { m: Move; fresh: boolean } {
  let to = moves.get(a)
  if (!to) moves.set(a, (to = new Map()))
  let m = to.get(b)
  const fresh = !m
  if (!m) { m = { id: nextId++, failed: false, same: false, asked: -1, still: null, steps: new Map() }; to.set(b, m); byId.set(m.id, m) }
  return { m, fresh }
}

/**
 * Asks for step q of the move from a to b, first; the geometry goes along the first time, with `others`, the stages of
 * the entry's other zones (where its land ends: lib/chronicle-morph.ts, prepare).
 */
export function wantMorph(a: Stage, b: Stage, q: number, others: Stage[]) {
  const w = start()
  if (!w) return
  const { m, fresh } = moveOf(a, b)
  if (m.failed || m.same || m.asked === q || (m.steps.has(q) && !fresh)) return
  m.asked = q
  post(w, fresh ? { type: 'want', id: m.id, q, a: flatOf(a), b: flatOf(b), others: others.map(flatOf) } : { type: 'want', id: m.id, q })
}

/** Asks for a move the map will show next, worked out once the one shown now is done. */
export function soonMorph(a: Stage, b: Stage, others: Stage[]) {
  const w = start()
  if (!w) return
  const { m, fresh } = moveOf(a, b)
  if (fresh) post(w, { type: 'soon', id: m.id, a: flatOf(a), b: flatOf(b), others: others.map(flatOf) })
}

const NONE: Loops = { xy: new Float64Array(), starts: new Uint32Array() }
/** The move at the nearest step already traced, or null: then the caller cross-fades. */
export function morphShape(a: Stage, b: Stage, q: number): MorphShape | null {
  if (!worker) return null
  const m = moves.get(a)?.get(b)
  if (!m || m.failed || !m.still) return null
  // Two stages of one shape: nothing moves, the shape stands as it is.
  if (m.same) return { still: m.still, loops: NONE, q }
  for (let d = 0; d <= STEPS; d++) for (const k of [q - d, q + d]) { const l = m.steps.get(k); if (l) return { still: m.still, loops: l, q: k } }
  return null
}
