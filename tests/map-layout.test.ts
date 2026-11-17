import { describe, expect, it } from 'vitest'
import { aheadPoints, cameraCall } from '../lib/map-camera'
import { freeOffset, ringOffset, stackSpots, Taken } from '../lib/map-layout'
import type { Track } from '../lib/map-timeline'

describe('where faces and words go', () => {
  it('stacks towns that touch on screen, and a small zoom does not make faces hop', () => {
    const at = (k: number) => [{ key: 'a', x: 0, y: 0, n: 3 }, { key: 'b', x: 30 * k, y: 0, n: 1 }, { key: 'c', x: 300, y: 0, n: 2 }]
    const one = stackSpots(at(1))
    expect([...one]).toEqual([['a', 'a'], ['c', 'c'], ['b', 'a']])
    // Zoomed in a little: b is now 45 px away, but stays in a's stack; far enough, it leaves.
    expect(stackSpots(at(1.5), one).get('b')).toBe('a')
    expect(stackSpots(at(1.5)).get('b')).toBe('b')
    expect(stackSpots(at(2), one).get('b')).toBe('b')
  })
  it('places labels greedily, never over what is taken', () => {
    const t = new Taken()
    t.add([0, 0, 10, 10])
    expect(t.first([[5, 5, 15, 15], [10, 0, 20, 10]])).toBe(1)
    expect(t.first([[0, 0, 4, 4]])).toBe(-1)
  })
  it('spreads a crowded town in a ring that grows with the crowd', () => {
    expect(ringOffset(0, 1)).toEqual([0, 0])
    expect(ringOffset(0, 4)[1]).toBeLessThan(0)
    expect(Math.hypot(...ringOffset(0, 12))).toBeGreaterThan(Math.hypot(...ringOffset(0, 4)))
  })
  it('moves the camera only when someone would leave the safe box, or all sit in a corner of it', () => {
    const safe: [number, number, number, number] = [0, 0, 1000, 600]
    expect(cameraCall([[100, 100], [900, 500]], safe)).toBeNull()
    expect(cameraCall([[100, 100], [1100, 500]], safe)).toBe('widen')
    expect(cameraCall([[500, 300], [520, 310]], safe)).toBe('close')
    expect(cameraCall([], safe)).toBeNull()
  })
  it('looks ahead to both ends and the middle of a journey about to start', () => {
    const sailor: Track = { personId: 's', name: 's', born: 1860, died: null, living: false, stops: [
      { lat: 40.42, lon: -3.7, place: 'Madrid', year: 1860, time: 1860, date: '1860', what: 'Birth', kind: 'birth' },
      { lat: -34.6, lon: -58.38, place: 'Buenos Aires', year: 1889, time: 1889, date: '1889', what: 'Moved', kind: 'move' }] }
    // In 1880 nobody is moving yet; looking ahead to 1888 already includes Buenos Aires.
    expect(aheadPoints([sailor], 1880, 1880).every(([lat]) => lat > 0)).toBe(true)
    expect(aheadPoints([sailor], 1880, 1888).some(([lat]) => lat < -30)).toBe(true)
  })
})

describe('a mark whose place is covered', () => {
  it('stays put when free, else moves to the nearest free spot above, below, then beside', () => {
    const t = new Taken()
    expect(freeOffset(t, [0, 0, 16, 16])).toEqual([0, 0])
    t.add([0, 0, 16, 16])
    expect(freeOffset(t, [4, 2, 20, 18])).toEqual([0, -20])
    t.add([4, -18, 20, -2])
    expect(freeOffset(t, [4, 2, 20, 18])).toEqual([0, 20])
  })
})
