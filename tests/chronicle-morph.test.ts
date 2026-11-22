// A zone's front moving between two dated outlines: distance fields, the mix, the traced edge, and the steps a zone
// stands at. Plain shapes in map pixels only.
import { describe, expect, it } from 'vitest'
import { area, contour, morphAt, morphStep, prepare, rasterise, signedDistance, STEPS, type FlatPolygon, type Loops } from '../lib/chronicle-morph'
import type { Stage } from '../lib/chronicle'

const square = (x: number, y: number, d: number): FlatPolygon => [[x, y, x + d, y, x + d, y + d, x, y + d]]
/** The area the loops enclose, holes taken away (even-odd: a loop inside another is a hole). */
const total = (l: Loops) => {
  const span = (k: number): [number, number] => [2 * l.starts[k], k + 1 < l.starts.length ? 2 * l.starts[k + 1] : l.xy.length]
  const inside = (x: number, y: number, [from, to]: [number, number]) => {
    let c = false
    for (let i = from, j = to - 2; i < to; j = i, i += 2) if ((l.xy[i + 1] > y) !== (l.xy[j + 1] > y) && x < l.xy[i] + ((y - l.xy[i + 1]) / (l.xy[j + 1] - l.xy[i + 1])) * (l.xy[j] - l.xy[i])) c = !c
    return c
  }
  let s = 0
  for (let k = 0; k < l.starts.length; k++) {
    const [from, to] = span(k)
    let depth = 0
    for (let m = 0; m < l.starts.length; m++) if (m !== k && inside(l.xy[from], l.xy[from + 1], span(m))) depth++
    s += (depth % 2 ? -1 : 1) * Math.abs(area(l.xy, from, to))
  }
  return s
}
const xsOf = (l: Loops) => Array.from(l.xy).filter((_, i) => i % 2 === 0)

describe('signed distance', () => {
  it('is negative inside, positive outside, and grows by one a grid step', () => {
    const g = { x0: 0, y0: 0, cell: 1, w: 20, h: 20 }
    const sdf = signedDistance(rasterise([square(5, 5, 9.5)], g), 20, 20)
    expect(sdf[10 * 20 + 10]).toBeLessThan(0)
    expect(sdf[1 * 20 + 10]).toBeGreaterThan(0)
    // Grid x 2, 3 lie 3.5 and 2.5 steps outside the square's left side at 5 (the edge half way, at 4.5 on the grid).
    expect(sdf[10 * 20 + 2]).toBeCloseTo(2.5, 5)
    expect(sdf[10 * 20 + 3]).toBeCloseTo(1.5, 5)
    expect(sdf[10 * 20 + 7] - sdf[10 * 20 + 8]).toBeCloseTo(1, 5)
  })

  it('traces a square back as a square of the same size', () => {
    const p = prepare([square(10, 10, 20)], [square(10, 10, 20)])
    expect(p.same).toBe(true)
    const q = prepare([square(10, 10, 20)], [square(10, 10, 21)], 128)
    const l = contour(q.a, q.grid)
    expect(l.starts.length).toBe(1)
    expect(total(l)).toBeGreaterThan(400 * 0.93)
    expect(total(l)).toBeLessThan(400 * 1.07)
  })
})

describe('a front between two stages', () => {
  // A square of 10 growing to one of 30 with the same lower left corner.
  const small = square(0, 0, 10), big = square(0, 0, 30)
  const p = prepare([small], [big], 256)

  it('at half way, covers an area between the two, and its far edge stands between the two edges', () => {
    const half = morphAt(p, STEPS / 2, 0)
    const a = total(half)
    expect(a).toBeGreaterThan(100 * 1.5)
    expect(a).toBeLessThan(900 * 0.9)
    const right = Math.max(...xsOf(half))
    expect(right).toBeGreaterThan(17)
    expect(right).toBeLessThan(23)
  })

  it('grows at every step, never fading: the edge moves out step by step', () => {
    let last = 0, lastRight = 0
    for (let q = 0; q <= STEPS; q += 8) {
      const l = morphAt(p, q, 0)
      const a = total(l), right = Math.max(...xsOf(l))
      expect(a).toBeGreaterThan(last)
      expect(right).toBeGreaterThan(lastRight)
      last = a; lastRight = right
    }
    expect(Math.max(...xsOf(morphAt(p, 0, 0)))).toBeCloseTo(10, 0)
    expect(Math.max(...xsOf(morphAt(p, STEPS, 0)))).toBeCloseTo(30, 0)
  })

  it('never leaves the room between the two stages', () => {
    for (let q = 1; q < STEPS; q += 7) {
      const l = morphAt(p, q, 0)
      for (let i = 0; i < l.xy.length; i += 2) {
        expect(l.xy[i]).toBeGreaterThan(-0.5); expect(l.xy[i]).toBeLessThan(30.5)
        expect(l.xy[i + 1]).toBeGreaterThan(-0.5); expect(l.xy[i + 1]).toBeLessThan(30.5)
      }
    }
  })

  it('two blobs grow into one', () => {
    const two = prepare([square(0, 0, 8), square(20, 0, 8)], [[[0, 0, 28, 0, 28, 8, 0, 8]]], 256)
    expect(morphAt(two, 0, 0).starts.length).toBe(2)
    expect(morphAt(two, STEPS, 0).starts.length).toBe(1)
    const counts = Array.from({ length: STEPS + 1 }, (_, q) => morphAt(two, q, 0).starts.length)
    // Two, then one from the moment they meet on: they never split again.
    const first = counts.indexOf(1)
    expect(first).toBeGreaterThan(0)
    expect(counts.slice(first).every((c) => c === 1)).toBe(true)
  })

  it('keeps an island both stages share out of the grid, drawn as it is', () => {
    const island = square(500, 500, 3)
    const q = prepare([small, island], [big, island], 256)
    expect(q.still).toEqual([island])
    // The grid covers the moving square only, so it is fine: 256 points over 30, not over 503.
    expect(q.grid.cell).toBeLessThan(0.15)
  })

  it('a hole closes as the stage around it fills', () => {
    const ring: FlatPolygon = [[0, 0, 30, 0, 30, 30, 0, 30], [10, 10, 20, 10, 20, 20, 10, 20]]
    const r = prepare([ring], [square(0, 0, 30)], 256)
    expect(morphAt(r, 0, 0).starts.length).toBe(2)
    expect(morphAt(r, STEPS, 0).starts.length).toBe(1)
    expect(total(morphAt(r, 0, 0))).toBeLessThan(total(morphAt(r, 16, 0)))
  })
})

describe('a front moving up to the sea', () => {
  // The land is a 20 × 20 square (the war's whole territory, another zone); the advancing side holds its west part.
  const land = [square(0, 0, 20)]
  /** Where the mix at step q changes sign along the row at height y, from the west: the front's x there. */
  const frontX = (p: ReturnType<typeof prepare>, q: number, y: number) => {
    const g = p.grid, j = Math.round((y - g.y0) / g.cell), u = q / STEPS
    for (let i = 1; i < g.w; i++) {
      const at = (k: number) => (1 - u) * p.a[j * g.w + k] + u * p.b[j * g.w + k] - p.grow
      if (at(i - 1) < 0 && at(i) >= 0) return g.x0 + i * g.cell
    }
    return NaN
  }

  it('moves as a straight front: by the coast as far as inland, no strip of coast left behind', () => {
    const p = prepare([[[0, 0, 6, 0, 6, 20, 0, 20]]], [[[0, 0, 14, 0, 14, 20, 0, 20]]], 256, [land])
    for (const q of [16, 32, 48]) {
      const mid = frontX(p, q, 10), coast = frontX(p, q, 0.4)
      expect(Math.abs(mid - coast)).toBeLessThan(0.5)
      expect(mid).toBeGreaterThan(6 + (8 * q) / STEPS - 1)
      expect(mid).toBeLessThan(6 + (8 * q) / STEPS + 1)
    }
  })

  it('without the land, the coast holds the front back: why the land is passed', () => {
    const p = prepare([[[0, 0, 6, 0, 6, 20, 0, 20]]], [[[0, 0, 14, 0, 14, 20, 0, 20]]], 256)
    expect(frontX(p, 32, 10) - frontX(p, 32, 0.4)).toBeGreaterThan(2)
  })

  it('sweeps the whole land evenly when the last stage holds all of it', () => {
    const p = prepare([[[0, 0, 5, 0, 5, 20, 0, 20]]], [square(0, 0, 20)], 256, [land])
    const xs = [16, 32, 48].map((q) => frontX(p, q, 10))
    expect(xs[0]).toBeGreaterThan(7); expect(xs[0]).toBeLessThan(11)
    expect(xs[1]).toBeGreaterThan(11); expect(xs[1]).toBeLessThan(14)
    expect(xs[2]).toBeGreaterThan(14.5); expect(xs[2]).toBeLessThan(18)
  })
})

describe('the step a zone stands at', () => {
  const st = (at: string, year: number, extra: Partial<Stage> = {}): Stage => ({ at, year, outline: { type: 'Polygon', coordinates: [] }, ...extra })
  const a = st('1856', 1856), b = st('1857', 1857), c = st('1858', 1858, { hold: true }), d = st('1859', 1859)
  const zone = { stages: [a, b, c, d] }

  it('is nothing before the first stage', () => expect(morphStep(zone, 1855.9)).toBeNull())
  it('is a stage on its own at its date', () => expect(morphStep(zone, 1856)).toEqual({ a }))
  it('is a step of the way between two stages', () => expect(morphStep(zone, 1856.5)).toEqual({ a, b, q: STEPS / 2 }))
  it('rounds to the next stage on its own just before its date', () => expect(morphStep(zone, 1856.999)).toEqual({ a: b }))
  it('holds a stage that holds, whole, until the next', () => expect(morphStep(zone, 1858.6)).toEqual({ a: c }))
  it('stands at the last stage after it', () => expect(morphStep(zone, 1950)).toEqual({ a: d }))
})
