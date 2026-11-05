// Who stands next to whom in each row, chosen to cross as few lines as possible. The layered method
// (Sugiyama et al., 1981): sweep the rows by barycentre, keep the best order seen, then move single
// groups to their best place (sifting). A couple is one unit, so partners always stay side by side.

/** People who stand together in a row, or the place where a line passes through it. */
export interface OrderNode {
  key: string
  /** Left to right. */
  slots: string[]
  /** Who goes first among equals: siblings stand eldest first. */
  birth: number
}

/** A line from the row above to one slot below; several slots above when it starts between partners. */
export interface OrderEdge {
  up: string[]
  down: string
  /** The row of `down`; `up` is in the row before it. */
  rank: number
}

const SWEEPS = 24
const PATIENCE = 6
const SIFT_ROUNDS = 3
const mean = (xs: number[]) => xs.reduce((a, c) => a + c, 0) / xs.length

/** Pairs out of order; equal values do not cross, since those lines start or end at one point. */
function inversions(pairs: [number, number][]) {
  const lower = pairs.toSorted((a, b) => a[0] - b[0] || a[1] - b[1]).map((p) => p[1])
  const merge = (xs: number[]): [number[], number] => {
    if (xs.length < 2) return [xs, 0]
    const mid = xs.length >> 1
    const [l, cl] = merge(xs.slice(0, mid))
    const [r, cr] = merge(xs.slice(mid))
    const out: number[] = []
    let i = 0, j = 0, count = cl + cr
    while (i < l.length || j < r.length) {
      if (j >= r.length || (i < l.length && l[i] <= r[j])) out.push(l[i++])
      else {
        count += l.length - i
        out.push(r[j++])
      }
    }
    return [out, count]
  }
  return merge(lower)[1]
}

/** How many times the values in a cross those in b when a stands to the left. */
function crossed(a: number[], b: number[]) {
  let n = 0
  for (const x of a) for (const y of b) if (x > y) n++
  return n
}

/** Reorders the rows and the slots inside their nodes in place. */
export function orderRows(rows: OrderNode[][], edges: OrderEdge[]) {
  const nodeOf = new Map<string, OrderNode>()
  for (const row of rows) for (const n of row) for (const s of n.slots) nodeOf.set(s, n)
  const coord = new Map<string, number>()
  const number = (row: OrderNode[]) => {
    let i = 0
    for (const n of row) for (const s of n.slots) coord.set(s, i++)
  }
  rows.forEach(number)
  const top = (e: OrderEdge) => mean(e.up.map((s) => coord.get(s)!))
  const bottom = (e: OrderEdge) => coord.get(e.down)!

  const byRank = Map.groupBy(edges, (e) => e.rank)
  const entering = new Map<OrderNode, OrderEdge[]>()
  const leaving = new Map<OrderNode, OrderEdge[]>()
  const note = (m: Map<OrderNode, OrderEdge[]>, n: OrderNode, e: OrderEdge) => {
    const list = m.get(n)
    if (list) { if (!list.includes(e)) list.push(e) } else m.set(n, [e])
  }
  for (const e of edges) {
    note(entering, nodeOf.get(e.down)!, e)
    for (const s of e.up) note(leaving, nodeOf.get(s)!, e)
  }
  const total = () => {
    let n = 0
    for (const list of byRank.values()) n += inversions(list.map((e) => [top(e), bottom(e)]))
    return n
  }
  const snapshot = () => rows.map((row) => row.map((n) => ({ n, slots: n.slots })))
  const restore = (saved: ReturnType<typeof snapshot>) => saved.forEach((row, r) => {
    rows[r] = row.map(({ n, slots }) => {
      n.slots = slots
      return n
    })
    number(rows[r])
  })

  const sweep = (r: number, down: boolean) => {
    const place = new Map(rows[r].map((n, i) => [n, i]))
    const value = new Map(rows[r].map((n) => {
      const seen = down ? entering.get(n)?.map(top) : leaving.get(n)?.map(bottom)
      // Rows hold different numbers of people, so a node without lines keeps its share of the way along.
      return [n, seen?.length ? mean(seen) : coord.get(n.slots[0])!] as const
    }))
    rows[r].sort((a, b) => value.get(a)! - value.get(b)! || a.birth - b.birth || place.get(a)! - place.get(b)!)
    number(rows[r])
  }

  let best = total()
  let bestOrder = snapshot()
  let stale = 0
  for (let i = 0; i < SWEEPS && best > 0 && stale < PATIENCE; i++) {
    const down = i % 2 === 0
    for (let k = 1; k < rows.length; k++) sweep(down ? k : rows.length - 1 - k, down)
    const now = total()
    if (now < best) {
      best = now
      bestOrder = snapshot()
      stale = 0
    } else stale++
  }
  restore(bestOrder)

  /** Where each node's lines end in the rows around it. These stay fixed while one row is being reordered. */
  const ends = new Map<OrderNode, { above: number[]; below: number[] }>()
  const measure = (row: OrderNode[]) => {
    for (const n of row) ends.set(n, { above: (entering.get(n) ?? []).map(top), below: (leaving.get(n) ?? []).map(bottom) })
  }
  /** What a left of b costs, counting the lines of the rows above and below this one. */
  const cost = (a: OrderNode, b: OrderNode) => {
    const p = ends.get(a)!, q = ends.get(b)!
    return crossed(p.above, q.above) + crossed(p.below, q.below)
  }

  /** Moves one node to the place in its row where it crosses least, staying put unless that is strictly better. */
  const sift = (row: OrderNode[], n: OrderNode) => {
    const from = row.indexOf(n)
    const others = row.filter((x) => x !== n)
    if (!entering.has(n) && !leaving.has(n)) return
    // Standing at the far left, then stepping over each neighbour in turn.
    let here = others.reduce((sum, x) => sum + cost(n, x), 0)
    let bestAt = 0, bestCost = here
    let atFrom = from === 0 ? here : Infinity
    others.forEach((x, i) => {
      here += cost(x, n) - cost(n, x)
      if (i + 1 === from) atFrom = here
      if (here < bestCost) {
        bestCost = here
        bestAt = i + 1
      }
    })
    if (bestCost < atFrom) {
      others.splice(bestAt, 0, n)
      row.splice(0, row.length, ...others)
    }
  }

  /** Inside a couple or a chain of marriages: only those lines are affected by turning it around. */
  const turn = (n: OrderNode, row: OrderNode[]) => {
    if (n.slots.length < 2) return
    const near = (list?: OrderEdge[]) => list ?? []
    const inside = () => {
      let c = 0
      const inn = near(entering.get(n)), out = near(leaving.get(n))
      for (const list of [inn, out]) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const dTop = top(list[i]) - top(list[j]), dBottom = bottom(list[i]) - bottom(list[j])
        if (dTop * dBottom < 0) c++
      }
      return c
    }
    const before = inside()
    if (!before) return
    n.slots = n.slots.toReversed()
    number(row)
    if (inside() >= before) {
      n.slots = n.slots.toReversed()
      number(row)
    }
  }

  for (let round = 0; round < SIFT_ROUNDS && best > 0; round++) {
    for (const row of rows) {
      measure(row)
      for (const n of [...row].sort((a, b) => (entering.get(b)?.length ?? 0) + (leaving.get(b)?.length ?? 0) - (entering.get(a)?.length ?? 0) - (leaving.get(a)?.length ?? 0))) {
        sift(row, n)
        number(row)
        turn(n, row)
      }
    }
    const now = total()
    if (now >= best) {
      if (now > best) restore(bestOrder)
      break
    }
    best = now
    bestOrder = snapshot()
  }

  // Where nothing is at stake, siblings still stand eldest first.
  for (const row of rows) {
    measure(row)
    for (let pass = 0; pass < row.length; pass++) {
      let moved = false
      for (let i = 0; i + 1 < row.length; i++) {
        const a = row[i], b = row[i + 1]
        if (a.birth > b.birth && entering.has(a) && entering.has(b) && cost(b, a) <= cost(a, b) && top(entering.get(a)![0]) === top(entering.get(b)![0])) {
          row[i] = b
          row[i + 1] = a
          moved = true
        }
      }
      if (!moved) break
    }
    number(row)
  }
}
