'use client'
// The bar under the map: a track through the years with a quiet histogram of the family's events over it, a handle
// to drag (its year in a bubble), previous / next event, Play, the speed, what to show, and how many are shown.
// Plain props in and plain calls out; the handle follows the clock itself while it plays, so React redraws the bar
// only once a year.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { useApp } from '@/lib/client'
import { axisTicks, bins, caption, eventWords, share, stepYear, yearAt } from '@/lib/map-scrub'
import { peopleWords } from '@/lib/names'

export type Show = 'both' | 'people' | 'events'

/** One event as the bar tells it. */
export interface BarEvent { year: number; moved: boolean; what: string; name: string; place: string; personId: string }
/**
 * The person followed: their life is a band on the track and their events are the ones stepped through. A line of
 * descent has a band per generation (named where it fits) and its own events to step through.
 */
export interface BarFocus { id: string; name: string; from: number; to: number; bands?: { from: number; to: number; name: string }[]; steps?: BarEvent[] }

export interface TimelineBarProps {
  min: number; max: number
  /** The moment shown; a fraction while it plays or is dragged. */
  year: number
  playing: boolean; speed: number; show: Show
  counts: { people: number; events: number }
  /** Every placed, dated event in scope, oldest first. */
  events: BarEvent[]
  focus: BarFocus | null
  /** Who is followed and the ways to open their card or let go, over the track. */
  chip?: ReactNode
  /** The clock's own listener, so the handle moves every frame without a render. */
  listen?: (fn: (at: number) => void) => () => void
  /** A new moment; `settled` when the hand has let go (end of a drag, a key). */
  onSeek: (year: number, settled: boolean) => void
  onPlay: () => void; onSpeed: () => void
}

const speedText = (s: number) => (s === 0.5 ? '½×' : `${s}×`)

export function TimelineBar({ min, max, year, playing, speed, show, counts, events, focus, chip, listen, onSeek, onPlay, onSpeed }: TimelineBarProps) {
  const { t, lang } = useApp()
  const track = useRef<HTMLDivElement>(null)
  const line = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  const [said, setSaid] = useState('')
  const whole = Math.floor(year)

  const hist = useMemo(() => bins(events, min, max), [events, min, max])
  const ticks = useMemo(() => axisTicks(min, max), [min, max])
  // What the event buttons step through: the person followed, or everyone.
  const steps = useMemo(() => focus?.steps ?? (focus ? events.filter((e) => e.personId === focus.id) : events), [events, focus])
  // How wide the track is, so a generation's band is named only where its name fits.
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = track.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const stepYears = useMemo(() => [...new Set(steps.map((e) => Math.floor(e.year)))], [steps])
  const n = max - min + 1
  const pct = (y: number) => `${share(y, min, max) * 100}%`

  // The handle and the played part follow the clock every frame; at rest they follow the props.
  // A quiet year moves the handle a twentieth of a pixel a frame: a move under a quarter pixel is not worth a style
  // recalculation of the bar, so it is written only when it would show.
  const shownAt = useRef(NaN)
  const put = (y: number) => {
    const at = share(y, min, max)
    if (Math.abs(at - shownAt.current) * (width || 320) < 0.25) return
    shownAt.current = at
    track.current?.style.setProperty('--at', String(at))
  }
  useLayoutEffect(() => { if (!playing || !listen) { shownAt.current = NaN; put(year) } })
  useEffect(() => listen?.((y) => put(y)), [listen, min, max]) // eslint-disable-line react-hooks/exhaustive-deps

  const countIn = (y: number) => steps.filter((e) => Math.floor(e.year) === y).length
  const valueText = (y: number) => { const k = countIn(y); return k ? `${y}, ${eventWords(k, lang)}` : String(y) }
  // The year stands large beside the line, so the line itself starts with what happened.
  const lineOf = (y: number) => caption(steps, y, false)
  /** The year is told once the clock settles: a step, the end of a drag, a pause. Never while it plays. */
  const say = (y: number) => { const w = Math.floor(y), c = lineOf(w); setSaid(c ? `${valueText(w)}. ${c}` : valueText(w)) }
  const wasPlaying = useRef(playing)
  useEffect(() => { if (wasPlaying.current && !playing) say(year); wasPlaying.current = playing }, [playing]) // eslint-disable-line react-hooks/exhaustive-deps

  const go = (y: number) => { const to = Math.max(min, Math.min(max, y)); onSeek(to, true); say(to) }
  const step = (dir: 1 | -1) => { const y = stepYear(stepYears, year, dir); if (y !== null) go(y) }
  const prev = stepYear(stepYears, year, -1), next = stepYear(stepYears, year, 1)

  // The ARIA slider: a year with the arrows, ten with Page keys, the ends with Home and End.
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    const to = { ArrowRight: whole + 1, ArrowUp: whole + 1, ArrowLeft: Math.ceil(year) - 1, ArrowDown: Math.ceil(year) - 1, PageUp: whole + 10, PageDown: Math.ceil(year) - 10, Home: min, End: max }[e.key]
    if (to === undefined) return
    e.preventDefault()
    go(to)
  }
  // Space anywhere on the bar but a button plays or pauses; a button keeps Space for itself.
  const barKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== ' ' || (e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    onPlay()
  }
  // The track by hand: a press jumps there, a drag scrubs (Play stops), a hover shows the year under the pointer.
  const under = (e: PointerEvent) => { const r = line.current!.getBoundingClientRect(); return yearAt((e.clientX - r.left) / r.width, min, max) }
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag(true)
    onSeek(under(e), false)
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (drag) onSeek(under(e), false)
    else if (e.pointerType === 'mouse') setHover(Math.floor(under(e)))
  }
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag) return
    setDrag(false)
    const y = under(e)
    onSeek(y, true)
    say(y)
  }

  const count = show === 'events'
    ? `${eventWords(counts.events, lang)} ${t('на карте сейчас')}`
    : `${peopleWords(counts.people, lang)} ${t('на карте сейчас')}`
  const atRest = !playing && !drag
  // Who is followed is in the chip over the track, so a quiet year says nothing.
  const told = atRest ? lineOf(whole) : ''
  const bubble = drag ? whole : hover
  const bar = (list: number[]) => list.map((v, i) => (v ? `M${i + 0.12} 1V${1 - Math.max(0.12, v / hist.peak)}h0.76V1Z` : '')).join('')
  const ticksAt = (ys: number[]) => ys.map((y) => `M${y - min + 0.5} 0V1`).join('')

  return (
    <div className="map-bar float fixed z-10 flex w-[960px] -translate-x-1/2 flex-col px-3 pb-1.5 pt-1" onKeyDown={barKeys}>
      {chip}
      <div ref={track} role="slider" tabIndex={0} aria-label={t('Год')} aria-valuemin={min} aria-valuemax={max} aria-valuenow={whole} aria-valuetext={valueText(whole)}
        className={`map-track${drag ? ' dragging' : ''}`} onKeyDown={keys} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={() => setHover(null)}>
        <svg className="map-hist" viewBox={`0 0 ${n} 1`} preserveAspectRatio="none" aria-hidden>
          {focus && !focus.bands && <rect className="map-band" x={Math.max(0, focus.from - min)} width={Math.max(0.5, Math.min(max + 1, focus.to + 1) - Math.max(min, focus.from))} y="0" height="1" />}
          {focus?.bands?.map((b, i) => <rect key={i} className={`map-band map-band-${i % 2 ? 'b' : 'a'}`} x={Math.max(0, b.from - min)} width={Math.max(0.3, Math.min(max + 1, b.to) - Math.max(min, b.from))} y="0" height="1" />)}
          <path className="map-hist-all" d={bar(hist.all)} />
          <path className="map-hist-moves" d={bar(hist.moves)} />
        </svg>
        <div ref={line} className="map-line"><div className="map-played" /></div>
        <svg className="map-ticks" viewBox={`0 0 ${n} 1`} preserveAspectRatio="none" aria-hidden>
          <path className="map-tick" d={ticksAt(ticks.minor)} />
          <path className="map-tick-major" d={ticksAt(ticks.labels)} />
        </svg>
        {focus && <svg className="map-ticks-focus" viewBox={`0 0 ${n} 1`} preserveAspectRatio="none" aria-hidden><path d={ticksAt(stepYears)} /></svg>}
        {ticks.labels.map((y) => <span key={y} className="map-axis" style={{ left: pct(y + 0.5) }} aria-hidden>{y}</span>)}
        {focus?.bands?.map((b, i) => {
          const px = ((Math.min(max + 1, b.to) - Math.max(min, b.from)) / n) * width
          // About 6.5 px a letter in the band's small italic, and a little room on each side.
          return px > b.name.length * 6.5 + 8 && <span key={i} className="map-band-name" style={{ left: pct(Math.max(min, b.from)), maxWidth: `${px}px` }} aria-hidden>{b.name}</span>
        })}
        <div className="map-handle" />
        {bubble !== null && <span className="map-bubble" style={drag ? undefined : { left: pct(bubble + 0.5) }} aria-hidden>{bubble}</span>}
      </div>
      <div className="map-controls flex min-w-0 items-center gap-x-1">
        <button type="button" className="bar-btn !px-0" aria-label={t('Предыдущее событие')} title={t('Предыдущее событие')} disabled={prev === null} onClick={() => step(-1)}><SkipBack size={15} /></button>
        <button type="button" className="bar-btn !px-0" aria-label={t(playing ? 'Пауза' : 'Воспроизвести')} title={t(playing ? 'Пауза' : 'Воспроизвести')} onClick={onPlay}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button type="button" className="bar-btn !px-0" aria-label={t('Следующее событие')} title={t('Следующее событие')} disabled={next === null} onClick={() => step(1)}><SkipForward size={15} /></button>
        <button type="button" className="bar-btn map-speed !px-1 font-serif tabular-nums" aria-label={`${t('Скорость')}: ${speedText(speed)}`} title={t('Скорость')} onClick={onSpeed}>{speedText(speed)}</button>
        <span className="map-now ml-1 w-14 flex-none font-serif text-xl tabular-nums" aria-hidden>{whole}</span>
        {/* On a phone the year leads the caption line, so the buttons and the choice fit one row. */}
        <span className="map-caption min-w-0 flex-1 truncate font-serif text-sm italic text-ink-soft" title={told || undefined}><span className="map-now-inline not-italic text-ink" aria-hidden>{whole}{told && ' · '}</span>{told}</span>
        <span className="map-count ml-2 flex-none text-sm text-ink-soft">{count}</span>
      </div>
      <span className="sr-only" aria-live="polite">{said}</span>
    </div>
  )
}
