import { describe, expect, it } from 'vitest'
import { BASE_MS, msAt, schedule, totalMs, yearAtMs, yearWeights } from '../lib/map-pacing'
import type { TimedStop, Track } from '../lib/map-timeline'

const stop = (year: number, lat: number, lon: number, kind: TimedStop['kind'] = 'move'): TimedStop => ({ lat, lon, place: `${lat}`, year, time: year, date: String(year), what: kind, kind })
const track = (stops: TimedStop[]): Track => ({ personId: 'x', name: 'x', born: stops[0].year, died: null, living: false, stops })
// Born in Madrid 1860, sails to Buenos Aires, arriving 1889; nothing else happens until 1960.
const sailor = track([stop(1860, 40.42, -3.7, 'birth'), stop(1889, -34.6, -58.38)])

describe('the pace of playback', () => {
  it('gives the years of a journey time, and quiet years none', () => {
    const w = yearWeights([sailor], 1850, 1960)
    expect(w[1889 - 1850]).toBeGreaterThan(w[1860 - 1850])
    expect(w[1888 - 1850]).toBeGreaterThan(0)
    expect(w[1870 - 1850]).toBe(0)
  })
  it('squeezes a long empty stretch, and never makes a year longer than the cap', () => {
    const s = schedule([sailor], 1850, 1960)
    const yearMs = (y: number) => msAt(s, y + 1) - msAt(s, y)
    expect(yearMs(1888)).toBeGreaterThan(yearMs(1875))
    // 1890–1960 is empty: 71 years in about 1.5 s.
    expect(msAt(s, 1961) - msAt(s, 1890)).toBeLessThanOrEqual(1500 + 1e-6)
    expect(Math.max(...s.start.slice(1).map((v, i) => v - s.start[i]))).toBeLessThanOrEqual(BASE_MS * 8)
    expect(totalMs(s)).toBe(s.start.at(-1))
  })
  it('maps playback time to true years and back', () => {
    const s = schedule([sailor], 1850, 1960)
    for (const y of [1850, 1861.25, 1888.5, 1889, 1930.9]) expect(yearAtMs(s, msAt(s, y))).toBeCloseTo(y, 9)
    expect(yearAtMs(s, -5)).toBe(1850)
    expect(yearAtMs(s, 1e12)).toBe(1961)
  })
  it('plays a big family in about the time of a small one', () => {
    const small = [sailor, track([stop(1870, 41.15, 1.1, 'birth'), stop(1900, 48.85, 2.35)])]
    const big = Array.from({ length: 150 }, (_, i) => small[i % 2])
    const a = totalMs(schedule(small, 1850, 1960)), b = totalMs(schedule(big, 1850, 1960))
    expect(b / a).toBeLessThan(1.6)
  })
})
