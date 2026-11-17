// Where faces and words go on the map's screen: which towns share one stack of faces, and which labels fit.
// Pure, in screen pixels, so the rules are tested without a map.

/** A town on screen with people resting there. */
export interface Spot { key: string; x: number; y: number; n: number }

/** Towns closer than this on screen share one stack. */
export const JOIN_PX = 34
/** A town already in a stack stays in it until it is this far away: a small zoom does not make faces hop. */
export const KEEP_PX = 52

/**
 * Which stack each town belongs to: town key → the key of the town the stack stands on. The busiest towns anchor
 * stacks; a town joins the nearest anchor within JOIN_PX, or keeps its stack from last time within KEEP_PX.
 */
export function stackSpots(spots: Spot[], prev: ReadonlyMap<string, string> = new Map(), join = JOIN_PX, keep = KEEP_PX): Map<string, string> {
  const order = [...spots].sort((a, b) => b.n - a.n || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const byKey = new Map(spots.map((s) => [s.key, s]))
  const out = new Map<string, string>()
  const anchors: Spot[] = []
  const d = (a: Spot, b: Spot) => Math.hypot(a.x - b.x, a.y - b.y)
  // Last time's anchors anchor again while they are still there, so a stack does not change its face.
  const wasAnchor = new Set([...prev.values()].filter((k) => byKey.has(k)))
  for (const s of order.filter((s) => wasAnchor.has(s.key)).concat(order.filter((s) => !wasAnchor.has(s.key)))) {
    const before = prev.get(s.key)
    const kept = before !== undefined && before !== s.key ? anchors.find((a) => a.key === before && d(a, s) < keep) : undefined
    let near: Spot | undefined
    if (!kept) for (const a of anchors) if (d(a, s) < join && (!near || d(a, s) < d(near, s))) near = a
    const to = kept ?? near
    if (to) out.set(s.key, to.key)
    else { anchors.push(s); out.set(s.key, s.key) }
  }
  return out
}

/** A box on screen: left, top, right, bottom. */
export type Box = [number, number, number, number]

/** How far each face of a little stack fans out to the right, in pixels. */
export const FAN_PX = 9

/** Where face `i` of a stack stands, in pixels to the right of its town. */
export const fanOffset = (i: number, fan = FAN_PX) => i * fan

/** Which face of a stack carries the name: the last one drawn, so the name stands beside the whole fan. */
export const namedFace = (shown: number) => Math.max(0, shown - 1)

/** The grid cell size of Taken, in pixels: a box is only tested against boxes in the cells it touches. */
const CELL = 64

/** Boxes already taken on screen, for placing labels greedily so none overlap. */
export class Taken {
  readonly boxes: Box[] = []
  private cells = new Map<number, Box[]>()
  /** Empties it, for the next frame to fill rather than a new one to be made. */
  clear() { this.boxes.length = 0; this.cells.clear() }
  /** A copy with the same boxes taken, to try more on without touching this one. */
  copy() {
    const t = new Taken()
    for (const b of this.boxes) t.add(b)
    return t
  }
  private each(b: Box, fn: (key: number) => boolean | void) {
    const x1 = Math.floor(b[2] / CELL), y1 = Math.floor(b[3] / CELL)
    for (let x = Math.floor(b[0] / CELL); x <= x1; x++)
      for (let y = Math.floor(b[1] / CELL); y <= y1; y++) if (fn((x + 4096) * 8192 + y + 4096)) return true
    return false
  }
  hit = (b: Box) => this.each(b, (k) => this.cells.get(k)?.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]))
  add = (b: Box) => {
    this.boxes.push(b)
    this.each(b, (k) => { const list = this.cells.get(k); if (list) list.push(b); else this.cells.set(k, [b]) })
  }
  /** Takes the first box that is free and says which; nothing taken when none is. */
  first = (choices: Box[]): number => {
    const i = choices.findIndex((b) => !this.hit(b))
    if (i >= 0) this.add(choices[i])
    return i
  }
}

/** Below this zoom a passing event's mark is not shown at all: at world size it is a stray dot among thousands. */
export const MARK_ZOOM = 5

/** Whether this choice of what to show draws event marks at this zoom (events mode always does; people mode never). */
export function marksAt(show: string, zoom: number) {
  return show !== 'people' && (show === 'events' || zoom >= MARK_ZOOM)
}

/**
 * A hairline from a mark drawn `dx, dy` pixels away from its place back to the place. The line runs from the mark
 * to the place: `len` is the distance, `angle` the canvas/CSS rotation (radians, y down). Nothing moved, no line.
 */
export function leader(dx: number, dy: number): { len: number; angle: number; moved: boolean } {
  const len = Math.hypot(dx, dy)
  return { len, angle: len > 0.5 ? Math.atan2(-dy, -dx) : 0, moved: len > 0.5 }
}

/** Faces of one town spread in a ring when the map is close enough: where face i of n goes, in pixels from the town. */
export function ringOffset(i: number, n: number, face = 28): [number, number] {
  if (n <= 1) return [0, 0]
  const r = Math.max(face * 0.75, (n * face) / (2 * Math.PI))
  const a = -Math.PI / 2 + (2 * Math.PI * i) / n
  return [Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)]
}

/**
 * Whether a stack may open into a ring here: only a group small enough to read face by face, and only where the ring
 * stays clear of the next town on screen. A village of three hundred, or one 25 km from its neighbour, stays a counted
 * stack (as map clusters do) and its card lists who is there, rather than a ring that covers the neighbour's faces.
 */
export function canRing(n: number, at: { x: number; y: number }, others: { x: number; y: number }[], max = 16, face = 28): boolean {
  if (n < 2 || n > max) return false
  const [ox, oy] = ringOffset(0, n, face)
  const reach = Math.hypot(ox, oy) + face / 2
  return others.every((o) => Math.hypot(o.x - at.x, o.y - at.y) > reach + face / 2)
}

/**
 * Where a small mark goes when its own place is already covered by another mark (two towns a few pixels apart at
 * this zoom): the nearest free spot above, below, then beside, as an offset in pixels; [0, 0] when its place is free
 * or nothing near is. The mark is displaced, as on a printed map, rather than hidden under the other.
 */
export function freeOffset(taken: Taken, box: Box): [number, number] {
  if (!taken.hit(box)) return [0, 0]
  const w = box[2] - box[0] + 4, h = box[3] - box[1] + 4
  for (const [dx, dy] of [[0, -h], [0, h], [w, 0], [-w, 0], [0, -2 * h], [0, 2 * h]] as const)
    if (!taken.hit([box[0] + dx, box[1] + dy, box[2] + dx, box[3] + dy])) return [dx, dy]
  return [0, 0]
}

/**
 * How far a town's stack of faces moves up when the person followed stands on that very spot: three face-widths,
 * enough that neither the followed face nor its name (drawn beside it) covers the stack's top face and "+N" count.
 * In a ring (a crowded town opened up at close zoom) the faces are already spread around the followed one.
 */
export const stackShift = (focusHere: boolean, spread: boolean, fan: number) => (focusHere && !spread ? 3 * fan : 0)
