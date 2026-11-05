// Which part of the chart is worth keeping on the page. A large family is mostly out of sight, and
// everything out of sight costs memory and slows every highlight.

export type Box = [x1: number, y1: number, x2: number, y2: number]

/** How much of a screen is kept around the view, so that panning shows no gaps. */
const KEEP = 0.4
/** Panning this close to the edge of what is kept brings in more. */
const REFILL = 0.1
/** Zooming in leaves far too much on the page; past this share of the screen it is dropped. */
const TOO_MUCH = 8

export const touches = (a: Box, b: Box) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]
const covers = (outer: Box, inner: Box) => outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3]
const area = (b: Box) => (b[2] - b[0]) * (b[3] - b[1])

export function boxOf(points: [number, number][]): Box {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/** The chart's coordinates seen on a screen of w × h, with `margin` screens around them. */
function seen(x: number, y: number, k: number, w: number, h: number, margin: number): Box {
  return [(-x - margin * w) / k, (-y - margin * h) / k, (w - x + margin * w) / k, (h - y + margin * h) / k]
}

/** The new box to keep on the page, or null while the current one still serves: most frames of a pan change nothing. */
export function nextView(current: Box | null, x: number, y: number, k: number, w: number, h: number): Box | null {
  if (current && covers(current, seen(x, y, k, w, h, REFILL)) && area(current) <= TOO_MUCH * area(seen(x, y, k, w, h, 0))) return null
  return seen(x, y, k, w, h, KEEP)
}
