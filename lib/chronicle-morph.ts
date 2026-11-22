// A zone's front sliding from one dated outline to the next, rather than one outline fading into the other.
// Pure and DOM-free: the chronicle's worker runs it (components/map-chronicle.worker.ts), the tests run it here.
//
// How: both outlines are laid on one grid over the part of the map where they differ, each as a signed distance field
// (how far every grid point is from the outline's edge, negative inside). At a share u of the way from one date to the
// next the two fields are mixed, (1 − u)·A + u·B, and the new edge is where the mix is zero, traced with marching
// squares. A point inside both outlines stays inside at every u and a point outside both stays outside, so the moving
// edge never leaves the room between the two outlines: a front that only grows only grows.
import { zoneBlend, type Stage, type Zone } from './chronicle'

/** A polygon as rings of flat x, y pairs in the map's own pixels at zoom 0; the first ring is the outside. */
export type FlatPolygon = number[][]
/** Closed loops: `xy` holds every loop's points one after another, `starts` where each loop begins. */
export interface Loops { xy: Float64Array; starts: Uint32Array }
export interface Grid { x0: number; y0: number; cell: number; w: number; h: number }

/** Steps a stage-to-stage move is cut into: the edge is traced once per step and kept. */
export const STEPS = 64
/** Grid points along the long side of the room the front moves in. */
export const GRID_LONG = 512

/** Where a zone stands at a moment, in whole steps: a stage on its own, or a step of the way from one to the next. */
export type MorphStep = { a: Stage; b?: undefined; q?: undefined } | { a: Stage; b: Stage; q: number }

/**
 * The zone at a moment as morph steps: null before its first stage; a held or last stage on its own; between two
 * stages, the step of the way (0 < q < STEPS). A step that rounds to either end is that stage on its own.
 */
export function morphStep(zone: Pick<Zone, 'stages'>, y: number): MorphStep | null {
  const bl = zoneBlend(zone, y)
  if (!bl) return null
  if (!bl.b) return { a: bl.a }
  const q = Math.round(bl.u * STEPS)
  if (q <= 0) return { a: bl.a }
  if (q >= STEPS) return { a: bl.b }
  return { a: bl.a, b: bl.b, q }
}

/** Every grid point inside the polygons (even-odd, as the map fills them): 1 inside, 0 outside. */
export function rasterise(polys: FlatPolygon[], g: Grid): Uint8Array {
  const mask = new Uint8Array(g.w * g.h)
  const xs: number[] = []
  for (let j = 0; j < g.h; j++) {
    const y = g.y0 + j * g.cell
    xs.length = 0
    for (const poly of polys) for (const r of poly) {
      const n = r.length / 2
      for (let k = 0, m = n - 1; k < n; m = k++) {
        const ya = r[2 * m + 1], yb = r[2 * k + 1]
        if ((ya > y) === (yb > y)) continue
        const xa = r[2 * m], xb = r[2 * k]
        xs.push(xa + ((y - ya) / (yb - ya)) * (xb - xa))
      }
    }
    if (xs.length < 2) continue
    xs.sort((p, q) => p - q)
    const row = j * g.w
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - g.x0) / g.cell)), i1 = Math.min(g.w - 1, Math.floor((xs[k + 1] - g.x0) / g.cell))
      for (let i = i0; i <= i1; i++) mask[row + i] ^= 1
    }
  }
  return mask
}

const INF = 1e20
/** Felzenszwalb and Huttenlocher's exact distance transform along one line, squared distances in place. */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0
  v[0] = 0; z[0] = -INF; z[1] = INF
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]) }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF
  }
  k = 0
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]] }
}

/** For every grid point, the squared distance in grid steps to the nearest point where `from` holds. */
function edt(from: (i: number) => boolean, w: number, h: number): Float64Array {
  const out = new Float64Array(w * h)
  const n = Math.max(w, h)
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1)
  for (let i = 0; i < w * h; i++) out[i] = from(i) ? 0 : INF
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) f[j] = out[j * w + i]
    edt1d(f, h, d, v, z)
    for (let j = 0; j < h; j++) out[j * w + i] = d[j]
  }
  for (let j = 0; j < h; j++) {
    const row = j * w
    for (let i = 0; i < w; i++) f[i] = out[row + i]
    edt1d(f, w, d, v, z)
    for (let i = 0; i < w; i++) out[row + i] = d[i]
  }
  return out
}

/**
 * The signed distance, in grid steps, from each grid point to the edge of the shape `mask` draws: negative inside,
 * positive outside, the edge half way between an inside point and an outside one.
 *
 * With `land`, only the edge between the shape and the rest of the land counts: a point inside measures to the nearest
 * land outside it, not to the sea, and a point off the land (sea) counts as inside.
 */
export function signedDistance(mask: Uint8Array, w: number, h: number, land?: Uint8Array): Float32Array {
  const toIn = edt((i) => mask[i] === 1, w, h)
  const toOut = edt(land ? (i) => land[i] === 1 && mask[i] === 0 : (i) => mask[i] === 0, w, h)
  const out = new Float32Array(w * h)
  const far = Math.hypot(w, h)
  for (let i = 0; i < w * h; i++) {
    const inside = mask[i] === 1 || (land !== undefined && land[i] === 0)
    out[i] = inside ? -(Math.min(far, Math.sqrt(toOut[i])) - 0.5) : Math.min(far, Math.sqrt(toIn[i])) - 0.5
  }
  return out
}

/**
 * A stage with no front on the land (it holds all of it, or none) has no edge to move from: its field is the other
 * stage's, moved by the farthest distance in it, so the front sweeps the land evenly over the whole move.
 */
function frontless(f: Float32Array, other: Float32Array, land: Uint8Array | undefined) {
  let pos = false, neg = false, most = 0, least = 0
  for (let i = 0; i < f.length; i++) {
    if (land && !land[i]) continue
    if (f[i] > 0) pos = true; else neg = true
    most = Math.max(most, other[i]); least = Math.min(least, other[i])
  }
  if (pos && neg) return
  for (let i = 0; i < f.length; i++) f[i] = pos ? other[i] - least + 1 : other[i] - most - 1
}

/**
 * The zero edge of a field on the grid, as closed loops in map pixels (marching squares, the saddle settled by the
 * square's middle). Points on the grid's border count as outside, so every loop closes.
 */
export function contour(field: Float32Array, g: Grid): Loops {
  const { w, h } = g
  const val = (i: number, j: number) => (i <= 0 || j <= 0 || i >= w - 1 || j >= h - 1 ? 1 : field[j * w + i] || 1e-9)
  // A crossing lives on a grid edge: horizontal edge (i, j)–(i+1, j) is j·w + i, vertical (i, j)–(i, j+1) is w·h + j·w + i.
  const H = w * h
  const nb0 = new Int32Array(2 * H).fill(-1), nb1 = new Int32Array(2 * H).fill(-1)
  const link = (p: number, q: number) => {
    if (nb0[p] < 0) nb0[p] = q; else nb1[p] = q
    if (nb0[q] < 0) nb0[q] = p; else nb1[q] = p
  }
  for (let j = 0; j + 1 < h; j++) for (let i = 0; i + 1 < w; i++) {
    const a = val(i, j), b = val(i + 1, j), c = val(i + 1, j + 1), d = val(i, j + 1)
    const k = (a < 0 ? 1 : 0) | (b < 0 ? 2 : 0) | (c < 0 ? 4 : 0) | (d < 0 ? 8 : 0)
    if (k === 0 || k === 15) continue
    const top = j * w + i, bottom = (j + 1) * w + i, left = H + j * w + i, right = H + j * w + i + 1
    switch (k) {
      case 1: case 14: link(left, top); break
      case 2: case 13: link(top, right); break
      case 3: case 12: link(left, right); break
      case 4: case 11: link(right, bottom); break
      case 6: case 9: link(top, bottom); break
      case 7: case 8: link(left, bottom); break
      case 5: case 10: {
        const mid = (a + b + c + d) / 4
        // Corners a and c share a sign: joined through the middle when the middle has it too.
        const joined = (mid < 0) === (a < 0)
        if (k === 5) { if (joined) { link(left, bottom); link(top, right) } else { link(left, top); link(right, bottom) } }
        else { if (joined) { link(left, top); link(right, bottom) } else { link(left, bottom); link(top, right) } }
        break
      }
    }
  }
  const point = (e: number, out: number[]) => {
    if (e < H) {
      const j = Math.floor(e / w), i = e - j * w, a = val(i, j), b = val(i + 1, j), t = a / (a - b)
      out.push(g.x0 + (i + t) * g.cell, g.y0 + j * g.cell)
    } else {
      const f = e - H, j = Math.floor(f / w), i = f - j * w, a = val(i, j), b = val(i, j + 1), t = a / (a - b)
      out.push(g.x0 + i * g.cell, g.y0 + (j + t) * g.cell)
    }
  }
  const seen = new Uint8Array(2 * H)
  const xy: number[] = [], starts: number[] = []
  const loop: number[] = []
  for (let e0 = 0; e0 < 2 * H; e0++) {
    if (seen[e0] || nb0[e0] < 0) continue
    loop.length = 0
    let prev = -1, e = e0
    while (e >= 0 && !seen[e]) {
      seen[e] = 1
      point(e, loop)
      const next = nb0[e] !== prev ? nb0[e] : nb1[e]
      prev = e; e = next
    }
    const s = simplify(loop, g.cell * 0.3)
    // A speck under a grid square is no island.
    if (s.length >= 6 && Math.abs(area(s)) > g.cell * g.cell) { starts.push(xy.length / 2); for (const n of s) xy.push(n) }
  }
  return { xy: Float64Array.from(xy), starts: Uint32Array.from(starts) }
}

/** The signed area of a ring of flat x, y pairs. */
export function area(r: ArrayLike<number>, from = 0, to = r.length): number {
  let s = 0
  for (let k = from, m = to - 2; k < to; m = k, k += 2) s += r[m] * r[k + 1] - r[k] * r[m + 1]
  return s / 2
}

/** Douglas–Peucker on a closed ring: corners kept, points nearer than `tol` to the line between their neighbours gone. */
export function simplify(r: number[], tol: number): number[] {
  const n = r.length / 2
  if (n < 8) return r
  // Two anchors far apart, then each half on its own.
  let far = 0, best = -1
  for (let k = 1; k < n; k++) { const d = (r[2 * k] - r[0]) ** 2 + (r[2 * k + 1] - r[1]) ** 2; if (d > best) { best = d; far = k } }
  const keep = new Uint8Array(n)
  keep[0] = keep[far] = 1
  const t2 = tol * tol
  const stack: number[] = [0, far, far, n]
  while (stack.length) {
    const b = stack.pop()!, a = stack.pop()!
    const bi = b % n
    const ax = r[2 * a], ay = r[2 * a + 1], bx = r[2 * bi], by = r[2 * bi + 1]
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1e-30
    let worst = -1, at = -1
    for (let k = a + 1; k < b; k++) {
      const px = r[2 * k] - ax, py = r[2 * k + 1] - ay
      const c = px * dy - py * dx
      const d = (c * c) / len2
      if (d > worst) { worst = d; at = k }
    }
    if (at >= 0 && worst > t2) { keep[at] = 1; stack.push(a, at, at, b) }
  }
  const out: number[] = []
  for (let k = 0; k < n; k++) if (keep[k]) out.push(r[2 * k], r[2 * k + 1])
  return out
}

const boundsOf = (polys: FlatPolygon[]) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of polys) for (const r of p) for (let k = 0; k < r.length; k += 2) {
    x0 = Math.min(x0, r[k]); x1 = Math.max(x1, r[k]); y0 = Math.min(y0, r[k + 1]); y1 = Math.max(y1, r[k + 1])
  }
  return { x0, y0, x1, y1 }
}
type Box = ReturnType<typeof boundsOf>
const meets = (a: Box, b: Box) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1
const keyOf = (p: FlatPolygon) => p.map((r) => r.join(',')).join('|')

/** One stage-to-stage move made ready: the grid, both fields, and the polygons left out of it because they never move. */
export interface Prepared {
  /** The two stages are the same shape: nothing moves. */
  same: boolean
  grid: Grid
  a: Float32Array
  b: Float32Array
  /** Polygons both stages share, wholly outside the grid: drawn as they are at every step. */
  still: FlatPolygon[]
  /** Grid steps the traced edge is grown by before the caller clips it to the two stages. */
  grow: number
}

/**
 * Lays two stages on one grid over where they differ. Polygons both stages have point for point, away from the change
 * (an island that never changes hands), stay out of the grid, so the grid is as fine as the moving part allows.
 *
 * `others`, the outlines of the entry's other zones (a war's whole territory), say where the land the fronts fight
 * over ends. Beyond it (the sea, a neighbouring country) counts as inside both stages: a stage's coast is then no edge
 * of its field, only its front is, so a front moving up to the sea does not leave a strip of coast behind it. The
 * caller clips to the two stages, which puts the coast back. With no other zone nothing is known of the land, and the
 * stages are taken as they are.
 */
export function prepare(a: FlatPolygon[], b: FlatPolygon[], long = GRID_LONG, others: FlatPolygon[][] = []): Prepared {
  const inA = new Set(a.map(keyOf)), inB = new Set(b.map(keyOf))
  const all = [...a.map((p) => ({ p, shared: inB.has(keyOf(p)), box: boundsOf([p]) })), ...b.filter((p) => !inA.has(keyOf(p))).map((p) => ({ p, shared: false, box: boundsOf([p]) }))]
  const moving = all.filter((x) => !x.shared)
  if (!moving.length) return { same: true, grid: { x0: 0, y0: 0, cell: 1, w: 0, h: 0 }, a: new Float32Array(), b: new Float32Array(), still: a, grow: 0 }
  // The room: what moves, grown to take in whole any polygon it touches, so no polygon is cut at the grid's border.
  let room = boundsOf(moving.map((x) => x.p))
  const inside = new Set(moving)
  for (let grew = true; grew;) {
    grew = false
    for (const x of all) if (!inside.has(x) && meets(x.box, room)) {
      inside.add(x); grew = true
      room = { x0: Math.min(room.x0, x.box.x0), y0: Math.min(room.y0, x.box.y0), x1: Math.max(room.x1, x.box.x1), y1: Math.max(room.y1, x.box.y1) }
    }
  }
  const span = Math.max(room.x1 - room.x0, room.y1 - room.y0) || 1e-6
  const cell = span / (long - 8)
  // Four grid steps of margin all round: the border is outside, and every loop closes before it.
  const x0 = room.x0 - 4 * cell, y0 = room.y0 - 4 * cell
  const grid: Grid = { x0, y0, cell, w: Math.ceil((room.x1 - x0) / cell) + 5, h: Math.ceil((room.y1 - y0) / cell) + 5 }
  const keys = new Set([...inside].map((x) => keyOf(x.p)))
  const inGrid = (polys: FlatPolygon[]) => polys.filter((p) => keys.has(keyOf(p)))
  const ma = rasterise(inGrid(a), grid), mb = rasterise(inGrid(b), grid)
  let land: Uint8Array | undefined
  if (others.length) {
    // Each outline on its own (an outline is even-odd within itself, never across outlines), then all of them together.
    land = new Uint8Array(ma.length)
    for (const o of [...others, a, b]) { const m = rasterise(o, grid); for (let i = 0; i < m.length; i++) land[i] |= m[i] }
  }
  const fa = signedDistance(ma, grid.w, grid.h, land), fb = signedDistance(mb, grid.w, grid.h, land)
  frontless(fa, fb, land); frontless(fb, fa, land)
  // Where the land is known, the coast is the clip's: the front needs no growing. Otherwise a grid step of growth
  // carries the fill out to a coast both stages share.
  return { same: false, grid, a: fa, b: fb, still: a.filter((p) => !keys.has(keyOf(p))), grow: land ? 0.5 : 1 }
}

/**
 * The edge at step q of STEPS. The mix is grown a little (`grow`, grid steps), and the caller clips the result to the
 * two stages' own outlines: so where both share an edge (a coast), the fill ends on the true coast, not a grid step short.
 */
export function morphAt(p: Prepared, q: number, grow = p.grow): Loops {
  const u = q / STEPS, { a, b } = p, f = new Float32Array(a.length)
  for (let i = 0; i < f.length; i++) f[i] = (1 - u) * a[i] + u * b[i] - grow
  return contour(f, p.grid)
}
