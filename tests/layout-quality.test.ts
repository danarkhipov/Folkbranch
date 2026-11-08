import { describe, expect, it } from 'vitest'
import { CARD_W, layoutFamily, PITCH } from '../lib/graph/layout'
import { orderRows, type OrderEdge, type OrderNode } from '../lib/graph/order'
import { assignTracks, type Net } from '../lib/graph/tracks'
import { buildGraph, kinship, nearLines, quality, randomFamily, TANGLE } from './layout-quality'

describe('lines on the chart', () => {
  for (const rootsBelow of [false, true]) {
    it(`untangles the reported family, ${rootsBelow ? 'elders below' : 'elders above'}`, () => {
      expect(quality(layoutFamily(TANGLE, { rootsBelow }), TANGLE)).toMatchObject({ crossings: 0, overlaps: 0, throughCards: 0, tight: 0 })
    })
  }

  // These fell from 4, 20, 248 and 809 when the search for the order was written; they must not creep back. Seeds 4 and 6 gave up two and seven crossings when rows began to follow birth years, and seed 4 two more for keeping branches together.
  it.each([[3, 40, 4], [4, 150, 9], [6, 600, 56], [7, 1500, 254]])('keeps crossings down in a random family (seed %i, %i people)', (seed, size, most) => {
    const g = randomFamily(seed, size)
    const q = quality(layoutFamily(g), g)
    expect(q.crossings).toBeLessThanOrEqual(most)
    expect(q.tight).toBe(0)
  })

  // Lines of different families kept apart enough to follow, and relatives kept in one stretch of their row.
  it.each([[3, 40, 0, 4], [4, 150, 2, 30], [6, 600, 8, 1140]])('keeps lines apart and branches together (seed %i, %i people)', (seed, size, nearMost, intrusionsMost) => {
    const g = randomFamily(seed, size)
    const l = layoutFamily(g)
    expect(nearLines(l)).toBeLessThanOrEqual(nearMost)
    expect(kinship(l, g).intrusions).toBeLessThanOrEqual(intrusionsMost)
  })

  it('gathers the branches of a family traced back from one person', () => {
    // Two grandparent couples on each side, so father's and mother's lines must each stay together.
    const g = buildGraph(
      [['gf1', 'M', 1900], ['gm1', 'F', 1902], ['gf2', 'M', 1901], ['gm2', 'F', 1903], ['gf3', 'M', 1899], ['gm3', 'F', 1904], ['gf4', 'M', 1898], ['gm4', 'F', 1905],
        ['f', 'M', 1930], ['m', 'F', 1932], ['uncle', 'M', 1934], ['aunt', 'F', 1936], ['me', 'M', 1960], ['cousin', 'F', 1962]],
      [['gf1', 'f'], ['gm1', 'f'], ['gf2', 'uncle'], ['gm2', 'uncle'], ['gf3', 'm'], ['gm3', 'm'], ['gf4', 'aunt'], ['gm4', 'aunt'], ['f', 'me'], ['m', 'me'], ['uncle', 'cousin'], ['aunt', 'cousin']],
      [['gf1', 'gm1'], ['gf2', 'gm2'], ['gf3', 'gm3'], ['gf4', 'gm4'], ['f', 'm'], ['uncle', 'aunt']],
    )
    const l = layoutFamily(g)
    expect(quality(l, g)).toMatchObject({ overlaps: 0, throughCards: 0 })
    expect(kinship(l, g).intrusions).toBeLessThanOrEqual(2)
  })

  it('leaves a clear strip between partners for the line down', () => {
    const l = layoutFamily(TANGLE)
    for (const u of l.unions) expect(u.x2 - u.x1).toBe(PITCH)
  })

  it('moves nobody sideways when a name changes', () => {
    const before = layoutFamily(TANGLE)
    const renamed = { ...TANGLE, persons: TANGLE.persons.map((p) => (p.id === 'ivan' ? { ...p, givenName: 'Очень длинное имя на несколько строк подряд' } : p)) }
    const after = layoutFamily(renamed)
    for (const [id, c] of before.cards) expect(after.cards.get(id)!.x).toBe(c.x)
  })

  it('gives the same chart every time', () => {
    const g = randomFamily(4, 150)
    const a = layoutFamily(g), b = layoutFamily({ ...g, persons: g.persons.map((p) => ({ ...p, birthYear: (p.birthYear ?? 0) + 1 })) }), c = layoutFamily(g)
    expect(b.cards.size).toBe(a.cards.size)
    expect([...c.cards.values()]).toEqual([...a.cards.values()])
  })

  it('keeps a line through a row clear of everyone in that row', () => {
    // A grandchild linked straight to a grandparent, with a full row in between.
    const g = buildGraph([['a', 'M'], ['b', 'F'], ['c', 'M'], ['d', 'F'], ['e', 'M'], ['f', 'F'], ['far', 'M']], [['a', 'c'], ['b', 'c'], ['a', 'd'], ['b', 'd'], ['c', 'e'], ['d', 'f'], ['a', 'far']], [['a', 'b']])
    expect(quality(layoutFamily(g), g).throughCards).toBe(0)
  })
})

describe('order of a row', () => {
  const node = (key: string, slots = [key], birth = 0): OrderNode => ({ key, slots, birth })
  const count = (rows: OrderNode[][], edges: OrderEdge[]) => {
    const at = new Map(rows.flatMap((r) => r.flatMap((n) => n.slots)).map((s) => [s, 0]))
    for (const r of rows) { let i = 0; for (const n of r) for (const s of n.slots) at.set(s, i++) }
    let c = 0
    for (const e of edges) for (const f of edges) if (e.rank === f.rank && at.get(e.up[0])! < at.get(f.up[0])! && at.get(e.down)! > at.get(f.down)!) c++
    return c
  }

  it('finds the order without crossings when there is one', () => {
    const rows = [[node('a'), node('b'), node('c')], [node('z'), node('y'), node('x')]]
    const edges = [{ up: ['a'], down: 'x', rank: 1 }, { up: ['b'], down: 'y', rank: 1 }, { up: ['c'], down: 'z', rank: 1 }]
    orderRows(rows, edges)
    expect(count(rows, edges)).toBe(0)
  })

  it('uncrosses a couple\'s parents, and never parts the couple', () => {
    const rows = [[node('pa'), node('pb')], [node('couple', ['b', 'a'])]]
    const edges = [{ up: ['pa'], down: 'a', rank: 1 }, { up: ['pb'], down: 'b', rank: 1 }]
    orderRows(rows, edges)
    expect(count(rows, edges)).toBe(0)
    expect(rows[1]).toHaveLength(1)
  })

  it('stands siblings eldest first when nothing is at stake', () => {
    const rows = [[node('p')], [node('young', ['young'], 1950), node('old', ['old'], 1920)]]
    orderRows(rows, [{ up: ['p'], down: 'young', rank: 1 }, { up: ['p'], down: 'old', rank: 1 }])
    expect(rows[1].map((n) => n.key)).toEqual(['old', 'young'])
  })
})

describe('heights of the bars', () => {
  const net = (above: number[], below: number[]): Net => ({ above, below, track: 0 })

  it('lets bars side by side share a height', () => {
    expect(assignTracks([net([0], [0, 100]), net([300], [300, 400])])).toBe(1)
  })

  it('never lays one vertical over another', () => {
    // b comes down exactly where a goes on to its child, so a must run below b.
    const a = net([0], [100]), b = net([100], [200])
    expect(assignTracks([a, b])).toBe(2)
    expect(b.track).toBeLessThan(a.track)
  })

  it('gives a tall gap as many tracks as the bars need', () => {
    const nets = Array.from({ length: 5 }, (_, i) => net([i * 10], [500 + i * 10]))
    expect(assignTracks(nets)).toBe(5)
  })
})

describe('cards placed by hand', () => {
  const family = randomFamily(4, 60)
  const plain = layoutFamily(family)
  const someone = [...plain.cards.values()][Math.floor(plain.cards.size / 2)]

  it('stay exactly where they were put', () => {
    const x = someone.x + 700
    expect(layoutFamily(family, { pins: { [someone.id]: x } }).cards.get(someone.id)!.x).toBeCloseTo(x, 1)
  })

  it('do not change who is in which generation, and nobody overlaps', () => {
    const l = layoutFamily(family, { pins: { [someone.id]: someone.x + 700 } })
    expect(l.cards.get(someone.id)!.y).toBe(plain.cards.get(someone.id)!.y)
    const cards = [...l.cards.values()]
    for (const a of cards) for (const b of cards) if (a !== b && a.y === b.y) expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(CARD_W - 0.01)
    expect(l.edges.length).toBe(plain.edges.length)
  })

  it('a card dragged past its neighbour stands on the other side', () => {
    const g = buildGraph([['a', 'M'], ['b', 'M'], ['c', 'M']], [], [])
    const base = layoutFamily(g)
    const left = [...base.cards.values()].sort((p, q) => p.x - q.x)[0]
    const far = Math.max(...[...base.cards.values()].map((c) => c.x)) + 500
    const l = layoutFamily(g, { pins: { [left.id]: far } })
    expect(l.cards.get(left.id)!.x).toBeCloseTo(far, 1)
    expect(Math.max(...[...l.cards.values()].map((c) => c.x))).toBeCloseTo(far, 1)
  })

  it('a placement for someone not on this chart changes nothing', () => {
    expect([...layoutFamily(family, { pins: { nobody: 5 } }).cards.values()]).toEqual([...plain.cards.values()])
  })
})
