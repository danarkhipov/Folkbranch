// Is a point on land? The same Natural Earth polygons the map draws (public/atlas/land.json), searched with
// bounding boxes first so a point costs a few hundred comparisons rather than the whole file.

interface Geometry { type: string; coordinates?: unknown; geometries?: Geometry[] }

/** One ring of a polygon in lon/lat degrees, with the box that holds it. */
interface Ring { west: number; south: number; east: number; north: number; points: Float64Array }
interface Area { outer: Ring; holes: Ring[] }
export interface Land { areas: Area[] }

const KM_PER_DEG_LAT = 110.57

function toRing(points: number[][]): Ring {
  const flat = new Float64Array(points.length * 2)
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity
  points.forEach(([lon, lat], i) => {
    flat[i * 2] = lon
    flat[i * 2 + 1] = lat
    if (lon < west) west = lon
    if (lon > east) east = lon
    if (lat < south) south = lat
    if (lat > north) north = lat
  })
  return { west, south, east, north, points: flat }
}

/** The land polygons of the atlas file. Read once; a ring is kept flat, which is what makes testing them quick. */
export function landFromGeoJSON(geo: unknown): Land {
  const areas: Area[] = []
  const add = (rings: number[][][]) => areas.push({ outer: toRing(rings[0]), holes: rings.slice(1).map(toRing) })
  const walk = (g: Geometry) => {
    if (g.geometries) return g.geometries.forEach(walk)
    if (g.type === 'Polygon') add(g.coordinates as number[][][])
    else if (g.type === 'MultiPolygon') (g.coordinates as number[][][][]).forEach(add)
  }
  walk(geo as Geometry)
  return { areas }
}

/** The even-odd rule, after the box has thrown away every ring that cannot hold the point. */
function inRing(r: Ring, lon: number, lat: number): boolean {
  if (lon < r.west || lon > r.east || lat < r.south || lat > r.north) return false
  const p = r.points
  let inside = false
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1]
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Whether the point lies within `km` of the ring's edge, in a flat local kilometre grid: close enough for a margin. */
function nearRing(r: Ring, lon: number, lat: number, km: number): boolean {
  const cos = Math.max(0.02, Math.cos((lat * Math.PI) / 180))
  const dx = km / (KM_PER_DEG_LAT * cos), dy = km / KM_PER_DEG_LAT
  if (lon < r.west - dx || lon > r.east + dx || lat < r.south - dy || lat > r.north + dy) return false
  const p = r.points, limit = km * km
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const ax = (lon - p[i]) * KM_PER_DEG_LAT * cos, ay = (lat - p[i + 1]) * KM_PER_DEG_LAT
    const bx = (lon - p[j]) * KM_PER_DEG_LAT * cos, by = (lat - p[j + 1]) * KM_PER_DEG_LAT
    const ex = bx - ax, ey = by - ay
    const t = ex || ey ? Math.max(0, Math.min(1, -(ax * ex + ay * ey) / (ex * ex + ey * ey))) : 0
    const px = ax + ex * t, py = ay + ey * t
    if (px * px + py * py <= limit) return true
  }
  return false
}

/**
 * A point on land, or close enough to the coast that it is still the place: the coastline here is coarse, and a
 * berth or a small island sits a few kilometres out, so the margin is the one a person would allow on a paper map.
 */
export function isOnLand(lat: number, lon: number, land: Land, km = 20): boolean {
  for (const a of land.areas) if (inRing(a.outer, lon, lat) && !a.holes.some((h) => inRing(h, lon, lat))) return true
  for (const a of land.areas) if (nearRing(a.outer, lon, lat, km) || a.holes.some((h) => nearRing(h, lon, lat, km))) return true
  return false
}

let loading: Promise<Land> | null = null
/** The same polygons in the browser, fetched once; a failure is not kept, so the next place tries again. */
export function loadLand(): Promise<Land> {
  if (!loading) loading = fetch('/atlas/land.json').then((r) => {
    if (!r.ok) throw new Error(`land.json: ${r.status}`)
    return r.json()
  }).then(landFromGeoJSON).catch((e) => { loading = null; throw e })
  return loading
}
