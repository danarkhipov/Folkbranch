import { describe, expect, it } from 'vitest'
import { drawGhost, legTooFar, recentInk, type TrailState } from '../components/map-trails'
import { leader, marksAt } from '../lib/map-layout'
import { mercator } from '../lib/map-motion'
import type { Track } from '../lib/map-timeline'

/** A canvas context that only records what a drawing pass did. */
function recorder() {
  const rec = {
    strokes: 0, fills: 0, alphas: [] as number[], xs: [] as number[], ys: [] as number[],
    setTransform() {}, clearRect() {}, beginPath() {}, closePath() {}, arc() {}, moveTo() {}, lineTo(x: number, y: number) { rec.xs.push(x); rec.ys.push(y) },
    stroke() { rec.strokes++; rec.alphas.push((rec as unknown as { globalAlpha: number }).globalAlpha) },
    fill() { rec.fills++ },
    strokeStyle: '', fillStyle: '', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', globalAlpha: 1,
  }
  return rec
}
type Ctx = ReturnType<typeof recorder>

const view = (ctx: Ctx, zoom: number, at: [number, number] = [0, 0]) => {
  const scale = 2 ** zoom
  const center = mercator(at)
  return { ctx: ctx as unknown as CanvasRenderingContext2D, scale, ox: center[0] * scale - 720, oy: center[1] * scale - 450, w: 1440, h: 900, dpr: 1 }
}

const track = (id: string, a: [number, number], b: [number, number], years: [number, number]): Track => ({
  personId: id, name: id, born: years[0], died: null, living: false,
  stops: [
    { lat: a[0], lon: a[1], place: 'a', year: years[0], date: String(years[0]), what: 'Birth', kind: 'birth', time: years[0] },
    { lat: b[0], lon: b[1], place: 'b', year: years[1], date: String(years[1]), what: 'Residence', kind: 'move', time: years[1] },
  ],
})
const state = (tracks: Track[], year: number): TrailState => ({ tracks, year, positions: new Map(), pulses: [], ink: '#2a2620', focus: null, line: null })

describe('the ghost of finished journeys', () => {
  it('draws every journey in one stroke, so shared routes cannot add up to black', () => {
    const ctx = recorder()
    // Two people took exactly the same way: drawn leg by leg, the ink would be laid twice (0.3 + 0.3).
    const a = track('a', [0, 0], [0, 1], [1900, 1901])
    const b = track('b', [0, 0], [0, 1], [1900, 1901])
    drawGhost(view(ctx, 6), state([a, b], 2000))
    expect(ctx.strokes).toBe(1)
    // And the whole pass is at the ghost's own, capped ink.
    expect(Math.max(...ctx.alphas)).toBeLessThanOrEqual(0.3)
  })

  it('leaves a leg that crosses the whole view out of a city view, but keeps it in the world view', () => {
    const local = track('local', [0, 0], [0, 0.05], [1900, 1901])
    const crossing = track('crossing', [0, -70], [0, 70], [1900, 1901])
    const near = recorder()
    drawGhost(view(near, 8.5), state([local, crossing], 2000))
    // Only the town's own traffic: no line spanning the continent.
    expect(Math.max(...near.xs) - Math.min(...near.xs)).toBeLessThan(200)
    const far = recorder()
    drawGhost(view(far, 3), state([local, crossing], 2000))
    // From the whole world, the same crossing is part of the pattern.
    expect(Math.max(...far.xs) - Math.min(...far.xs)).toBeGreaterThan(500)
  })

  it('quiets every recent trail as more of them share the screen, and keeps a lone one dark', () => {
    expect(recentInk(1)).toBe(1)
    expect(recentInk(4)).toBe(1)
    expect(recentInk(9)).toBeLessThan(1)
    expect(recentInk(40)).toBeLessThan(recentInk(9))
    expect(recentInk(0)).toBe(1)
  })

  it('knows a long leg from a local one, and only when the eye is close in', () => {
    const box: [number, number, number, number] = [0, 0, 1000, 10]
    expect(legTooFar(box, view(recorder(), 3))).toBe(false)
    expect(legTooFar(box, view(recorder(), 8.5))).toBe(true)
    expect(legTooFar([0, 0, 5, 2], view(recorder(), 8.5))).toBe(false)
  })
})

describe('a mark moved aside from its place', () => {
  it('gives the hairline back to the place: its length and the way it points', () => {
    expect(leader(9, 0).moved).toBe(true)
    expect(leader(9, 0).len).toBeCloseTo(9)
    expect(Math.abs(leader(9, 0).angle)).toBeCloseTo(Math.PI)
    expect(leader(0, 27).angle).toBeCloseTo(-Math.PI / 2)
    expect(leader(0, 0)).toEqual({ len: 0, angle: 0, moved: false })
    // The place is the far end of a line drawn from a mark moved (dx, dy).
    expect(leader(-20, 40).len).toBeCloseTo(Math.hypot(20, 40))
  })

  it('shows event marks only when they can be read, or when events are all that is shown', () => {
    expect(marksAt('people', 8.5)).toBe(false)
    expect(marksAt('both', 3.25)).toBe(false)
    expect(marksAt('both', 5)).toBe(true)
    expect(marksAt('events', 3.25)).toBe(true)
  })
})
