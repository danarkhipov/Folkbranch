// When the map's camera moves while the family plays. It holds still: it widens only when someone shown (now or in
// the next few seconds) would leave the safe part of the screen, and closes in only when everyone, now and soon,
// sits in a small part of it. Pure, in screen pixels.
import type { Box } from './map-layout'
import { along, wrapLon } from './map-motion'
import { lifeSpan, positionAt, trackLegs, type Track } from './map-timeline'

export type CameraCall = 'widen' | 'close' | null

/** Everyone, now and soon, fits in less than this share of the safe width and height: worth closing in. */
const SMALL = 0.3

/** What the camera should do, given where people are now and will be soon (screen points) and the safe box. */
export function cameraCall(points: [number, number][], safe: Box): CameraCall {
  if (!points.length) return null
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity
  for (const [x, y] of points) { l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); b = Math.max(b, y) }
  if (l < safe[0] || t < safe[1] || r > safe[2] || b > safe[3]) return 'widen'
  if (r - l < (safe[2] - safe[0]) * SMALL && b - t < (safe[3] - safe[1]) * SMALL) return 'close'
  return null
}

/**
 * Where the people shown will be between two moments: a few samples, plus both ends of every journey under way or
 * starting in between, so the camera widens before a crossing instead of chasing it.
 */
export function aheadPoints(tracks: Track[], from: number, to: number, steps = 6): [number, number][] {
  const out: [number, number][] = []
  for (const tr of tracks) {
    // A life that is over before this stretch, or has not begun by its end, is nowhere on the map in it: the span is
    // kept per track, so this drops most of a family before even one position is worked out.
    const [start, end] = lifeSpan(tr)
    if (end < from || start > to) continue
    for (let i = 0; i <= steps; i++) {
      const p = positionAt(tr, from + ((to - from) * i) / steps)
      if (p) out.push([p.lat, p.lon])
    }
    for (const leg of trackLegs(tr)) {
      if (leg.arrive < from || leg.leave > to || !positionAt(tr, Math.max(from, leg.leave))) continue
      // The middle of a journey over the 180° meridian is put back on the one world, as the faces are.
      const [la, lo] = along(leg.path, 0.5)
      out.push([leg.from.lat, leg.from.lon], [la, wrapLon(lo)], [leg.to.lat, leg.to.lon])
    }
  }
  return out
}
