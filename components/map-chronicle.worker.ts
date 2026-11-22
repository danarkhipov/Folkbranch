// The chronicle's moving fronts, worked out off the page's thread (lib/chronicle-morph.ts): each stage-to-stage move is
// laid on its grid once, then its edge is traced step by step, the step the page asks for first and the ones around it
// next, each sent as soon as it is ready. Small pieces of work, one per turn, so a newer ask is heard between them.
import { morphAt, prepare, STEPS, type FlatPolygon, type Prepared } from '@/lib/chronicle-morph'

type In =
  | { type: 'want'; id: number; q: number; a?: FlatPolygon[]; b?: FlatPolygon[]; others?: FlatPolygon[][] }
  | { type: 'soon'; id: number; a: FlatPolygon[]; b: FlatPolygon[]; others: FlatPolygon[][] }

interface Job { id: number; a: FlatPolygon[]; b: FlatPolygon[]; others: FlatPolygon[][]; prep: Prepared | null; done: Uint8Array; left: number; q: number }

const scope = self as unknown as { postMessage: (m: unknown, t?: Transferable[]) => void; onmessage: ((e: MessageEvent<In>) => void) | null }
const jobs = new Map<number, Job>()
/** The move the page shows now, first; then the ones it will show next, oldest ask first. */
let current: number | null = null
const later: number[] = []
let pumping = false

function jobOf(id: number, a?: FlatPolygon[], b?: FlatPolygon[], others: FlatPolygon[][] = []): Job | null {
  let j = jobs.get(id)
  if (!j && a && b) { j = { id, a, b, others, prep: null, done: new Uint8Array(STEPS + 1), left: STEPS - 1, q: 1 }; jobs.set(id, j) }
  return j ?? null
}

/** The next step to trace: the one asked for, then outwards from it, a little ahead first (playback runs forward). */
function nextStep(j: Job): number {
  for (let d = 0; d <= STEPS; d++) for (const q of [j.q + d, j.q - d]) if (q > 0 && q < STEPS && !j.done[q]) return q
  return -1
}

function work(j: Job) {
  if (!j.prep) {
    j.prep = prepare(j.a, j.b, undefined, j.others)
    const still = j.prep.same ? j.a : j.prep.still
    scope.postMessage({ type: 'still', id: j.id, same: j.prep.same, still })
    if (j.prep.same) { j.left = 0; j.prep = null }
    return
  }
  const q = nextStep(j)
  if (q < 0) return
  const l = morphAt(j.prep, q)
  j.done[q] = 1
  // Once every step is out, the grid is no longer needed.
  if (--j.left === 0) j.prep = null
  scope.postMessage({ type: 'step', id: j.id, q, xy: l.xy, starts: l.starts }, [l.xy.buffer, l.starts.buffer])
}

function pump() {
  pumping = false
  let j = current !== null ? jobs.get(current) : undefined
  if (!j || j.left === 0) {
    while (later.length && (jobs.get(later[0])?.left ?? 0) === 0) later.shift()
    j = later.length ? jobs.get(later[0]) : undefined
  }
  if (!j || j.left === 0) return
  try { work(j) } catch (e) { scope.postMessage({ type: 'error', id: j.id, error: (e as Error).message }); j.left = 0; j.prep = null }
  schedule()
}
const schedule = () => { if (!pumping) { pumping = true; setTimeout(pump, 0) } }

scope.onmessage = (e) => {
  // A dedicated worker hears only the page that made it; this says so, and ignores a message from any other origin.
  if (e.origin && e.origin !== (self as unknown as { location: { origin: string } }).location.origin) return
  const m = e.data
  const j = jobOf(m.id, m.a, m.b, m.others)
  if (!j) return
  if (m.type === 'want') { j.q = m.q; current = m.id }
  else if (!later.includes(m.id)) later.push(m.id)
  schedule()
}
// Listening from here on: the page holds what it asks until it hears this.
scope.postMessage({ type: 'ready' })
