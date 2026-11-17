import { describe, expect, it } from 'vitest'
import { along, bow, distanceKm, easeInOut, easeInOutInverse, greatCircle, legPath, mercator, wrapLon } from '../lib/map-motion'

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
  it('goes the great circle on a long leg, and ends exactly at both stops', () => {
    const gc = greatCircle(madrid, [40.71, -74.0])
    expect(gc[0]).toEqual(madrid)
    expect(gc.at(-1)).toEqual([40.71, -74.0])
    // Madrid to New York arcs north of both ends.
    expect(Math.max(...gc.map((p) => p[0]))).toBeGreaterThan(45)
    const legPathLong = legPath(madrid, baires)
    expect(legPathLong.pts.length).toBe(65)
    expect(distanceKm(madrid, baires)).toBeGreaterThan(10000)
  })
  it('bows a short leg to the left of the way, so there and back do not overlap', () => {
    expect(distanceKm(reus, tarragona)).toBeLessThan(800)
    const there = bow(reus, tarragona), back = bow(tarragona, reus)
    expect(there[0]).toEqual(reus)
    expect(there.at(-1)).toEqual(tarragona)
    // Going east, left is north; going back west, left is south.
    expect(there[16][0]).toBeGreaterThan((reus[0] + tarragona[0]) / 2)
    expect(back[16][0]).toBeLessThan((reus[0] + tarragona[0]) / 2)
  })
  it('travels evenly by length along the curve', () => {
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
