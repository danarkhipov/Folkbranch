// The base map: Natural Earth land, lakes, rivers and borders shipped with the app (public/atlas, built by
// scripts/build-atlas.mjs), drawn on our own canvas, and the names of countries and cities placed where they fit.
// No tiles and nothing asked of any other server, so no consent is needed.
import type * as Leaflet from 'leaflet'
import { mercator } from '@/lib/map-motion'
import type { Taken } from '@/lib/map-layout'
import { canvasLayer, type View } from './map-canvas'

const ATLAS = '/atlas'
/** Rows of [name, lat, lon, rank] for labels: a lower rank shows from further out. */
type LabelRow = [string, number, number, number]
export interface AtlasLabels { countries: LabelRow[]; cities: LabelRow[] }
interface Geometry { type: string; coordinates: unknown; geometries?: Geometry[] }

/** A GeoJSON geometry as one path in world pixels at zoom 0: built once, drawn at any zoom with a transform. */
function toPath(g: Geometry, closed: boolean): Path2D {
  const path = new Path2D()
  const ring = (pts: [number, number][]) => {
    pts.forEach(([lon, lat], i) => { const [x, y] = mercator([lat, lon]); if (i) path.lineTo(x, y); else path.moveTo(x, y) })
    if (closed) path.closePath()
  }
  const walk = (geo: Geometry) => {
    if (geo.geometries) return geo.geometries.forEach(walk)
    const c = geo.coordinates as never
    if (geo.type === 'Polygon' || geo.type === 'MultiLineString') (c as [number, number][][]).forEach(ring)
    else if (geo.type === 'MultiPolygon') (c as [number, number][][][]).forEach((p) => p.forEach(ring))
    else if (geo.type === 'LineString') ring(c)
  }
  walk(g)
  return path
}

export async function loadAtlas(L: typeof Leaflet) {
  // A proxy or an offline page can answer with HTML: anything but the files themselves is a failure, not a map.
  const get = (f: string) => fetch(`${ATLAS}/${f}`).then((r) => { if (!r.ok) throw new Error(`${f}: ${r.status}`); return r.json() })
  const [land, lakes, rivers, borders, labels] = await Promise.all(['land.json', 'lakes.json', 'rivers.json', 'borders.json', 'labels.json'].map(get))
  const css = (name: string, or: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || or
  const sepia = css('--ink-faint', '#6b6455'), sea = css('--paper-dot', '#d9d2c2'), paper = css('--paper', '#f7f3ea')
  const p = { land: toPath(land, true), lakes: toPath(lakes, true), rivers: toPath(rivers, false), borders: toPath(borders, false) }
  // A quiet old atlas: paper land, thin sepia coasts, faint lakes and rivers, dashed borders.
  const draw = ({ ctx, scale: s, ox, oy, dpr }: View) => {
    ctx.setTransform(dpr * s, 0, 0, dpr * s, -dpr * ox, -dpr * oy)
    ctx.lineJoin = 'round'
    const line = (path: Path2D, width: number, alpha: number, dash?: number[]) => {
      ctx.globalAlpha = alpha; ctx.lineWidth = width / s; ctx.setLineDash(dash ? dash.map((d) => d / s) : []); ctx.stroke(path)
    }
    ctx.strokeStyle = sepia
    ctx.globalAlpha = 1; ctx.fillStyle = paper; ctx.fill(p.land, 'evenodd')
    line(p.land, 0.6, 0.7)
    ctx.globalAlpha = 1; ctx.fillStyle = sea; ctx.fill(p.lakes, 'evenodd')
    line(p.lakes, 0.4, 0.5)
    line(p.rivers, 0.5, 0.35)
    line(p.borders, 0.6, 0.55, [3, 2])
    ctx.globalAlpha = 1; ctx.setLineDash([])
  }
  return { base: canvasLayer(L, 'atlas', draw), names: atlasNames(L, labels as AtlasLabels) }
}

/**
 * Country and city names, placed greedily where nothing else is: big cities, then countries (never microstates,
 * Natural Earth label rank 6), then small cities. A name already on the map is kept, not made again.
 */
function atlasNames(L: typeof Leaflet, labels: AtlasLabels) {
  const shown = new Map<string, Leaflet.Marker>()
  const group = L.layerGroup()
  const place = (m: Leaflet.Map, taken: Taken) => {
    const z = m.getZoom(), view = m.getBounds().pad(0.2)
    const want = new Map<string, { row: LabelRow; cls: string }>()
    const put = (rows: LabelRow[], cls: string, charW: number, show: (rank: number) => boolean) => {
      for (const row of rows) {
        const [name, lat, lon, rank] = row
        if (!show(rank) || !view.contains([lat, lon])) continue
        const at = m.latLngToContainerPoint([lat, lon]), w = (name.length * charW) / 2 + 6
        if (taken.first([[at.x - w, at.y - 9, at.x + w, at.y + 9]]) < 0) continue
        want.set(`${cls}|${name}|${lat}|${lon}`, { row, cls })
      }
    }
    const city = (r: number) => z >= 4 && r <= z - 2
    put(labels.cities, 'atlas-label atlas-city', 6.2, (r) => r <= 3 && city(r))
    put(labels.countries, 'atlas-label atlas-country', 8.4, (r) => r < 6 && r <= Math.max(2, z))
    put(labels.cities, 'atlas-label atlas-city', 6.2, (r) => r > 3 && city(r))
    for (const [k, mk] of shown) if (!want.has(k)) { group.removeLayer(mk); shown.delete(k) }
    for (const [k, { row, cls }] of want) {
      if (shown.has(k)) continue
      const mk = L.marker([row[1], row[2]], { interactive: false, keyboard: false, icon: L.divIcon({ className: cls, html: '', iconSize: undefined }) }).addTo(group)
      mk.getElement()!.textContent = row[0]
      shown.set(k, mk)
    }
  }
  return { group, place }
}
