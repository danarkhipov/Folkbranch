// The camera that follows the family. While playing it holds still and moves only when the policy in
// lib/map-camera.ts says so, in one eased flight that is never retargeted mid-air. Any pan or zoom by hand turns
// following off (the view is the reader's then), and the Follow button turns it back on.
import type * as Leaflet from 'leaflet'
import { cameraCall } from '@/lib/map-camera'

/** The most the camera closes in by itself. */
const MAX_ZOOM = 7
/** One refit, in seconds. */
const FLIGHT_S = 1.3
/** Closing in is worth a flight only for more than this many zoom steps. */
const CLOSE_STEPS = 0.75

export interface Insets { top: number; right: number; bottom: number; left: number }

export class Follow {
  following = true
  private flying = false
  private reduced: boolean

  constructor(private L: typeof Leaflet, private map: Leaflet.Map, private insets: () => Insets, private onManual: () => void) {
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // A hand on the map wins at once: a flight under way stops where it is, so the camera never pulls against a pan
    // or a pinch that has just begun.
    const manual = () => { if (this.flying) { this.flying = false; map.stop() } this.release() }
    // Only what a person does counts as by hand; our own flights fire the same move events, so those are not used.
    map.on('dragstart dblclick boxzoomstart', manual)
    const box = map.getContainer()
    box.addEventListener('wheel', manual, { passive: true })
    box.addEventListener('touchstart', (e) => { if (e.touches.length > 1 || this.flying) manual() }, { passive: true })
    box.addEventListener('mousedown', () => { if (this.flying) manual() })
    box.addEventListener('keydown', (e) => { if (/^(Arrow|\+|-|=|_)/.test(e.key) && e.target === box) manual() })
    // In the capture phase: Leaflet stops a zoom button's click on the button itself, so it never bubbles up here.
    box.querySelector('.leaflet-control-zoom')?.addEventListener('click', manual, true)
  }

  /** Room left for the bars and for names, as Leaflet's padding. */
  private pad() {
    const i = this.insets()
    return { paddingTopLeft: this.L.point(i.left, i.top), paddingBottomRight: this.L.point(i.right, i.bottom) }
  }
  private safe(): [number, number, number, number] {
    const i = this.insets(), s = this.map.getSize()
    return [i.left, i.top, s.x - i.right, s.y - i.bottom]
  }

  /** Flies to show these places, unless already flying (the next check, after landing, decides again). */
  private fly(points: [number, number][], animate = !this.reduced) {
    const m = this.map, want = this.L.latLngBounds(points), pad = this.pad()
    const zoom = Math.min(MAX_ZOOM, m.getBoundsZoom(want, false, pad.paddingTopLeft.add(pad.paddingBottomRight)))
    const same = Math.abs(zoom - m.getZoom()) < 0.25 && m.getBounds().contains(want)
    if (same) return
    if (!animate) { m.fitBounds(want, { ...pad, maxZoom: MAX_ZOOM, animate: false }); return }
    this.flying = true
    m.once('moveend', () => { this.flying = false })
    m.flyToBounds(want, { ...pad, maxZoom: MAX_ZOOM, duration: FLIGHT_S })
  }

  /** While playing: keeps now and soon in the safe part of the view, moving only when it has to. */
  keep(points: [number, number][]) {
    if (!this.following || this.flying || !points.length) return
    const m = this.map
    const call = cameraCall(points.map(([a, b]) => { const p = m.latLngToContainerPoint([a, b]); return [p.x, p.y] }), this.safe())
    if (call === 'widen') this.fly(points)
    else if (call === 'close') {
      const pad = this.pad()
      const zoom = Math.min(MAX_ZOOM, m.getBoundsZoom(this.L.latLngBounds(points), false, pad.paddingTopLeft.add(pad.paddingBottomRight)))
      if (zoom > m.getZoom() + CLOSE_STEPS) this.fly(points)
    }
  }

  /** A plain fit, once: on opening, and when following is turned back on. */
  fit(points: [number, number][], animate: boolean) {
    if (!points.length) return
    if (this.flying) this.map.stop()
    this.flying = false
    this.fly(points, animate && !this.reduced)
  }

  resume() { this.following = true }
  /** Something the reader asked for moves the camera (zoom in on a town): following stops, as if by hand. */
  release() { if (this.following) { this.following = false; this.onManual() } }
  get busy() { return this.flying }
}
