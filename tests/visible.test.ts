import { describe, expect, it } from 'vitest'
import { layoutFamily, cardBox, CARD_W } from '../lib/graph/layout'
import { boxOf, nextView, touches, type Box } from '../lib/graph/visible'
import type { Graph } from '../lib/types'

const person = (id: string, sex: 'M' | 'F') => ({ id, sex, givenName: id, surname: '', birthYear: null }) as unknown as Graph['persons'][number]
const link = (parentId: string, childId: string) => ({ id: `${parentId}-${childId}`, parentId, childId, kind: 'birth', certainty: 'known' }) as unknown as Graph['parentChild'][number]
const union = (id: string, aId: string, bId: string) => ({ id, aId, bId, kind: 'marriage', certainty: 'known' }) as unknown as Graph['unions'][number]
/** Parents, three children, one of them with a family of their own, and a marriage across generations. */
const GRAPH: Graph = {
  persons: [person('p', 'M'), person('m', 'F'), person('a', 'M'), person('b', 'F'), person('c', 'M'), person('w', 'F'), person('g', 'M'), person('late', 'F')],
  parentChild: [link('p', 'a'), link('m', 'a'), link('p', 'b'), link('m', 'b'), link('p', 'c'), link('m', 'c'), link('a', 'g'), link('w', 'g')],
  unions: [union('u1', 'p', 'm'), union('u2', 'a', 'w'), union('u3', 'p', 'late')],
} as Graph

const screen = [1000, 800] as const
const view = (x: number, y: number, k: number, kept: Box | null = null) => nextView(kept, x, y, k, ...screen)

describe('what stays on the page', () => {
  it('keeps more than the screen, in chart coordinates', () => {
    const b = view(0, 0, 0.5)!
    expect(b[0]).toBeLessThan(0)
    expect(b[2]).toBeGreaterThan(2000)
  })

  it('a small pan changes nothing, a long one brings in more', () => {
    const b = view(0, 0, 1)!
    expect(view(-100, 50, 1, b)).toBeNull()
    expect(view(-900, 0, 1, b)).not.toBeNull()
  })

  it('zooming out needs more at once, zooming far in lets go of the rest', () => {
    const b = view(0, 0, 1)!
    expect(view(0, 0, 0.6, b)).not.toBeNull()
    expect(view(0, 0, 3, b)).not.toBeNull()
  })

  it('touching includes the shared edge and nothing past it', () => {
    expect(touches([0, 0, 10, 10], [10, 10, 20, 20])).toBe(true)
    expect(touches([0, 0, 10, 10], [11, 0, 20, 10])).toBe(false)
  })

  it('every line and dot lies inside its box', () => {
    const l = layoutFamily(GRAPH)
    expect(l.edges.length).toBeGreaterThan(3)
    const numbers = (d: string) => [...d.matchAll(/([MLQ])([-\d.]+) ([-\d.]+)/g)].map((m) => [Number(m[2]), Number(m[3])])
    for (const e of l.edges) for (const [x, y] of [...numbers(e.path), ...numbers(e.shared), ...numbers(e.own)]) {
      expect(x).toBeGreaterThanOrEqual(e.box[0])
      expect(x).toBeLessThanOrEqual(e.box[2])
      expect(y).toBeGreaterThanOrEqual(e.box[1])
      expect(y).toBeLessThanOrEqual(e.box[3])
    }
    for (const u of l.unions) expect(touches(u.box, boxOf([[u.x, u.y]]))).toBe(true)
  })

  it('a card is kept while any of it could show', () => {
    const c = { id: 'a', x: 0, y: 0 }
    expect(touches(cardBox(c), [CARD_W / 2 - 1, 0, 500, 500])).toBe(true)
    expect(touches(cardBox(c), [CARD_W / 2 + 1, 0, 500, 500])).toBe(false)
  })
})
