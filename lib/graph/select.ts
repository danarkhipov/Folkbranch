// Who belongs to a part of the family. Pure, so the page and the server choose people the same way.
import type { Family } from '../kinship'
import type { Graph } from '../types'

export type Scope = 'all' | 'ancestors' | 'descendants' | 'near'

/** Parents, spouses, children, siblings and grandparents: the people closest to someone. */
export function nearFamily(family: Family, id: string) {
  const parents = family.parents.get(id) ?? []
  const siblings = parents.flatMap((p) => family.children.get(p) ?? []).filter((c) => c !== id)
  const grand = parents.flatMap((p) => family.parents.get(p) ?? [])
  return [...new Set([...parents, ...(family.spouses.get(id) ?? []), ...(family.children.get(id) ?? []), ...siblings, ...grand])]
}

/**
 * Everyone in a person's own line: ancestors above, descendants below, and the partners and siblings along the way.
 * `depth` is how many steps from the person, which sets when each one lights as the glow runs outward;
 * `pairs` are the lines it runs along, each with the direction it travels (up, towards parents).
 */
export function lineageOf(family: Family, id: string) {
  const depth = new Map<string, number>([[id, 0]])
  const pairs = new Map<string, { d: number; up: boolean }>()
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
  for (const [next, up] of [[family.parents, true], [family.children, false]] as const) {
    let layer = [id]
    for (let d = 1; layer.length && d < 60; d++) {
      const after: string[] = []
      for (const x of layer) for (const y of next.get(x) ?? []) {
        if (!pairs.has(key(x, y))) pairs.set(key(x, y), { d, up })
        if (!depth.has(y)) { depth.set(y, d); after.push(y) }
      }
      layer = after
    }
  }
  // Brothers and sisters hang from the same parents' line.
  for (const p of family.parents.get(id) ?? []) for (const s of family.children.get(p) ?? []) {
    if (s === id) continue
    if (!pairs.has(key(p, s))) pairs.set(key(p, s), { d: 2, up: false })
    if (!depth.has(s)) depth.set(s, 2)
  }
  for (const [x, d] of [...depth]) for (const s of family.spouses.get(x) ?? []) {
    if (!pairs.has(key(x, s))) pairs.set(key(x, s), { d, up: false })
    if (!depth.has(s)) depth.set(s, d)
  }
  return { depth, pairs }
}

/** Follows one kind of link. A shared ancestor is met twice and counted once, and bad data with a loop cannot trap it. */
function walk(start: string, next: (id: string) => string[] | undefined) {
  const seen = new Set<string>()
  const stack = [...(next(start) ?? [])]
  while (stack.length) {
    const id = stack.pop()!
    if (id === start || seen.has(id)) continue
    seen.add(id)
    stack.push(...(next(id) ?? []))
  }
  return seen
}

export const ancestorsOf = (family: Family, id: string) => walk(id, (x) => family.parents.get(x))
export const descendantsOf = (family: Family, id: string) => walk(id, (x) => family.children.get(x))

/** Everyone a scope shows around a person, partners included, or they would stand there without the other parent. */
export function peopleInScope(family: Family, scope: Exclude<Scope, 'all'>, id: string) {
  if (scope === 'near') return new Set([id, ...nearFamily(family, id)])
  if (scope === 'ancestors') return new Set([id, ...ancestorsOf(family, id)])
  const down = [id, ...descendantsOf(family, id)]
  return new Set([...down, ...down.flatMap((x) => family.spouses.get(x) ?? [])])
}

/**
 * Who a collapsed person hides: all their descendants, and the partners of those who have no other reason to be on
 * the chart. The person and their own partners stay.
 */
export function hiddenByCollapse(family: Family, collapsed: Iterable<string>) {
  const gone = new Set<string>()
  for (const id of collapsed) for (const d of descendantsOf(family, id)) gone.add(d)
  for (const id of collapsed) gone.delete(id)
  const partners = new Set([...gone].flatMap((x) => family.spouses.get(x) ?? []))
  for (const p of partners) {
    if (gone.has(p)) continue
    const hasParents = (family.parents.get(p) ?? []).some((x) => !gone.has(x))
    const hasOthers = (family.spouses.get(p) ?? []).some((x) => !gone.has(x))
    if (!hasParents && !hasOthers) gone.add(p)
  }
  return gone
}

/** The part of the graph with only these people and the links between them. */
export function subgraph(g: Graph, keep: (id: string) => boolean): Graph {
  return {
    ...g,
    persons: g.persons.filter((p) => keep(p.id)),
    parentChild: g.parentChild.filter((l) => keep(l.parentId) && keep(l.childId)),
    unions: g.unions.filter((u) => keep(u.aId) && keep(u.bId)),
  }
}
