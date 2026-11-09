// Family layout, following pedigree-chart conventions: partners side by side with the man on
// the left, a straight line between them, children hanging from one shared bar, eldest on the
// left, and every line made of horizontal and vertical segments.
// dagre only decides the generations and a first order. `order.ts` then chooses who stands where
// to cross least, and `tracks.ts` the heights of the bars; both are named after the methods they use.
import dagre from '@dagrejs/dagre'
import type { Graph, ParentLink, Person, Union } from '../types'
import { AVATAR_CY, AVATAR_R, CARD_H, CARD_W, cardHeight, PITCH, PRINT_GAP, PRINT_PITCH, UNDER_CAPTION } from './metrics'
import { orderRows, type OrderEdge, type OrderNode } from './order'
import { assignTracks, type Net } from './tracks'
import { boxOf, type Box } from './visible'

export { AVATAR_CY, CARD_H, CARD_W, PITCH } from './metrics'
const RANK_SEP = 76
const NODE_SEP = 22
/** A line passing through a row takes this little room, and stays clear of captions on both sides. */
const PASS_W = 16
const LANE = 16
/** A card placed by hand stays put: everyone else in its row gives way. */
const PIN_WEIGHT = 1e6
/** Between a bar and the rows above and below it. */
const GAP_EDGE = 26
const CORNER = 8

export type LineStyle = 'solid' | 'adopted' | 'assumed'
export interface CardPos { id: string; x: number; y: number }
export interface UnionPos { id: string; union: Union; x: number; y: number; path: string; x1: number; x2: number; box: Box }
export interface EdgePos { id: string; childId: string; parentIds: string[]; path: string; style: LineStyle; links: ParentLink[]; familyKey: string
  /** Around the whole bar with its trunk and all the siblings, so the shared part is never cut. */ box: Box
  /** The stretch that belongs to this child alone, from its bar down to it. */ own: string
  /** Where the line goes on under the estimated caption, to the point it enters the card: clickable below the cards, where the real caption is shorter than the estimate. */ tail: string
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

/** Past the card's text, however it wraps, and past its plus buttons. */
export const cardBox = (c: CardPos): Box => [c.x - CARD_W / 2, c.y - 30, c.x + CARD_W / 2, c.y + 260]

interface Block extends OrderNode { rank: number; x: number; width: number }

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
function placeInOrder(blocks: Block[], want: number[], gap: number, weight: (b: Block) => number = () => 1) {
  const pools: { sum: number; n: number; offset: number[] }[] = []
  let shift = 0
  blocks.forEach((b, i) => {
    shift += i ? blocks[i - 1].width / 2 + gap + b.width / 2 : 0
    pools.push({ sum: (want[i] - shift) * weight(b), n: weight(b), offset: [shift] })
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

const mean = (xs: number[]) => xs.reduce((a, c) => a + c, 0) / xs.length

interface Family { key: string; parents: string[]; children: string[]; links: ParentLink[] }

/** Dagre and the search for the best order take most of the time on a large family, and depend only on its shape, so editing a name reuses their answer. */
let lastOrder: { key: string; rows: { key: string; slots: string[]; rank: number; x: number; width: number; birth: number }[][]; edges: OrderEdge[] } | null = null

/** A line passing through a row on its way to children further down holds a place in that row. */
function passKey(f: string, childRank: number, rank: number) {
  return `pass:${f}@${childRank}:${rank}`
}

function arrangeRows(g: Graph, members: Map<string, Set<string>>, blockOf: Map<string, string>, adjacency: Map<string, string[]>, parentsOf: Map<string, string[]>, byFamily: Map<string, Family>, byId: Map<string, Person>, hints: Map<string, number>) {
  const key = JSON.stringify([
    [...members].map(([k, m]) => [k, [...m]]),
    g.parentChild.map((l) => [l.parentId, l.childId]),
    g.unions.map((u) => [u.aId, u.bId]),
    g.persons.map((p) => [p.sex, p.birthYear]),
    [...hints],
  ])
  if (lastOrder?.key === key) return lastOrder

  const d = new dagre.graphlib.Graph().setGraph({ rankdir: 'TB', ranksep: RANK_SEP, nodesep: NODE_SEP }).setDefaultEdgeLabel(() => ({}))
  for (const [k, m] of members) d.setNode(k, { width: m.size * PITCH, height: CARD_H })
  for (const l of g.parentChild) {
    const a = blockOf.get(l.parentId), b = blockOf.get(l.childId)
    if (a !== undefined && b !== undefined && a !== b) d.setEdge(a, b)
  }
  dagre.layout(d)
  const ys = [...new Set([...members.keys()].map((k) => (d.node(k) as { y: number }).y))].sort((a, b) => a - b)
  const rankOfBlock = generations(g, members, blockOf, byId, (k) => ys.indexOf((d.node(k) as { y: number }).y), hints)
  const rowCount = Math.max(0, ...rankOfBlock.values()) + 1

  const birth = (ids: string[]) => Math.min(9999, ...ids.filter((m) => parentsOf.has(m)).map((m) => byId.get(m)?.birthYear ?? 9999))
  const rows: Block[][] = Array.from({ length: rowCount }, () => [])
  const rankOf = new Map<string, number>()
  for (const [k, m] of members) {
    const n = d.node(k) as { x: number; y: number }
    const rank = rankOfBlock.get(k)!
    let slots = chainOrder([...m], adjacency)
    // The convention, until crossings say otherwise: the man on the left.
    if (slots.length === 2 && (byId.get(slots[0])?.sex === 'F' || byId.get(slots[1])?.sex === 'M')) slots = slots.toReversed()
    rows[rank].push({ key: k, slots, birth: birth(slots), rank, x: n.x, width: m.size * PITCH })
    for (const id of m) rankOf.set(id, rank)
  }

  const edges: OrderEdge[] = []
  const passFrom = new Map<string, string>()
  for (const f of byFamily.values()) {
    const placed = f.parents.filter((p) => rankOf.has(p))
    if (!placed.length) continue
    const nearest = Math.max(...placed.map((p) => rankOf.get(p)!))
    const sources = placed.filter((p) => rankOf.get(p) === nearest)
    const sourceX = mean(sources.map((p) => (d.node(blockOf.get(p)!) as { x: number }).x))
    for (const [rank, kids] of Map.groupBy(f.children.filter((c) => rankOf.has(c)), (c) => rankOf.get(c)!)) {
      if (rank <= nearest) continue // A link that goes up the chart cannot be helped by the order.
      let up = sources
      for (let r = nearest + 1; r < rank; r++) {
        const pass = passKey(f.key, rank, r)
        rows[r].push({ key: pass, slots: [pass], birth: 9999, rank: r, x: sourceX, width: PASS_W })
        passFrom.set(pass, sources[0])
        edges.push({ up, down: pass, rank: r })
        up = [pass]
      }
      for (const c of kids) edges.push({ up, down: c, rank })
    }
  }
  // Start from an order in which every branch is one stretch of its row, walking the family down or up; keep the tidier.
  const slotsX = rows.map((row) => row.map((b) => b.x).sort((a, b) => a - b))
  const attempt = (dir: 'dagre' | 'down' | 'up', pull = 0) => {
    const pre = dir === 'dagre' ? new Map<string, number>() : branchOrder(g, members, blockOf, byId, dir)
    for (const [pass, from] of passFrom) if (dir !== 'dagre') pre.set(pass, (pre.get(blockOf.get(from)!) ?? 1e9) + 0.5)
    const copy = rows.map((row) => row.map((b) => ({ ...b })).sort((a, b) => (pre.get(a.key) ?? 1e9) - (pre.get(b.key) ?? 1e9) || a.x - b.x))
    if (dir !== 'dagre') for (const row of copy) { let i = 0; for (const b of row) { (b as { prior?: number }).prior = i; i += b.slots.length } }
    orderRows(copy, edges, pull)
    return { copy, score: untidiness(g, copy, edges) }
  }
  // Each start can end somewhere different; the tidiest of them is kept. A big family gets only the plain starts, to stay quick.
  const tries = [attempt('dagre'), attempt('down'), attempt('up')]
  if (g.persons.length <= PULL_UP_TO) for (const pull of g.persons.length <= MANY_STARTS_UP_TO ? PULLS : PULLS.slice(0, 1)) tries.push(attempt('down', pull), attempt('up', pull))
  const best = tries.reduce((a, c) => (c.score < a.score * 0.97 ? c : a))
  rows.splice(0, rows.length, ...best.copy)
  rows.forEach((row, r) => row.forEach((b, i) => { b.x = slotsX[r][i] ?? b.x }))
  lastOrder = { key, rows: rows.map((row) => row.map(({ key, slots, rank, x, width, birth }) => ({ key, slots, rank, x, width, birth }))), edges }
  return lastOrder
}

/**
 * The order in which a walk meets each block, so that read off one row at a time every branch is one stretch.
 * Walking down from the oldest people (eldest child first) suits a family that spreads out; walking up from the
 * youngest (father's side first) suits one traced back from a person, where the ancestors are the branches.
 */
function branchOrder(g: Graph, members: Map<string, Set<string>>, blockOf: Map<string, string>, byId: Map<string, Person>, dir: 'down' | 'up') {
  const year = (k: string) => Math.min(9999, ...[...members.get(k)!].map((id) => byId.get(id)?.birthYear ?? 9999))
  const kids = new Map<string, Set<string>>(), parents = new Map<string, Set<string>>()
  const sexRank = (id: string) => (byId.get(id)?.sex === 'M' ? 0 : byId.get(id)?.sex === 'F' ? 2 : 1)
  const links = g.parentChild.toSorted((x, y) => sexRank(x.parentId) - sexRank(y.parentId))
  for (const l of links) {
    const a = blockOf.get(l.parentId), b = blockOf.get(l.childId)
    if (a === undefined || b === undefined || a === b) continue
    ;(kids.get(a) ?? kids.set(a, new Set()).get(a)!).add(b)
    ;(parents.get(b) ?? parents.set(b, new Set()).get(b)!).add(a)
  }
  const next = dir === 'down' ? kids : parents
  const order = new Map<string, number>()
  const walk = (start: string) => {
    const stack = [start]
    while (stack.length) {
      const k = stack.pop()!
      if (order.has(k)) continue
      order.set(k, order.size)
      const more = [...(next.get(k) ?? [])].filter((c) => !order.has(c))
      // Going down the eldest is taken first; going up the father's side. The stack takes the last pushed first.
      stack.push(...(dir === 'down' ? more.sort((a, b) => year(b) - year(a) || (a < b ? 1 : -1)) : more.toReversed()))
    }
  }
  const starts = [...members.keys()].filter((k) => !(dir === 'down' ? parents : kids).has(k)).sort((a, b) => (dir === 'down' ? year(a) - year(b) : year(b) - year(a)) || (a < b ? -1 : 1))
  for (const r of starts) walk(r)
  for (const k of members.keys()) walk(k)
  return order
}

/** People born about a generation apart stand in the same row, as far as the links allow. */
const GENERATION_YEARS = 28

/**
 * The row of every block. dagre knows only the shape of the tree, so a cousin whose line to the family is missing
 * can land a generation off. Here a block with a known birth year is moved down to the row of its time, a parent
 * is never left below a child, and a block without a year is drawn close above whoever it parents.
 */
function generations(g: Graph, members: Map<string, Set<string>>, blockOf: Map<string, string>, byId: Map<string, Person>, structural: (k: string) => number, hints: Map<string, number>) {
  const rank = generationsByTime(g, members, blockOf, byId, structural)
  if (!hints.size) return rank
  // Someone added where the chart was pressed, and tied to no one yet, stays in the row they were put in.
  const linked = new Set(g.parentChild.flatMap((l) => [l.parentId, l.childId]))
  const last = Math.max(0, ...rank.values())
  for (const [k, m] of members) {
    const hint = [...m].map((id) => hints.get(id)).find((h) => h !== undefined)
    if (hint !== undefined && ![...m].some((id) => linked.has(id))) rank.set(k, Math.max(0, Math.min(last, Math.round(hint))))
  }
  return rank
}

function generationsByTime(g: Graph, members: Map<string, Set<string>>, blockOf: Map<string, string>, byId: Map<string, Person>, structural: (k: string) => number) {
  const rank = new Map<string, number>([...members.keys()].map((k) => [k, structural(k)]))
  const years = new Map<string, number>()
  for (const [k, m] of members) {
    const ys = [...m].map((id) => byId.get(id)?.birthYear).filter((y): y is number => !!y)
    if (ys.length) years.set(k, Math.min(...ys))
  }
  if (!years.size) return rank
  const first = Math.min(...years.values())
  const parents = new Map<string, Set<string>>(), kids = new Map<string, Set<string>>()
  for (const l of g.parentChild) {
    const a = blockOf.get(l.parentId), b = blockOf.get(l.childId)
    if (a === undefined || b === undefined || a === b) continue
    ;(parents.get(b) ?? parents.set(b, new Set()).get(b)!).add(a)
    ;(kids.get(a) ?? kids.set(a, new Set()).get(a)!).add(b)
  }
  const order = [...rank.keys()].sort((a, b) => rank.get(a)! - rank.get(b)!)
  // Down: a block takes the row of its time, never above its parents' next row.
  for (const k of order) {
    const y = years.get(k)
    const floor = Math.max(rank.get(k)!, ...[...(parents.get(k) ?? [])].map((p) => rank.get(p)! + 1))
    rank.set(k, y === undefined ? floor : Math.max(floor, Math.round((y - first) / GENERATION_YEARS)))
  }
  // Up: someone with no known year sits just above their nearest child instead of far above.
  for (const k of order.toReversed()) {
    if (years.has(k) || !kids.get(k)?.size) continue
    rank.set(k, Math.max(rank.get(k)!, Math.min(...[...kids.get(k)!].map((c) => rank.get(c)!)) - 1))
  }
  // Rows nobody stands in are taken out.
  const used = [...new Set(rank.values())].sort((a, b) => a - b)
  for (const [k, r] of rank) rank.set(k, used.indexOf(r))
  return rank
}

/** How much the order a walk through the family gives counts against the crossing search, and up to how many people it is tried. */
const PULLS = [0.3, 0.2, 0.4, 0.5, 0.6]
/** Up to this many people every pull is tried; more get the first only. */
const MANY_STARTS_UP_TO = 250
const PULL_UP_TO = 800

/** Crossings, and strangers standing inside the stretch a branch covers in its row: the lower the tidier. */
function untidiness(g: Graph, rows: { slots: string[] }[][], edges: OrderEdge[]) {
  const at = new Map<string, [number, number]>()
  rows.forEach((row, r) => { let i = 0; for (const b of row) for (const s of b.slots) at.set(s, [r, i++]) })
  let cross = 0
  for (const list of Map.groupBy(edges, (e) => e.rank).values()) {
    const pairs = list.map((e) => [mean(e.up.map((s) => at.get(s)![1])), at.get(e.down)![1]])
    for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) if ((pairs[i][0] - pairs[j][0]) * (pairs[i][1] - pairs[j][1]) < 0) cross++
  }
  const kids = new Map<string, string[]>(), mates = new Map<string, string[]>()
  for (const l of g.parentChild) kids.set(l.parentId, [...(kids.get(l.parentId) ?? []), l.childId])
  for (const u of g.unions) { mates.set(u.aId, [...(mates.get(u.aId) ?? []), u.bId]); mates.set(u.bId, [...(mates.get(u.bId) ?? []), u.aId]) }
  let strangers = 0
  for (const p of g.persons) {
    if (!at.has(p.id)) continue
    const seen = new Set<string>(), stack = [...(kids.get(p.id) ?? [])]
    while (stack.length) { const x = stack.pop()!; if (seen.has(x)) continue; seen.add(x); stack.push(...(kids.get(x) ?? [])) }
    if (seen.size < 3) continue
    const branch = new Set([p.id, ...(mates.get(p.id) ?? []), ...seen, ...[...seen].flatMap((x) => mates.get(x) ?? [])])
    const span = new Map<number, [number, number, number]>()
    for (const id of branch) { const a = at.get(id); if (!a) continue; const s = span.get(a[0]); span.set(a[0], s ? [Math.min(s[0], a[1]), Math.max(s[1], a[1]), s[2] + 1] : [a[1], a[1], 1]) }
    for (const [lo, hi, n] of span.values()) if (n > 1) strangers += hi - lo + 1 - n
  }
  return cross * 5 + strangers
}

/** `rootsBelow` draws the tree as it grows: elders at the bottom, the youngest at the top. */
export function layoutFamily(g: Graph, { rootsBelow = false, pins = {}, print = false }: { rootsBelow?: boolean; /** Where people were placed by hand: person id to x. */ pins?: Record<string, number>; /** Tighter, for paper. */ print?: boolean } = {}): Layout {
  if (!g.persons.length) return { cards: new Map(), unions: [], edges: [], bounds: { x: 0, y: 0, w: 0, h: 0 } }
  const { members, blockOf, adjacency, parentsOf } = buildBlocks(g)
  const byId = new Map(g.persons.map((p) => [p.id, p]))

  // Children grouped by their set of parents: one family, one shared bar.
  const linksOf = Map.groupBy(g.parentChild, (l) => l.childId)
  const byFamily = new Map<string, Family>()
  for (const [child, parents] of parentsOf) {
    if (!byId.has(child)) continue
    const key = [...parents].sort().join('|')
    const fam = byFamily.get(key) ?? { key, parents, children: [], links: [] }
    fam.children.push(child)
    fam.links.push(...(linksOf.get(child) ?? []))
    byFamily.set(key, fam)
  }

  const pitch = print ? PRINT_PITCH : PITCH
  const gap = print ? PRINT_GAP : NODE_SEP
  // A person with a pin named "row:<id>" was put in that generation's row by hand.
  const hints = new Map(Object.entries(pins).filter(([k]) => k.startsWith('row:')).map(([k, v]) => [k.slice(4), v]))
  const arranged = arrangeRows(g, members, blockOf, adjacency, parentsOf, byFamily, byId, hints)
  const rows: Block[][] = arranged.rows.map((row) => row.map((b) => ({ ...b, width: b.key.startsWith('pass:') ? PASS_W : b.slots.length * pitch })))

  /** Where each person, or passing line, stands relative to the centre of its block. */
  const offsetOf = new Map<string, number>()
  const blockFor = new Map<string, Block>()
  for (const row of rows) for (const b of row) b.slots.forEach((id, i) => {
    offsetOf.set(id, (i + 0.5) * (b.width / b.slots.length) - b.width / 2)
    blockFor.set(id, b)
  })
  const xOf = (slot: string) => blockFor.get(slot)!.x + offsetOf.get(slot)!
  const edgeTop = (e: OrderEdge) => mean(e.up.map(xOf))
  const entering = Map.groupBy(arranged.edges, (e) => blockFor.get(e.down)!.key)
  const leaving = new Map<string, OrderEdge[]>()
  for (const e of arranged.edges) for (const k of new Set(e.up.map((s) => blockFor.get(s)!.key))) leaving.set(k, [...(leaving.get(k) ?? []), e])

  /** Where each block must stand because someone in it was placed by hand. */
  const pinned = new Map<Block, number>()

  // Alternate up and down so parents settle above the middle of their children.
  const settle = (row: Block[], up: boolean) => {
    const want = row.map((b) => {
      const targets: number[] = []
      if (up) {
        for (const e of leaving.get(b.key) ?? []) for (const s of e.up) if (blockFor.get(s) === b) targets.push(xOf(e.down) - offsetOf.get(s)!)
      } else {
        for (const e of entering.get(b.key) ?? []) targets.push(edgeTop(e) - offsetOf.get(e.down)!)
      }
      return pinned.get(b) ?? (targets.length ? mean(targets) : b.x)
    })
    placeInOrder(row, want, gap, (b) => (pinned.has(b) ? PIN_WEIGHT : 1))
  }
  for (const row of rows) settle(row, false)
  for (let i = 0; i < 6; i++) {
    for (let r = rows.length - 2; r >= 0; r--) settle(rows[r], true)
    for (let r = 1; r < rows.length; r++) settle(rows[r], false)
  }
  // First where everyone would stand by themselves, so that a card dragged past its neighbours can be seen to be
  // on their other side. Then everyone else adjusts around it.
  for (const [id, x] of Object.entries(pins)) {
    const b = byId.has(id) ? blockFor.get(id) : undefined
    if (b && !pinned.has(b)) pinned.set(b, x - offsetOf.get(id)!)
  }
  if (pinned.size) {
    for (const row of rows) if (row.some((b) => pinned.has(b))) row.sort((p, q) => (pinned.get(p) ?? p.x) - (pinned.get(q) ?? q.x))
    for (const row of rows) settle(row, false)
    for (let i = 0; i < 3; i++) {
      for (let r = rows.length - 2; r >= 0; r--) settle(rows[r], true)
      for (let r = 1; r < rows.length; r++) settle(rows[r], false)
    }
  }

  /** The rows as they stand on the page, top first. */
  const lastRank = rows.length - 1
  const visual = (rank: number) => (rootsBelow ? lastRank - rank : rank)
  const rankOfPerson = (id: string) => blockFor.get(id)?.rank
  /** The gap on the parents' side of a row, as the page's rows it lies between: gap v is under page row v. */
  const gapBefore = (rank: number) => (rootsBelow ? visual(rank) : visual(rank) - 1)

  const heightOf = (id: string) => Math.max(CARD_H, cardHeight(byId.get(id), print))
  const rowHeight: number[] = []
  for (const row of rows) rowHeight[visual(row[0]?.rank ?? 0)] = Math.max(CARD_H, ...row.flatMap((b) => b.slots.filter((s) => byId.has(s)).map(heightOf)))

  /** A clear vertical corridor in a row, near x, for a bar that must leave from between other people. */
  const corridor = (rank: number, x: number, lo: number, hi: number) => {
    const row = rows[rank] ?? []
    const blocked = (c: number) => row.some((b) => c > b.x - b.width / 2 - 8 && c < b.x + b.width / 2 + 8)
    if (!blocked(x)) return x
    const options = row.flatMap((b) => [b.x - b.width / 2 - gap / 2, b.x + b.width / 2 + gap / 2]).filter((c) => !blocked(c) && c > lo && c < hi)
    return options.length ? options.reduce((a, c) => (Math.abs(c - x) < Math.abs(a - x) ? c : a)) : x
  }

  // First the positions along the row: everything horizontal is known before any height is chosen.
  type Bridge = { u: Union; a: string; b: string; l: string; r: string; kind: 'side' | 'over' | 'across'; x: number; net?: Net; gap?: number; hi?: string; lo?: string; dir?: number; side?: number }
  const edge = AVATAR_R + 5
  const netsByGap = new Map<number, Net[]>()
  const addNet = (gap: number, above: number[], below: number[]) => {
    const net: Net = { above, below, track: 0 }
    netsByGap.set(gap, [...(netsByGap.get(gap) ?? []), net])
    return net
  }
  const bridges: Bridge[] = g.unions.flatMap((u): Bridge[] => {
    if (!blockFor.has(u.aId) || !blockFor.has(u.bId)) return []
    const [l, r] = xOf(u.aId) < xOf(u.bId) ? [u.aId, u.bId] : [u.bId, u.aId]
    const lx = xOf(l), rx = xOf(r)
    const base = { u, a: u.aId, b: u.bId, l, r }
    if (rankOfPerson(l) === rankOfPerson(r)) {
      if (rx - lx <= pitch + 1) return [{ ...base, kind: 'side', x: (lx + rx) / 2 }]
      return [{ ...base, kind: 'over', x: corridor(rankOfPerson(l)!, (lx + rx) / 2, lx, rx) }]
    }
    // Across generations: leave sideways, go along a gap, come in from the side.
    const [hi, lo] = visual(rankOfPerson(l)!) < visual(rankOfPerson(r)!) ? [l, r] : [r, l]
    const dir = xOf(lo) >= xOf(hi) ? 1 : -1
    const x = xOf(hi) + dir * (pitch / 2)
    const side = xOf(lo) - dir * edge
    const gap = visual(rankOfPerson(hi)!)
    return [{ ...base, kind: 'across', x, hi, lo, dir, side, gap, net: addNet(gap, [x], [side]) }]
  })
  const bridgeOfPair = new Map<string, Bridge>()
  for (const b of bridges) {
    const pair = [b.a, b.b].sort().join('|')
    if (!bridgeOfPair.has(pair)) bridgeOfPair.set(pair, b)
  }

  type Group = { f: Family; rank: number; kids: string[]; dot?: Bridge; sources: string[]; x: number; legs: { gap: number; net?: Net; to: number }[]; bar: Net; lo: number; hi: number; trunkX: number }
  const groups: Group[] = []
  for (const f of [...byFamily.values()]) {
    const ps = f.parents.filter((p) => blockFor.has(p))
    if (!ps.length) continue
    const dot = f.parents.length === 2 ? bridgeOfPair.get([...f.parents].sort().join('|')) : undefined
    const x = dot ? dot.x : mean(ps.map(xOf))
    const nearest = Math.max(...ps.map((p) => rankOfPerson(p)!))
    for (const [rank, kids] of Map.groupBy(f.children.filter((c) => blockFor.has(c)), (c) => rankOfPerson(c)!)) {
      const legs: Group['legs'] = []
      let at = x
      for (let r = nearest + 1; r < rank; r++) {
        const to = xOf(passKey(f.key, rank, r))
        const gap = gapBefore(r)
        legs.push({ gap, to, net: to === at ? undefined : addNet(gap, rootsBelow ? [to] : [at], rootsBelow ? [at] : [to]) })
        at = to
      }
      const xs = kids.map(xOf)
      const gap = gapBefore(rank)
      const bar = addNet(gap, rootsBelow ? xs : [at], rootsBelow ? [at] : xs)
      groups.push({ f, rank, kids, dot, sources: ps, x, legs, bar, lo: Math.min(...xs, at), hi: Math.max(...xs, at), trunkX: at })
    }
  }

  // Now the heights: each gap is as tall as its bars need.
  const tracksOf = new Map<number, number>()
  for (const [gap, nets] of netsByGap) tracksOf.set(gap, assignTracks(nets))
  const gapHeight = (gap: number) => Math.max(RANK_SEP, 2 * GAP_EDGE + ((tracksOf.get(gap) ?? 1) - 1) * LANE)
  const rowTop: number[] = []
  let y = 0
  for (let v = 0; v <= lastRank; v++) {
    rowTop[v] = y
    y += rowHeight[v] + gapHeight(v)
  }
  const gapTop = (gap: number) => (gap < 0 ? -gapHeight(gap) : rowTop[gap] + rowHeight[gap])
  const netY = (gap: number, net: Net) => gapTop(gap) + (gapHeight(gap) - ((tracksOf.get(gap) ?? 1) - 1) * LANE) / 2 + net.track * LANE

  const cards = new Map<string, CardPos>()
  for (const row of rows) for (const b of row) for (const id of b.slots) if (byId.has(id)) cards.set(id, { id, x: xOf(id), y: rowTop[visual(b.rank)] })

  const unions: UnionPos[] = bridges.map((br) => {
    const l = cards.get(br.l)!, r = cards.get(br.r)!
    const y1 = l.y + AVATAR_CY, y2 = r.y + AVATAR_CY
    const common = { id: br.u.id, union: br.u, x1: l.x, x2: r.x }
    if (br.kind === 'side') return { ...common, x: br.x, y: y1, path: `M${l.x + edge} ${y1}H${r.x - edge}`, box: boxOf([[l.x, y1], [r.x, y1]]) }
    if (br.kind === 'over') {
      const top = l.y - 14
      const points: [number, number][] = [[l.x, y1 - edge], [l.x, top], [r.x, top], [r.x, y2 - edge]]
      return { ...common, x: br.x, y: top, path: orthogonal(points), box: boxOf(points) }
    }
    const hi = cards.get(br.hi!)!, lo = cards.get(br.lo!)!
    const midY = netY(br.gap!, br.net!)
    const points: [number, number][] = [[hi.x + br.dir! * edge, hi.y + AVATAR_CY], [br.x, hi.y + AVATAR_CY], [br.x, midY], [br.side!, midY], [br.side!, lo.y + AVATAR_CY]]
    return { ...common, x: br.x, y: midY, path: orthogonal(points), box: boxOf(points) }
  })
  const unionById = new Map(unions.map((u) => [u.id, u]))

  /** The card is a portrait over a caption, so a line comes into the portrait from above or under the caption from below. */
  const entryY = (c: CardPos) => (rootsBelow ? c.y + UNDER_CAPTION : c.y + AVATAR_CY - AVATAR_R - 4)
  /** The clickable part of a line stays outside the caption, so a click on a name is a click on the card. */
  const hitEndY = (c: CardPos) => (rootsBelow ? c.y + heightOf(c.id) : entryY(c))

  const edges: EdgePos[] = []
  for (const g2 of groups) {
    const { f, kids, trunkX: x, lo, hi, legs, bar } = g2
    const parentCards = g2.sources.map((p) => cards.get(p)!)
    const start = g2.dot ? unionById.get(g2.dot.u.id)!.y : rootsBelow ? Math.min(...parentCards.map((p) => p.y)) + AVATAR_CY - AVATAR_R - 4 : Math.max(...parentCards.map((p) => p.y)) + UNDER_CAPTION
    const path: [number, number][] = [[g2.x, start]]
    let at = g2.x
    for (const leg of legs) {
      if (leg.net) {
        const y = netY(leg.gap, leg.net)
        path.push([at, y], [leg.to, y])
      }
      at = leg.to
    }
    const barY = netY(gapBefore(g2.rank), bar)
    const shared = `${orthogonal([...path, [x, barY]])} M${lo} ${barY}H${hi}`
    const box = boxOf([...path, [x, barY], [lo, barY], [hi, barY], ...kids.flatMap((c): [number, number][] => [[cards.get(c)!.x, entryY(cards.get(c)!)], [cards.get(c)!.x, hitEndY(cards.get(c)!)]])])
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
        box,
        own: `M${t.x} ${barY}V${hitEndY(t)}`,
        tail: hitEndY(t) === entryY(t) ? '' : `M${t.x} ${hitEndY(t)}V${entryY(t)}`,
        shared,
        group: `${f.key}@${g2.rank}`,
        barAt: [t.x, barY],
        groupAt: [(lo + hi) / 2, barY],
      })
    }
  }

  const all = [...cards.values()]
  const minX = Math.min(...all.map((c) => c.x)) - CARD_W / 2, maxX = Math.max(...all.map((c) => c.x)) + CARD_W / 2
  const minY = Math.min(...all.map((c) => c.y)), maxY = Math.max(...all.map((c) => c.y + heightOf(c.id)))
  return { cards, unions, edges, bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } }
}
