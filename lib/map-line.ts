// A line of descent on the map: the parent → child chain from an ancestor down to one person, and the one thread it
// draws across the generations. Each bearer carries the thread on their own route from their birth until the next in
// line is born (the handover); what they did after that is a side branch, not the thread. Where the archive does not
// say how the thread got from one place to the next (a parent elsewhere at a birth, a bearer with nothing placed), the
// join is an assumed link, drawn dashed. No position is ever made up: links run only between documented points.
import { legPath, wrapLon, type LatLon } from './map-motion'
import { lifeSpan, MOVE_YEARS, positionAt, trackLegs, type Leg, type Track } from './map-timeline'
import type { Graph, ParentKind } from './types'

export interface LineOptions {
  /** Hidden from this reader: a chain through them is taken only when no other is as short. */
  hidden?: (id: string) => boolean
  /** Has somewhere to stand on the map: among equally short chains, the best documented wins. */
  placed?: (id: string) => boolean
  /**
   * How a parent and child are linked. Every kind makes an ancestor, as it does for kinship's names (lib/kinship.ts
   * calls a step- or adoptive grandparent a grandparent); among equally short chains, one of birth links comes first.
   */
  kind?: (parent: string, child: string) => ParentKind
}

/**
 * The chain [from, …, to] when `from` is an ancestor of `to`, else null. The shortest one; where several are as short
 * (cousins who married), the one with fewest links that are not by birth, then through fewest hidden people, then
 * the one with most bearers on the map, then the first by the order the parents are written. Iterative throughout,
 * so a malformed pedigree thousands of generations deep cannot run out of stack; a cycle is met once and left.
 */
export function descentLine(parents: Map<string, string[]>, from: string, to: string, opts: LineOptions = {}): string[] | null {
  if (from === to) return null
  // How many generations each ancestor is above `to`, by the shortest way, nearest first.
  const depth = new Map([[to, 0]])
  const order = [to]
  for (let i = 0; i < order.length; i++) {
    const cur = order[i]
    for (const p of parents.get(cur) ?? []) if (!depth.has(p)) { depth.set(p, depth.get(cur)! + 1); order.push(p) }
  }
  if (!depth.has(from)) return null
  // Going down, a child is on a shortest chain when it is one generation nearer `to`.
  const down = new Map<string, string[]>()
  for (const id of order) for (const p of parents.get(id) ?? []) if (depth.get(p) === depth.get(id)! + 1) { const l = down.get(p); if (l) l.push(id); else down.set(p, [id]) }
  const hidden = opts.hidden ?? (() => false), placed = opts.placed ?? (() => true), kind = opts.kind ?? (() => 'birth')
  // The best way down from each ancestor, worked out nearest `to` first, so each child's is known before its parent's.
  type Best = { next: string | null; notBirth: number; hidden: number; unplaced: number }
  const best = new Map<string, Best>()
  const better = (a: Best, b: Best) => a.notBirth - b.notBirth || a.hidden - b.hidden || a.unplaced - b.unplaced
  for (const id of order) {
    const self = { hidden: hidden(id) ? 1 : 0, unplaced: !hidden(id) && !placed(id) ? 1 : 0 }
    if (id === to) { best.set(id, { next: null, notBirth: 0, ...self }); continue }
    let pick: Best | null = null
    for (const c of down.get(id) ?? []) {
      const b = best.get(c)!
      const via = { next: c, notBirth: b.notBirth + (kind(id, c) === 'birth' ? 0 : 1), hidden: b.hidden + self.hidden, unplaced: b.unplaced + self.unplaced }
      if (!pick || better(via, pick) < 0) pick = via
    }
    if (pick) best.set(id, pick)
    if (id === from) break
  }
  const out = [from]
  for (let cur = best.get(from)?.next ?? null; cur !== null; cur = best.get(cur)!.next) out.push(cur)
  return out
}

/**
 * The line offered from an ancestor: to the first of `ends` (the reader's own person, then the tree's root) they are an
 * ancestor of, else null. Never from or to someone hidden from this reader: such a line is not offered at all, as for
 * an id nobody has. Someone hidden in the middle stays in the chain, counted but never named or drawn.
 */
export function lineFor(parents: Map<string, string[]>, anc: string | null, ends: (string | null)[], opts: LineOptions = {}): { ids: string[]; end: string } | null {
  const hidden = opts.hidden ?? (() => false)
  if (!anc || !parents.has(anc) || hidden(anc)) return null
  for (const end of ends) {
    if (!end || end === anc || !parents.has(end) || hidden(end)) continue
    const ids = descentLine(parents, anc, end, opts)
    if (ids) return { ids, end }
  }
  return null
}

/**
 * The tree's view with everyone in the line added (the line may run outside it), with their marriages. A marriage to
 * someone hidden from this reader stays out, as it does everywhere else: the partner is not in the view to say so.
 */
export function withLine(view: Graph, whole: Graph, ids: string[]): Graph {
  const extra = new Set(ids.filter((id) => !view.persons.some((p) => p.id === id)))
  if (!extra.size) return view
  const hidden = new Set(whole.persons.filter((p) => p.hidden).map((p) => p.id))
  const persons = [...view.persons, ...whole.persons.filter((p) => extra.has(p.id))]
  const unions = [...view.unions, ...whole.unions.filter((u) => (extra.has(u.aId) || extra.has(u.bId)) && !hidden.has(u.aId) && !hidden.has(u.bId) && !view.unions.includes(u))]
  return { ...view, persons, unions }
}

/** One bearer as the thread sees them: their route (null with nothing placed), birth year, and whether hidden. */
export interface Bearer { id: string; track: Track | null; born: number | null; hidden?: boolean }
/** A piece of the thread: along a documented journey, or an assumed link between two documented points. */
export interface ThreadSeg { kind: 'route' | 'link'; pts: LatLon[]; /** The year each point is passed. */ at: number[] }
/** One generation's share of the thread: from the handover to them until the next. */
export interface Stretch { personId: string; from: number; to: number; segs: ThreadSeg[] }
/** Where the thread passes to the next generation (gen 1 is where it starts, with the ancestor). */
export interface Handover {
  gen: number; year: number; child: string; parent: string | null
  /** Where the child takes it up; null when they have nothing placed (or are hidden, then there is no handover at all). */
  lat: number | null; lon: number | null; place: string
  /** The year the archive puts them at `place`: `year`, or later when they were first placed there after it. */
  placeYear: number
  /** The parent was somewhere else: the two are joined by an assumed link. */
  linked: boolean
  /** The year is the child's birth (not their first placed event, nor a year held back to the parent's). */
  birth: boolean
  /** Where the child was born, when the archive says; '' when not ("place" is then only where they were first placed). */
  bornAt: string
}
export interface Thread {
  stretches: Stretch[]; handovers: Handover[]
  /** Someone in the line, not hidden, stands somewhere on the map: else there is no thread to draw at all. */
  placed: boolean
  /** Each bearer's life after handing over, apart from the thread. */
  branches: { personId: string; segs: ThreadSeg[] }[]
  start: number; end: number
}

/** The year a person stands somewhere on their route: kept inside their life, so the ends of a life are its places. */
function standAt(track: Track, y: number) {
  const [a, b] = lifeSpan(track)
  const pos = positionAt(track, Math.max(a, Math.min(b, y)))
  if (pos) { const st = pos.moving && pos.progress > 0.5 ? pos.moving : pos.at; return { lat: pos.lat, lon: pos.lon, place: st.place, year: st.year } }
  const s = track.stops[0]
  return { lat: s.lat, lon: s.lon, place: s.place, year: s.year }
}

/** A journey cut to the years a..b: its points passed then, with the points at the cut ends put in. */
export function clipLeg(leg: Leg, a: number, b: number): ThreadSeg | null {
  if (leg.arrive <= a || leg.leave >= b) return null
  const { pts } = leg.path, at = leg.at
  const out: ThreadSeg = { kind: 'route', pts: [], at: [] }
  const cut = (i: number, y: number) => {
    const f = (y - at[i]) / (at[i + 1] - at[i] || 1)
    out.pts.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f])
    out.at.push(y)
  }
  for (let i = 0; i < pts.length; i++) {
    if (at[i] >= a && at[i] <= b) { out.pts.push(pts[i]); out.at.push(at[i]) }
    if (i + 1 < pts.length) {
      if (at[i] < a && at[i + 1] > a) cut(i, a)
      if (at[i] < b && at[i + 1] > b) cut(i, b)
    }
  }
  return out.pts.length > 1 ? out : null
}

/** An assumed join between two documented points, on the same curves as journeys, passed over years t0..t1. */
function link(a: LatLon, b: LatLon, t0: number, t1: number): ThreadSeg {
  const path = legPath(a, b)
  return { kind: 'link', pts: path.pts, at: path.cum.map((c) => t0 + (t1 - t0) * c) }
}

/**
 * The thread for a chain of bearers, oldest first, up to `now`. Rules: the first bearer carries it from their first
 * placed event; each next one takes it at their birth (or, with no birth year, at their first placed event), never
 * before the one above; the last carries it to the end of their life or `now`. A bearer with nothing placed, or
 * hidden, carries no route: the thread waits at the last known point and a dashed link runs to the next known one in
 * the last stretch before it is reached (a move takes at most MOVE_YEARS, as on the routes).
 */
export function lineThread(bearers: Bearer[], now: number): Thread {
  const shown = (b: Bearer) => !b.hidden && !!b.track
  // When each takes the thread up. A hidden person tells nothing, so their handover has no year of its own.
  const take: (number | null)[] = []
  let floor = -Infinity
  bearers.forEach((b, i) => {
    let y = b.hidden ? null : i === 0 ? (b.track?.stops[0].time ?? b.born) : (b.born ?? b.track?.stops[0].year ?? null)
    if (y !== null) { y = Math.max(y, floor); floor = y }
    take.push(y)
  })
  const last = bearers.at(-1)
  const lifeEnd = (b: Bearer) => (b.track ? Math.min(now, lifeSpan(b.track)[1]) : now)
  const end = Math.max(floor, last ? lifeEnd(last) : now)
  const start = take.find((y) => y !== null) ?? end
  const stretches: Stretch[] = [], handovers: Handover[] = [], branches: Thread['branches'] = []
  let prev: { at: LatLon; year: number } | null = null
  bearers.forEach((b, i) => {
    const from = take[i]
    const nextTake = take.slice(i + 1).find((y) => y !== null) ?? null
    const to = i === bearers.length - 1 ? end : (nextTake ?? end)
    const st: Stretch = { personId: b.id, from: from ?? prev?.year ?? start, to, segs: [] }
    if (!b.hidden) stretches.push(st)
    const up = bearers[i - 1]
    if (!shown(b) || from === null) {
      if (!b.hidden && from !== null) handovers.push({ gen: i + 1, year: from, child: b.id, parent: up?.id ?? null, lat: null, lon: null, place: '', placeYear: from, linked: false, birth: i > 0 && from === b.born, bornAt: '' })
      return
    }
    const tr = b.track!
    const s = standAt(tr, from)
    // From the last known point to where this bearer takes over: an assumed link, unless it is the same place.
    let linked = false
    if (prev && (prev.at[0] !== s.lat || prev.at[1] !== s.lon)) {
      st.segs.push(link(prev.at, [s.lat, s.lon], Math.max(prev.year, from - MOVE_YEARS), from))
      linked = true
    }
    handovers.push({ gen: i + 1, year: from, child: b.id, parent: up?.id ?? null, lat: s.lat, lon: s.lon, place: s.place, placeYear: Math.max(from, s.year), linked, birth: i > 0 && from === b.born, bornAt: tr.stops.find((x) => x.kind === 'birth')?.place ?? '' })
    const stop = Math.min(to, lifeEnd(b))
    for (const leg of trackLegs(tr)) { const seg = clipLeg(leg, from, stop); if (seg) st.segs.push(seg) }
    const e = standAt(tr, stop)
    prev = { at: [e.lat, e.lon], year: stop }
    // The rest of their own life, after the thread went on without them.
    if (i < bearers.length - 1) {
      const after = trackLegs(tr).flatMap((leg) => clipLeg(leg, stop, Infinity) ?? [])
      if (after.length) branches.push({ personId: b.id, segs: after })
    }
  })
  return { stretches, handovers, branches, start, end, placed: handovers.some((h) => h.lat !== null) }
}

/** Who carries the thread at a moment: the youngest in line who has already taken it up. */
export function bearerAt(thread: Thread, y: number): string | null {
  let out: string | null = null
  for (const s of thread.stretches) if (s.from <= y) out = s.personId
  return out
}

/** Every point of the thread, for framing it whole. */
export function threadPoints(thread: Thread): [number, number][] {
  const out: [number, number][] = []
  // Every fourth point and each end: a great circle bulges past its ends, and the points run on past ±180°.
  for (const s of thread.stretches) for (const seg of s.segs) seg.pts.forEach((p, i) => { if (i % 4 === 0 || i === seg.pts.length - 1) out.push([p[0], wrapLon(p[1])]) })
  for (const h of thread.handovers) if (h.lat !== null && h.lon !== null) out.push([h.lat, h.lon])
  return out
}
