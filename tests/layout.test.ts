import { describe, expect, it } from 'vitest'
import { CARD_W, layoutFamily } from '../lib/graph/layout'
import type { Graph, Person } from '../lib/types'

const graph = (ids: string[], pc: [string, string][], un: [string, string][]) => ({
  persons: ids.map((id) => ({ id, sex: 'U' } as Person)),
  parentChild: pc.map(([parentId, childId], i) => ({ id: `${i}`, parentId, childId, kind: 'birth', certainty: 'family' })),
  unions: un.map(([aId, bId], i) => ({ id: `u${i}`, aId, bId, kind: 'marriage' })),
}) as unknown as Graph

const P = (id: string, sex: 'M' | 'F' | 'U', birthYear: number | null = null) => ({ id, sex, birthYear } as Person)

describe('chart conventions', () => {
  const family = {
    persons: [P('d', 'M', 1900), P('m', 'F', 1902), P('young', 'F', 1940), P('old', 'M', 1930), P('mid', 'F', 1935), P('wife', 'F', 1931), P('gr', 'M', 1960), P('s1', 'F', 1945), P('s2', 'F', 1950), P('hub', 'M', 1940), P('k1', 'M', 1970), P('k2', 'M', 1975)],
    parentChild: [['d', 'young'], ['m', 'young'], ['d', 'old'], ['m', 'old'], ['d', 'mid'], ['m', 'mid'], ['old', 'gr'], ['wife', 'gr'], ['hub', 'k1'], ['s1', 'k1'], ['hub', 'k2'], ['s2', 'k2']].map(([parentId, childId], i) => ({ id: `${i}`, parentId, childId, kind: 'birth', certainty: 'family' })),
    unions: [['m', 'd'], ['wife', 'old'], ['s1', 'hub'], ['hub', 's2']].map(([aId, bId], i) => ({ id: `u${i}`, aId, bId, kind: 'marriage' })),
  } as unknown as Graph
  const l = layoutFamily(family)
  const x = (id: string) => l.cards.get(id)!.x

  it('puts the man on the left of the woman', () => {
    expect(x('d')).toBeLessThan(x('m'))
    expect(x('old')).toBeLessThan(x('wife'))
  })

  it('stands siblings eldest first', () => {
    expect(x('old')).toBeLessThan(x('mid'))
    expect(x('mid')).toBeLessThan(x('young'))
  })

  it('draws only horizontal and vertical lines', () => {
    for (const path of [...l.edges.map((e) => e.path), ...l.unions.map((u) => u.path)]) {
      // Corners are short curves; every straight piece must keep x or y.
      const pts = [...path.matchAll(/([MLQ])([-\d.]+) ([-\d.]+)(?: ([-\d.]+) ([-\d.]+))?|([HV])([-\d.]+)/g)]
      let cx = 0, cy = 0
      for (const m of pts) {
        if (m[6] === 'H') cx = +m[7]
        else if (m[6] === 'V') cy = +m[7]
        else if (m[1] === 'Q') { cx = +m[4]; cy = +m[5] }
        else {
          const nx = +m[2], ny = +m[3]
          if (m[1] === 'L') expect(Math.abs(nx - cx) < 0.01 || Math.abs(ny - cy) < 0.01).toBe(true)
          cx = nx
          cy = ny
        }
      }
    }
  })

  it('never overlaps cards, and a family dot sits over its children', () => {
    const cards = [...l.cards.values()]
    for (const a of cards) for (const b of cards) if (a !== b && a.y === b.y) expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(CARD_W - 0.01)
    const dot = l.unions.find((u) => u.union.aId === 'wife')!
    expect(Math.abs(dot.x - x('gr'))).toBeLessThan(CARD_W)
  })

  it('tells children of different marriages apart', () => {
    const k1 = l.edges.find((e) => e.childId === 'k1')!
    const k2 = l.edges.find((e) => e.childId === 'k2')!
    expect(k1.familyKey).not.toBe(k2.familyKey)
    expect(x('k1')).toBeLessThan(x('k2'))
  })
})

describe('layoutFamily', () => {
  it('keeps bars out of tall captions, whichever way the tree grows', () => {
    const long = { givenName: 'Екатерина Ивановна', surname: 'Волынкина' }
    const g = graph(['a', 'b', 'c'], [['a', 'c'], ['b', 'c']], [['a', 'b']])
    const tall = { ...g, persons: g.persons.map((p) => ({ ...p, ...long })) }
    for (const rootsBelow of [false, true]) {
      const l = layoutFamily(tall, { rootsBelow })
      const e = l.edges[0]
      const child = l.cards.get('c')!, parent = l.cards.get('a')!
      const captionBottom = (rootsBelow ? child.y : parent.y) + 64 + 13 + 3 * 17 + 15 + 20
      expect(e.barAt[1]).toBeGreaterThan(captionBottom)
    }
  })
  it('can grow upwards: elders below, the same columns, lines ending under the child', () => {
    const g = graph(['a', 'b', 'c', 'd', 'n'], [['a', 'c'], ['b', 'c'], ['a', 'd'], ['b', 'd'], ['c', 'n']], [['a', 'b']])
    const down = layoutFamily(g)
    const up = layoutFamily(g, { rootsBelow: true })
    const y = (id: string) => up.cards.get(id)!.y
    expect(y('a')).toBeGreaterThan(y('c'))
    expect(y('c')).toBeGreaterThan(y('n'))
    for (const id of ['a', 'b', 'c', 'd', 'n']) expect(up.cards.get(id)!.x).toBe(down.cards.get(id)!.x)
    expect(up.bounds).toEqual(down.bounds)
    const e = up.edges.find((x) => x.childId === 'n')!
    const end = Number(e.path.match(/(-?[\d.]+)$/)![1])
    // Behind the caption, whose background cuts it off at the text.
    expect(end).toBeGreaterThan(y('n') + 64)
    expect(end).toBeLessThan(y('n') + 90)
    const named = (givenName: string, surname: string) => {
      const l = layoutFamily({ ...g, persons: g.persons.map((p) => (p.id === 'n' ? { ...p, givenName, surname } : p)) }, { rootsBelow: true })
      return Number(l.edges.find((x) => x.childId === 'n')!.own.match(/(-?[\d.]+)$/)![1])
    }
    expect(named('Екатерина', 'Соколова')).toBeGreaterThan(named('Анна', 'Ким'))
  })
  it('places everyone, spouses side by side, children below', () => {
    const l = layoutFamily(graph(['a', 'b', 'c', 'd'], [['a', 'c'], ['b', 'c'], ['a', 'd'], ['b', 'd']], [['a', 'b']]))
    expect(l.cards.size).toBe(4)
    const [a, b, c] = ['a', 'b', 'c'].map((i) => l.cards.get(i)!)
    expect(a.y).toBe(b.y)
    expect(Math.abs(a.x - b.x)).toBe(CARD_W)
    expect(c.y).toBeGreaterThan(a.y)
    expect(l.unions).toHaveLength(1)
    expect(l.unions[0].x).toBe((a.x + b.x) / 2)
    expect(l.edges).toHaveLength(2)
  })

  it('keeps a person with two spouses between them', () => {
    const l = layoutFamily(graph(['s1', 'hub', 's2'], [], [['s1', 'hub'], ['hub', 's2']]))
    const xs = ['s1', 'hub', 's2'].map((i) => l.cards.get(i)!.x)
    expect(xs[1]).toBeGreaterThan(Math.min(xs[0], xs[2]))
    expect(xs[1]).toBeLessThan(Math.max(xs[0], xs[2]))
  })

  it('survives a marriage across generations and an empty graph', () => {
    const l = layoutFamily(graph(['p', 'c', 'n'], [['p', 'c'], ['c', 'n']], [['p', 'n']]))
    expect(l.cards.size).toBe(3)
    expect(l.unions).toHaveLength(1)
    expect(layoutFamily(graph([], [], [])).cards.size).toBe(0)
  })
})
