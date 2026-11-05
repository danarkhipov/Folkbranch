// Which height each horizontal bar takes in the gap between two rows. Choosing the order of the bars
// so that they cross least follows orthogonal hypergraph routing (Eschbach, Günther, Becker, 2006):
// for any two bars the cost of either order can be counted, then each bar is moved to its best place.

export interface Net {
  /** Verticals arriving from above, and leaving downwards. */
  above: number[]
  below: number[]
  /** Which track it got; 0 is the highest. */
  track: number
}

/** Bars closer than this cannot share a height: they would read as one line. */
const CLEARANCE = 14
const ROUNDS = 4
/** Two verticals on top of each other are far worse than a crossing. */
const ON_TOP = 100

const extent = (n: Net) => {
  const xs = [...n.above, ...n.below]
  return [Math.min(...xs), Math.max(...xs)] as const
}

/** What it costs for a to run above b. */
function cost(a: Net, b: Net) {
  const [alo, ahi] = extent(a), [blo, bhi] = extent(b)
  let c = 0
  // a's verticals go down through b's bar, b's come down through a's bar.
  for (const x of a.below) if (x >= blo && x <= bhi) c++
  for (const x of b.above) {
    if (x >= alo && x <= ahi) c++
    if (a.below.includes(x)) c += ON_TOP
  }
  return c
}

/** Fills in `track` and says how many tracks the gap needs. */
export function assignTracks(nets: Net[]) {
  const sorted = nets.toSorted((a, b) => extent(a)[0] - extent(b)[0] || extent(a)[1] - extent(b)[1])
  // Bars that share no stretch of width do not affect each other, so each cluster is solved alone.
  const clusters: Net[][] = []
  let reach = -Infinity
  for (const n of sorted) {
    const [lo, hi] = extent(n)
    if (lo - CLEARANCE > reach) clusters.push([])
    clusters.at(-1)!.push(n)
    reach = Math.max(reach, hi)
  }
  let tracks = 0
  for (const cluster of clusters) {
    const order = [...cluster]
    for (let round = 0; round < ROUNDS; round++) {
      let moved = false
      for (const n of cluster) {
        const others = order.filter((x) => x !== n)
        let here = others.reduce((sum, x) => sum + cost(n, x), 0)
        let bestAt = 0, bestCost = here
        others.forEach((x, i) => {
          here += cost(x, n) - cost(n, x)
          if (here < bestCost) {
            bestCost = here
            bestAt = i + 1
          }
        })
        others.splice(bestAt, 0, n)
        if (others.some((x, i) => x !== order[i])) moved = true
        order.splice(0, order.length, ...others)
      }
      if (!moved) break
    }
    // As high as the bars above it allow, so that bars side by side share a height.
    order.forEach((n, i) => {
      const [lo, hi] = extent(n)
      n.track = 0
      for (let j = 0; j < i; j++) {
        const [plo, phi] = extent(order[j])
        if (plo - CLEARANCE <= hi && lo - CLEARANCE <= phi) n.track = Math.max(n.track, order[j].track + 1)
      }
      tracks = Math.max(tracks, n.track + 1)
    })
  }
  return tracks
}
