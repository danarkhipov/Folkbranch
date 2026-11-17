// How a person travels on the map: along a curve, slow to start and slow to arrive. Long legs follow the great
// circle (the way a ship or plane goes), short ones a gentle bow, so a return trip does not hide under the way out.
// Pure: points are worked out once per leg and cached by the two ends.

/** A point in the map's own pixels at zoom 0 (Web Mercator, 256 wide, as Leaflet draws it). Multiply by 2^zoom. */
export type World = [number, number]
export type LatLon = [number, number]

const R = 6371
const rad = Math.PI / 180
/** Longer than this, a leg follows the great circle; shorter, a bow. */
export const GREAT_CIRCLE_KM = 800
/** How far a short leg bows out to its left, as a share of its length. */
const BOW = 0.18

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

/** Points along the great circle from a to b, ends included; longitudes kept continuous so a line never wraps. */
export function greatCircle(a: LatLon, b: LatLon, n = 64): LatLon[] {
  const v = ([lat, lon]: LatLon) => [Math.cos(lat * rad) * Math.cos(lon * rad), Math.cos(lat * rad) * Math.sin(lon * rad), Math.sin(lat * rad)]
  const p = v(a), q = v(b)
  const omega = Math.acos(Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])))
  if (omega < 1e-9) return [a, b]
  const out: LatLon[] = []
  let prevLon = a[1]
  for (let i = 0; i <= n; i++) {
    const f = i / n, s = Math.sin(omega)
    const ka = Math.sin((1 - f) * omega) / s, kb = Math.sin(f * omega) / s
    const x = ka * p[0] + kb * q[0], y = ka * p[1] + kb * q[1], z = ka * p[2] + kb * q[2]
    let lon = Math.atan2(y, x) / rad
    while (lon - prevLon > 180) lon -= 360
    while (lon - prevLon < -180) lon += 360
    prevLon = lon
    out.push([Math.atan2(z, Math.hypot(x, y)) / rad, lon])
  }
  out[0] = a
  out[n] = [b[0], out[n][1]]
  return out
}

/** A gentle bow from a to b, bulging to the left of the way of travel: b to a bulges the other side. */
export function bow(a: LatLon, b: LatLon, n = 32): LatLon[] {
  // In a flat, locally true frame (longitude shrunk by the latitude), so the bow is round on the map.
  const k = Math.cos(((a[0] + b[0]) / 2) * rad)
  const dx = (b[1] - a[1]) * k, dy = b[0] - a[0]
  // Left of the direction of travel: (-dy, dx), then back to degrees.
  const c: LatLon = [(a[0] + b[0]) / 2 + dx * BOW * 2, (a[1] + b[1]) / 2 + (-dy * BOW * 2) / (k || 1)]
  const out: LatLon[] = []
  for (let i = 0; i <= n; i++) {
    const f = i / n, g = 1 - f
    out.push([g * g * a[0] + 2 * g * f * c[0] + f * f * b[0], g * g * a[1] + 2 * g * f * c[1] + f * f * b[1]])
  }
  return out
}

/**
 * One leg's way, sampled: points, the same in world pixels, and the share of the length covered at each point. The
 * points run on past ±180° when the short way crosses that meridian (Tokyo to San Francisco goes east to 237.6°);
 * `wraps` says which way it ran off (1 east, −1 west), so the drawing repeats it one world over and it meets itself.
 */
export interface Path { pts: LatLon[]; world: World[]; cum: number[]; wraps: -1 | 0 | 1 }

const paths = new Map<string, Path>()
/** The way from a to b, made once and remembered: a great circle when long, a bow when short. */
export function legPath(a: LatLon, b: LatLon): Path {
  const key = `${a[0]},${a[1]};${b[0]},${b[1]}`
  let p = paths.get(key)
  if (!p) {
    // The short way round: a hop from 179.5° to −179.5° is one degree, not the whole map.
    const near: LatLon = [b[0], b[1] - a[1] > 180 ? b[1] - 360 : b[1] - a[1] < -180 ? b[1] + 360 : b[1]]
    const pts = distanceKm(a, b) > GREAT_CIRCLE_KM ? greatCircle(a, near) : bow(a, near)
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

/** The point at share s of a path's length (0 = start, 1 = end), so travel is even along the curve. */
export function along(path: Path, s: number): LatLon {
  const { pts, cum } = path
  if (s <= 0) return pts[0]
  if (s >= 1) return pts.at(-1)!
  let lo = 0, hi = cum.length - 1
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid }
  const f = (s - cum[lo]) / (cum[hi] - cum[lo] || 1)
  return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * f, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f]
}
