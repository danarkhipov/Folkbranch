import { describe, expect, it } from 'vitest'
import { Family } from '../lib/kinship'
import { layoutFamily } from '../lib/graph/layout'
import { ancestorsOf, descendantsOf, hiddenByCollapse, peopleInScope, subgraph } from '../lib/graph/select'
import { buildGraph } from './layout-quality'

// Grandparents a+b, children c (married to d) and e; c+d have f (married to g), f+g have h. Cousins i and j share the grandparents a+b too.
const g = buildGraph(
  [['a', 'M'], ['b', 'F'], ['c', 'M'], ['d', 'F'], ['e', 'F'], ['f', 'M'], ['g', 'F'], ['h', 'M'], ['x', 'M']],
  [['a', 'c'], ['b', 'c'], ['a', 'e'], ['b', 'e'], ['c', 'f'], ['d', 'f'], ['f', 'h'], ['g', 'h']],
  [['a', 'b'], ['c', 'd'], ['f', 'g']],
)
const family = new Family(g)
const sorted = (s: Iterable<string>) => [...s].sort()

describe('parts of the family', () => {
  it('finds ancestors and descendants', () => {
    expect(sorted(ancestorsOf(family, 'h'))).toEqual(['a', 'b', 'c', 'd', 'f', 'g'])
    expect(sorted(descendantsOf(family, 'c'))).toEqual(['f', 'h'])
    expect(sorted(descendantsOf(family, 'h'))).toEqual([])
  })

  it('counts a shared ancestor once, and survives a loop in bad data', () => {
    const cousins = buildGraph([['a', 'M'], ['p', 'M'], ['q', 'F'], ['k', 'M']], [['a', 'p'], ['a', 'q'], ['p', 'k'], ['q', 'k']], [['p', 'q']])
    expect(sorted(ancestorsOf(new Family(cousins), 'k'))).toEqual(['a', 'p', 'q'])
    const loop = buildGraph([['l', 'M'], ['m', 'M']], [['l', 'm'], ['m', 'l']], [])
    expect(sorted(ancestorsOf(new Family(loop), 'l'))).toEqual(['m'])
  })

  it('descendants bring their partners, ancestors do not bring outsiders', () => {
    expect(sorted(peopleInScope(family, 'descendants', 'c'))).toEqual(['c', 'd', 'f', 'g', 'h'])
    expect(sorted(peopleInScope(family, 'ancestors', 'f'))).toEqual(['a', 'b', 'c', 'd', 'f'])
    expect(peopleInScope(family, 'near', 'x')).toEqual(new Set(['x']))
  })

  it('collapsing hides descendants and those who married in, not the person or their partner', () => {
    expect(sorted(hiddenByCollapse(family, ['c']))).toEqual(['f', 'g', 'h'])
    expect(hiddenByCollapse(family, []).size).toBe(0)
  })

  it('collapsing keeps a partner who has a family of their own on the chart', () => {
    const inLaw = buildGraph([['c', 'M'], ['f', 'M'], ['g', 'F'], ['gp', 'M']], [['c', 'f'], ['gp', 'g']], [['f', 'g']])
    expect(sorted(hiddenByCollapse(new Family(inLaw), ['c']))).toEqual(['f'])
  })

  it('a part can be laid out on its own, with no links to anyone outside', () => {
    const part = subgraph(g, (id) => peopleInScope(family, 'descendants', 'c').has(id))
    expect(part.parentChild.every((l) => part.persons.some((p) => p.id === l.parentId))).toBe(true)
    const l = layoutFamily(part)
    expect(l.cards.size).toBe(5)
    expect(l.cards.has('a')).toBe(false)
  })
})
