// The base map: Natural Earth land, lakes, rivers and borders shipped with the app (public/atlas, built by
// scripts/build-atlas.mjs), drawn on our own canvas, and the names of countries and cities placed where they fit.
// No tiles and nothing asked of any other server, so no consent is needed.
import type * as Leaflet from 'leaflet'
import type { Taken } from '@/lib/map-layout'
import { ATLAS_FILES, atlasDrawer, type AtlasColours, type Geometry } from './map-atlas-draw'
import { canvasLayer, type View } from './map-canvas'

const ATLAS = '/atlas'
/** Rows of [name, lat, lon, rank] for labels: a lower rank shows from further out. */
type LabelRow = [string, number, number, number]
export interface AtlasLabels { countries: LabelRow[]; cities: LabelRow[] }

/** The base map drawn in a worker where the browser can, else on the page; with the names of places. */
export async function loadAtlas(L: typeof Leaflet) {
  const css = (name: string, or: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || or
  const colours = { sepia: css('--ink-faint', '#6b6455'), sea: css('--paper-dot', '#d9d2c2'), paper: css('--paper', '#f7f3ea') }
  const labels = fetch(`${ATLAS}/labels.json`).then((r) => { if (!r.ok) throw new Error(`labels.json: ${r.status}`); return r.json() as Promise<AtlasLabels> })
  // Not left unheard if the base map fails first; it is awaited below.
  labels.catch(() => {})
  const base = (await inWorker(L, colours)) ?? (await onPage(L, colours))
  return { base, names: atlasNames(L, await labels) }
}

/** On the page's own thread: for a browser that cannot draw in a worker. */
async function onPage(L: typeof Leaflet, colours: AtlasColours) {
  // A proxy or an offline page can answer with HTML: anything but the files themselves is a failure, not a map.
  const files = await Promise.all(ATLAS_FILES.map((f) => fetch(`${ATLAS}/${f}`).then((r) => { if (!r.ok) throw new Error(`${f}: ${r.status}`); return r.json() as Promise<Geometry> })))
  const draw = atlasDrawer(files, colours)
  return canvasLayer(L, 'atlas', (v: View) => draw(v.ctx, v))
}

/**
 * In a worker: the page's thread only puts finished pictures in place, so a pinch or a pan never waits for the coast
 * to be drawn. Nothing, if this browser cannot draw off the page; a file that does not come is a failure as on the page.
 */
async function inWorker(L: typeof Leaflet, colours: AtlasColours) {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || !('transferToImageBitmap' in OffscreenCanvas.prototype)) return null
  let worker: Worker
  try { worker = new Worker(new URL('./map-atlas.worker.ts', import.meta.url), { type: 'module' }) } catch { return null }
  const waiting = new Map<number, (p: ImageBitmap | null) => void>()
  let next = 1
  const ready = new Promise<boolean>((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.type === 'ready') resolve(true)
      else if (data.type === 'error') reject(new Error(data.error))
      else if (data.type === 'drawn') { waiting.get(data.id)?.(data.picture); waiting.delete(data.id) }
    }
    // A worker that cannot start at all is no worse than none: the page draws instead.
    worker.onerror = () => { resolve(false); waiting.forEach((done) => done(null)); waiting.clear() }
  })
  worker.postMessage({ type: 'init', colours })
  if (!(await ready.catch((e) => { worker.terminate(); throw e }))) { worker.terminate(); return null }
  return canvasLayer(L, 'atlas', null, (view, pw, ph) => new Promise((done) => {
    const id = next++
    waiting.set(id, done)
    worker.postMessage({ type: 'draw', id, view, pw, ph })
  }), () => worker.terminate())
}

/**
 * Country and city names, placed greedily where nothing else is: big cities, then countries (never microstates,
 * Natural Earth label rank 6). Smaller cities (rank 4 and up, mostly towns that grew in the last century) are left
 * out: on a family's map they crowd the family's own places and help nobody find them. A name already on the map is
 * kept, not made again.
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
    // A city shows one zoom after its rank would allow, so the biggest come first and the map is not lettered over.
    const city = (r: number) => z >= 4 && r <= z - 3
    put(labels.cities, 'atlas-label atlas-city', 6.2, (r) => r <= 3 && city(r))
    put(labels.countries, 'atlas-label atlas-country', 8.4, (r) => r < 6 && r <= Math.max(2, z))
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
