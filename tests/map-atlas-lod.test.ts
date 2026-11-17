import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { type Geometry, levelStats, pickLevel, simplify } from '../components/map-atlas-draw'

describe('simplify', () => {
  it('drops a point within tol of the line and keeps the ends', () => {
    expect(simplify([[0, 0], [1, 0.05], [2, 0]], 0.1)).toEqual([[0, 0], [2, 0]])
  })

  it('keeps a spike larger than tol', () => {
    expect(simplify([[0, 0], [1, 0.5], [2, 0]], 0.1)).toEqual([[0, 0], [1, 0.5], [2, 0]])
  })

  it('keeps the first and last point even when tol removes everything between', () => {
    expect(simplify([[0, 0], [1, 0], [2, 0]], 10)).toEqual([[0, 0], [2, 0]])
  })
})

// A big square with a hole in it, and a sub-pixel island far away. Coordinates are [lon, lat].
const world: Geometry = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [[-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]],
      [[-5, -5], [5, -5], [5, 5], [-5, 5], [-5, -5]],
    ],
    [[[100, 40], [100.2, 40], [100.1, 40.2], [100, 40]]],
  ],
}

describe('levels of detail', () => {
  const stats = levelStats(world, true)
  const at = (scale: number) => stats.find((s) => s.scale === scale)!

  it('drops the island at zoom 0 and keeps it at full detail', () => {
    expect(at(1).units).toBe(1)
    expect(at(32).units).toBe(2)
  })

  it('keeps the hole in the square unit, not as a unit of its own', () => {
    // The square and its hole are five points each at zoom 0, and the island is gone.
    expect(at(1).points).toBe(10)
    expect(at(32).points).toBe(14)
  })

  it('never has fewer points at a finer level', () => {
    for (let i = 1; i < stats.length; i++) expect(stats[i].points).toBeGreaterThanOrEqual(stats[i - 1].points)
  })

  it('picks the most detailed level not coarser than the scale', () => {
    const levels = [1, 2, 4, 8, 16, 32, 64, 128, 256].map((scale) => ({ scale }))
    expect(pickLevel(levels, 0.5).scale).toBe(1)
    expect(pickLevel(levels, 3.5).scale).toBe(2)
    expect(pickLevel(levels, 1000).scale).toBe(256)
  })
})

describe('the real land file', () => {
  it('has under a quarter of its full-detail points at zoom 0', () => {
    const land = JSON.parse(readFileSync(fileURLToPath(new URL('../public/atlas/land.json', import.meta.url)), 'utf8')) as Geometry
    const stats = levelStats(land, true)
    console.log(stats.map((s) => `scale ${s.scale}: ${s.points} points, ${s.units} units, ${s.cells} cells`).join('\n'))
    expect(stats[0].points).toBeLessThan(stats.at(-1)!.points * 0.25)
  })
})
