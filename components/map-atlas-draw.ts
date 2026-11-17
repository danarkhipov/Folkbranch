// The base map's geometry and its drawing, with no Leaflet and no page: the same code runs in the map's worker and,
// where a worker cannot draw, on the page. Natural Earth land, lakes, rivers and borders (public/atlas), simplified to
// what a screen pixel shows at each zoom and sorted into a grid, so a view draws only what it needs.
import { mercator } from '@/lib/map-motion'

export interface Geometry { type: string; coordinates: unknown; geometries?: Geometry[] }
/** Where the view is: world pixels at zoom 0 times scale, minus the offset, in CSS pixels; dpr pixels to each. */
export interface AtlasView { scale: number; ox: number; oy: number; w: number; h: number; dpr: number }
export interface AtlasColours { sepia: string; sea: string; paper: string }
export const ATLAS_FILES = ['land.json', 'lakes.json', 'rivers.json', 'borders.json'] as const

type Ring = [number, number][]
type Box = [number, number, number, number]
/**
 * Zoom 0 to 4: each level keeps the detail one screen pixel needs at its scale, and no more. From zoom 5 (scale 32)
 * the file's own points are drawn: simplifying there drops under 2% of them and costs more than it saves.
 */
const LEVEL_SCALES = [1, 2, 4, 8, 16, 32]
const FULL = 32
/** Units are sorted into a grid this many cells a side, so a view draws only the cells it touches. */
const GRID = 16
const CELL = 256 / GRID

/** A rings-in-world-pixels drawing piece: a polygon with its holes, or one line. Projected once. */
interface Unit { rings: Ring[]; box: Box }
interface PlanCell { box: Box; units: Ring[][] }
interface PlanLevel { scale: number; cells: PlanCell[] }
export interface Level { scale: number; cells: { box: Box; path: Path2D }[] }

/** Douglas–Peucker, run with a stack: keeps the ends, and every point more than tol from the line so far. */
export function simplify(points: [number, number][], tol: number): [number, number][] {
  const n = points.length
  if (n < 3) return points.slice()
  const keep = new Uint8Array(n)
  keep[0] = 1; keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let far = -1, most = tol * tol
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment2(points[i], points[a], points[b])
      if (d > most) { most = d; far = i }
    }
    if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]) }
  }
  return points.filter((_, i) => keep[i] === 1)
}

/** Squared distance from a point to a segment (no root: only compared); a segment of no length is a single point. */
function distToSegment2([x, y]: [number, number], [ax, ay]: [number, number], [bx, by]: [number, number]): number {
  const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0
  const ex = x - (ax + t * dx), ey = y - (ay + t * dy)
  return ex * ex + ey * ey
}

function bounds(pts: Ring): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  return [x0, y0, x1, y1]
}

const join = (a: Box, b: Box): Box => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]

/** The drawing pieces of a geometry. A closed polygon with its holes is one piece; an open one falls apart into lines. */
function units(g: Geometry, closed: boolean): Unit[] {
  const out: Unit[] = []
  const unit = (rings: Ring[]) => out.push({ rings, box: bounds(rings[0]) })
  const ring = (pts: [number, number][]): Ring => pts.map(([lon, lat]) => mercator([lat, lon]))
  const polygon = (rings: [number, number][][]) => {
    if (closed) unit(rings.map(ring))
    else rings.forEach((r) => unit([ring(r)]))
  }
  const walk = (geo: Geometry) => {
    if (geo.geometries) return geo.geometries.forEach(walk)
    const c = geo.coordinates as never
    if (geo.type === 'Polygon') polygon(c)
    else if (geo.type === 'MultiPolygon') (c as [number, number][][][]).forEach((p) => polygon(p))
    else if (geo.type === 'LineString') unit([ring(c)])
    else if (geo.type === 'MultiLineString') (c as [number, number][][]).forEach((l) => unit([ring(l)]))
  }
  walk(g)
  return out
}

const cellOf = (v: number) => Math.min(GRID - 1, Math.max(0, Math.floor(v / CELL)))

/** One level: every unit simplified to the tolerance, the ones too small or too thin to show dropped, the rest bucketed. */
function plan(all: Unit[], closed: boolean, scale: number): PlanLevel {
  const full = scale >= FULL, tol = 0.35 / scale
  const cells = new Map<number, PlanCell>()
  for (const u of all) {
    // A closed unit under two half-pixels across is a speck on the map: a sub-pixel island or lake.
    if (!full && closed && u.box[2] - u.box[0] < 2 * tol && u.box[3] - u.box[1] < 2 * tol) continue
    const rings: Ring[] = []
    for (const [i, r] of u.rings.entries()) {
      const s = full ? r : simplify(r, tol)
      if (s.length >= (closed ? 4 : 2)) rings.push(s)
      else if (i === 0) break // the outer ring is gone: its holes go with it
    }
    if (!rings.length) continue
    const box = rings.map(bounds).reduce(join)
    const key = cellOf((u.box[1] + u.box[3]) / 2) * GRID + cellOf((u.box[0] + u.box[2]) / 2)
    const cell = cells.get(key)
    if (cell) { cell.box = join(cell.box, box); cell.units.push(rings) }
    else cells.set(key, { box, units: [rings] })
  }
  return { scale, cells: [...cells.values()] }
}

function planLevels(g: Geometry, closed: boolean): PlanLevel[] {
  const all = units(g, closed)
  return LEVEL_SCALES.map((s) => plan(all, closed, s))
}

/** Points, units and cells per level, without any Path2D: what the drawing will hold, for the tests and for checks. */
export function levelStats(g: Geometry, closed: boolean) {
  return planLevels(g, closed).map(({ scale, cells }) => ({
    scale,
    points: cells.reduce((n, c) => n + c.units.reduce((m, rings) => m + rings.reduce((k, r) => k + r.length, 0), 0), 0),
    units: cells.reduce((n, c) => n + c.units.length, 0),
    cells: cells.length,
  }))
}

function toPath2D(units: Ring[][], closed: boolean): Path2D {
  const path = new Path2D()
  for (const rings of units) {
    for (const r of rings) {
      r.forEach(([x, y], i) => { if (i) path.lineTo(x, y); else path.moveTo(x, y) })
      if (closed) path.closePath()
    }
  }
  return path
}

/**
 * Every level of a layer, as paths in world pixels, drawn at any zoom with a transform. A level is built the first
 * time a zoom needs it, so opening the map pays for one or two levels, not all of them.
 */
export function buildLevels(g: Geometry, closed: boolean): Level[] {
  const all = units(g, closed)
  return LEVEL_SCALES.map((scale) => {
    let cells: Level['cells'] | null = null
    return {
      scale,
      get cells() {
        cells ??= plan(all, closed, scale).cells.map((c) => ({ box: c.box, path: toPath2D(c.units, closed) }))
        return cells
      },
    }
  })
}

/** The most detailed level not coarser than the scale; below the first level, the first one. */
export function pickLevel<T extends { scale: number }>(levels: T[], s: number): T {
  let pick = levels[0]
  for (const l of levels) if (l.scale <= s) pick = l
  return pick
}


type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** Builds the layers once (each level the first time a zoom needs it) and returns the drawing of one view. */
export function atlasDrawer([land, lakes, rivers, borders]: Geometry[], { sepia, sea, paper }: AtlasColours) {
  const p = { land: buildLevels(land, true), lakes: buildLevels(lakes, true), rivers: buildLevels(rivers, false), borders: buildLevels(borders, false) }
  // A quiet old atlas: paper land, thin sepia coasts, faint lakes and rivers, dashed borders.
  return (ctx: Ctx, { scale: s, ox, oy, w, h, dpr }: AtlasView) => {
    ctx.setTransform(dpr * s, 0, 0, dpr * s, -dpr * ox, -dpr * oy)
    ctx.lineJoin = 'round'
    // The view in world pixels, with a little room so a line at its edge is not cut off.
    const m = 2 / s, x0 = ox / s - m, y0 = oy / s - m, x1 = (ox + w) / s + m, y1 = (oy + h) / s + m
    const visible = (lv: Level, act: (path: Path2D) => void) => {
      for (const c of lv.cells) if (c.box[0] <= x1 && c.box[2] >= x0 && c.box[1] <= y1 && c.box[3] >= y0) act(c.path)
    }
    const fill = (lv: Level, colour: string) => {
      ctx.globalAlpha = 1; ctx.fillStyle = colour
      visible(lv, (path) => ctx.fill(path, 'evenodd'))
    }
    const line = (lv: Level, width: number, alpha: number, dash?: number[]) => {
      ctx.globalAlpha = alpha; ctx.lineWidth = width / s; ctx.setLineDash(dash ? dash.map((d) => d / s) : [])
      visible(lv, (path) => ctx.stroke(path))
    }
    const at = (levels: Level[]) => pickLevel(levels, s)
    ctx.strokeStyle = sepia
    fill(at(p.land), paper); line(at(p.land), 0.6, 0.7)
    fill(at(p.lakes), sea); line(at(p.lakes), 0.4, 0.5)
    line(at(p.rivers), 0.5, 0.35)
    line(at(p.borders), 0.6, 0.55, [3, 2])
    ctx.globalAlpha = 1; ctx.setLineDash([])
  }
}
