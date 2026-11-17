// The people on the map: a face for each, stacked where several share a town, a name beside each stack, and small
// marks for what happened lately. Faces and words are made once and then only moved or re-labelled: per frame only
// travellers move; stacks and labels are worked out again only when someone appears, leaves, sets off or arrives,
// when the whole year changes, or when the map stops moving.
import type * as Leaflet from 'leaflet'
import { GLYPH } from '@/lib/map-glyphs'
import { canRing, fanOffset, FAN_PX, freeOffset, leader, namedFace, ringOffset, stackShift, stackSpots, Taken, type Box, type Spot } from '@/lib/map-layout'
import { clipPlace, routeStopLabel, sinceAt, stopAt, type EventKind, type Position, type RouteStop, type Track } from '@/lib/map-timeline'

/** At most this many faces fan out at one spot; the rest are counted in the label. */
const STACK = 3
/** How far each face of a stack fans out to the right, in pixels. */
const FAN = FAN_PX
/** Half a face with its rings, in pixels. */
const R = 15
/** From this zoom on, a crowded town spreads its faces in a ring and names each one. */
export const RING_ZOOM = 7
const RING_MAX = 16
/** How long an event's mark stays on the map, fading, after its year. */
export const FADE_YEARS = 3
/** Under this zoom a mark's caption is left out: at world size the words would pile up over the faces. */
const CAPTION_ZOOM = 6
/** Up to this many people on their way at once, each keeps a name even when it must go over another mark. */
const KEPT_NAMES = 6

export interface Mark { key: string; lat: number; lon: number; kind: EventKind; caption: string; year: number; personId: string }
/** A stack of faces pressed (or Enter on it): where it stands and who is in it, for the "who is here" card. */
export interface StackHit { lat: number; lon: number; ids: string[]; el: HTMLElement }
interface RouteEl { marker: Leaflet.Marker; el: HTMLElement; num: HTMLElement; label: HTMLElement; w: number; stop: RouteStop; side: Side | null; own: boolean; shown: string; ahead: boolean }

type Side = 'right' | 'left' | 'above' | 'below'
interface Face {
  /** Whose route a hover shows: in a folded stack, the person named on top, whichever face is under the pointer. */
  hoverAs?: string
  marker: Leaflet.Marker; el: HTMLElement; name: HTMLElement; strong: HTMLElement; where: HTMLElement
  shown: boolean; moving: boolean; yields: boolean; focused: boolean; kin: boolean; hidden: boolean; unsure: boolean
  at: string; dx: number; dy: number; side: Side | null; text: string; w: number; z: number
}
interface MarkEl { marker: Leaflet.Marker; el: HTMLElement; cap: HTMLElement; capW: number; fade: number; slot: string; mine: boolean }

let measurer: CanvasRenderingContext2D | null = null
const widths = new Map<string, number>()
/** How wide a text is drawn in a font, so its box is true; remembered, since the same names come back every year. */
function textWidth(text: string, font: string): number {
  const key = `${font}|${text}`
  let w = widths.get(key)
  if (w !== undefined) return w
  measurer ??= document.createElement('canvas').getContext('2d')
  if (!measurer) return text.length * 6.4
  measurer.font = font
  w = measurer.measureText(text).width
  if (widths.size > 4000) widths.clear()
  widths.set(key, w)
  return w
}

const marker = (mk: MarkEl) => mk.marker.getElement()!

export class PeopleLayer {
  readonly group: Leaflet.LayerGroup
  private faces = new Map<string, Face>()
  private marks = new Map<string, MarkEl>()
  /** Which stack each town was in last time, so a small zoom does not regroup. */
  private stacks = new Map<string, string>()
  /** Everything placed but the travellers, for checking their labels between layouts. */
  private still = new Taken()
  /** What this frame's travellers have taken, emptied and filled again each frame. */
  private placed = new Taken()
  private font = ''
  private capFont = ''
  /** The person followed, and their route's marks. */
  private focusId: string | null = null
  private route: RouteEl[] = []
  /** Following a line of descent: everyone in it, who stay bright while the rest are quieter. */
  private kin: Set<string> | null = null
  /** Faces that stand for a stack of several, by person: pressing one opens who is here. */
  private stackOf = new Map<string, { lat: number; lon: number; ids: string[] }>()
  /** The faces in keyboard order (west to east) and the one that holds the single Tab stop. */
  private order: string[] = []
  private active: string | null = null

  constructor(private L: typeof Leaflet, private map: Leaflet.Map, private opts: { avatar: (id: string) => string; pick: (id: string) => void; stack: (s: StackHit) => void; t: (k: string) => string; people: (n: number) => string; hover?: (id: string | null) => void }) {
    this.group = L.layerGroup().addTo(map)
    const serif = getComputedStyle(document.documentElement).getPropertyValue('--font-serif').trim() || 'serif'
    this.font = `500 11px ${serif}`
    this.capFont = `italic 10.5px ${serif}`
  }

  /**
   * Follows one person: their face is ringed and on top, their route's stops are numbered, everyone else is quieter.
   * A line of descent gives its generation marks as the stops (with their own words) and everyone in it as `kin`.
   */
  setFocus(id: string | null, stops: (RouteStop & { text?: string })[], kin: Set<string> | null = null) {
    this.focusId = id
    this.kin = kin
    for (const r of this.route) this.group.removeLayer(r.marker)
    this.route = []
    if (!id) return
    for (const stop of stops) {
      const el = document.createElement('span')
      el.className = kin ? 'map-stop-in map-gen' : 'map-stop-in'
      const num = el.appendChild(document.createElement('b'))
      num.textContent = stop.visits.join('·')
      const label = el.appendChild(document.createElement('span'))
      const text = stop.text ?? routeStopLabel(stop)
      label.textContent = text
      const marker = this.L.marker([stop.lat, stop.lon], { keyboard: false, interactive: false, zIndexOffset: 15000, icon: this.L.divIcon({ className: 'map-stop', html: el, iconSize: [0, 0] }) })
      this.group.addLayer(marker)
      this.route.push({ marker, el, num, label, w: textWidth(text, this.font) + 8, stop, side: null, own: stop.text !== undefined, shown: text, ahead: false })
    }
  }

  /**
   * A life's stop as the clock has reached it: a place still to come is a faint number with no words, and a place
   * visited again later lists only the visits made so far. A line's generation marks keep their own words.
   */
  private reach(r: RouteEl, year: number) {
    if (r.own) return
    const at = stopAt(r.stop, year)
    const ahead = !at
    if (r.ahead !== ahead) { r.ahead = ahead; r.el.classList.toggle('ahead', ahead) }
    const shown = at ? routeStopLabel(at) : ''
    if (r.shown === shown) return
    r.shown = shown
    r.num.textContent = (at ?? r.stop).visits.join('·')
    r.label.textContent = shown
    r.w = textWidth(shown, this.font) + 8
  }

  /** Along a line, who carries it now: their face wears the rings. Only names it; the next layout shows it. */
  setCurrent(id: string | null) { if (this.kin) this.focusId = id }

  /** A face pressed or Entered: a stack opens who is here, a single face follows that person. */
  private activate(id: string) {
    const st = this.stackOf.get(id), f = this.faces.get(id)
    if (st && st.ids.length > 1 && f) this.opts.stack({ ...st, el: f.el })
    else this.opts.pick(id)
  }
  /** The arrow keys walk the faces west to east; the face reached becomes the Tab stop. */
  private roam(id: string, d: number) {
    if (!this.order.length) return
    const i = this.order.indexOf(id)
    const to = this.order[(Math.max(0, i) + d + this.order.length) % this.order.length]
    this.setActive(to)
    this.faces.get(to)?.el.focus({ preventScroll: true })
  }
  private setActive(id: string | null) {
    if (this.active === id) return
    if (this.active) this.faces.get(this.active)?.el.setAttribute('tabindex', '-1')
    this.active = id
    if (id) this.faces.get(id)?.el.setAttribute('tabindex', '0')
  }
  /** A new family: everything is made again, the keyboard's stop and the route with it (setFocus draws it anew). */
  /**
   * The family changed (someone's edit came in): faces of people no longer shown go, everyone else keeps their face,
   * their stack and the keyboard's place, so a live edit does not shake the map. Event marks are made again.
   */
  reset(keep: ReadonlySet<string>) {
    for (const [id, f] of this.faces) if (!keep.has(id)) { this.group.removeLayer(f.marker); this.faces.delete(id) }
    for (const mk of this.marks.values()) this.group.removeLayer(mk.marker)
    this.marks.clear()
    this.stackOf.clear()
    if (this.active && !keep.has(this.active)) this.active = null
  }

  /** Portraits still to put in, and whether a slice of them is already asked for. */
  private portraits: [HTMLImageElement, string][] = []
  private portraitsAsked = false
  private later(img: HTMLImageElement, id: string) {
    img.decoding = 'async'
    this.portraits.push([img, id])
    if (this.portraitsAsked) return
    this.portraitsAsked = true
    const idle = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 200 }) : setTimeout(fn, 16))
    const slice = () => {
      // Forty at a time between frames, the ones on screen first as they were made.
      for (const [im, who] of this.portraits.splice(0, 40)) im.src = this.opts.avatar(who)
      if (this.portraits.length) idle(slice)
      else this.portraitsAsked = false
    }
    idle(slice)
  }

  private face(id: string, name: string): Face {
    let f = this.faces.get(id)
    if (f) return f
    const el = document.createElement('div')
    el.className = 'map-face-in'
    el.setAttribute('role', 'button')
    el.tabIndex = -1
    const img = el.appendChild(document.createElement('img'))
    // The portrait comes a moment later, a few at a time: hundreds decoded at once held the first zoom for seconds.
    this.later(img, id)
    img.alt = ''
    // Built from text, not HTML: names and places are what relatives typed.
    const label = el.appendChild(document.createElement('span'))
    label.className = 'map-name'
    const strong = label.appendChild(document.createElement('strong'))
    const where = label.appendChild(document.createElement('span'))
    strong.textContent = name
    const marker = this.L.marker([0, 0], { icon: this.L.divIcon({ className: 'map-face', html: el, iconSize: [24, 24] }), keyboard: false })
    marker.on('click', () => this.activate(id))
    // Hovered or reached by the keyboard: on top, named, with where and when.
    // Their route lights up as well, as a line of descent does on the chart.
    const open = () => { el.classList.add('open'); marker.setZIndexOffset(30000); this.opts.hover?.(f?.hoverAs ?? id) }
    const close = () => { if (document.activeElement === el || el.matches(':hover')) return; el.classList.remove('open'); marker.setZIndexOffset(f!.z); this.opts.hover?.(null) }
    marker.on('mouseover', open)
    marker.on('mouseout', close)
    el.addEventListener('focus', () => { open(); this.setActive(id) })
    el.addEventListener('blur', close)
    el.addEventListener('keydown', (e) => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
      if (d) { e.preventDefault(); e.stopPropagation(); this.roam(id, d); return }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); this.activate(id) }
    })
    f = { marker, el, name: label, strong, where, shown: false, moving: false, yields: false, focused: false, kin: false, hidden: false, unsure: false, at: '', dx: NaN, dy: NaN, side: null, text: name, w: textWidth(name, this.font) + 8, z: 0 }
    this.faces.set(id, f)
    return f
  }

  private place(f: Face, lat: number, lon: number) {
    const ll = f.marker.getLatLng()
    if (ll.lat !== lat || ll.lng !== lon) f.marker.setLatLng([lat, lon])
  }
  private offset(f: Face, dx: number, dy: number) {
    if (f.dx === dx && f.dy === dy) return
    f.dx = dx; f.dy = dy
    f.el.style.setProperty('--dx', `${dx}px`)
    f.el.style.setProperty('--dy', `${dy}px`)
  }
  private setText(f: Face, text: string) {
    if (f.text === text) return
    f.text = text
    f.strong.textContent = text
    f.w = textWidth(text, this.font) + 8
  }
  private setSide(f: Face, side: Side | null) {
    if (f.side === side) return
    f.side = side
    if (side) f.name.dataset.side = side
    else delete f.name.dataset.side
  }
  /** A class on a face, changed only when it is another: a play lays the same faces out again and again. */
  private setFlag(f: Face, key: 'moving' | 'focused' | 'kin' | 'hidden' | 'unsure', on: boolean) {
    if (f[key] === on) return
    f[key] = on
    f.el.classList.toggle(key === 'hidden' ? 'hidden-face' : key, on)
    // A face folded into a stack is not drawn, and its marker must not catch the press meant for the stack's top.
    if (key === 'hidden') f.marker.getElement()?.classList.toggle('map-folded', on)
  }
  /** A traveller over a stack lets presses through to it. */
  private yieldTo(f: Face, on: boolean) {
    if (f.yields === on) return
    f.yields = on
    f.marker.getElement()?.classList.toggle('map-yield', on)
  }
  private setZ(f: Face, z: number) { if (f.z !== z) { f.z = z; if (!f.el.classList.contains('open')) f.marker.setZIndexOffset(z) } }
  private setLabel(f: Face, text: string) { if (f.el.getAttribute('aria-label') !== text) f.el.setAttribute('aria-label', text) }
  /** A dot on the town's own point, so a face fanned or ringed aside still reads as standing there. */
  private anchor(f: Face, on: boolean) { f.marker.getElement()?.classList.toggle('anchored', on) }
  /**
   * A hairline from a mark drawn (dx, dy) away from its place back to the place. (x, y) is the mark's own centre
   * inside its element: the face and the numbered stop have theirs at 0,0, an event's glyph at 8,8.
   */
  private lead(el: HTMLElement, dx: number, dy: number, x = 0, y = 0) {
    const l = leader(dx, dy)
    if (!l.moved) { el.classList.remove('moved'); return }
    el.style.setProperty('--lx', `${x}px`)
    el.style.setProperty('--ly', `${y}px`)
    el.style.setProperty('--ll', `${l.len}px`)
    el.style.setProperty('--la', `${l.angle}rad`)
    el.style.setProperty('--px', `${x - dx}px`)
    el.style.setProperty('--py', `${y - dy}px`)
    el.classList.add('moved')
  }
  /** Where a face's label would go on each side, as boxes on screen, for a face drawn at x, y. */
  private sides(f: Face, x: number, y: number, prefer: Side[]): Box[] {
    const h = 9, w = f.w
    const at: Record<Side, Box> = {
      right: [x + R, y - h, x + R + w, y + h],
      left: [x - R - w, y - h, x - R, y + h],
      above: [x - w / 2, y - R - 2 * h, x + w / 2, y - R],
      below: [x - w / 2, y + R, x + w / 2, y + R + 2 * h],
    }
    return prefer.map((s) => at[s])
  }

  /** Per frame: travellers move, with their labels. True when the picture changed enough to lay it out again. */
  frame(positions: Map<string, Position | null>): boolean {
    let changed = false
    // What travellers' names give way to this frame: everything still, and the travellers already placed.
    const placed = this.placed
    placed.clear()
    const now = { hit: (b: Box) => this.still.hit(b) || placed.hit(b), add: placed.add }
    // Only those with somewhere to stand are placed at all, so the one frame walks them rather than every life in
    // the family. A face still shown for someone gone is caught by the count and laid out away at once.
    let live = 0
    for (const [id, pos] of positions) {
      if (!pos) continue
      live++
      const f = this.faces.get(id)
      if (!f?.shown) { changed = true; continue }
      if (!!pos.leg !== f.moving) { changed = true; continue }
      if (!f.moving) continue
      // On the way they are on their own, not in a town's stack.
      f.hoverAs = undefined
      this.place(f, pos.lat, pos.lon)
      const p = this.map.latLngToContainerPoint([pos.lat, pos.lon])
      // Just setting off or about to arrive, they stand over a town's stack: a press there is meant for the stack.
      const { pts } = pos.leg!.path
      const over = (ll: [number, number]) => { const q = this.map.latLngToContainerPoint(ll); return Math.abs(q.x - p.x) < 2 * R + 2 * FAN && Math.abs(q.y - p.y) < 2 * R }
      this.yieldTo(f, over(pts[0]) || over(pts[pts.length - 1]))
      // Their label gives way to anything already placed, until the next layout.
      if (f.side) {
        const [box] = this.sides(f, p.x, p.y, [f.side])
        const hit = now.hit(box)
        if (hit !== f.name.classList.contains('collide')) f.name.classList.toggle('collide', hit)
        now.add([p.x - R, p.y - R, p.x + R, p.y + R])
        if (!hit) now.add(box)
      }
    }
    let shown = 0
    for (const f of this.faces.values()) if (f.shown) shown++
    return changed || live !== shown
  }

  /**
   * Lays everything out again: faces first (so no label covers a face), then travellers' names, then stacks' names
   * (busiest first, each trying four sides), then event marks. Returns what is taken, for the atlas's names.
   */
  layout(tracks: Track[], positions: Map<string, Position | null>, marks: Mark[], year: number, blocked: Box[] = [], captions = false): Taken {
    const m = this.map, taken = new Taken(), still = new Taken()
    const both = (b: Box) => { taken.add(b); still.add(b) }
    // The app's own bars over the map: names and marks keep clear of them.
    blocked.forEach(both)
    const ring = m.getZoom() >= RING_ZOOM
    // The spot the followed person rests on: a town's stack there moves aside, so the followed face does not hide it.
    const focusPos = this.focusId ? positions.get(this.focusId) : null
    const focusSpot = focusPos && !focusPos.leg ? `${focusPos.lat},${focusPos.lon}` : null
    const spots = new Map<string, { lat: number; lon: number; ids: string[] }>()
    const travellers: { id: string; pos: Position }[] = []
    const names = new Map(tracks.map((tr) => [tr.personId, tr.name]))
    for (const tr of tracks) {
      const pos = positions.get(tr.personId)
      const f = this.faces.get(tr.personId)
      if (!pos) { if (f?.shown) { this.group.removeLayer(f.marker); f.shown = false; f.yields = false } continue }
      const face = this.face(tr.personId, tr.name)
      if (!face.shown) { this.group.addLayer(face.marker); face.shown = true }
      this.setFlag(face, 'moving', !!pos.leg)
      if (!face.moving) this.yieldTo(face, false)
      const t = this.opts.t
      this.setFlag(face, 'unsure', pos.after !== undefined)
      const at = pos.moving ? `${clipPlace(pos.at.place)} → ${clipPlace(pos.moving.place)} (${pos.moving.date})` : `${clipPlace(pos.at.place)} · ${pos.at.what}, ${pos.at.date}${pos.after !== undefined ? ` · ${t('дальше неизвестно')}` : ''}`
      if (face.at !== at) { face.at = at; face.where.textContent = at }
      this.setFlag(face, 'focused', tr.personId === this.focusId)
      this.setFlag(face, 'kin', !!this.kin?.has(tr.personId))
      this.setLabel(face, pos.moving ? `${tr.name}, ${pos.at.place} → ${pos.moving.place}`
        : pos.after !== undefined ? `${tr.name}, ${pos.at.place} ${sinceAt(tr, pos)}–${pos.after}, ${t('дальше неизвестно')}`
          : `${tr.name}, ${pos.at.place}, ${t('с')} ${sinceAt(tr, pos)}`)
      // Travellers, and the person followed, stand on their own spot, apart from any stack, and are always named.
      if (pos.leg || tr.personId === this.focusId) { travellers.push({ id: tr.personId, pos }); continue }
      const key = `${pos.lat},${pos.lon}`
      const s = spots.get(key) ?? spots.set(key, { lat: pos.lat, lon: pos.lon, ids: [] }).get(key)!
      s.ids.push(tr.personId)
    }
    // Towns that touch on screen share one stack, standing on the busiest of them.
    const list: Spot[] = [...spots].map(([key, s]) => { const p = m.latLngToContainerPoint([s.lat, s.lon]); return { key, x: p.x, y: p.y, n: s.ids.length } })
    this.stacks = stackSpots(list, this.stacks)
    const groups = new Map<string, string[]>()
    for (const s of list.sort((a, b) => b.n - a.n)) {
      const anchor = this.stacks.get(s.key)!
      groups.set(anchor, [...(groups.get(anchor) ?? []), ...spots.get(s.key)!.ids])
    }
    this.stackOf.clear()
    const order: { id: string; x: number; y: number }[] = []
    const where = new Map(tracks.map((tr) => [tr.personId, positions.get(tr.personId)?.at.place ?? '']))
    const point = new Map(list.map((s) => [s.key, s]))
    const labels: { f: Face; x: number; y: number; prefer: Side[]; size: number }[] = []
    const anchors = [...groups.keys()].map((k) => point.get(k)!)
    for (const [anchor, ids] of groups) {
      const s = spots.get(anchor)!, p = point.get(anchor)!
      const spread = ring && canRing(ids.length, p, anchors.filter((o) => o !== p), RING_MAX)
      const shift = stackShift(anchor === focusSpot, spread, FAN)
      const shown = spread ? Math.min(ids.length, RING_MAX) : Math.min(ids.length, STACK)
      ids.forEach((id, i) => {
        const f = this.faces.get(id)!
        this.place(f, s.lat, s.lon)
        const hidden = i >= shown
        this.setFlag(f, 'hidden', hidden)
        f.hoverAs = spread ? id : ids[0]
        // Hovered, a stack tells who is in it: two names and the rest counted, so the platform's own tooltip stays a
        // line or two rather than a black box over the map. The card has the whole list.
        f.el.title = !spread && i === 0 && ids.length > 1 ? `${ids.slice(0, 2).map((x) => names.get(x)).join(', ')}${ids.length > 2 ? ` +${ids.length - 2}` : ''}` : ''
        if (hidden) { this.setSide(f, null); this.lead(f.el, 0, 0); this.anchor(f, false); return }
        const [dx, dy] = spread ? ringOffset(i, shown) : [fanOffset(i, FAN), -shift]
        this.offset(f, dx, dy)
        this.lead(f.el, dx, dy)
        // One dot at the town's own point for the whole group, so the place itself is never empty.
        this.anchor(f, i === 0 && ids.length > 1)
        this.setZ(f, id === this.focusId ? 20000 : spread ? 0 : (STACK - i) * 100)
        both([p.x + dx - R, p.y + dy - R, p.x + dx + R, p.y + dy + R])
        // A stack is one stop for the keyboard (its top face opens who is here); a ring, one stop per face.
        if (spread || i === 0) order.push({ id, x: p.x + dx, y: p.y + dy })
        const more = ids.length - shown
        if (!spread && ids.length > 1) {
          this.stackOf.set(id, { lat: s.lat, lon: s.lon, ids })
          const places = [...new Set(ids.map((x) => clipPlace(where.get(x) ?? '')))].join(', ')
          this.setLabel(f, `${places}: ${this.opts.people(ids.length)}, ${ids.slice(0, 3).map((x) => names.get(x)).join(', ')}${ids.length > 3 ? ` +${ids.length - 3}` : ''}`)
        }
        if (spread) {
          // Each face of the ring is named, on its outer side: the top of the ring above, the bottom below.
          this.setText(f, i === namedFace(shown) && more ? `${names.get(id)} +${more}` : names.get(id)!)
          const h: Side = dx >= 0 ? 'right' : 'left', o: Side = dx >= 0 ? 'left' : 'right', v: Side = dy < 0 ? 'above' : 'below'
          const prefer: Side[] = Math.abs(dy) > Math.abs(dx) * 2 ? [v, h, o, dy < 0 ? 'below' : 'above'] : [h, v, o, dy < 0 ? 'below' : 'above']
          labels.push({ f, x: p.x + dx, y: p.y + dy, prefer, size: 1 })
        } else if (i === namedFace(shown)) {
          // The name goes beside the whole fan, on the last face drawn: a name put on the first face sat over the
          // second and third, and the room it kept was worked out for the last one, so names crossed each other.
          this.setText(f, ids.length > 1 ? `${names.get(id)} +${ids.length - 1}` : names.get(id)!)
          labels.push({ f, x: p.x + dx, y: p.y - shift, prefer: ['right', 'left', 'below', 'above'], size: ids.length })
        } else this.setSide(f, null)
      })
    }
    // Travellers stand apart and above everyone, with their names kept on.
    const moving: { f: Face; x: number; y: number }[] = []
    for (const { id, pos } of travellers) {
      const f = this.faces.get(id)!
      this.place(f, pos.lat, pos.lon)
      this.setFlag(f, 'hidden', false)
      f.el.title = ''
      this.offset(f, 0, 0)
      this.lead(f.el, 0, 0)
      this.anchor(f, false)
      this.setZ(f, id === this.focusId ? 20000 : 10000)
      this.setText(f, names.get(id)!)
      const p = m.latLngToContainerPoint([pos.lat, pos.lon])
      taken.add([p.x - R, p.y - R, p.x + R, p.y + R])
      moving.push({ f, x: p.x, y: p.y })
      order.push({ id, x: p.x, y: p.y })
    }
    // One Tab stop for all the faces; the arrows go west to east.
    this.order = order.sort((a, b) => a.x - b.x || a.y - b.y).map((o) => o.id)
    for (const [id, f] of this.faces) if (id !== this.active && f.el.tabIndex !== -1) f.el.tabIndex = -1
    this.setActive(this.active && this.order.includes(this.active) ? this.active : this.order[0] ?? null)
    // The route's numbered stops come before other names: the circles always, the year and place where they fit.
    const routeBoxes: { r: RouteEl; x: number; y: number; box: Box }[] = []
    // Two towns a few pixels apart (Reus and Barcelona from far out): the later mark moves aside, not under.
    // Faces are already in: a number never lands on a face.
    const circles = taken.copy()
    for (const r of this.route) {
      this.reach(r, year)
      const p = m.latLngToContainerPoint([r.stop.lat, r.stop.lon])
      const w = 8 + 5 * (r.stop.visits.join('·').length - 1)
      const [dx, dy] = freeOffset(circles, [p.x - w, p.y - 8, p.x + w, p.y + 8])
      const box: Box = [p.x + dx - w, p.y + dy - 8, p.x + dx + w, p.y + dy + 8]
      circles.add(box)
      both(box)
      r.el.style.setProperty('--ox', `${dx}px`)
      r.el.style.setProperty('--oy', `${dy}px`)
      // A numbered stop moved off its place keeps a hairline back to it, so the number is not read as another town.
      this.lead(r.el, dx, dy)
      routeBoxes.push({ r, x: p.x + dx, y: p.y + dy, box })
    }
    // A name must stay on the screen: one that would run off an edge goes to another side.
    const size = m.getSize()
    const free = (b: Box) => b[0] >= 2 && b[2] <= size.x - 2 && b[1] >= 0 && b[3] <= size.y && !taken.hit(b)
    for (const { f, x, y } of moving) {
      const sides: Side[] = ['right', 'left', 'above', 'below']
      const boxes = this.sides(f, x, y, sides)
      const i = boxes.findIndex(free)
      // A traveller is named where there is room. Where there is none it is quiet, since at sea a dozen people are a
      // few pixels apart and every name forced to the right of them lay across the next face and the next name. While
      // one or two are on their way, the name is kept even over another mark: there the eye is following them.
      const keep = moving.length <= KEPT_NAMES
      this.setSide(f, i >= 0 ? sides[i] : keep ? sides[0] : null)
      if (i >= 0 || keep) taken.add(boxes[Math.max(0, i)])
      f.name.classList.remove('collide')
    }
    const near = (b: Box, own: Box) => routeBoxes.some((o) => o.box !== own && b[0] - 14 < o.box[2] && b[2] + 14 > o.box[0] && b[1] < o.box[3] && b[3] > o.box[1])
    for (const { r, x, y, box: own } of routeBoxes) {
      // Close beside the number first; where faces stand on the stop, a little further out, past them.
      const h = 9, w = r.w
      const sides = (g: number): [Side, Box, number][] => [['right', [x + g, y - h, x + g + w, y + h], g], ['left', [x - g - w, y - h, x - g, y + h], g], ['below', [x - w / 2, y + g, x + w / 2, y + g + 2 * h], g], ['above', [x - w / 2, y - g - 2 * h, x + w / 2, y - g], g]]
      // With a margin at both ends, so a long name never starts right against another mark and reads as its own.
      // A place still ahead has no words yet, and keeps no room for them.
      const hit = r.ahead ? undefined : [...sides(10), ...sides(R + 2 * FAN + 6)].find(([, b]) => free(b) && !near(b, own))
      if (hit) both(hit[1])
      const side = hit?.[0] ?? null, gap = hit?.[2] ?? 10
      if (r.side !== side) { r.side = side; if (side) r.label.dataset.side = side; else delete r.label.dataset.side }
      r.label.style.setProperty('--g', `${gap}px`)
    }
    for (const { f, x, y, prefer } of labels.sort((a, b) => b.size - a.size)) {
      const boxes = this.sides(f, x, y, prefer)
      const i = boxes.findIndex(free)
      this.setSide(f, i >= 0 ? prefer[i] : null)
      if (i >= 0) both(boxes[i])
      // No room for the name on the map: it is still there, under the pointer.
      else if (!f.el.title) f.el.title = f.text
      f.name.classList.remove('collide')
    }
    this.placeMarks(marks, year, taken, still, captions)
    this.still = still
    return taken
  }

  /** Event marks: a glyph near where it happened, with "what · who" beside it while there is room. */
  private placeMarks(marks: Mark[], year: number, taken: Taken, still: Taken, captions: boolean) {
    const keep = new Set<string>()
    const zoom = this.map.getZoom(), size = this.map.getSize()
    for (const e of marks) {
      const p = this.map.latLngToContainerPoint([e.lat, e.lon])
      // A mark far outside the screen is no mark at all: it would only take a DOM node and a slot.
      if (p.x < -60 || p.y < -60 || p.x > size.x + 60 || p.y > size.y + 60) continue
      // Under the town first, then beside it, then above: never on a face.
      const slots: [number, number][] = [[0, 27], [-24, 27], [24, 27], [0, -27], [-24, -27], [24, -27]]
      const i = taken.first(slots.map(([dx, dy]): Box => [p.x + dx - 9, p.y + dy - 9, p.x + dx + 9, p.y + dy + 9]))
      if (i < 0) continue
      still.add(taken.boxes.at(-1)!)
      keep.add(e.key)
      const [gx, gy] = slots[i]
      const cap: Box = [p.x + gx + 10, p.y + gy - 8, p.x + gx + 14 + textWidth(e.caption, this.capFont), p.y + gy + 8]
      const withCap = (captions || zoom >= CAPTION_ZOOM) && !taken.hit(cap)
      if (withCap) { taken.add(cap); still.add(cap) }
      let mk = this.marks.get(e.key)
      if (!mk) {
        const el = document.createElement('span')
        el.className = 'map-event-in'
        el.appendChild(document.createElement('b')).textContent = GLYPH[e.kind]
        const capEl = el.appendChild(document.createElement('span'))
        capEl.textContent = e.caption
        const marker = this.L.marker([e.lat, e.lon], { keyboard: false, icon: this.L.divIcon({ className: `map-event map-event-${e.kind}`, html: el, iconSize: [0, 0] }) })
        marker.on('click', () => this.opts.pick(e.personId))
        this.group.addLayer(marker)
        marker.getElement()!.title = e.caption
        mk = { marker, el, cap: capEl, capW: 0, fade: NaN, slot: '', mine: false }
        this.marks.set(e.key, mk)
      }
      const mine = this.kin ? this.kin.has(e.personId) : e.personId === this.focusId
      if (mk.mine !== mine) { mk.mine = mine; marker(mk).classList.toggle('mine', mine) }
      const slot = `${gx},${gy}`
      if (mk.slot !== slot) { mk.slot = slot; mk.el.style.setProperty('--gx', `${gx}px`); mk.el.style.setProperty('--gy', `${gy}px`) }
      // The glyph stands beside its place, joined to it by a hairline and a dot, not left floating as a stray mark.
      this.lead(mk.el, gx, gy, 8, 8)
      mk.cap.classList.toggle('off', !withCap)
      const fade = Math.round((1 - ((year - e.year) / FADE_YEARS) * 0.7) * 20) / 20
      if (mk.fade !== fade) { mk.fade = fade; mk.el.style.opacity = String(fade) }
    }
    for (const [k, mk] of this.marks) if (!keep.has(k)) { this.group.removeLayer(mk.marker); this.marks.delete(k) }
  }

  /** How many event marks are drawn now. */
  get markCount() { return this.marks.size }
}
