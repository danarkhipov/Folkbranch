// Where people have been. The last years of a journey are drawn in ink, thick at the traveller and thinning to a
// hairline behind, so the way of travel shows while it happens; a followed person's journeys carry one arrowhead
// each. A person's last finished journey stays as a faint ghost on a canvas of its own, drawn as one stroke at one
// capped ink, for a generation and then it is gone: the map shows where each one came from most recently, not a web
// of every move ever made. The person followed or under the pointer shows their whole route. Close in, a route of
// another region is left out rather than crossing the view; the one followed keeps its own curves at every zoom. A
// short ring marks an event as it happens.
import type { Thread, ThreadSeg } from '@/lib/map-line'
import { along, easeInOut, mercator, type World } from '@/lib/map-motion'
import { lifeSpan, trackLegs, type Leg, type Position, type Track } from '@/lib/map-timeline'
import type { View } from './map-canvas'

/** How many years a trail stays in full ink behind its traveller. */
export const RECENT_YEARS = 12
/** Ink of the ghost of older trails, and how thin its line: one pass at this ink, never one per journey. */
const GHOST = 0.28
const GHOST_PX = 1
/** How much of its ink the ghost keeps with n lines on screen: a few at full ink, hundreds faint. */
export function ghostInk(n: number) { return Math.min(1, Math.sqrt(40 / Math.max(1, n))) }
/** How long a person's last journey stays in the ghost: about a generation. Earlier ones leave the map at once. */
export const GHOST_YEARS = 30
/** From this zoom on, a journey that spans several screens is traffic of another region, not of this view. */
export const FAR_ZOOM = 5
const FAR_SCREENS = 1.5
/**
 * From this zoom on, the recent ink of everyone is drawn. From the world view it is not: every life's last years
 * laid over each other at that size is the black web, while the one followed keeps their recent ink at every zoom.
 */
const RECENT_ZOOM = 5
/** How much of its usual ink a recent trail keeps when n of them are on screen: fewer travellers, darker ink. */
export function recentInk(n: number) { return Math.min(1, 2.2 / Math.sqrt(Math.max(1, n))) }
const HEAD_PX = 2.5, TAIL_PX = 0.35
/** The dot where a finished journey arrived. */
const END_PX = 1.8
/** The recent stretch is drawn in this many steps of width and ink, each one stroke, so nothing is inked twice. */
const BANDS = 12
/** The arrowhead on a followed person's journeys, and the shortest journey on screen that gets one. */
const ARROW_PX = 6, ARROW_MIN_PX = 36
/** While someone is followed, everyone else's ink is this much quieter. */
const QUIET = 0.4
/** How long the ring of an event lasts, in ms. */
export const PULSE_MS = 700

export interface Pulse { at: World; t0: number }
/** A traveller's point on their journey's own way (not put back on the one world), so the line meets the face. */
const headOf = (pos: Position): World => mercator(pos.leg ? along(pos.leg.path, pos.progress) : [pos.lat, pos.lon])
/** A line of descent followed: its thread, everyone in it, and a key that changes with it (for the ghost cache). */
export interface LineDraw { thread: Thread; ids: Set<string>; key: string }
export interface TrailState { departed?: boolean; tracks: Track[]; year: number; positions: Map<string, Position | null>; pulses: Pulse[]; ink: string; accent?: string; focus: Track | null; line?: LineDraw | null; /** The person under the pointer: their whole route is drawn dark. */ hover?: Track | null; /** Every finished journey, or each person's last one (the default). */ routes?: 'recent' | 'all'; /** The routes layer: off leaves only the person followed, the one pointed at and a line. */ trails?: boolean; /** Story focus: the relatives a story names keep their ink, everyone else is quieter. */ apart?: Set<string> | null; /** The story's key, for the ghost cache. */ story?: string | null }

/** The thread: ahead of the clock a faint outline, behind it full ink; an assumed link is dashed in both. */
const THREAD_AHEAD = 0.2, THREAD_INK = 0.9, THREAD_PX = 2.4, LINK_PX = 1.6, DASH = [5, 5]
/** What a bearer did after handing over, quieter than the thread but plainly theirs. */
const BRANCH = 0.42
/** A segment's points in world pixels, worked out once. */
const worlds = new WeakMap<ThreadSeg, World[]>()
const worldOf = (seg: ThreadSeg) => { let w = worlds.get(seg); if (!w) { w = seg.pts.map(mercator); worlds.set(seg, w) } return w }
/** Which way a segment runs past the 180° meridian, if it does: worked out once, not on every frame. */
const wrapsOf = new WeakMap<ThreadSeg, number>()
const wrapOf = (seg: ThreadSeg) => {
  let w = wrapsOf.get(seg)
  if (w === undefined) { const lons = seg.pts.map((p) => p[1]); w = Math.max(...lons) > 180 ? 1 : Math.min(...lons) < -180 ? -1 : 0; wrapsOf.set(seg, w) }
  return w
}

/** World width at zoom 0, for drawing a journey over the 180° meridian once more, one world over. */
const WORLD = 256

/** A journey's own box in world pixels, worked out once, so one off the canvas is skipped before any point is drawn. */
const boxes = new WeakMap<Leg, [number, number, number, number]>()
function legBox(leg: Leg): [number, number, number, number] {
  let b = boxes.get(leg)
  if (!b) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const w of leg.path.world) { if (w[0] < x0) x0 = w[0]; if (w[0] > x1) x1 = w[0]; if (w[1] < y0) y0 = w[1]; if (w[1] > y1) y1 = w[1] }
    b = [x0, y0, x1, y1]
    boxes.set(leg, b)
  }
  return b
}
/** Whether a journey's world box meets what the canvas covers. A journey over ±180° is always drawn, on both worlds. */
function onCanvas(b: [number, number, number, number], v: View) {
  const x0 = v.ox / v.scale, x1 = (v.ox + v.w) / v.scale, y0 = v.oy / v.scale, y1 = (v.oy + v.h) / v.scale
  return b[2] >= x0 && b[0] <= x1 && b[3] >= y0 && b[1] <= y1
}

/**
 * Whether a journey is foreign traffic at this zoom: from this far in, a line longer than several screens belongs to
 * another region and only cuts across the view. The world view keeps it (there everything is one view).
 */
export function legTooFar(b: [number, number, number, number], v: Pick<View, 'scale' | 'w' | 'h'>) {
  if (Math.log2(v.scale) < FAR_ZOOM) return false
  return (b[2] - b[0]) * v.scale > FAR_SCREENS * v.w || (b[3] - b[1]) * v.scale > FAR_SCREENS * v.h
}

/** The points of a recent trail, kept per track and filled again each frame rather than made anew. */
const recentPts = new WeakMap<Track, World[]>()
const recentAt = new WeakMap<Track, number[]>()

/** Drops the rings that have faded, in place. Whoever starts a ring's frames ages them, whether trails are drawn or not. */
export function agePulses(pulses: Pulse[], now: number) {
  let n = 0
  for (const p of pulses) if (now - p.t0 < PULSE_MS) pulses[n++] = p
  pulses.length = n
}

/** Every journey's arrival year, sorted, for the lives drawn in the ghost: built once per family and choice. */
const arrivals = new WeakMap<Track[], { who: string; years: Float64Array }>()
const departures = new WeakMap<Track[], { who: string; years: Float64Array }>()
/** How many journeys of the ghost have finished by a year, by binary search instead of walking every life each frame. */
function finishedBy(tracks: Track[], who: string, apart: (id: string) => boolean, year: number, field: 'arrive' | 'leave' = 'arrive') {
  const cache = field === 'arrive' ? arrivals : departures
  let a = cache.get(tracks)
  if (!a || a.who !== who) {
    const ys: number[] = []
    for (const tr of tracks) if (!apart(tr.personId)) for (const leg of trackLegs(tr)) ys.push(leg[field])
    a = { who, years: Float64Array.from(ys.sort((x, y) => x - y)) }
    cache.set(tracks, a)
  }
  let lo = 0, hi = a.years.length
  while (lo < hi) { const m = (lo + hi) >> 1; if (a.years[m] <= year) lo = m + 1; else hi = m }
  return lo
}

/** The year after which each life is gone (its end plus one), sorted: how many lives have ended is part of what the ghost shows. */
const endings = new WeakMap<Track[], { who: string; years: Float64Array }>()
function endedBy(tracks: Track[], who: string, apart: (id: string) => boolean, year: number) {
  let a = endings.get(tracks)
  if (!a || a.who !== who) {
    const ys: number[] = []
    for (const tr of tracks) if (!apart(tr.personId)) { const e = lifeSpan(tr)[1] + 1; if (Number.isFinite(e)) ys.push(e) }
    a = { who, years: Float64Array.from(ys.sort((x, y) => x - y)) }
    endings.set(tracks, a)
  }
  let lo = 0, hi = a.years.length
  while (lo < hi) { const m = (lo + hi) >> 1; if (a.years[m] <= year) lo = m + 1; else hi = m }
  return lo
}

/** What both trail canvases draw with: world to screen, whose trails are apart, and a journey as one stroke. */
function pen({ ctx, scale: s, ox, oy, dpr }: View, st: TrailState) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.strokeStyle = st.ink
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  let shift = 0
  const X = (w: World) => (w[0] + shift) * s - ox, Y = (w: World) => w[1] * s - oy
  const focusId = st.focus?.personId
  const line = st.line ?? null
  const story = st.apart ?? null
  const quiet = focusId || line || story ? QUIET : 1
  /** Whose trails are drawn some other way: the person followed, or everyone in the line. */
  const apart = (id: string) => id === focusId || !!line?.ids.has(id)
  /** How much of its ink a trail keeps: the relatives a story names keep all of it, as before anyone was picked. */
  const inkOf = (id: string) => (story?.has(id) ? 1 : quiet)
  /** A journey's way, as one stroke; again one world over when it runs past the 180° meridian. */
  const stroke = (leg: Leg, n: number, head: World | null) => {
    for (const sh of leg.path.wraps ? [0, -leg.path.wraps * WORLD] : [0]) {
      shift = sh
      const { world } = leg.path
      ctx.beginPath()
      ctx.moveTo(X(world[0]), Y(world[0]))
      for (let i = 1; i < n; i++) ctx.lineTo(X(world[i]), Y(world[i]))
      if (head) ctx.lineTo(X(head), Y(head))
      ctx.stroke()
    }
    shift = 0
  }
  /** Draws one world over for what runs past the 180° meridian, then back. */
  const over = (wraps: number, fn: () => void) => { for (const sh of wraps ? [0, -wraps * WORLD] : [0]) { shift = sh; fn() } shift = 0 }
  return { X, Y, line, quiet, apart, inkOf, story, stroke, over }
}

export function drawGhost(v: View, st: TrailState) {
  if (st.trails === false) return
  const { ctx } = v, { year } = st
  const { quiet, apart, story } = pen(v, st)
  // The ghost goes into ONE path and is stroked once: a place where many took the same way reads no darker than a
  // lone one, so the family's routes cannot pile up into a black mass. Zoomed in, another region's long line is left
  // out rather than crossing this one. The canvas is redrawn only when a journey finishes, the view changes, or
  // someone is followed.
  ctx.fillStyle = st.ink
  ctx.lineWidth = GHOST_PX
  ctx.globalAlpha = GHOST * quiet
  ctx.beginPath()
  const ends: [number, number][] = []
  let drew = false, count = 0
  for (const tr of st.tracks) {
    if (apart(tr.personId) || story?.has(tr.personId)) continue
    // A person whose life has ended leaves with their lines, so no line runs on to nobody: unless the dead are kept, and
    // then every move they made stays.
    const gone = year >= lifeSpan(tr)[1] + 1
    if (gone && !st.departed) continue
    // Each person's last finished journey, for a generation: where they came from most recently. Or, chosen, every
    // journey so far, the family's routes building up as the years play.
    let last: Leg | null = null
    const done: Leg[] = []
    let under = false
    for (const leg of trackLegs(tr)) { if (leg.leave < year && leg.arrive > year) under = true; if (leg.arrive > year) break; last = leg; done.push(leg) }
    // One line for a traveller: while a journey is under way it is theirs, drawn live, and the one before it is let go.
    if (under && st.routes !== 'all' && !gone) continue
    for (const leg of st.routes === 'all' || gone ? done : last && year - last.arrive <= GHOST_YEARS ? [last] : []) {
      const box = legBox(leg)
      if (!leg.path.wraps && (!onCanvas(box, v) || legTooFar(box, v))) continue
      const { world } = leg.path
      const shifts = leg.path.wraps ? [0, -leg.path.wraps * WORLD] : [0]
      for (const sh of shifts) {
        ctx.moveTo((world[0][0] + sh) * v.scale - v.ox, world[0][1] * v.scale - v.oy)
        for (let i = 1; i < world.length; i++) ctx.lineTo((world[i][0] + sh) * v.scale - v.ox, world[i][1] * v.scale - v.oy)
      }
      // Where it came in, a small dot, so a route whose traveller has gone still ends at a place.
      const end = mercator([leg.to.lat, leg.to.lon])
      for (const sh of shifts) ends.push([(end[0] + sh) * v.scale - v.ox, end[1] * v.scale - v.oy])
      drew = true
      count++
    }
  }
  if (drew) {
    // Hundreds of lines at one ink fill the space between them with grey: the more of them, the quieter they are.
    ctx.globalAlpha = GHOST * quiet * ghostInk(count)
    ctx.stroke()
    // The arrival dots are one fill too: many arrivals at one place stay a dot, not a blot.
    ctx.beginPath()
    for (const [x, y] of ends) { ctx.moveTo(x + END_PX, y); ctx.arc(x, y, END_PX, 0, Math.PI * 2) }
    ctx.fill()
  }
  ctx.globalAlpha = 1
  // In story focus the relatives it names are their own pass, at full ink.
  if (story) drawGhost(v, { ...st, tracks: st.tracks.filter((tr) => story.has(tr.personId)), apart: null })
}

export function drawTrails(v: View, st: TrailState) {
  const { ctx } = v, { year } = st
  const { X, Y, line, apart, inkOf, stroke, over } = pen(v, st)
  // At the world view the recent ink of every life would be laid over every other; only the followed keeps it there.
  const recentShown = Math.log2(v.scale) >= RECENT_ZOOM
  // And a trail belongs to its traveller: one whose face is off the screen is passing through, not here. Its ink is
  // left out, so a country view is not covered by the recent years of people who are elsewhere.
  const near = (p: Position | null) => {
    if (!p) return true
    const w = mercator([p.lat, p.lon]), x = w[0] * v.scale - v.ox, y = w[1] * v.scale - v.oy
    return x >= -120 && y >= -120 && x <= v.w + 120 && y <= v.h + 120
  }
  /** Every trail of the recent years to ink this frame, and where its traveller is. */
  const live: { tr: Track; pos: Position | null }[] = []

  for (const tr of st.trails === false ? [] : st.tracks) {
    // Most lives have no journey under way and none in the last years: nothing of theirs to draw live.
    const legs = trackLegs(tr)
    if (!legs.length || legs[0].leave >= year || year - legs[legs.length - 1].arrive > RECENT_YEARS) continue
    if (apart(tr.personId)) continue
    // Nobody is left to draw live ink behind.
    if (year >= lifeSpan(tr)[1] + 1) continue
    const pos = st.positions.get(tr.personId)
    // Journeys under way: their ghost so far, live. Where the recent ink draws the same way (it does for a traveller
    // near the view), the way is drawn once, in that ink, not again underneath it.
    const inked = recentShown && near(pos ?? null)
    ctx.globalAlpha = GHOST * inkOf(tr.personId)
    ctx.lineWidth = 1.2
    for (const leg of trackLegs(tr)) {
      if (leg.leave >= year) break
      if (leg.arrive <= year || inked) continue
      // A journey entirely off the canvas, or of another region at this zoom, is not drawn point by point for nothing.
      if (!leg.path.wraps && (!onCanvas(legBox(leg), v) || legTooFar(legBox(leg), v))) continue
      let n = 0
      while (n < leg.path.world.length && leg.at[n] <= year) n++
      stroke(leg, n, pos?.leg === leg ? headOf(pos) : null)
    }
    if (inked) live.push({ tr, pos: pos ?? null })
  }
  // Recent ink is shared out by how much of it there is: with a crowd on screen each trail is quieter, so the many
  // do not add up to black, while a lone traveller is drawn as dark as before.
  const k = recentInk(live.length)
  for (const { tr, pos } of live) recent(tr, pos, k * inkOf(tr.personId))
  // The person followed: their whole life as one route in ink, and their recent travel over it.
  if (st.focus) {
    // What is still ahead of the clock is drawn faint and dashed, as a line's thread is: the way is there to read,
    // but the life does not look as if it had already been lived.
    ctx.lineWidth = 1.7
    const legs = trackLegs(st.focus)
    ctx.globalAlpha = THREAD_AHEAD
    ctx.setLineDash(DASH)
    for (const leg of legs) if (leg.arrive > st.year) stroke(leg, leg.path.world.length, null)
    ctx.setLineDash([])
    ctx.globalAlpha = 0.78
    for (const leg of legs) if (leg.arrive <= st.year) stroke(leg, leg.path.world.length, null)
    // Which way each journey went: one small arrowhead two thirds along it, where the route is long enough to read.
    // A journey there and back gets an arrow each way, so it no longer reads as one trip.
    ctx.lineWidth = 1.6
    ctx.globalAlpha = 0.9
    for (const leg of legs) {
      if (leg.arrive > st.year) continue
      const a = mercator(along(leg.path, 0.6)), b = mercator(along(leg.path, 0.66))
      const dx = (b[0] - a[0]) * v.scale, dy = (b[1] - a[1]) * v.scale, len = Math.hypot(dx, dy)
      const whole = Math.hypot((leg.path.world.at(-1)![0] - leg.path.world[0][0]) * v.scale, (leg.path.world.at(-1)![1] - leg.path.world[0][1]) * v.scale)
      if (!len || whole < ARROW_MIN_PX) continue
      const ux = dx / len, uy = dy / len
      over(leg.path.wraps, () => {
        const x = X(b), y = Y(b)
        ctx.beginPath()
        ctx.moveTo(x - ARROW_PX * (ux + 0.6 * uy), y - ARROW_PX * (uy - 0.6 * ux))
        ctx.lineTo(x, y)
        ctx.lineTo(x - ARROW_PX * (ux - 0.6 * uy), y - ARROW_PX * (uy + 0.6 * ux))
        ctx.stroke()
      })
    }
    recent(st.focus, st.positions.get(st.focus.personId) ?? null, 1)
  }

  if (line) drawLine(line.thread)
  // The person under the pointer: their whole route, every journey of the life, in full ink over the grey of the rest.
  if (st.hover && st.hover !== st.focus) {
    ctx.lineWidth = 2.2
    ctx.globalAlpha = 0.95
    for (const leg of trackLegs(st.hover)) stroke(leg, leg.path.world.length, null)
  }

  /** A piece of the thread up to a year (all of it with Infinity): one stroke, again one world over past ±180°. */
  function seg(sg: ThreadSeg, until: number) {
    const w = worldOf(sg), { at } = sg
    if (at[0] > until) return
    let n = 0
    while (n < w.length && at[n] <= until) n++
    // The point between the last one passed and the next, so the thread meets the traveller.
    let head: World | null = null
    if (n < w.length && n > 0) { const f = (until - at[n - 1]) / (at[n] - at[n - 1] || 1); head = [w[n - 1][0] + (w[n][0] - w[n - 1][0]) * f, w[n - 1][1] + (w[n][1] - w[n - 1][1]) * f] }
    if (n < 2 && !head) return
    over(wrapOf(sg), () => {
      ctx.beginPath()
      ctx.moveTo(X(w[0]), Y(w[0]))
      for (let i = 1; i < n; i++) ctx.lineTo(X(w[i]), Y(w[i]))
      if (head) ctx.lineTo(X(head), Y(head))
      ctx.stroke()
    })
  }
  /** A line of descent: side branches quiet, the whole thread faint, and in ink as far as the clock has come. */
  function drawLine(th: Thread) {
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.globalAlpha = BRANCH
    ctx.lineWidth = 1.3
    for (const b of th.branches) for (const sg of b.segs) seg(sg, year)
    const all = th.stretches.flatMap((x) => x.segs)
    for (const [alpha, until] of [[THREAD_AHEAD, Infinity], [THREAD_INK, year]] as const) {
      ctx.globalAlpha = alpha
      for (const sg of all) {
        const dashed = sg.kind === 'link'
        ctx.setLineDash(dashed ? DASH : [])
        ctx.lineWidth = dashed ? LINK_PX : THREAD_PX
        seg(sg, until)
      }
    }
    ctx.setLineDash([])
  }

  /**
   * A traveller's last years, thick and dark at them and thinning behind, continuous across journeys: the stretch is
   * cut into bands by age and each band is one stroke with round joins, so where two short journeys meet there is
   * no doubled ink and no kink.
   */
  function recent(tr: Track, pos: Position | null, k0: number) {
    const pts = recentPts.get(tr) ?? [], at = recentAt.get(tr) ?? []
    recentPts.set(tr, pts); recentAt.set(tr, at)
    pts.length = 0; at.length = 0
    let wraps = 0
    for (const leg of trackLegs(tr)) {
      if (leg.leave >= year) break
      if (year - leg.arrive > RECENT_YEARS) continue
      // The recent ink of another region does not cut across this view either.
      if (!leg.path.wraps && legTooFar(legBox(leg), v)) continue
      const { world } = leg.path
      wraps ||= leg.path.wraps
      for (let i = 0; i < world.length && leg.at[i] <= year; i++) { pts.push(world[i]); at.push(leg.at[i]) }
      if (pos?.leg === leg) { pts.push(headOf(pos)); at.push(year) }
    }
    over(wraps, () => bands(pts, at, k0))
  }
  function bands(pts: World[], at: number[], k0: number) {
    let band = -1, open = false
    const style = (b: number) => {
      const k = ((b + 0.5) / BANDS) ** 2
      ctx.globalAlpha = (0.2 + 0.75 * k) * k0
      ctx.lineWidth = TAIL_PX + (HEAD_PX - TAIL_PX) * k
    }
    ctx.lineCap = 'butt'
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i]
      if (a[0] === b[0] && a[1] === b[1]) continue
      // One journey ran on past the 180° meridian and the next starts back on the world: not a line across it.
      if (Math.abs(a[0] - b[0]) > WORLD / 2) { if (open) ctx.stroke(); open = false; band = -1; continue }
      const age = (year - (at[i - 1] + at[i]) / 2) / RECENT_YEARS
      if (age >= 1) { if (open) ctx.stroke(); open = false; band = -1; continue }
      const nb = Math.min(BANDS - 1, Math.floor((1 - age) * BANDS))
      if (nb !== band || !open) {
        if (open) ctx.stroke()
        band = nb
        style(nb)
        ctx.beginPath()
        ctx.moveTo(X(a), Y(a))
        open = true
      }
      ctx.lineTo(X(b), Y(b))
    }
    // The newest band ends in a round tip at the traveller.
    if (open) { ctx.lineCap = 'round'; ctx.stroke() }
    ctx.lineCap = 'round'
  }

  // Events as they happen: a ring that opens and fades.
  const now = performance.now()
  agePulses(st.pulses, now)
  ctx.lineWidth = 1.25
  for (const p of st.pulses) {
    const e = easeInOut(Math.min(1, (now - p.t0) / PULSE_MS) * 0.5 + 0.5) * 2 - 1 // ease-out half of the curve
    ctx.globalAlpha = 0.7 * (1 - e)
    ctx.beginPath()
    ctx.arc(X(p.at), Y(p.at), 6 + 16 * e, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

/** What the ghost shows at this moment: when it changes, the ghost is drawn again. */
export function ghostKey(st: TrailState) {
  const focusId = st.focus?.personId, line = st.line ?? null
  const apart = (id: string) => id === focusId || !!line?.ids.has(id)
  const who = `${focusId}|${line?.key}`
  // A journey enters the ghost when it ends and leaves it a generation later: either way the canvas changes.
  return `${st.routes ?? 'recent'}|${st.departed ? 'dead' : ''}|${st.trails === false ? 'off' : 'on'}|${finishedBy(st.tracks, who, apart, st.year)}-${finishedBy(st.tracks, who, apart, st.year - GHOST_YEARS - 1e-9)}-${st.routes === 'all' ? '' : finishedBy(st.tracks, who, apart, st.year - 1e-9, 'leave')}|${endedBy(st.tracks, who, apart, st.year)}|${focusId}|${line?.key}|${st.story ?? ''}|${st.ink}`
}
