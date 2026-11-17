import { describe, expect, it } from 'vitest'
import { along, BOW, distanceKm, easeInOut, easeInOutInverse, legPath, mercator, straight, unmercator, wrapLon } from '../lib/map-motion'

const reus: [number, number] = [41.15, 1.1], tarragona: [number, number] = [41.12, 1.25]
const madrid: [number, number] = [40.42, -3.7], baires: [number, number] = [-34.6, -58.38]

describe('how people travel', () => {
  it('projects like Leaflet at zoom 0', () => {
    expect(mercator([0, 0])).toEqual([128, 128])
    expect(mercator([0, 180])[0]).toBe(256)
    expect(mercator([85.06, 0])[1]).toBeCloseTo(0, 1)
  })
  it('eases slow at both ends, and the inverse undoes it', () => {
    expect([easeInOut(0), easeInOut(0.5), easeInOut(1)]).toEqual([0, 0.5, 1])
    expect(easeInOut(0.1)).toBeLessThan(0.1)
    expect(easeInOut(0.9)).toBeGreaterThan(0.9)
    for (const u of [0.05, 0.3, 0.5, 0.71, 0.99]) expect(easeInOutInverse(easeInOut(u))).toBeCloseTo(u, 9)
  })
  it('goes from stop to stop nearly straight, bowed a little, and ends exactly at both', () => {
    for (const [from, to] of [[madrid, [40.71, -74.0]], [madrid, baires], [reus, tarragona]] as [[number, number], [number, number]][]) {
      const line = straight(from, to)
      expect(line[0]).toEqual(from)
      expect(line.at(-1)).toEqual(to)
      // No point strays from the line between the two ends by more than the bow: no swing across the globe.
      const [ax, ay] = mercator(from), [bx, by] = mercator(to), len = Math.hypot(bx - ax, by - ay)
      for (const pt of line) {
        const [x, y] = mercator(pt)
        expect(Math.abs((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / len).toBeLessThanOrEqual(BOW * len + 1e-9)
      }
    }
    // Madrid to New York no longer swings north of both towns.
    expect(Math.max(...straight(madrid, [40.71, -74.0]).map((p) => p[0]))).toBeLessThan(45)
    expect(distanceKm(madrid, baires)).toBeGreaterThan(10000)
    expect(unmercator(mercator([55.75, 37.62]))[0]).toBeCloseTo(55.75, 9)
  })
  it('bows there and back to opposite sides, so a return trip does not hide under the way out', () => {
    const there = straight(reus, tarragona), back = straight(tarragona, reus)
    const side = (pts: [number, number][]) => { const [ax, ay] = mercator(reus), [bx, by] = mercator(tarragona), [x, y] = mercator(pts[8]); return Math.sign((bx - ax) * (y - ay) - (by - ay) * (x - ax)) }
    expect(side(there)).not.toBe(0)
    expect(side(back)).toBe(-side(there))
  })
  it('travels evenly by length along the line', () => {
    const p = legPath(madrid, baires)
    expect(along(p, 0)).toEqual(madrid)
    expect(along(p, 1)).toEqual(p.pts.at(-1))
    const w = [0, 0.25, 0.5, 0.75, 1].map((s) => mercator(along(p, s)))
    const steps = w.slice(1).map((q, i) => Math.hypot(q[0] - w[i][0], q[1] - w[i][1]))
    for (const s of steps) expect(s / steps[0]).toBeCloseTo(1, 1)
  })
  it('takes the short way over the 180° meridian, and the traveller ends on the place itself', () => {
    const tokyo: [number, number] = [35.68, 139.69], sf: [number, number] = [37.77, -122.42]
    const p = legPath(tokyo, sf)
    expect(p.wraps).toBe(1)
    // East over the Pacific: the way runs on past 180°, never back across Asia and the Atlantic.
    expect(Math.min(...p.pts.map((x) => x[1]))).toBeGreaterThan(139)
    const hop = legPath([0, 179.5], [0, -179.5])
    expect(Math.max(...hop.pts.map((x) => x[1])) - Math.min(...hop.pts.map((x) => x[1]))).toBeLessThan(2)
    expect(wrapLon(along(p, 1)[1])).toBeCloseTo(-122.42, 6)
    expect([wrapLon(200), wrapLon(-200), wrapLon(180), wrapLon(-12)]).toEqual([-160, 160, 180, -12])
  })
})
