// Family layout, following pedigree-chart conventions: partners side by side with the man on
// the left, a straight line between them, children hanging from one shared bar, eldest on the
// left, and every line made of horizontal and vertical segments.
// dagre only decides the generations and a first order; the rest is computed here.
import dagre from '@dagrejs/dagre'
import type { Graph, ParentLink, Union } from '../types'

export const CARD_W = 156
export const CARD_H = 118
export const AVATAR_CY = 34
const AVATAR_R = 30
const RANK_SEP = 76
const NODE_SEP = 44
const LANE = 10
const CORNER = 8

export type LineStyle = 'solid' | 'adopted' | 'assumed'
export interface CardPos { id: string; x: number; y: number }
export interface UnionPos { id: string; union: Union; x: number; y: number; path: string; x1: number; x2: number }
export interface EdgePos { id: string; childId: string; parentIds: string[]; path: string; style: LineStyle; links: ParentLink[]; familyKey: string; /** The stretch that belongs to this child alone, from its bar down to it. */ own: string
  /** The part shared with siblings: from the parents down to the bar, and the bar itself. */ shared: string
  /** Siblings hanging from one bar share a group. */ group: string
  barAt: [number, number]
  groupAt: [number, number] }
export interface Layout {
  cards: Map<string, CardPos>
  unions: UnionPos[]
  edges: EdgePos[]
  bounds: { x: number; y: number; w: number; h: number }
}

interface Block { key: string; members: string[]; rank: number; x: number; width: number }

/** Groups spouses into blocks, refusing a merge that would put a parent and child side by side. */
function buildBlocks(g: Graph) {
  const parentsOf = new Map<string, string[]>()
  for (const l of g.parentChild) parentsOf.set(l.childId, [...(parentsOf.get(l.childId) ?? []), l.parentId])
  const members = new Map<string, Set<string>>(g.persons.map((p) => [p.id, new Set([p.id])]))
  const blockOf = new Map<string, string>(g.persons.map((p) => [p.id, p.id]))
  const adjacency = new Map<string, string[]>()
  for (const u of g.unions) {
    const a = blockOf.get(u.aId), b = blockOf.get(u.bId)
    if (a === undefined || b === undefined) continue
    if (a !== b) {
      const merged = new Set([...members.get(a)!, ...members.get(b)!])
      const related = [...merged].some((m) => (parentsOf.get(m) ?? []).some((p) => merged.has(p)))
      if (related) continue // e.g. marriage across generations: stays a long line
      for (const m of members.get(b)!) blockOf.set(m, a)
      members.set(a, merged)
      members.delete(b)
    }
    adjacency.set(u.aId, [...(adjacency.get(u.aId) ?? []), u.bId])
    adjacency.set(u.bId, [...(adjacency.get(u.bId) ?? []), u.aId])
  }
  return { members, blockOf, adjacency, parentsOf }
}

/** Walks the spouse chain from an end, so partners end up next to each other. */
function chainOrder(ids: string[], adjacency: Map<string, string[]>) {
  const ends = ids.filter((i) => (adjacency.get(i)?.length ?? 0) === 1)
  const out: string[] = []
  const seen = new Set<string>()
  const walk = (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    out.push(id)
    ;(adjacency.get(id) ?? []).forEach(walk)
  }
  walk(ends[0] ?? ids[0])
  ids.forEach(walk)
  // A hub with several spouses sits between them: s1, hub, s2.
  const hub = ids.find((i) => (adjacency.get(i)?.length ?? 0) > 1)
  if (hub && ids.length === 3 && out[1] !== hub) {
    const others = out.filter((x) => x !== hub)
    return [others[0], hub, others[1]]
  }
  return out
}

/**
 * The closest positions to `want` that keep the blocks in order and apart: pool adjacent
 * violators. It treats everyone fairly, unlike pushing blocks along in one direction.
 */
function placeInOrder(blocks: Block[], want: number[]) {
  const pools: { sum: number; n: number; offset: number[] }[] = []
  let shift = 0
  blocks.forEach((b, i) => {
    shift += i ? blocks[i - 1].width / 2 + NODE_SEP + b.width / 2 : 0
    pools.push({ sum: want[i] - shift, n: 1, offset: [shift] })
    while (pools.length > 1 && pools.at(-2)!.sum / pools.at(-2)!.n > pools.at(-1)!.sum / pools.at(-1)!.n) {
      const top = pools.pop()!
      const under = pools.at(-1)!
      under.sum += top.sum
      under.n += top.n
      under.offset.push(...top.offset)
    }
  })
  let i = 0
  for (const pool of pools) {
    const base = pool.sum / pool.n
    for (const off of pool.offset) blocks[i++].x = base + off
  }
}

/** A path of right angles with soft corners, from a list of points. */
export function orthogonal(points: [number, number][]) {
  const pts = points.filter((p, i) => !i || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1])
  let d = `M${pts[0][0]} ${pts[0][1]}`
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = pts[i]
    const next = pts[i + 1]
    if (!next) {
      d += `L${x} ${y}`
      continue
    }
    const [px, py] = pts[i - 1]
    const r = Math.min(CORNER, Math.hypot(x - px, y - py) / 2, Math.hypot(next[0] - x, next[1] - y) / 2)
    const inX = Math.sign(x - px), inY = Math.sign(y - py), outX = Math.sign(next[0] - x), outY = Math.sign(next[1] - y)
    d += `L${x - inX * r} ${y - inY * r}Q${x} ${y} ${x + outX * r} ${y + outY * r}`
  }
  return d
}

const ROW = CARD_H + RANK_SEP
const mean = (xs: number[]) => xs.reduce((a, c) => a + c, 0) / xs.length

/** `rootsBelow` draws the tree as it grows: elders at the bottom, the youngest at the top. */
export function layoutFamily(g: Graph, { rootsBelow = false }: { rootsBelow?: boolean } = {}): Layout {
  const { members, blockOf, adjacency, parentsOf } = buildBlocks(g)
  const byId = new Map(g.persons.map((p) => [p.id, p]))
  const d = new dagre.graphlib.Graph().setGraph({ rankdir: 'TB', ranksep: RANK_SEP, nodesep: NODE_SEP }).setDefaultEdgeLabel(() => ({}))
  for (const [k, m] of members) d.setNode(k, { width: m.size * CARD_W, height: CARD_H })
  for (const l of g.parentChild) {
    const a = blockOf.get(l.parentId), b = blockOf.get(l.childId)
    if (a !== undefined && b !== undefined && a !== b) d.setEdge(a, b)
  }
  dagre.layout(d)

  const ys = [...new Set([...members.keys()].map((k) => d.node(k).y))].sort((a, b) => a - b)
  const rowY = (rank: number) => (rootsBelow ? ys.length - 1 - rank : rank) * ROW
  const blocks = new Map<string, Block>()
  for (const [k, m] of members) {
    const n = d.node(k)
    blocks.set(k, { key: k, members: [...m], rank: ys.indexOf(n.y), x: n.x, width: m.size * CARD_W })
  }
  const rows: Block[][] = ys.map(() => [])
  for (const b of blocks.values()) rows[b.rank].push(b)

  /** Where each person sits relative to the centre of their block. */
  const offsetOf = new Map<string, number>()
  const blockFor = (id: string) => blocks.get(blockOf.get(id) ?? '')
  const arrange = (b: Block) => {
    const order = chainOrder(b.members, adjacency)
    const parentX = (id: string) => {
      const p = parentsOf.get(id)?.[0]
      const bl = p ? blockFor(p) : undefined
      return bl && bl.key !== b.key ? bl.x : undefined
    }
    if (order.length === 2) {
      const [a, c] = order
      const ax = parentX(a), cx = parentX(c)
      // When both have parents here, whoever's parents stand further left goes left, or lines
      // would cross. Otherwise the convention holds: the man on the left.
      const flip = ax !== undefined && cx !== undefined ? ax > cx : byId.get(a)?.sex === 'F' || byId.get(c)?.sex === 'M'
      if (flip) order.reverse()
    }
    order.forEach((id, i) => offsetOf.set(id, (i + 0.5) * CARD_W - b.width / 2))
    b.members = order
  }
  const familyX = (parents: string[]) => {
    const xs = parents.flatMap((p) => {
      const bl = blockFor(p)
      return bl && offsetOf.has(p) ? [bl.x + offsetOf.get(p)!] : []
    })
    return xs.length ? mean(xs) : undefined
  }
  const childrenOf = new Map<string, string[]>()
  for (const [c, ps] of parentsOf) for (const p of ps) childrenOf.set(p, [...(childrenOf.get(p) ?? []), c])
  const birth = (b: Block) => Math.min(9999, ...b.members.filter((m) => parentsOf.has(m)).map((m) => byId.get(m)?.birthYear ?? 9999))

  // Top down: each row follows its parents, and siblings stand eldest first.
  for (const row of rows) {
    row.forEach(arrange)
    const key = new Map(row.map((b) => {
      const xs = b.members.flatMap((m) => {
        const x = parentsOf.has(m) ? familyX(parentsOf.get(m)!) : undefined
        return x === undefined ? [] : [x - offsetOf.get(m)!]
      })
      return [b.key, xs.length ? mean(xs) : b.x]
    }))
    // Compare by the family's position, so that siblings group together and birth order decides inside.
    const familyPos = new Map(row.map((b) => {
      const kid = b.members.find((m) => parentsOf.has(m))
      return [b.key, kid ? familyX(parentsOf.get(kid)!) ?? b.x : b.x]
    }))
    row.sort((p, q) => {
      const diff = familyPos.get(p.key)! - familyPos.get(q.key)!
      return Math.abs(diff) > 1 ? diff : birth(p) - birth(q)
    })
    placeInOrder(row, row.map((b) => key.get(b.key)!))
  }

  // Alternate up and down so parents settle above the middle of their children.
  const sweep = (row: Block[], up: boolean) => {
    const want = row.map((b) => {
      const targets: number[] = []
      for (const m of b.members) {
        const off = offsetOf.get(m)!
        if (up) {
          for (const c of childrenOf.get(m) ?? []) {
            const bl = blockFor(c)
            if (bl && offsetOf.has(c)) targets.push(bl.x + offsetOf.get(c)! - off)
          }
        } else if (parentsOf.has(m)) {
          const x = familyX(parentsOf.get(m)!)
          if (x !== undefined) targets.push(x - off)
        }
      }
      return targets.length ? mean(targets) : b.x
    })
    placeInOrder(row, want)
  }
  for (let i = 0; i < 6; i++) {
    for (let r = rows.length - 2; r >= 0; r--) sweep(rows[r], true)
    for (let r = 1; r < rows.length; r++) sweep(rows[r], false)
  }

  const cards = new Map<string, CardPos>()
  for (const b of blocks.values()) for (const id of b.members) cards.set(id, { id, x: b.x + offsetOf.get(id)!, y: rowY(b.rank) })

  /** A clear vertical corridor in a row, near x, for lines passing through a generation. */
  const corridor = (rank: number, x: number) => {
    const row = rows[rank] ?? []
    let best = x, bestDist = Infinity
    const consider = (c: number) => {
      if (row.some((b) => c > b.x - b.width / 2 - 8 && c < b.x + b.width / 2 + 8)) return
      if (Math.abs(c - x) < bestDist) {
        best = c
        bestDist = Math.abs(c - x)
      }
    }
    consider(x)
    for (const b of row) {
      consider(b.x - b.width / 2 - NODE_SEP / 2)
      consider(b.x + b.width / 2 + NODE_SEP / 2)
    }
    return best
  }

  const unions: UnionPos[] = g.unions.flatMap((u) => {
    const a = cards.get(u.aId), b = cards.get(u.bId)
    if (!a || !b) return []
    const [l, r] = a.x < b.x ? [a, b] : [b, a]
    const y1 = l.y + AVATAR_CY, y2 = r.y + AVATAR_CY
    const edge = AVATAR_R + 5
    if (l.y === r.y && r.x - l.x <= CARD_W + 1) return [{ id: u.id, union: u, x: (l.x + r.x) / 2, y: y1, path: `M${l.x + edge} ${y1}H${r.x - edge}`, x1: l.x, x2: r.x }]
    if (l.y === r.y) {
      // A partner further along the row: a bracket over the cards in between.
      const top = l.y - 14
      return [{ id: u.id, union: u, x: (l.x + r.x) / 2, y: top, path: orthogonal([[l.x, y1 - edge], [l.x, top], [r.x, top], [r.x, y2 - edge]]), x1: l.x, x2: r.x }]
    }
    // Across generations: leave sideways, go down a corridor, come in from the side.
    const [hi, lo] = l.y < r.y ? [l, r] : [r, l]
    const dir = lo.x >= hi.x ? 1 : -1
    const x = hi.x + dir * (CARD_W / 2)
    const midY = hi.y + CARD_H + 14
    return [{ id: u.id, union: u, x, y: midY, path: orthogonal([[hi.x + dir * edge, hi.y + AVATAR_CY], [x, hi.y + AVATAR_CY], [x, midY], [lo.x - dir * edge, midY], [lo.x - dir * edge, lo.y + AVATAR_CY]]), x1: l.x, x2: r.x }]
  })

  // Children grouped by their set of parents: one family, one shared bar.
  const byFamily = new Map<string, { key: string; parents: string[]; children: string[]; links: ParentLink[] }>()
  for (const [child, parents] of parentsOf) {
    if (!cards.has(child)) continue
    const key = [...parents].sort().join('|')
    const fam = byFamily.get(key) ?? { key, parents, children: [], links: [] }
    fam.children.push(child)
    fam.links.push(...g.parentChild.filter((l) => l.childId === child))
    byFamily.set(key, fam)
  }
  const dotOf = (parents: string[]) => unions.find((u) => parents.length === 2 && parents.includes(u.union.aId) && parents.includes(u.union.bId))
  const families = [...byFamily.values()].map((f) => {
    const dot = dotOf(f.parents)
    const ps = f.parents.map((p) => cards.get(p)).filter(Boolean) as CardPos[]
    return { ...f, dot, ps, x: dot ? dot.x : ps.length ? mean(ps.map((c) => c.x)) : 0 }
  }).filter((f) => f.ps.length).sort((a, b) => a.x - b.x)

  const rankOf = (y: number) => (rootsBelow ? ys.length - 1 - Math.round(y / ROW) : Math.round(y / ROW))
  /** A bar's height in the gap before its children's row: lane 0 sits next to the children, higher lanes move towards the parents. */
  const laneY = (rank: number, lane: number) => (rootsBelow ? rowY(rank) + CARD_H + RANK_SEP / 2 - 14 + lane * LANE : rowY(rank) - RANK_SEP / 2 + 14 - lane * LANE)
  /** The middle of the gap a trunk crosses on its way through a generation. */
  const gapY = (rank: number) => (rootsBelow ? rowY(rank) + CARD_H + RANK_SEP / 2 : rowY(rank) - RANK_SEP / 2)
  /** The card is a portrait over a caption, so a line comes into the portrait from above or under the caption from below. */
  const entryY = (c: CardPos) => (rootsBelow ? c.y + CARD_H - 6 : c.y + AVATAR_CY - AVATAR_R - 4)
  const startOf = (f: (typeof families)[number]) => (f.dot ? f.dot.y : rootsBelow ? Math.min(...f.ps.map((p) => p.y)) + AVATAR_CY - AVATAR_R - 4 : Math.max(...f.ps.map((p) => p.y)) + CARD_H)

  type Group = { f: (typeof families)[number]; rank: number; kids: string[]; trunkX: number; lo: number; hi: number; path: [number, number][]; barY: number; start: number }
  const groupsList: Group[] = []
  for (const f of families) {
    const nearest = (rootsBelow ? Math.min : Math.max)(...f.ps.map((p) => p.y))
    const start = startOf(f)
    const groups = new Map<number, string[]>()
    for (const c of f.children) {
      const rank = rankOf(cards.get(c)!.y)
      groups.set(rank, [...(groups.get(rank) ?? []), c])
    }
    for (const [rank, kids] of groups) {
      // The trunk drops through any generations in between along a clear corridor.
      const path: [number, number][] = [[f.x, start]]
      let x = f.x
      for (let r = rankOf(nearest) + 1; r < rank; r++) {
        const c = corridor(r, x)
        const y = gapY(r)
        path.push([x, y], [c, y])
        x = c
      }
      const xs = [...kids.map((c) => cards.get(c)!.x), x]
      groupsList.push({ f, rank, kids, trunkX: x, lo: Math.min(...xs), hi: Math.max(...xs), path, barY: laneY(rank, 0), start })
    }
  }

  /** The vertical pieces a bar at height y adds: its trunk, and one drop to each child. */
  const verticals = (g: Group, y: number): [number, number, number][] => [
    [g.trunkX, g.start, y],
    ...g.kids.map((c): [number, number, number] => [cards.get(c)!.x, y, entryY(cards.get(c)!)]),
  ]
  /** Crossings a bar at height y would make with every other family, plus a large penalty for two bars on one line. */
  const cost = (g: Group, y: number) => {
    let c = 0
    const mine = verticals(g, y)
    for (const h of groupsList) {
      if (h === g) continue
      if (h.rank === g.rank && Math.abs(h.barY - y) < 1 && h.lo < g.hi && h.hi > g.lo) c += 1000
      for (const [vx, v1, v2] of verticals(h, h.barY)) if (vx > g.lo && vx < g.hi && y > Math.min(v1, v2) && y < Math.max(v1, v2)) c += 1
      for (const [vx, v1, v2] of mine) if (vx > h.lo && vx < h.hi && h.barY > Math.min(v1, v2) && h.barY < Math.max(v1, v2)) c += 1
    }
    return c
  }
  // Move each bar to the lane that crosses the fewest other lines; a few rounds settle it.
  for (let round = 0; round < 3; round++) {
    for (const g of groupsList) {
      let best = g.barY, bestCost = Infinity
      for (let lane = 0; lane < 6; lane++) {
        const y = laneY(g.rank, lane)
        const c = cost(g, y) + lane * 0.01
        if (c < bestCost) {
          bestCost = c
          best = y
        }
      }
      g.barY = best
    }
  }

  const edges: EdgePos[] = []
  for (const g of groupsList) {
    const { f, kids, trunkX: x, lo, hi, path, barY } = g
    const shared = `${orthogonal([...path, [x, barY]])} M${lo} ${barY}H${hi}`
    for (const child of kids) {
      const t = cards.get(child)!
      const links = f.links.filter((l) => l.childId === child)
      edges.push({
        id: `${child}:${f.parents.join('+')}`,
        childId: child,
        parentIds: f.parents,
        familyKey: f.key,
        path: orthogonal([...path, [x, barY], [t.x, barY], [t.x, entryY(t)]]),
        style: links.some((l) => l.kind !== 'birth') ? 'adopted' : links.some((l) => l.certainty === 'assumed') ? 'assumed' : 'solid',
        links,
        own: `M${t.x} ${barY}V${entryY(t)}`,
        shared,
        group: `${f.key}@${g.rank}`,
        barAt: [t.x, barY],
        groupAt: [(lo + hi) / 2, barY],
      })
    }
  }

  const all = [...cards.values()]
  const minX = Math.min(...all.map((c) => c.x)) - CARD_W / 2, maxX = Math.max(...all.map((c) => c.x)) + CARD_W / 2
  const minY = Math.min(...all.map((c) => c.y)), maxY = Math.max(...all.map((c) => c.y)) + CARD_H
  return { cards, unions, edges, bounds: all.length ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : { x: 0, y: 0, w: 0, h: 0 } }
}
