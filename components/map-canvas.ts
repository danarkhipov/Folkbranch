// One canvas on the map that we draw ourselves: the atlas under everything, the trails above it. While a pinch or a
// zoom runs, the canvas is only scaled with the markers, as Leaflet's own renderer does; it is drawn again once the
// zoom ends or a pan runs past what it covers, and not at all while the view stands still.
import type * as Leaflet from 'leaflet'

/** How to put a world point (Web Mercator pixels at zoom 0) on the canvas: x × scale − ox, in CSS pixels. */
export interface View { ctx: CanvasRenderingContext2D; scale: number; ox: number; oy: number; w: number; h: number; dpr: number }

export interface CanvasLayer { layer: Leaflet.Layer; redraw: () => void }

/** Room drawn around the view, as a share of its size: what a pan or a zoom-out shows at its edges before a redraw. */
const PAD = 0.25
/** The most pixels one canvas holds: a phone keeps memory and fill low, and fine lines need no more than this. */
const maxPixels = () => (matchMedia('(pointer: coarse)').matches ? 3e6 : 6e6)

export function canvasLayer(L: typeof Leaflet, pane: string, draw: (v: View) => void): CanvasLayer {
  let map: Leaflet.Map | null = null
  const canvas = document.createElement('canvas')
  canvas.className = 'leaflet-zoom-animated map-canvas'
  canvas.style.pointerEvents = 'none'
  let view: View | null = null
  let drawnZoom = NaN, drawnCenter: Leaflet.LatLng | null = null
  let box = { x0: 0, y0: 0, x1: 0, y1: 0 } // what the canvas covers, in layer points

  const paint = () => {
    if (!view) return
    view.ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0)
    view.ctx.clearRect(0, 0, view.w, view.h)
    draw(view)
  }
  /** Sizes and places the canvas around the view as it is now, then draws. */
  const reset = () => {
    if (!map) return
    const size = map.getSize()
    const tl = map.containerPointToLayerPoint([-size.x * PAD, -size.y * PAD]).round()
    const w = Math.round(size.x * (1 + 2 * PAD)), h = Math.round(size.y * (1 + 2 * PAD))
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1, Math.sqrt(maxPixels() / (w * h))))
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr)
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw; canvas.height = ph
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`
    }
    L.DomUtil.setPosition(canvas, tl)
    const origin = map.getPixelOrigin()
    drawnZoom = map.getZoom(); drawnCenter = map.getCenter()
    box = { x0: tl.x, y0: tl.y, x1: tl.x + w, y1: tl.y + h }
    view = { ctx: canvas.getContext('2d')!, scale: 2 ** drawnZoom, ox: tl.x + origin.x, oy: tl.y + origin.y, w, h, dpr }
    paint()
  }
  /** The canvas as drawn, scaled and moved to stand where it belongs at another zoom and centre. */
  const fit = (center: Leaflet.LatLng, zoom: number) => {
    if (!map || !drawnCenter) return
    const m = map as Leaflet.Map & { _getNewPixelOrigin(c: Leaflet.LatLng, z: number): Leaflet.Point }
    const scale = m.getZoomScale(zoom, drawnZoom)
    const half = m.getSize().multiplyBy(0.5 + PAD)
    const tl = half.multiplyBy(-scale).add(m.project(drawnCenter, zoom)).subtract(m._getNewPixelOrigin(center, zoom))
    L.DomUtil.setTransform(canvas, tl, scale)
  }
  /** A pan alone moves the canvas with the map; it is redrawn only when the view runs past what it covers. */
  const moved = () => {
    if (!map || map.getZoom() !== drawnZoom) return
    const size = map.getSize(), a = map.containerPointToLayerPoint([0, 0])
    if (a.x < box.x0 || a.y < box.y0 || a.x + size.x > box.x1 || a.y + size.y > box.y1) reset()
  }
  // During a pinch, a wheel zoom or a flight the canvas follows by transform; the drawing waits for the zoom's end.
  // Zoomed out past the drawn margin (blank edges would show) or in to twice the size (soft lines): drawn anew.
  const zooming = () => {
    if (!map) return
    const k = map.getZoomScale(map.getZoom(), drawnZoom)
    if (k < 1 / (1 + 2 * PAD) + 0.1 || k > 2) reset()
    else fit(map.getCenter(), map.getZoom())
  }
  const zoomanim = (e: Leaflet.ZoomAnimEvent) => fit(e.center, e.zoom)

  // Dragged to a screen of another density (or zoomed in the browser): drawn again at the new one.
  let density: MediaQueryList | null = null
  const watchDensity = () => {
    density?.removeEventListener('change', onDensity)
    density = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
    density.addEventListener('change', onDensity)
  }
  function onDensity() { watchDensity(); reset() }

  const Layer = L.Layer.extend({
    onAdd(m: Leaflet.Map) {
      map = m
      m.getPane(pane)!.appendChild(canvas)
      watchDensity()
      reset()
    },
    onRemove() { canvas.remove(); density?.removeEventListener('change', onDensity); density = null; map = null; view = null },
    getEvents() { return { viewreset: reset, zoom: zooming, zoomend: reset, move: moved, resize: reset, zoomanim } },
  })
  return { layer: new Layer(), redraw: paint }
}
