// How a person travels on the map: from one place to the next along a line that bows only slightly to its left, slow
// to start and slow to arrive. The line is drawn on the screen, not along the globe: a family's moves read as "from
// here to there", and a great circle that swung far from both towns was taken for a journey through the places under
// it. The slight bow keeps the way there and the way back apart. Pure: points are worked out once per leg and cached.

/** A point in the map's own pixels at zoom 0 (Web Mercator, 256 wide, as Leaflet draws it). Multiply by 2^zoom. */
export type World = [number, number]
export type LatLon = [number, number]

const R = 6371
const rad = Math.PI / 180
/** The same projection as Leaflet's EPSG:3857 at zoom 0, so the canvas and the markers agree to the pixel. */
export function mercator([lat, lon]: LatLon): World {
  const phi = Math.max(-85.0511287798, Math.min(85.0511287798, lat)) * rad
  return [256 * (0.5 + lon / 360), 256 * (0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI))]
}

/** A longitude put back on the one world the map draws, −180 to 180. */
export const wrapLon = (lon: number) => (lon >= -180 && lon <= 180 ? lon : ((((lon + 180) % 360) + 360) % 360) - 180)

export function distanceKm([lat1, lon1]: LatLon, [lat2, lon2]: LatLon): number {
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Slow out, slow in: a cubic, so a traveller sets off gently, crosses at speed and settles on arrival. */
export const easeInOut = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2)
/** The time at which the eased motion has covered share s of the way. */
export const easeInOutInverse = (s: number) => (s <= 0 ? 0 : s >= 1 ? 1 : s < 0.5 ? Math.cbrt(s / 4) : 1 - Math.cbrt(2 * (1 - s)) / 2)

/** The latitude and longitude of a point in the map's own pixels at zoom 0: the inverse of `mercator`. */
export function unmercator([x, y]: World): LatLon {
  return [(2 * Math.atan(Math.exp(Math.PI * (1 - y / 128))) - Math.PI / 2) / rad, (x / 256 - 0.5) * 360]
}

/** How far a line bows out to the left of its way at its middle, as a share of its length on the map. */
export const BOW = 0.06

/**
 * Points from a to b as the map draws them, ends included: nearly straight, bowed a little to the left of the way of
 * travel, so b to a bows the other side and a return does not hide under the way out.
 */
export function straight(a: LatLon, b: LatLon, n = 16): LatLon[] {
  const p = mercator(a), q = mercator([b[0], 0])
  // b's longitude is used as given, even past ±180°, so the short way over that meridian stays one line.
  const qx = 256 * (0.5 + b[1] / 360)
  const dx = qx - p[0], dy = q[1] - p[1]
  const out: LatLon[] = []
  for (let i = 0; i <= n; i++) {
    const f = i / n, k = BOW * 4 * f * (1 - f)
    // Left of the way on the screen, where y grows downwards: (dy, -dx).
    out.push(unmercator([p[0] + dx * f + dy * k, p[1] + dy * f - dx * k]))
  }
  out[0] = a
  out[n] = b
  return out
}

/**
 * One leg's way, sampled: points, the same in world pixels, and the share of the length covered at each point. The
 * points run on past ±180° when the short way crosses that meridian (Tokyo to San Francisco goes east to 237.6°);
 * `wraps` says which way it ran off (1 east, −1 west), so the drawing repeats it one world over and it meets itself.
 */
export interface Path { pts: LatLon[]; world: World[]; cum: number[]; wraps: -1 | 0 | 1 }

const paths = new Map<string, Path>()
/** The way from a to b, made once and remembered: a straight line on the map. */
export function legPath(a: LatLon, b: LatLon): Path {
  const key = `${a[0]},${a[1]};${b[0]},${b[1]}`
  let p = paths.get(key)
  if (!p) {
    // The short way round: a hop from 179.5° to −179.5° is one degree, not the whole map.
    const near: LatLon = [b[0], b[1] - a[1] > 180 ? b[1] - 360 : b[1] - a[1] < -180 ? b[1] + 360 : b[1]]
    const pts = straight(a, near)
    const world = pts.map(mercator)
    const cum = [0]
    for (let i = 1; i < world.length; i++) cum.push(cum[i - 1] + Math.hypot(world[i][0] - world[i - 1][0], world[i][1] - world[i - 1][1]))
    const total = cum.at(-1) || 1
    const lons = pts.map((x) => x[1])
    p = { pts, world, cum: cum.map((c) => c / total), wraps: Math.max(...lons) > 180 ? 1 : Math.min(...lons) < -180 ? -1 : 0 }
    if (paths.size > 5000) paths.clear()
    paths.set(key, p)
  }
  return p
}

/** The point at share s of a path's length (0 = start, 1 = end), so travel is even along the line. */
export function along(path: Path, s: number): LatLon {
  const { pts, cum } = path
  if (s <= 0) return pts[0]
  if (s >= 1) return pts.at(-1)!
  let lo = 0, hi = cum.length - 1
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid }
  const f = (s - cum[lo]) / (cum[hi] - cum[lo] || 1)
  return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * f, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f]
}
