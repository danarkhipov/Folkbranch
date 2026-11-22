'use client'
// The family on a map through time. One story clock (map-clock) moves everyone along their journeys; the atlas
// (map-atlas), the trails (map-trails) and the faces (map-people) are drawn from it; the camera (map-follow) holds
// still unless someone would leave the view; the bar (map-timeline-bar) plays and scrubs the clock.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import type * as Leaflet from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { LocateFixed } from 'lucide-react'
import { api, avatarUrl, useApp } from '@/lib/client'
import { peopleWords } from '@/lib/names'
import { aheadPoints } from '@/lib/map-camera'
import { marksAt } from '@/lib/map-layout'
import { bearerAt, lineFor, lineThread, threadPoints, withLine, type Thread } from '@/lib/map-line'
import { mercator } from '@/lib/map-motion'
import { msAt, schedule, yearAtMs } from '@/lib/map-pacing'
import { generationWords } from '@/lib/map-scrub'
import { eventYear, lifeSpan, mapTimeline, positionAt, routePoints, routeStops, sinceAt, trackLegs, withoutKinds, type MapTimeline, type Position, type RouteStop, type Track } from '@/lib/map-timeline'
import { lifeYears, personName, type Graph, type Place } from '@/lib/types'
import { activeIn, byStanding, entryBounds, erasOf, pickText, type ChronicleList, type ChronicleSwitches, type Entry, type Shape } from '@/lib/chronicle'
import { useLayers } from '@/lib/map-layers'
import { loadAtlas } from './map-atlas'
import { canvasLayer, type CanvasLayer } from './map-canvas'
import type { ArticleActions } from './chronicle-card'
import type { ChronicleState } from './map-chronicle'
import { useStoryClock } from './map-clock'
import { Follow, type Insets } from './map-follow'
import { FollowChip } from './map-follow-chip'
import { GAP_LABEL, MapGaps } from './map-gaps'
import { FADE_YEARS, PeopleLayer, RING_ZOOM, type Mark, type StackHit } from './map-people'
import { MapPlaceCard, type PlaceCardProps } from './map-place-card'
import { TimelineBar, type BarEra, type BarEvent, type BarFocus, type Show } from './map-timeline-bar'
import { agePulses, drawGhost, drawTrails, ghostKey, type LineDraw, type TrailState } from './map-trails'

/** How far ahead the camera looks while playing, in ms of what the screen will show. */
const LOOKAHEAD_MS = 4000
/** How often, while playing, the camera asks whether it should move. */
const CAMERA_EVERY_MS = 250
/**
 * How much of a year the recent trails move on while nobody travels. A band of the recent ink changes only when a
 * stretch of it ages past a band (a whole year of the twelve), so a sixth of a year is finer than it can show and a
 * quiet play need not draw the live canvas on every frame.
 */
const TRAIL_STEP = 1 / 6
/** While a ring of an event lives, the live trails are drawn for it at most this often: a ring opens over 700 ms. */
const RING_FRAME_MS = 40
/** The chronicle's shapes are drawn again at most this often while a front moves or an entry fades. */
const CHRONICLE_FRAME_MS = 33
/** No chronicle yet, the same empty list every render. */
const NO_ENTRIES: Entry[] = []
const NO_ERAS: BarEra[] = []
/** The chronicle's code, loaded only once a switch under Settings > Map shows it. */
type ChronicleParts = typeof import('./map-chronicle-parts')
/**
 * The live trails are drawn at most this often while they change: two screens a frame apart look the same, and a
 * trail 30 ms behind its traveller cannot be seen, while every frame of a big play redraws hundreds of journeys.
 */
const TRAIL_FRAME_MS = 30
/** From this speed on, a play of the whole family holds one still view of all its routes, so the pattern builds. */
const SWEEP_SPEED = 4
/**
 * The closest the reader can zoom. The bundled coast (Natural Earth 1:50m, simplified) turns to visible facets past
 * this; a crowded town's ring (RING_ZOOM) still opens below it.
 */
const MAX_ZOOM = 8.5
/**
 * Wheel pixels per zoom level, so one notch of a mouse wheel zooms about one level on every system, as on Google
 * Maps. Leaflet first divides a wheel's pixels by a factor that differs by system and screen; this undoes it.
 */
const wheelPx = (L: typeof import('leaflet')) => {
  const dpr = window.devicePixelRatio || 1
  const b = L.Browser as typeof L.Browser & { linux: boolean; mac: boolean }
  const factor = b.linux && b.chrome ? dpr : b.mac ? dpr * 3 : 2 * dpr
  return 70 / factor
}
/**
 * A trackpad or touch mouse sends many small wheel steps, a mouse wheel few large ones. A small step zooms the map at
 * once, every frame, the way Leaflet follows two fingers on a phone; the family is laid out again when the gesture
 * ends. TOUCH_RATE is zoom levels per pixel: a pinch or a two-finger swipe covers ground as on Google Maps.
 */
const TOUCH_RATE = 0.013
const isTouchStep = (e: WheelEvent) => e.deltaMode === 0 && Math.abs(e.deltaY) < 50 && e.deltaY !== Math.round(e.deltaY / 10) * 10 || (e.ctrlKey && Math.abs(e.deltaY) < 50)

/** Touch steps take the pinch path; a wheel notch keeps Leaflet's own one-level animated zoom. */
function smoothTouchZoom(L: typeof import('leaflet'), m: import('leaflet').Map) {
  type Inner = import('leaflet').Map & { _moveStart: (zoom: boolean, noMove: boolean) => void; _move: (c: import('leaflet').LatLng, z: number, o: object) => void; _moveEnd: (zoomChanged: boolean) => void }
  const map = m as Inner
  const wheel = (m as unknown as { scrollWheelZoom: { _onWheelScroll: (e: WheelEvent) => void; removeHooks: () => void; addHooks: () => void } }).scrollWheelZoom
  const own = wheel._onWheelScroll
  let zoom: number | null = null, center = m.getCenter(), frame = 0, done = 0
  // The gesture ends where the fingers left it: snapping to the nearest zoom step would zoom on by itself and slide the
  // map, since the centre was worked out for the zoom the fingers chose. Leaflet is told the move is over, so the
  // family is laid out again.
  const finish = () => {
    if (zoom === null) return
    cancelAnimationFrame(frame)
    map._move(center, zoom, { pinch: true, round: false })
    map._moveEnd(true)
    zoom = null
  }
  wheel.removeHooks()
  wheel._onWheelScroll = function (this: typeof wheel, e: WheelEvent) {
    if (!isTouchStep(e)) return own.call(this, e)
    e.preventDefault()
    if (zoom === null) { zoom = m.getZoom(); map._moveStart(true, false) }
    const next = Math.max(m.getMinZoom(), Math.min(m.getMaxZoom(), zoom - e.deltaY * TOUCH_RATE))
    // The point under the fingers stays under them, as on a map in the hand.
    const at = m.mouseEventToContainerPoint(e), half = m.getSize().divideBy(2)
    const there = m.containerPointToLatLng(at)
    center = m.unproject(m.project(there, next).subtract(at.subtract(half)), next)
    zoom = next
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => { if (zoom !== null) map._move(center, zoom, { pinch: true, round: false }) })
    clearTimeout(done)
    done = window.setTimeout(finish, 140)
  }
  wheel.addHooks()
  void L
}
/** The family before the places are known: an empty map, not a slow list of everyone missing. */
const NO_ONE: Graph = { persons: [], parentChild: [], unions: [] }

/** The person card slides in over this long; the camera fits a route once it is there. */
const CARD_MS = 380

/** The moment kept in the address next to `view` and `p` (?y=1889), so a view can be shared and reloaded. */
const readYear = () => { const v = Number(new URLSearchParams(location.search).get('y')); return v > 0 && Number.isFinite(v) ? v : null }
const writeYear = (y: number | null) => {
  const url = new URL(location.href)
  if (y === null) url.searchParams.delete('y')
  else url.searchParams.set('y', String(Math.round(y * 10) / 10))
  history.replaceState(null, '', url)
}

/** The line of descent followed, kept in the address as its ancestor (?line=<id>), next to `p`. */
const readLine = () => new URLSearchParams(location.search).get('line')
const writeLine = (id: string | null) => {
  const url = new URL(location.href)
  if (id === null) url.searchParams.delete('line')
  else url.searchParams.set('line', id)
  history.replaceState(null, '', url)
}

/** Who the map follows: one person's life, or a line of descent (the ancestor first, the end last). */
export interface Followed { mode: 'life' | 'line'; ids: string[] }

/** Why someone has no place on the map yet, in a few words: their first two gaps ("Birth — place unknown"). */
function missingFor(data: MapTimeline, id: string, t: (k: string) => string): string {
  const gaps = data.absent.find((a) => a.personId === id)?.gaps ?? data.missing.filter((m) => m.personId === id)
  if (!gaps.length) return t('no events written')
  return gaps.slice(0, 2).map((g) => `${g.what} — ${t(GAP_LABEL[g.gap])}`).join('; ') + (gaps.length > 2 ? ` +${gaps.length - 2}` : '')
}

interface Engine { L: typeof Leaflet; map: Leaflet.Map; people: PeopleLayer; trails: CanvasLayer; live: CanvasLayer; ghost: CanvasLayer; names: { group: Leaflet.LayerGroup; place: (m: Leaflet.Map, taken: import('@/lib/map-layout').Taken) => void }; follow: Follow; chronicle: CanvasLayer | null }

/** A phone: the person card is a sheet over most of the map, so picking someone follows them with the card closed. */
const narrow = () => matchMedia('(max-width: 640px)').matches
/** From this width the chronicle is a front page beside the map; below it, a card inside the bar. */
const WIDE = '(min-width: 1100px)'

/**
 * `card`: whether the person card is open. Who is followed is the app's `focusId` (`p`); the two are apart here.
 * `root`: the person the tree's current view is drawn from, if it is narrowed to one; a line may end there.
 */
export default function MapView({ card: cardOpen, onCard, root = null }: { card: boolean; onCard: (open: boolean) => void; root?: string | null }) {
  const { t, lang, archiveLang, view, graph, family, me, focus, byId, focusId } = useApp()
  const { data: places, isSuccess } = useQuery({ queryKey: ['places'], queryFn: () => api<Place[]>('places') })
  // What was going on around the family, when the owner's switches show it (Settings > Map): `history` draws the
  // shapes, `words` the marks on the bar, the chip, the card and the front page. Off, nothing of it is asked for or
  // loaded. The list comes again on every change; each shape once per version of its entry.
  const switches = useQuery({ queryKey: ['chronicle', 'switches'], queryFn: () => api<ChronicleSwitches>('chronicle/switches') })
  const history = !!switches.data?.history, words = !!switches.data?.chronicle
  const chronicle = useQuery({ queryKey: ['chronicle'], queryFn: () => api<ChronicleList>('chronicle'), enabled: history || words })
  const entries = (history || words) && chronicle.data?.entries || NO_ENTRIES
  const [parts, setParts] = useState<ChronicleParts | null>(null)
  useEffect(() => {
    if (parts || !(history || words)) return
    let gone = false
    void import('./map-chronicle-parts').then((m) => { if (!gone) setParts(m) })
    return () => { gone = true }
  }, [parts, history, words])
  const shapeAnswers = useQueries({ queries: entries.filter((e) => history && e.hasShape).map((e) => ({ queryKey: ['chronicle-shape', e.key, e.updatedAt], queryFn: () => api<{ shape: Shape }>(`chronicle/${encodeURIComponent(e.key)}/shape`).then((r) => [e.key, r.shape] as const), staleTime: Infinity })) })
  const shapesKey = shapeAnswers.map((q) => q.dataUpdatedAt).join()
  const shapes = useMemo(() => new Map(shapeAnswers.flatMap((q) => (q.data ? [q.data] : []))), [shapesKey]) // eslint-disable-line react-hooks/exhaustive-deps
  // Play slows through a moving front only where the front is drawn.
  const eras = useMemo(() => (history ? erasOf(entries) : []), [entries, history])
  // What the viewer switched on and off, remembered in this browser.
  const layers = useLayers()
  // A line is found in the whole family the page holds, not only the part the tree shows, and so is who is placed.
  // Nothing is built before the places come in: without them every life would be worked through only to be missing.
  const whole = useMemo(() => mapTimeline(places ? graph : NO_ONE, places ?? [], t), [graph, places, lang]) // eslint-disable-line react-hooks/exhaustive-deps
  const placedIds = useMemo(() => new Set(whole.tracks.map((x) => x.personId)), [whole])
  /** How each parent and child are linked, for preferring a chain of birth links. */
  const linkKind = useMemo(() => new Map(graph.parentChild.map((l) => [`${l.parentId}|${l.childId}`, l.kind])), [graph])
  /** The line from an ancestor: to the reader's own person, else to the tree's root; null when it is neither's. */
  const lineFrom = useCallback((anc: string | null) => {
    const found = lineFor(family.parents, anc, [me.personId, root], { hidden: (id) => !!byId.get(id)?.hidden, placed: (id) => placedIds.has(id), kind: (p, c) => linkKind.get(`${p}|${c}`) ?? 'birth' })
    return found && { ids: found.ids, you: found.end === me.personId }
  }, [me.personId, root, byId, family, placedIds, linkKind])
  const [lineAnc, setLineAnc] = useState<string | null>(() => (typeof location !== 'undefined' ? readLine() : null))
  const chosenLine = useMemo(() => lineFrom(lineAnc), [lineFrom, lineAnc])
  // The line holds while the person picked is in it: picking someone outside it follows their life instead.
  const line = chosenLine && focusId && chosenLine.ids.includes(focusId) ? chosenLine : null
  const offered = useMemo(() => (line ? line : lineFrom(focusId)), [line, lineFrom, focusId])
  const setLine = (anc: string | null) => setLineAnc(anc)
  // A line that no longer holds (the person picked left it, or its ancestor is gone) is let go while rendering,
  // and the address follows the line chosen.
  if (lineAnc && byId.size && !line) setLineAnc(null)
  useEffect(() => writeLine(lineAnc), [lineAnc])
  // Everyone in the line stands on the map, also those outside the tree's current view.
  const shown = useMemo<Graph>(() => (line ? withLine(view, graph, line.ids) : view), [view, graph, line])
  // By language, not by `t`: the app makes a new `t` every render, and new tracks would rebuild every face.
  const built = useMemo(() => (shown === graph || !places ? whole : mapTimeline(shown, places, t)), [shown, graph, whole, places, lang]) // eslint-disable-line react-hooks/exhaustive-deps
  /** Without the kinds of event the viewer switched off: the same object when none is. */
  const data = useMemo(() => withoutKinds(built, layers.hidden), [built, layers.hidden])
  /** The thread of the line followed, worked out from the tracks drawn. */
  // Null too when nobody in the line is on the map: then there is nothing to draw, play or frame, only the chip to say so.
  const thread = useMemo<Thread | null>(() => {
    if (!line) return null
    const th = lineThread(line.ids.map((id) => {
      const p = byId.get(id), tr = data.tracks.find((x) => x.personId === id) ?? null
      return { id, track: tr, hidden: !!p?.hidden, born: tr?.born ?? (p ? p.birthYear ?? eventYear(p.birthDate) : null) }
    }), Math.min(new Date().getFullYear(), data.max))
    return th.placed ? th : null
  }, [line, data, byId])
  const lineTracks = useMemo(() => (line ? data.tracks.filter((x) => line.ids.includes(x.personId)) : null), [line, data])
  // A line plays at its own pace: its busy years get the time, not the rest of the family's.
  const pacing = useMemo(() => schedule(lineTracks?.length ? lineTracks : data.tracks, data.min, data.max, eras), [data, lineTracks, eras])
  // Every event with a place and a year, oldest first: for marks, pulses and the camera.
  // A marriage is a stop for both partners but one mark on the map, as on the bar.
  const events = useMemo<Mark[]>(() => {
    const told = new Set<string>()
    return data.tracks.flatMap((tr) => tr.stops.flatMap((st, i) => {
      if (st.union) { if (told.has(st.union)) return []; told.add(st.union) }
      return [{ key: st.union ? `u:${st.union}` : `${tr.personId}:${i}`, lat: st.lat, lon: st.lon, kind: st.kind, caption: `${st.what} · ${tr.name}`, year: st.year, personId: tr.personId }]
    })).sort((a, b) => a.year - b.year)
  }, [data])
  // The same events as the bar tells them, and whether each brought someone somewhere new (for the histogram).
  // A marriage is a stop for both partners but one event: counted and told once.
  const barEvents = useMemo<BarEvent[]>(() => {
    const told = new Set<string>()
    return data.tracks.flatMap((tr) => tr.stops.flatMap((st, i) => {
      if (st.union) { if (told.has(st.union)) return []; told.add(st.union) }
      const before = tr.stops[i - 1]
      return [{ year: st.year, moved: !!before && (before.lat !== st.lat || before.lon !== st.lon), what: st.what, name: tr.name, place: st.place, personId: tr.personId }]
    })).sort((a, b) => a.year - b.year)
  }, [data])
  /** Every route of everyone in scope, for the still view of the whole family's pattern. */
  const allPoints = useMemo(() => data.tracks.flatMap(routePoints), [data])
  // The person followed, when they have somewhere to stand on the map.
  // Who the map follows. Today one person's life (the app's `p`); the shape leaves room for other ways of following
  // (a line of descent through several people) without changing what reads it.
  // Someone hidden from this reader is followed no more than an id nobody has: no chip, no marks.
  const who = useMemo<Followed | null>(() => (line ? { mode: 'line', ids: line.ids } : focusId && byId.has(focusId) && !byId.get(focusId)!.hidden ? { mode: 'life', ids: [focusId] } : null), [line, focusId, byId])
  const focusTrack = useMemo(() => (who?.mode === 'life' ? data.tracks.find((tr) => tr.personId === who.ids[0]) ?? null : null), [data, who])
  const nameOf = (id: string) => data.tracks.find((x) => x.personId === id)?.name ?? (byId.get(id) ? personName(byId.get(id)!) || t('No name') : '')
  const firstName = (id: string) => (byId.get(id)?.givenName.trim().split(/\s+/)[0] || nameOf(id))
  /** The line's own events, as the bar steps through them: each bearer's during their stretch, and each handover as a birth. */
  const lineSteps = useMemo<BarEvent[] | null>(() => {
    if (!thread) return null
    const out: BarEvent[] = []
    for (const [i, s] of thread.stretches.entries()) {
      const tr = data.tracks.find((x) => x.personId === s.personId)
      const h = thread.handovers.find((x) => x.child === s.personId)
      const last = i === thread.stretches.length - 1
      if (h?.birth) out.push({ year: h.year, moved: false, what: t('Birth'), name: nameOf(s.personId), place: h.bornAt || t('place unknown'), personId: s.personId })
      for (const st of tr?.stops ?? []) {
        if (st.year < s.from || (last ? st.year > s.to : st.year >= s.to)) continue
        if (h?.birth && st.kind === 'birth') continue
        out.push({ year: st.year, moved: false, what: st.what, name: tr!.name, place: st.place, personId: s.personId })
      }
    }
    return out.sort((a, b) => a.year - b.year)
  }, [thread, data]) // eslint-disable-line react-hooks/exhaustive-deps
  const barFocus = useMemo<BarFocus | null>(() => {
    if (thread && line) {
      return { id: line.ids[0], name: nameOf(line.ids[0]), from: thread.start, to: thread.end, steps: lineSteps ?? [], bands: thread.stretches.map((s) => ({ from: s.from, to: s.to, name: firstName(s.personId) })) }
    }
    if (!focusTrack) return null
    const [a, b] = lifeSpan(focusTrack)
    return { id: focusTrack.personId, name: focusTrack.name, from: Math.max(data.min, a), to: Math.min(data.max, b) }
  }, [focusTrack, data, thread, line, lineSteps]) // eslint-disable-line react-hooks/exhaustive-deps
  /** What the trails draw for the line, and the generation marks on the map. */
  const lineDraw = useMemo<LineDraw | null>(() => (thread && line ? { thread, ids: new Set(line.ids), key: line.ids.join(',') } : null), [thread, line])
  const genStops = useMemo(() => {
    if (!thread) return []
    // Marks at one place share one circle: "1·2", and the names beside it in turn.
    const out: (RouteStop & { text: string; who: string[] })[] = []
    for (const h of thread.handovers) {
      if (h.lat === null || h.lon === null) continue
      const same = out.find((r) => r.lat === h.lat && r.lon === h.lon)
      // The year they are first at that place: a birth with no place is not put where they were first placed.
      const who = `${firstName(h.child)} ${Math.floor(h.placeYear)}`
      if (same) { same.visits.push(h.gen); same.years.push(h.placeYear); same.who.push(who); same.text = `${same.who.join(', ')} · ${same.place}` }
      else out.push({ lat: h.lat, lon: h.lon, place: h.place, visits: [h.gen], years: [h.placeYear], who: [who], text: `${who} · ${h.place}` })
    }
    return out
  }, [thread]) // eslint-disable-line react-hooks/exhaustive-deps
  const clock = useStoryClock(pacing, data.min)
  // Play along a line runs the relay: from its start when the moment is outside it, and it stops at its end.
  const play = () => {
    if (thread && !clock.playing && (clock.at.current < thread.start || clock.at.current >= thread.end)) clock.seek(thread.start)
    clock.toggle()
  }
  const pause = useRef(clock.toggle)
  useLayoutEffect(() => { pause.current = clock.toggle })
  const [card, setCard] = useState<Omit<PlaceCardProps, 'onPick' | 'onZoom' | 'onClose'> & { lat: number; lon: number; el: HTMLElement } | null>(null)
  // Faces, marks or both, from the layers.
  const show: Show = layers.people && layers.events ? 'both' : layers.people ? 'people' : 'events'
  const [counts, setCounts] = useState({ people: 0, events: 0 })
  const [following, setFollowing] = useState(true)
  const [ready, setReady] = useState(false)
  // Read once, before anything writes the address.
  const [urlYear] = useState(() => (typeof location !== 'undefined' ? readYear() : null))
  const box = useRef<HTMLDivElement>(null)
  const engine = useRef<Engine | null>(null)
  /**
   * Someone picked on the map is followed; on a phone the sheet stays closed until "Open" in the bar. Along a line,
   * someone in it keeps the line and the moment moves into their stretch; anyone else is followed for their own life.
   */
  const follow = (id: string) => {
    const s = thread?.stretches.find((x) => x.personId === id)
    focus(id, { center: false })
    if (narrow()) onCard(false)
    if (!s) return
    const y = clock.at.current
    if (y < s.from || y >= s.to) { clock.seek(s.from, true) }
  }
  const pick = useRef(follow)
  useLayoutEffect(() => { pick.current = follow })
  const cardOpenRef = useRef(cardOpen)
  useLayoutEffect(() => { cardOpenRef.current = cardOpen })
  const faceFor = (id: string) => (byId.get(id) ? avatarUrl(byId.get(id)!) : '')
  const faceOf = useRef(faceFor)
  useLayoutEffect(() => { faceOf.current = faceFor })
  /** What the canvas and the layout read, kept outside React. */
  const state = useRef<TrailState & { show: Show; events: Mark[]; points: [number, number][] }>({ tracks: [], year: data.min, positions: new Map(), pulses: [], ink: '#2a2620', show: 'both', events: [], focus: null, line: null, points: [] })
  useLayoutEffect(() => { state.current.focus = focusTrack; state.current.line = lineDraw; state.current.routes = layers.routes; state.current.trails = layers.trails; state.current.departed = layers.departed; departedRef.current = layers.departed })
  /** What the chronicle's canvas reads, kept outside React; `chronicleShown` is the look it last drew. */
  const chron = useRef<ChronicleState>({ entries: [], shapes: new Map(), year: data.min, story: null, name: (x) => pickText(x, lang), colors: { ink: '#2a2620', inkSoft: '#6f685b', accent: '#a4502e', paper: '#f7f3ea', sans: 'sans-serif', serif: 'serif' } })
  const chronicleShown = useRef('')
  /** What the chronicle would draw at a moment, while its shapes are on the map; null while they are not. */
  const look = useRef<ChronicleParts['chronicleLook'] | null>(null)
  /** Draws the chronicle again if what it shows changed, at most every CHRONICLE_FRAME_MS; set with the clock below. */
  const redrawChronicle = useRef(() => {})
  useLayoutEffect(() => {
    const c = chron.current
    c.entries = entries; c.shapes = shapes; c.name = (x) => pickText(x, lang)
    chronicleShown.current = look.current?.(c, c.year) ?? ''
    engine.current?.chronicle?.redraw()
  }, [entries, shapes, lang, ready])
  // Chosen in the map's layers: the lines are drawn again at once.
  useEffect(() => { engine.current?.ghost.redraw(); engine.current?.live.redraw() }, [layers.routes, layers.trails])
  /** The places a followed route or line keeps in view, framed once when it is followed; null when no one is. */
  const followPoints = useMemo(() => (thread ? threadPoints(thread) : focusTrack ? routePoints(focusTrack) : null), [thread, focusTrack])
  const followRef = useRef(followPoints)
  useLayoutEffect(() => { followRef.current = followPoints })
  /** Where a line's play stops: its end (the present, or the end of the last life). */
  const lineEndRef = useRef<number | null>(null)
  useLayoutEffect(() => { lineEndRef.current = thread?.end ?? null })
  const tr = useRef(t)
  useLayoutEffect(() => { tr.current = t })
  const langRef = useRef(lang)
  useLayoutEffect(() => { langRef.current = lang })
  /** Faces, names and marks laid out again; set below, once the layout can read the moment. */
  const relayout = useRef(() => {})
  const sweepingRef = useRef(false)
  const allPointsRef = useRef(allPoints)
  useLayoutEffect(() => { allPointsRef.current = allPoints })
  const openStack = useRef((_: StackHit) => {})

  const [atlasLost, setAtlasLost] = useState(false)
  const retryAtlas = useRef(() => {})
  const addAtlas = (atlas: Awaited<ReturnType<typeof loadAtlas>>) => {
    const e = engine.current
    if (!e) return
    atlas.base.layer.addTo(e.map)
    atlas.names.group.addTo(e.map)
    e.names = atlas.names
    relayout.current()
  }

  // The map itself, once. Our own canvases sit in their own panes: the atlas under everything, trails above it.
  useEffect(() => {
    if (!box.current) return
    let gone = false
    void import('leaflet').then(async (L) => {
      if (gone || !box.current) return
      // No zoom steps: a pinch on a phone ends where the fingers left it, as the trackpad one does, instead of zooming on
      // to the nearest step and sliding; + and − and a wheel notch still move one whole level.
      const m = L.map(box.current, { zoomControl: false, attributionControl: true, maxZoom: MAX_ZOOM, zoomSnap: 0, zoomDelta: 1, wheelPxPerZoomLevel: wheelPx(L), wheelDebounceTime: 10, bounceAtZoomLimits: false, maxBoundsViscosity: 1, worldCopyJump: false, maxBounds: [[-85, -200], [85, 200]] }).setView([40, 0], 3)
      L.control.zoom({ position: 'bottomright' }).addTo(m)
      smoothTouchZoom(L, m)
      // Shown once the family's first view is set; if the family never comes, the plain map is shown anyway.
      setTimeout(() => box.current?.classList.remove('map-waiting'), 1500)
      if (process.env.NODE_ENV !== 'production') (window as unknown as { __fbMap?: unknown }).__fbMap = m
      m.attributionControl.setPrefix(false).addAttribution('Natural Earth')
      m.createPane('atlas').style.zIndex = '150'
      m.createPane('ghosts').style.zIndex = '340'
      m.createPane('trails').style.zIndex = '350'
      state.current.ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#2a2620'
      // Finished journeys on a canvas of their own, drawn when one more finishes; the live trails above, every frame.
      const ghost = canvasLayer(L, 'ghosts', (v) => { if (state.current.show !== 'events') drawGhost(v, state.current) })
      const live = canvasLayer(L, 'trails', (v) => { if (state.current.show !== 'events') drawTrails(v, state.current) })
      ghost.layer.addTo(m)
      live.layer.addTo(m)
      const css = getComputedStyle(document.documentElement), cssVar = (k: string, d: string) => css.getPropertyValue(k).trim() || d
      chron.current.colors = { ink: cssVar('--ink', '#2a2620'), inkSoft: cssVar('--ink-soft', '#6f685b'), accent: cssVar('--accent', '#a4502e'), paper: cssVar('--paper', '#f7f3ea'), sans: cssVar('--font-sans', 'sans-serif'), serif: cssVar('--font-serif', 'serif') }
      const trails: CanvasLayer = { layer: live.layer, redraw: () => { ghost.redraw(); live.redraw() } }
      state.current.accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#a4502e'
      const people = new PeopleLayer(L, m, { avatar: (id) => faceOf.current(id), pick: (id) => pick.current(id), stack: (h) => openStack.current(h), t: (k) => tr.current(k), people: (n) => peopleWords(n, langRef.current), hover: (id) => { state.current.hover = id ? state.current.tracks.find((t) => t.personId === id) ?? null : null; engine.current?.live.redraw() } })
      const follow = new Follow(L, m, () => insets(m), () => setFollowing(false))
      // Without the base map the family still stands and travels on plain paper, and the atlas can be asked again.
      const atlas = await loadAtlas(L).catch(() => null)
      if (gone) { m.remove(); return }
      engine.current = { L, map: m, people, trails, live, ghost, names: { group: L.layerGroup(), place: () => {} }, follow, chronicle: null }
      if (atlas) addAtlas(atlas)
      else setAtlasLost(true)
      retryAtlas.current = () => {
        setAtlasLost(false)
        void loadAtlas(L).then((a) => { if (!gone) addAtlas(a) }, () => { if (!gone) setAtlasLost(true) })
      }
      // Labels are laid out again when the map comes to rest, never during a move. A move closes the place card.
      m.on('moveend', () => relayout.current())
      m.on('movestart', () => setCard(null))
      setReady(true)
    })
    return () => {
      gone = true
      engine.current?.map.remove()
      engine.current = null
      setReady(false)
      // The year leaves the address only when the map does: React may take the map down and put it straight back
      // (as it does in development), and a reload right after must still find the year there.
      setTimeout(() => { if (new URLSearchParams(location.search).get('view') !== 'map') writeYear(null) }, 0)
    }
  }, [])

  const bars = useRef<{ at: number; boxes: [number, number, number, number][] }>({ at: -Infinity, boxes: [] })
  /** Faces, names and marks laid out for the moment shown, and the counts in the bar. */
  const relayoutNow = () => {
    const e = engine.current
    if (!e) return
    const st = state.current, y = st.year
    if (st.line) e.people.setCurrent(bearerAt(st.line.thread, y))
    // A passing event's mark is a small thing: close in it points out where something happened, at world size it is
    // one stray dot among thousands. Events mode is the exception: there the marks are what the map is for.
    const marks = !marksAt(st.show, e.map.getZoom()) ? [] : st.events.filter((ev) => y - ev.year >= 0 && y - ev.year < FADE_YEARS).reverse()
    // The bars over the map hardly move: measured at most every half second, not on every year of a play.
    const now = performance.now()
    if (now - bars.current.at > 500) {
      const box = e.map.getContainer().getBoundingClientRect()
      bars.current = { at: now, boxes: [...document.querySelectorAll('.main-bar, .map-gaps > *, .map-bar, .map-follow, .chronicle, .chronicle-tab')].map((el): [number, number, number, number] => {
        const r = el.getBoundingClientRect()
        return [r.left - box.left, r.top - box.top, r.right - box.left, r.bottom - box.top]
      }) }
    }
    // In events mode the mark's words are the content, so they are kept at every zoom.
    const taken = e.people.layout(st.tracks, st.positions, marks, y, bars.current.boxes, st.show === 'events')
    e.names.place(e.map, taken)
    let people = 0
    for (const p of st.positions.values()) if (p) people++
    const next = { people, events: e.people.markCount }
    setCounts((c) => (c.people === next.people && c.events === next.events ? c : next))
  }
  useLayoutEffect(() => { relayout.current = relayoutNow })

  /**
   * Where each person is, worked out once and kept while the answer cannot change: someone standing at a stop stays
   * there until the next journey leaves, and a traveller is worked out anew on every frame. The map is filled in
   * place rather than made again, so a play does not make two thousand entries a frame.
   */
  const departedRef = useRef(layers.departed)
  const posCache = useRef(new WeakMap<Track, { from: number; until: number; p: Position | null }>())
  const positionNow = (tr: Track, y: number): Position | null => {
    const cache = posCache.current, kept = cache.get(tr)
    if (kept && y >= kept.from && y < kept.until) return kept.p
    const [start, end] = lifeSpan(tr)
    const p = positionAt(tr, y, departedRef.current)
    let until: number
    if (!p) until = y < start ? start : Infinity
    else if (p.gone) until = Infinity
    else if (p.leg) until = Math.min(p.leg.arrive, end + 1)
    else {
      // A journey leaves from the stop they stand at; until then they are exactly where they are now.
      const next = trackLegs(tr).find((l) => l.from === p.at)
      until = Math.min(next ? next.leave : Infinity, end + 1)
    }
    cache.set(tr, { from: y, until, p })
    return p
  }
  /** Where everyone shown is at a moment. */
  const place = (y: number) => {
    const st = state.current, out = st.positions
    // Only the moment is shown as events, not faces: nothing to place. The cache goes with the emptied map.
    if (st.show === 'events') {
      if (out.size) { out.clear(); posCache.current = new WeakMap() }
      return out
    }
    const cache = posCache.current
    for (const tr of st.tracks) {
      // A kept answer is already in the map from the frame that worked it out: nothing to write again.
      const kept = cache.get(tr)
      if (kept && y >= kept.from && y < kept.until) continue
      const p = positionNow(tr, y)
      if (p) out.set(tr.personId, p)
      else out.delete(tr.personId)
    }
    return out
  }
  // The dead kept or let go: everyone is placed again, and the faces and lines follow.
  useEffect(() => {
    const st = state.current
    posCache.current = new WeakMap(); st.positions.clear(); st.positions = place(st.year)
    relayout.current(); engine.current?.ghost.redraw(); engine.current?.live.redraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers.departed])
  /** The places the camera should keep in view from a moment on: people now and soon, or events in events mode. */
  const keepInView = (y: number, ahead: number): [number, number][] => {
    const st = state.current
    // Following one person or a line, the camera keeps their whole route: it was framed when they were picked.
    if (followRef.current && st.show !== 'events') return followRef.current
    if (st.show === 'events') return st.events.filter((ev) => ev.year <= y + ahead && y - ev.year < FADE_YEARS).map((ev) => [ev.lat, ev.lon])
    return aheadPoints(st.tracks, y, y + ahead)
  }

  // Each change of the moment: move what moves, mark what happens, lay out again only when the picture changed.
  const lastCamera = useRef(0)
  /** What the ghost canvas shows now, so a frame draws it again only when it changed. */
  const ghostShown = useRef('')
  const playing = useRef(false)
  useLayoutEffect(() => { playing.current = clock.playing })
  const speed = useRef(clock.speed)
  useLayoutEffect(() => { speed.current = clock.speed })
  useEffect(() => {
    if (!ready) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let pulsing = 0
    // Rings are drawn with the trails, so they live only where trails are drawn, and every frame ages them first.
    const pulseLoop = () => {
      agePulses(state.current.pulses, performance.now())
      if (state.current.show !== 'events') engine.current?.live.redraw()
      pulsing = state.current.pulses.length && state.current.show !== 'events' ? requestAnimationFrame(pulseLoop) : 0
    }
    // The step of the year the live trails were last drawn at, for TRAIL_STEP, and when, for RING_FRAME_MS.
    let trailStep = NaN
    let trailAt = 0
    // The chronicle is drawn again only when what it shows has changed (an entry, a front's blend, a fade), and at most
    // every CHRONICLE_FRAME_MS; a change inside that time is drawn when it is up.
    let chronicleAt = 0, chronicleWait = 0
    const chronicleFrame = () => {
      const c = chron.current, now = look.current?.(c, c.year)
      if (now === undefined || now === chronicleShown.current) return
      const wait = CHRONICLE_FRAME_MS - (performance.now() - chronicleAt)
      if (wait > 0) { chronicleWait ||= window.setTimeout(() => { chronicleWait = 0; chronicleFrame() }, wait); return }
      chronicleAt = performance.now()
      chronicleShown.current = now
      engine.current?.chronicle?.redraw()
    }
    redrawChronicle.current = chronicleFrame
    const off = clock.listen((y, prev) => {
      const e = engine.current
      if (!e) return
      const st = state.current
      st.year = y
      chron.current.year = y
      chronicleFrame()
      st.positions = place(y)
      // Events as they happen: a ring at the place, only when the clock runs forward a little (not a jump).
      if (!reduced && st.show !== 'events' && y > prev && y - prev < 2) {
        const now = performance.now()
        for (const ev of st.events) if (ev.year > prev && ev.year <= y) st.pulses.push({ at: mercator([ev.lat, ev.lon]), t0: now })
        if (st.pulses.length && !playing.current && !pulsing) pulsing = requestAnimationFrame(pulseLoop)
      }
      if (playing.current && lineEndRef.current !== null && prev < lineEndRef.current && y >= lineEndRef.current && lineEndRef.current < pacing.max) pause.current()
      if (e.people.frame(st.positions) || Math.floor(y) !== Math.floor(prev)) relayout.current()
      if (st.show !== 'events') {
        const key = ghostKey(st)
        if (key !== ghostShown.current) { ghostShown.current = key; e.ghost.redraw() }
        // A traveller under way redraws the live trails every frame; with nobody travelling only the age of the ink
        // changes, and a step of TRAIL_STEP year is finer than it can show.
        let moving = false
        for (const p of st.positions.values()) if (p?.leg) { moving = true; break }
        const step = Math.floor(y / TRAIL_STEP)
        // A ring opens over 700 ms: it is drawn every RING_FRAME_MS, not on every frame, unless the trails are drawn
        // for another reason anyway (a traveller, a new step of the year).
        const now = performance.now()
        const ring = !!st.pulses.length && now - trailAt >= RING_FRAME_MS
        // The year's step, or a traveller under way, asks for a drawing; the rate above says when one is made.
        const due = (moving || step !== trailStep) && now - trailAt >= TRAIL_FRAME_MS
        if (ring || due) { trailStep = step; trailAt = now; e.live.redraw() }
      }
      if (playing.current && !sweepingRef.current && performance.now() - lastCamera.current > CAMERA_EVERY_MS) {
        lastCamera.current = performance.now()
        const ahead = yearAtMs(pacing, msAt(pacing, y) + LOOKAHEAD_MS * speed.current) - y
        e.follow.keep(keepInView(y, ahead))
      }
    })
    // At rest: the address keeps the moment, and the camera looks once at what is shown.
    // At the end of a play the last frame leaves the pattern on screen: every route (or the one followed), in one move.
    const offSettle = clock.onSettle((y) => {
      writeYear(y)
      const e = engine.current
      if (!e) return
      // The last frame of a jump or a scrub may have been skipped by the frame rate: at rest the trails are drawn for
      // exactly this moment, so no line of an earlier one stays.
      if (state.current.show !== 'events') { const key = ghostKey(state.current); if (key !== ghostShown.current) { ghostShown.current = key; e.ghost.redraw() } e.live.redraw() }
      if ((y >= pacing.max || (lineEndRef.current !== null && y >= lineEndRef.current)) && e.follow.following) e.follow.fit(followRef.current ?? allPointsRef.current, true)
      else e.follow.keep(keepInView(y, 0))
    })
    return () => { off(); offSettle(); cancelAnimationFrame(pulsing); clearTimeout(chronicleWait); redrawChronicle.current = () => {} }
  }, [ready, clock.listen, clock.onSettle, pacing])

  // The history on the map, once its code is in: the shapes on a canvas over the atlas and under the family, their
  // names just above, never in the way of a click. Switched off, both leave the map.
  useEffect(() => {
    const e = engine.current
    if (!ready || !e || !parts || !history) return
    const { L, map: m } = e
    for (const [name, z] of [['chronicle', '160'], ['chronicleNames', '161']] as const) {
      if (m.getPane(name)) continue
      const pane = m.createPane(name)
      pane.style.zIndex = z
      pane.style.pointerEvents = 'none'
    }
    const canvas = canvasLayer(L, 'chronicle', (v) => parts.drawChronicle(v, chron.current))
    canvas.layer.addTo(m)
    const names = new parts.ChronicleNames(L, m, 'chronicleNames')
    e.chronicle = { layer: canvas.layer, redraw: () => { canvas.redraw(); names.update(chron.current) } }
    // Names show from a zoom on: looked at again when a zoom ends.
    const zoomed = () => names.update(chron.current)
    m.on('zoomend', zoomed)
    look.current = parts.chronicleLook
    chronicleShown.current = parts.chronicleLook(chron.current, chron.current.year)
    e.chronicle.redraw()
    // A moving front's next step, traced in the worker, is drawn as soon as it comes in.
    const offMorph = parts.onMorph(() => redrawChronicle.current())
    return () => {
      offMorph()
      m.off('zoomend', zoomed)
      canvas.layer.remove()
      names.clear()
      look.current = null
      chronicleShown.current = ''
      e.chronicle = null
    }
  }, [ready, parts, history])

  // At 4× and 8× over the whole family, the camera frames all routes once and then holds still while they build.
  useEffect(() => {
    const e = engine.current
    sweepingRef.current = false
    if (!ready || !e || !clock.playing || clock.speed < SWEEP_SPEED || followPoints) return
    sweepingRef.current = true
    if (e.follow.following) e.follow.fit(allPoints, true)
  }, [ready, clock.playing, clock.speed, followPoints, allPoints])

  // A new family, new places or a new choice of what to show: everything is laid out again.
  const started = useRef(false)
  /** The reader moved the map before the family came in: the first framing does not take their view away. */
  const touched = useRef(false)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const mark = () => { if (!started.current) touched.current = true }
    for (const k of ['wheel', 'pointerdown', 'touchstart', 'keydown'] as const) el.addEventListener(k, mark, { passive: true })
    return () => { for (const k of ['wheel', 'pointerdown', 'touchstart', 'keydown'] as const) el.removeEventListener(k, mark) }
  }, [])
  useEffect(() => {
    const e = engine.current
    if (!ready || !e) return
    const st = state.current
    if (st.tracks !== data.tracks) {
      e.people.reset(new Set(data.tracks.map((x) => x.personId)))
      // Who is here may have changed under an open place card: it closes rather than list someone gone.
      setCard(null)
      // The places of people no longer shown would otherwise stay in a map filled in place.
      st.positions.clear()
      posCache.current = new WeakMap()
    }
    st.tracks = data.tracks
    st.events = events
    st.show = show
    // The first time the family is known, the moment comes from the address, and the map fits it without a flight.
    if (!started.current && isSuccess) {
      started.current = true
      // With no year in the address, the map opens on the first life, not on the empty start of its decade.
      const first = data.tracks.length ? Math.min(...data.tracks.map((x) => lifeSpan(x)[0])) : data.min
      const y = Math.max(data.min, Math.min(data.max, urlYear ?? first))
      clock.seek(y)
      st.pulses = []
      st.year = y
      st.positions = place(y)
      // The camera is set first and only then the map is shown: drawn before, it showed the whole world for a moment
      // and then jumped to the family.
      if (!touched.current) e.follow.fit(keepInView(y, 0), false)
      relayout.current()
      e.trails.redraw()
      box.current?.classList.remove('map-waiting')
      return
    }
    st.positions = place(st.year)
    relayout.current()
    e.trails.redraw()
  }, [ready, data, events, show, isSuccess])

  // Following a person: their route in full ink, numbered, everyone else quieter. If the moment is outside their life
  // it moves to their first placed event. Following a line: its thread over everything, the generations marked, and
  // the moment moves to where the line starts (unless a shared address put it inside the line). Either way the camera
  // fits the whole route or thread beside the person card, then holds still. Letting go brings the whole family back.
  const followKey = lineDraw ? `line:${lineDraw.key}` : focusTrack ? `life:${focusTrack.personId}` : null
  const followed = useRef<{ key: string | null; track: Track | null; thread: Thread | null }>({ key: null, track: null, thread: null })
  const firstFollow = useRef(true)
  useEffect(() => {
    const e = engine.current
    if (!ready || !e || !started.current) return
    const was = followed.current
    if (was.key === followKey && was.track === focusTrack && was.thread === thread) return
    followed.current = { key: followKey, track: focusTrack, thread }
    const marks = () => {
      if (lineDraw && thread) e.people.setFocus(bearerAt(thread, clock.at.current) ?? lineDraw.thread.stretches[0]?.personId ?? null, genStops, lineDraw.ids)
      else e.people.setFocus(focusTrack?.personId ?? null, focusTrack ? routeStops(focusTrack) : [])
    }
    // The same route or line with new data (a live edit, the family laid out again): drawn anew, the camera and the
    // place card stay as they are.
    if (was.key && was.key === followKey) {
      marks()
      // An edit moved their life away from the moment shown (a birth corrected later): the clock goes to it, so
      // the person followed is never missing from the map while still followed.
      if (!lineDraw && focusTrack && !positionAt(focusTrack, clock.at.current)) { const y = focusTrack.stops[0].year; clock.seek(y); writeYear(y) }
      relayout.current()
      e.trails.redraw()
      return
    }
    const first = firstFollow.current
    firstFollow.current = false
    marks()
    e.map.getContainer().classList.toggle('focusing', !!followKey)
    setCard(null)
    const st = state.current
    if (thread) {
      const keep = first && urlYear !== null && urlYear >= thread.start && urlYear <= thread.end
      if (!keep) { clock.seek(thread.start); writeYear(thread.start) }
    } else if (focusTrack && !positionAt(focusTrack, st.year)) {
      const y = focusTrack.stops[0].year
      clock.seek(y)
      writeYear(y)
    }
    relayout.current()
    e.trails.redraw()
    if (!followKey && !was.key) return
    e.follow.resume()
    setFollowing(true)
    const points = followPoints ?? keepInView(clock.at.current, 0)
    if (!followPoints || !cardOpenRef.current) { e.follow.fit(points, true); return }
    // The card is loaded on first use and slides in: fit once it stands where it will stay (or after 1.5 s anyway).
    let timer = 0, raf = 0
    const t0 = performance.now()
    const wait = () => {
      if (document.querySelector('aside.panel') || performance.now() - t0 > 1500) timer = window.setTimeout(() => e.follow.fit(points, true), CARD_MS)
      else raf = requestAnimationFrame(wait)
    }
    wait()
    return () => { clearTimeout(timer); cancelAnimationFrame(raf) }
  }, [ready, followKey, focusTrack, thread, isSuccess, data]) // eslint-disable-line react-hooks/exhaustive-deps

  // The card opened or closed while following: the room for the route changed, so it is framed again once the card
  // has slid in or out. Someone with nowhere on the map has only the card to show, so it opens for them.
  const cardWas = useRef(cardOpen)
  useEffect(() => {
    const e = engine.current
    if (cardWas.current === cardOpen || !ready || !e) return
    cardWas.current = cardOpen
    const points = followPoints
    if (!points || followed.current.key !== followKey) return
    e.follow.resume()
    setFollowing(true)
    const timer = setTimeout(() => e.follow.fit(points, true), CARD_MS)
    return () => clearTimeout(timer)
  }, [cardOpen, ready, followKey, followPoints])
  // The keyboard goes with the card: into it when "Open" is pressed (the button goes away), back to "Open" after.
  // Along a line, "Open" opens whoever carries it now; the line holds, since they are in it.
  const openCard = () => {
    if (thread) { const now = bearerAt(thread, clock.at.current); if (now && now !== focusId) focus(now) }
    onCard(true)
    let tries = 0
    const find = () => { const a = document.querySelector<HTMLElement>('aside.panel'); if (a) a.focus({ preventScroll: true }); else if (tries++ < 90) requestAnimationFrame(find) }
    requestAnimationFrame(find)
  }
  useEffect(() => {
    if (cardOpen || !who) return
    const raf = requestAnimationFrame(() => { if (document.activeElement === document.body) document.querySelector<HTMLElement>('.map-chip-acts button')?.focus({ preventScroll: true }) })
    return () => cancelAnimationFrame(raf)
  }, [cardOpen]) // eslint-disable-line react-hooks/exhaustive-deps
  const unfollow = () => {
    setLine(null)
    focus(null)
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.map-track')?.focus({ preventScroll: true }))
  }
  // The two-way choice: their own life, or the line from them down to the end. Their life is the ancestor's.
  const chooseLine = (on: boolean) => {
    const anc = line?.ids[0] ?? focusId
    if (!anc) return
    if (on) setLine(anc)
    else { setLine(null); if (focusId !== anc) focus(anc, { center: false }) }
  }
  const [gapsOpen, setGapsOpen] = useState(false)
  const lineGapIds = useMemo(() => (line ? new Set(line.ids.filter((id) => !byId.get(id)?.hidden && !data.tracks.some((x) => x.personId === id))) : null), [line, data, byId])
  // The chip: the person followed, or, when they have nothing placed yet, what the map is missing for them; along a
  // line, the line in a few words.
  const chipPerson = who ? byId.get(who.ids[0]) : undefined
  const missing = !chipPerson || focusTrack || line ? null : missingFor(data, chipPerson.id, t)
  const endName = offered ? (offered.you ? t('you') : nameOf(offered.ids.at(-1)!)) : ''
  const nowYear = new Date().getFullYear()
  const chipLine = offered && {
    on: !!line,
    choice: offered.you ? t('Line to you') : `${t('Line')} → ${endName}`,
    onChange: chooseLine,
    summary: thread ? `${generationWords(offered.ids.length, lang)} · ${Math.floor(thread.start)}–${thread.end >= nowYear ? t('now') : thread.end}` : line ? t('Nobody in this line is on the map yet') : undefined,
    notOnMap: lineGapIds?.size ? { count: lineGapIds.size, words: `${peopleWords(lineGapIds.size, lang)} ${t('not on the map')}`, onShow: () => setGapsOpen(true) } : undefined,
  }
  const chip = chipPerson && isSuccess && (
    <FollowChip name={personName(chipPerson) || t('No name')} to={line ? endName : null} face={faceFor(chipPerson.id)} years={lifeYears(chipPerson, '?', t('now'))}
      missing={missing} cardOpen={cardOpen} onOpen={openCard} onStop={unfollow} line={chipLine || null} />
  )

  // "Who is here": a stack pressed opens a card of everyone standing there now.
  const openStackNow = (h: StackHit) => {
    const st = state.current, y = Math.floor(st.year)
    const people = h.ids.flatMap((id) => {
      const track = st.tracks.find((x) => x.personId === id), pos = st.positions.get(id)
      return track && pos ? [{ id, name: track.name, face: faceFor(id), since: sinceAt(track, pos), place: pos.at.place, at: `${pos.lat},${pos.lon}` }] : []
    })
    // A stack can gather several towns that touch at this zoom: the card names the town it stands on, and each
    // person's own town beside them, rather than claiming they all live in one place.
    const anchored = people.find((p) => p.at === `${h.lat},${h.lon}`)?.place
    const r = h.el.getBoundingClientRect()
    setCard({ x: r.left + r.width / 2, y: r.top + r.height / 2, lat: h.lat, lon: h.lon, el: h.el, year: y, place: anchored ?? people[0]?.place ?? '', people })
  }
  useLayoutEffect(() => { openStack.current = openStackNow })
  const cardRef = useRef(card)
  useLayoutEffect(() => { cardRef.current = card })
  // Closed from inside it (Escape, the close button), the keyboard goes back to the stack it came from.
  const closeCard = useCallback(() => {
    const from = cardRef.current?.el, inside = !!document.activeElement?.closest('.map-place')
    setCard(null)
    if (inside && from?.isConnected) from.focus({ preventScroll: true })
  }, [])
  const zoomCard = () => {
    const e = engine.current
    if (!e || !card) return
    e.follow.release()
    e.map.flyTo([card.lat, card.lon], Math.max(RING_ZOOM + 0.5, e.map.getZoom() + 1), { duration: 0.8, animate: !matchMedia('(prefers-reduced-motion: reduce)').matches })
  }

  // The bar's height lifts the map's own buttons clear of it where they would meet.
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = bar.current?.firstElementChild as HTMLElement | null, map = box.current
    if (!el || !map) return
    const lift = () => {
      const r = el.getBoundingClientRect(), w = map.clientWidth
      map.style.setProperty('--map-lift', r.right > w - 64 ? `${Math.round(map.clientHeight - r.top + 6)}px` : '0px')
    }
    const ro = new ResizeObserver(lift)
    ro.observe(el)
    ro.observe(map)
    return () => ro.disconnect()
  }, [])

  // The person card on a wide screen: the bar keeps to the room left of it (a phone's card is a sheet below).
  useEffect(() => {
    const wrap = bar.current
    if (!wrap) return
    let ro: ResizeObserver | null = null, raf = 0, tries = 0
    const set = () => {
      const r = document.querySelector('aside.panel')?.getBoundingClientRect()
      const right = r?.width && r.left > innerWidth * 0.35 ? Math.round(innerWidth - r.left + 4) : 0
      wrap.style.setProperty('--map-card', `${right}px`)
    }
    const find = () => {
      const panel = document.querySelector('aside.panel')
      if (panel) { ro = new ResizeObserver(set); ro.observe(panel); set() } else if (tries++ < 60) raf = requestAnimationFrame(find); else set()
    }
    find()
    // The card slides in; where it ends up is known once it has.
    const late = setTimeout(set, CARD_MS + 50)
    addEventListener('resize', set)
    return () => { ro?.disconnect(); cancelAnimationFrame(raf); clearTimeout(late); removeEventListener('resize', set); wrap.style.removeProperty('--map-card') }
  }, [focusId, cardOpen])

  // The chronicle beside the family: a front page on the left from 1100 px, a card inside the bar below that. Both show
  // the entries going on in the year shown, framing ones first; the chip in the bar names the first of them.
  const [wide, setWide] = useState(() => matchMedia(WIDE).matches)
  useEffect(() => {
    const q = matchMedia(WIDE), on = () => setWide(q.matches)
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [])
  const ordered = useMemo(() => [...entries].sort(byStanding), [entries])
  const barEras = useMemo<BarEra[]>(() => ordered.map((e) => ({ key: e.key, from: e.fromYear, to: e.toYear, title: pickText(e.title, lang, archiveLang), lead: e.lead })), [ordered, lang, archiveLang])
  const shownYear = Math.floor(clock.shown)
  const activeNow = useMemo(() => activeIn(ordered, shownYear), [ordered, shownYear])
  const [eraCard, setEraCard] = useState<string | null>(null)
  const [pageAsk, setPageAsk] = useState<{ key: string; n: number } | null>(null)
  const cardEntry = eraCard === null ? null : activeNow.find((e) => e.key === eraCard) ?? activeNow[0] ?? null
  // The card closes once nothing is going on, when the person sheet opens, and on a wide screen, where the page shows it.
  if (eraCard !== null && (!activeNow.length || cardOpen || wide)) setEraCard(null)
  const closeEraCard = useCallback(() => setEraCard(null), [])
  const onEra = (key: string) => {
    if (wide) setPageAsk((a) => ({ key, n: (a?.n ?? 0) + 1 }))
    else setEraCard((k) => (k === null ? key : null))
  }
  /** An entry's headline: the moment goes inside it, and the camera frames its shape with the relatives it names. */
  const goToEntry = (entry: Entry) => {
    const e = engine.current
    if (!e) return
    e.follow.release()
    if (clock.at.current < entry.fromYear || clock.at.current >= entry.toYear) clock.seek(entry.fromYear, true)
    const shape = shapes.get(entry.key), box = shape && entryBounds(shape)
    const points: [number, number][] = box ? [box[0], box[1]] : []
    for (const l of entry.people) { const at = state.current.positions.get(l.personId); if (at) points.push([at.lat, at.lon]) }
    if (!points.length) return
    const room = insets(e.map)
    e.map.flyToBounds(points, { paddingTopLeft: [room.left, room.top], paddingBottomRight: [room.right, room.bottom], maxZoom: 7, duration: 0.8, animate: !matchMedia('(prefers-reduced-motion: reduce)').matches })
  }
  // Story focus: the relatives an entry names stay in full ink and everyone else goes quiet. Following someone wins:
  // the story waits under it. It ends on "The whole family", Escape, or when the clock settles outside the entry.
  const [story, setStory] = useState<string | null>(null)
  const storyEntry = story === null ? null : entries.find((x) => x.key === story) ?? null
  if (story !== null && chronicle.isSuccess && !storyEntry) setStory(null)
  const storying = !!storyEntry && !followKey
  const concerned = useMemo(() => (storying && storyEntry ? new Set(storyEntry.people.map((l) => l.personId)) : null), [storying, storyEntry])
  useEffect(() => {
    const e = engine.current
    if (!ready || !e) return
    const key = concerned ? story : null
    e.map.getContainer().classList.toggle('storying', !!concerned)
    e.people.setConcerned(concerned)
    state.current.apart = concerned
    state.current.story = key
    chron.current.story = key
    chronicleShown.current = look.current?.(chron.current, chron.current.year) ?? ''
    relayout.current()
    e.trails.redraw()
    e.chronicle?.redraw()
  }, [ready, concerned]) // eslint-disable-line react-hooks/exhaustive-deps
  const settleOn = clock.onSettle
  useEffect(() => {
    if (!storyEntry) return
    // The card in the bar takes the first Escape; the next one leaves the story.
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && !ev.defaultPrevented && !document.querySelector('.chronicle-card')) setStory(null) }
    const off = settleOn((y) => { if (y < storyEntry.fromYear || y >= storyEntry.toYear) setStory(null) })
    addEventListener('keydown', key)
    return () => { removeEventListener('keydown', key); off() }
  }, [storyEntry, settleOn])
  const chronicleActions: ArticleActions = {
    onHeadline: goToEntry,
    story,
    onStory: (x) => { if (x) goToEntry(x); setStory(x?.key ?? null) },
    // A relative's line: the moment goes to the line's year and the map follows them.
    onPerson: (id, year) => { if (year !== undefined) clock.seek(year, true); setEraCard(null); follow(id) },
    onHover: (id) => engine.current?.people.highlight(id),
    faceFor,
    nameOf: (id) => { const p = byId.get(id); return (p && personName(p)) || t('No name') },
  }
  // Who sees it, for the owner's small eye: changed under Settings > Map.
  const chronicleShow = me.role === 'owner' && !me.guest ? chronicle.data?.show : undefined
  const eraCardNode = !wide && words && parts && cardEntry && (
    <parts.ChronicleCard entries={activeNow} shown={cardEntry} shapes={shapes} onShow={setEraCard} onClose={closeEraCard} actions={chronicleActions} />
  )

  const followAgain = () => {
    const e = engine.current
    if (!e) return
    e.follow.resume()
    setFollowing(true)
    e.follow.fit(keepInView(clock.at.current, 0), true)
  }

  return (
    <>
      <div ref={box} role="region" aria-label={t('Family map')} className="family-map map-waiting fixed inset-0 z-0" />
      {isSuccess && !data.tracks.length && (
        <div className="float fixed left-1/2 top-1/2 z-10 max-w-sm -translate-x-1/2 -translate-y-1/2 p-4 text-sm text-ink-soft">
          {t('No event has both a place with coordinates and a year yet. Add coordinates to places under Places.')}
        </div>
      )}
      {atlasLost && (
        <div role="alert" className="float fixed left-1/2 top-16 z-20 flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2 py-1 pl-3 pr-1 text-sm max-sm:top-16">
          <span>{t('The world map did not load. People and routes still show without it.')}</span>
          <button type="button" className="bar-btn flex-none" onClick={() => retryAtlas.current()}>{t('Try again')}</button>
        </div>
      )}
      {/* Before the bar in the page, as it is on the screen: top left, then the bar at the bottom. */}
      {wide && words && parts && (
        <parts.ChroniclePage entries={ordered} shapes={shapes} year={shownYear} status={chronicle.isError ? 'error' : chronicle.isSuccess ? 'ready' : 'loading'}
          owner={me.role === 'owner' && !me.guest} personCard={cardOpen} ask={pageAsk} onJump={(x) => clock.seek(x.fromYear, true)} onRetry={() => chronicle.refetch()} actions={chronicleActions} show={chronicleShow} />
      )}
      <MapGaps data={data} only={gapsOpen ? lineGapIds : null} open={gapsOpen || undefined} onOpen={(v) => { if (!v) setGapsOpen(false) }} />
      <div ref={bar}>
        <TimelineBar min={data.min} max={data.max} year={clock.shown} playing={clock.playing} speed={clock.speed} show={show} counts={counts}
          events={barEvents} focus={barFocus} listen={clock.listen} chip={chip}
          onSeek={clock.seek} onPlay={play} onSpeed={clock.nextSpeed}
          eras={words ? barEras : NO_ERAS} onEra={onEra} eraOpen={wide ? undefined : eraCard !== null} card={eraCardNode || null} />
      </div>
      {!following && (
        <button type="button" className="map-follow float bar-btn fixed right-3 top-16 z-10 !h-9 text-ink max-sm:top-3" onClick={followAgain} title={focusTrack ? t('The camera goes back to this person and stays with them') : t('The camera goes where people are moving; pick someone on the map to follow only them')}>
          <LocateFixed size={14} /> {focusTrack ? t('Follow {name}').replace('{name}', () => focusTrack.name) : t('Follow the family')}
        </button>
      )}
      {card && <MapPlaceCard x={card.x} y={card.y} place={card.place} year={card.year} people={card.people} onClose={closeCard} onZoom={zoomCard} onPick={(id) => { setCard(null); follow(id) }} />}
    </>
  )
}

/** Room the camera leaves around people: the bars at the top and bottom as they are drawn, and names to the right. */
function insets(m: Leaflet.Map): Insets {
  const h = m.getSize().y, w = m.getSize().x
  let top = 12, bottom = 12
  for (const el of document.querySelectorAll('.main-bar, .map-gaps > button, .map-bar, .chronicle-tab')) {
    const r = el.getBoundingClientRect()
    if (!r.height) continue
    if (r.top + r.height / 2 < h / 2) top = Math.max(top, r.bottom + 8)
    else bottom = Math.max(bottom, h - r.top + 8)
  }
  // The person card covers the right side on a wide screen, and the lower part of a phone's (a sheet over the bars).
  const panel = document.querySelector('aside.panel')?.getBoundingClientRect()
  let right = 0, sheet = false
  if (panel?.width) {
    if (panel.left > w * 0.35) right = w - panel.left + 16
    else if (panel.top > h * 0.15) { bottom = h - panel.top + 8; sheet = true }
  }
  const narrow = w < 640
  // The chronicle's front page stands on the left on a wide screen.
  const page = document.querySelector('aside.chronicle')?.getBoundingClientRect()
  const left = Math.max(narrow ? 32 : 64, page?.width ? Math.round(page.right + 16) : 0)
  // A name above a face and an event's mark below it need a little more room, unless a sheet leaves only a strip.
  const roomy = !sheet || h - top - bottom > 220
  return { top: top + (roomy ? 24 : 4), bottom: bottom + (roomy ? 34 : 6), left, right: right + (narrow ? Math.round(w * 0.22) : Math.min(200, Math.round(w * 0.14))) }
}
