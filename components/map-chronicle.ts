// The chronicle under the family: zones with dated outlines, a route through places, marked places. One canvas in its
// own pane, above the atlas and below everything of the family's own. Between two dated outlines a zone's edge slides
// from the one to the other (lib/chronicle-morph.ts, traced in a worker); until a step of that is ready, or where no
// worker can run, the two stages cross-fade instead.
import { activeAt, entryFade, stopPoint, zoneBlend, type Blend, type Entry, type LonLat, type Polygon, type MultiPolygon, type RouteStop, type Shape, type Stage, type Tone, type Zone } from '@/lib/chronicle'
import { morphStep, type FlatPolygon } from '@/lib/chronicle-morph'
import { flatOf, morphShape, soonMorph, wantMorph, type MorphShape } from './map-chronicle-morph'
import { legPath, mercator, type World } from '@/lib/map-motion'
import type * as Leaflet from 'leaflet'
import type { View } from './map-canvas'

export interface Colors { ink: string; inkSoft: string; accent: string; paper: string; sans: string; serif: string }
export interface ChronicleState {
  entries: Entry[]
  /** Each entry's shape once fetched, by key. */
  shapes: Map<string, Shape>
  year: number
  /** Only this entry's shape is drawn, with firmer lines (story focus). */
  story: string | null
  /** Names in a reader's language: an entry's text is data, picked by the caller. */
  name: (t: Zone['name']) => string
  colors: Colors
}

/** Where a stage's name goes, and from which zoom names and stops are lettered. */
const ZONE_LABEL_ZOOM = 4, STOP_LABEL_ZOOM = 5
const TILE = 6

/** A hex colour with an opacity, for the canvas. */
function rgba(hex: string, a: number) {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

interface Look { wash: string | null; edge: string; dash: number[] }
const looks = (c: Colors): Record<Tone, Look> => ({
  1: { wash: rgba(c.ink, 0.05), edge: rgba(c.ink, 0.45), dash: [] },
  2: { wash: rgba(c.accent, 0.07), edge: rgba(c.accent, 0.6), dash: [] },
  3: { wash: null, edge: rgba(c.inkSoft, 0.5), dash: [3, 2] },
})

/** Hatches by tone, made once per density: diagonal lines one way, the other way, or dots, so tones read without colour. */
const patterns = new Map<string, CanvasPattern | null>()
function hatch(ctx: CanvasRenderingContext2D, tone: Tone, dpr: number, c: Colors): CanvasPattern | null {
  const id = `${tone}:${dpr}:${c.ink}:${c.accent}:${c.inkSoft}`
  if (patterns.has(id)) return patterns.get(id)!
  const s = TILE * dpr
  const tile = document.createElement('canvas')
  tile.width = tile.height = Math.round(s)
  const g = tile.getContext('2d')!
  // The wash is in the tile too, so a stage is one fill, not two: a front over the whole screen costs a fill per stage.
  const wash = looks(c)[tone].wash
  if (wash) { g.fillStyle = wash; g.fillRect(0, 0, tile.width, tile.height) }
  if (tone === 3) {
    g.fillStyle = rgba(c.inkSoft, 0.35)
    g.beginPath(); g.arc(s / 2, s / 2, 0.6 * dpr, 0, Math.PI * 2); g.fill()
  } else {
    g.strokeStyle = tone === 1 ? rgba(c.ink, 0.22) : rgba(c.accent, 0.3)
    g.lineWidth = dpr
    g.beginPath()
    // A line corner to corner and its two neighbours' ends, so the tiles join without a seam.
    for (const k of [-1, 0, 1]) {
      if (tone === 1) { g.moveTo(k * s, s); g.lineTo(k * s + s, 0) }
      else { g.moveTo(k * s, 0); g.lineTo(k * s + s, s) }
    }
    g.stroke()
  }
  const p = ctx.createPattern(tile, 'repeat')
  patterns.set(id, p)
  return p
}

/** Each stage's rings in the map's own pixels at zoom 0, worked out once. */
const worlds = new WeakMap<Stage, World[][]>()
function ringsOf(o: Polygon | MultiPolygon): LonLat[][] { return o.type === 'Polygon' ? o.coordinates : o.coordinates.flat() }
function worldOf(st: Stage): World[][] {
  let w = worlds.get(st)
  if (!w) { w = ringsOf(st.outline).map((r) => r.map(([lon, lat]) => mercator([lat, lon]))); worlds.set(st, w) }
  return w
}
function pathOf(rings: World[][], v: View): Path2D {
  const path = new Path2D()
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const x = r[i][0] * v.scale - v.ox, y = r[i][1] * v.scale - v.oy
      if (i) path.lineTo(x, y); else path.moveTo(x, y)
    }
    path.closePath()
  }
  return path
}

interface Painted { stage: Stage; strength: number }

/** Flat rings in map pixels added to a path in the canvas's pixels. */
function addFlat(path: Path2D, xy: ArrayLike<number>, from: number, to: number, v: View) {
  for (let i = from; i < to; i += 2) {
    const x = xy[i] * v.scale - v.ox, y = xy[i + 1] * v.scale - v.oy
    if (i === from) path.moveTo(x, y); else path.lineTo(x, y)
  }
  path.closePath()
}
function polysPath(polys: FlatPolygon[][], v: View): Path2D {
  const path = new Path2D()
  for (const ps of polys) for (const p of ps) for (const r of p) addFlat(path, r, 0, r.length, v)
  return path
}

/**
 * A zone part way from one stage to the next, its edge where the move has got to. The traced edge is clipped to the
 * two stages' own outlines together (each clipped to the coast by its author), so the wash never runs into the sea or
 * past either stage; it is traced a little wide (lib/chronicle-morph.ts, `grow`) so that the fill reaches the true
 * coast. Polygons that never move are drawn whole, outside the clip.
 */
function drawMorph(ctx: CanvasRenderingContext2D, v: View, m: MorphShape, a: Stage, b: Stage, alpha: number, look: Look, pat: CanvasPattern | null, under: boolean) {
  if (alpha <= 0.001) return false
  const room = polysPath([flatOf(a), flatOf(b)], v)
  const edge = new Path2D()
  const { xy, starts } = m.loops
  for (let k = 0; k < starts.length; k++) addFlat(edge, xy, 2 * starts[k], k + 1 < starts.length ? 2 * starts[k + 1] : xy.length, v)
  const still = m.still.length ? polysPath([m.still], v) : null
  const fill = pat ?? look.wash
  const paint = (clip: Path2D | null, p: Path2D) => {
    ctx.save()
    if (clip) ctx.clip(clip, 'nonzero')
    if (under) {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = '#000'
      ctx.globalAlpha = alpha
      ctx.fill(p, 'evenodd')
      ctx.globalCompositeOperation = 'source-over'
    }
    ctx.globalAlpha = alpha
    if (fill) { ctx.fillStyle = fill; ctx.fill(p, 'evenodd') }
    ctx.strokeStyle = look.edge
    ctx.stroke(p)
    ctx.restore()
  }
  if (starts.length) paint(room, edge)
  if (still) paint(null, still)
  return true
}

/** One zone at a moment: its stage, its moving edge, or (until that is ready) its two stages cross-faded. */
function drawZone(ctx: CanvasRenderingContext2D, v: View, zone: Zone, y: number, fade: number, firm: boolean, c: Colors, under: boolean): boolean {
  const step = morphStep(zone, y)
  if (!step) return under
  const look = looks(c)[zone.tone]
  const pat = hatch(ctx, zone.tone, v.dpr, c)
  // The hatch is fixed to the land: its tiles start at the world's own pixel grid, so a pan does not make it swim.
  pat?.setTransform(new DOMMatrix().translate(-(((v.ox % TILE) + TILE) % TILE), -(((v.oy % TILE) + TILE) % TILE)).scale(1 / v.dpr))
  ctx.lineWidth = firm ? 1.5 : 1
  ctx.setLineDash(look.dash)
  let drawnAny: boolean
  const m = step.b ? morphShape(step.a, step.b, step.q) : null
  if (step.b && m) drawnAny = drawMorph(ctx, v, m, step.a, step.b, fade, look, pat, under)
  else drawnAny = drawStages(ctx, v, step.b ? zoneBlend(zone, y)! : { a: step.a, u: 0 }, fade, look, pat, under)
  ctx.setLineDash([])
  ctx.globalAlpha = 1
  return under || drawnAny
}

/** A stage on its own, or two stages cross-faded, each at its own strength. */
function drawStages(ctx: CanvasRenderingContext2D, v: View, b: Blend, fade: number, look: Look, pat: CanvasPattern | null, under: boolean): boolean {
  const parts: Painted[] = b.b ? [{ stage: b.a, strength: 1 - b.u }, { stage: b.b, strength: b.u }] : [{ stage: b.a, strength: 1 }]
  const drawn = parts.map((p) => ({ path: pathOf(worldOf(p.stage), v), a: p.strength * fade })).filter((p) => p.a > 0.001)
  // A later zone covers an earlier one: what lies under each stage is taken away at that stage's strength. Both stages
  // of one zone are taken away before either is painted, so a blend does not take away its own other half.
  // On a canvas with nothing on it yet there is nothing to take away.
  if (under) {
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = '#000'
    for (const p of drawn) { ctx.globalAlpha = p.a; ctx.fill(p.path, 'evenodd') }
    ctx.globalCompositeOperation = 'source-over'
  }
  for (const p of drawn) {
    ctx.globalAlpha = p.a
    if (pat) { ctx.fillStyle = pat; ctx.fill(p.path, 'evenodd') }
    else if (look.wash) { ctx.fillStyle = look.wash; ctx.fill(p.path, 'evenodd') }
    ctx.strokeStyle = look.edge
    ctx.stroke(p.path)
  }
  return drawn.length > 0
}

const isPlace = (s: RouteStop): s is RouteStop & { place: string; name?: string } => 'place' in s
const stopName = (s: RouteStop, name: ChronicleState['name']) => (isPlace(s) ? s.name ?? '' : s.name ? name(s.name) : '')

function drawRoute(ctx: CanvasRenderingContext2D, v: View, shape: Extract<Shape, { kind: 'route' }>, fade: number, firm: boolean, st: ChronicleState) {
  const c = st.colors
  const pts = shape.stops.map((s) => ({ s, at: stopPoint(s) }))
  const unsure = new Set(shape.unsure ?? [])
  ctx.globalAlpha = fade
  ctx.strokeStyle = rgba(c.ink, 0.7)
  ctx.lineWidth = firm ? 2.2 : 1.6
  ctx.lineCap = 'round'
  let last: { from: [number, number]; to: [number, number] } | null = null
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i].at, b = pts[i + 1].at
    if (!a || !b) continue
    const w = legPath(a, b).world
    ctx.setLineDash(unsure.has(i) ? [5, 5] : [])
    ctx.beginPath()
    for (let k = 0; k < w.length; k++) {
      const x = w[k][0] * v.scale - v.ox, y = w[k][1] * v.scale - v.oy
      if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y)
    }
    ctx.stroke()
    const n = w.length
    last = { from: [w[n - 2][0] * v.scale - v.ox, w[n - 2][1] * v.scale - v.oy], to: [w[n - 1][0] * v.scale - v.ox, w[n - 1][1] * v.scale - v.oy] }
  }
  ctx.setLineDash([])
  // An arrowhead ends the last leg.
  if (last) {
    const ang = Math.atan2(last.to[1] - last.from[1], last.to[0] - last.from[0]), L = 6
    ctx.fillStyle = rgba(c.ink, 0.7)
    ctx.beginPath()
    ctx.moveTo(last.to[0], last.to[1])
    ctx.lineTo(last.to[0] - L * Math.cos(ang - 0.45), last.to[1] - L * Math.sin(ang - 0.45))
    ctx.lineTo(last.to[0] - L * Math.cos(ang + 0.45), last.to[1] - L * Math.sin(ang + 0.45))
    ctx.closePath()
    ctx.fill()
  }
  for (const { at } of pts) {
    if (!at) continue
    const [x, y] = project(at, v)
    ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2)
    ctx.fillStyle = c.paper; ctx.fill()
    ctx.strokeStyle = rgba(c.ink, 0.8); ctx.lineWidth = 1.2; ctx.stroke()
  }
  ctx.globalAlpha = 1
}

function drawPlaces(ctx: CanvasRenderingContext2D, v: View, shape: Extract<Shape, { kind: 'places' }>, fade: number, st: ChronicleState) {
  const c = st.colors
  ctx.globalAlpha = fade
  for (const p of shape.places) {
    const at = stopPoint(p)
    if (!at) continue
    const [x, y] = project(at, v), r = 3.5
    ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath()
    ctx.fillStyle = c.ink; ctx.fill()
  }
  ctx.globalAlpha = 1
}

const project = ([lat, lon]: [number, number], v: View): [number, number] => { const w = mercator([lat, lon]); return [w[0] * v.scale - v.ox, w[1] * v.scale - v.oy] }

/** What the chronicle shows at a moment: each active entry with a shape, its fade, and the zones' blends. */
function shown(st: ChronicleState, y: number) {
  return activeAt(st.entries, y).filter((e) => st.shapes.has(e.key) && (!st.story || e.key === st.story))
}

/** The chronicle's shapes at the moment, in one pass. Zones first (they erase what is under them), then lines and marks. */
export function drawChronicle(v: View, st: ChronicleState) {
  const stats = (globalThis as { __fbChronicleDraws?: number[] }).__fbChronicleDraws
  const t0 = stats ? performance.now() : 0
  const { ctx } = v
  const y = st.year, firm = !!st.story
  const active = shown(st, y)
  let under = false
  for (const e of active) {
    const s = st.shapes.get(e.key)!
    if (s.kind !== 'zones') continue
    const fade = entryFade(e, y)
    for (const zn of s.zones) under = drawZone(ctx, v, zn, y, fade, firm, st.colors, under)
  }
  for (const e of active) {
    const s = st.shapes.get(e.key)!
    if (s.kind === 'route') drawRoute(ctx, v, s, entryFade(e, y), firm, st)
    else if (s.kind === 'places') drawPlaces(ctx, v, s, entryFade(e, y), st)
  }
  if (stats) stats.push(performance.now() - t0)
}

interface Name { id: string; text: string; at: [number, number]; zone: boolean; alpha: number }

/** The names the chronicle letters at a moment and zoom: zones' from zoom 4, stops' and places' from zoom 5. */
function namesAt(st: ChronicleState, zoom: number): Name[] {
  const y = st.year, out: Name[] = []
  if (zoom < ZONE_LABEL_ZOOM) return out
  for (const e of shown(st, y)) {
    const s = st.shapes.get(e.key)!, alpha = entryFade(e, y)
    if (s.kind === 'zones') {
      for (const zn of s.zones) {
        const b = zoneBlend(zn, y)
        // The name stands where the stage shown most says, the earlier one's until the blend passes half way.
        const named = b && (b.b && b.u > 0.5 ? b.b : b.a)
        if (named?.label) out.push({ id: `${e.key}/${zn.id}`, text: st.name(zn.name), at: [named.label[1], named.label[0]], zone: true, alpha })
      }
    } else if (zoom >= STOP_LABEL_ZOOM) {
      ;(s.kind === 'route' ? s.stops : s.places).forEach((p, i) => {
        const at = stopPoint(p), text = stopName(p, st.name)
        if (at && text) out.push({ id: `${e.key}/${i}`, text, at, zone: false, alpha })
      })
    }
  }
  return out
}

const ZONE_NAME = 'position:absolute;transform:translate(-50%,-50%);white-space:nowrap;pointer-events:none;font:600 10px var(--font-sans);text-transform:uppercase;letter-spacing:.18em;color:color-mix(in srgb,var(--ink) 55%,transparent);-webkit-text-stroke:6px var(--paper);paint-order:stroke fill'
const STOP_NAME = 'position:absolute;transform:translate(7px,-50%);white-space:nowrap;pointer-events:none;font:italic 10.5px var(--font-serif);color:var(--ink-soft);-webkit-text-stroke:6px var(--paper);paint-order:stroke fill'

/**
 * The chronicle's names, as a few words on the page in their own pane just above the shapes. Not lettered on a
 * canvas: with a large family on the map, letters on a canvas held the page 15–35 ms each time it was drawn close in.
 */
export class ChronicleNames {
  private marks = new Map<string, { m: Leaflet.Marker; el: HTMLSpanElement; key: string }>()
  constructor(private L: typeof Leaflet, private map: Leaflet.Map, private pane: string) {}
  update(st: ChronicleState) {
    const seen = new Set<string>()
    for (const n of namesAt(st, this.map.getZoom())) {
      seen.add(n.id)
      const key = `${n.text}|${n.at}|${n.zone}`
      let mark = this.marks.get(n.id)
      if (mark && mark.key !== key) { mark.m.remove(); mark = undefined }
      if (!mark) {
        const el = document.createElement('span')
        el.textContent = n.zone ? n.text.toUpperCase() : n.text
        el.style.cssText = n.zone ? ZONE_NAME : STOP_NAME
        const m = this.L.marker(n.at, { pane: this.pane, interactive: false, keyboard: false, icon: this.L.divIcon({ className: '', html: el, iconSize: undefined }) }).addTo(this.map)
        mark = { m, el, key }
        this.marks.set(n.id, mark)
      }
      const a = String(Math.round(n.alpha * 100) / 100)
      if (mark.el.style.opacity !== a) mark.el.style.opacity = a
    }
    for (const [id, mark] of this.marks) if (!seen.has(id)) { mark.m.remove(); this.marks.delete(id) }
  }
  /** Every name off the map: the history was switched off. */
  clear() {
    for (const mark of this.marks.values()) mark.m.remove()
    this.marks.clear()
  }
}

/** Blends and fades are drawn again when they move by this much: finer than the eye can tell. */
const STEP = 0.02
/**
 * A short description of what the chronicle would draw at a moment: the canvas is drawn again only when it changes.
 * Cheap: a few numbers per active entry.
 */
export function chronicleLook(st: ChronicleState, y: number): string {
  let key = st.story ?? ''
  for (const e of shown(st, y)) {
    key += `|${e.key}:${Math.round(entryFade(e, y) / STEP)}`
    const s = st.shapes.get(e.key)!
    if (s.kind === 'zones') for (const zn of s.zones) key += zoneLook(zn, y, s.zones)
  }
  return key
}

/**
 * A zone's part of the look, asking the worker for what it will need on the way: the step shown now, first, and the
 * next move. The look names the step actually drawn (the nearest ready) or a cross-fade, so a step coming in redraws.
 */
function zoneLook(zn: Zone, y: number, all: Zone[]): string {
  const step = morphStep(zn, y)
  if (!step) return ',-'
  const others = all.filter((z) => z !== zn).flatMap((z) => z.stages)
  const i = zn.stages.indexOf(step.b ?? step.a)
  const next = zn.stages[i + 1]
  if (next && !(step.b ?? step.a).hold && next.year > (step.b ?? step.a).year) soonMorph(step.b ?? step.a, next, others)
  if (!step.b) return `,${step.a.at}`
  wantMorph(step.a, step.b, step.q, others)
  const m = morphShape(step.a, step.b, step.q)
  return `,${step.a.at}~${step.q}${m ? `m${m.q}` : `f${Math.round(zoneBlend(zn, y)!.u / STEP)}`}`
}
