// The map's one story clock: a moment (a year with a fraction) held outside React and moved by the screen's own
// frames while playing. Playing and scrubbing set the same clock, so they show the same picture for the same moment.
// React hears only what the interface redraws: the whole year, playing or not, the speed.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { msAt, yearAtMs, type Schedule } from '@/lib/map-pacing'

export const SPEEDS = [1, 2, 4, 8, 0.5] as const
export type Speed = (typeof SPEEDS)[number]
const SPEED_KEY = 'folkbranch.mapSpeed'

const readSpeed = (): Speed => {
  try { const v = Number(sessionStorage.getItem(SPEED_KEY)); return (SPEEDS as readonly number[]).includes(v) ? (v as Speed) : 1 } catch { return 1 }
}

export interface StoryClock {
  /** The moment shown, read any time without a render. */
  at: { readonly current: number }
  year: number; playing: boolean; speed: Speed
  /** The moment for the slider: the whole year while playing, the exact moment at rest or while dragged. */
  shown: number
  /** Sets the moment; `settled` says the hand has let go (end of a drag, a key), so the address and camera follow. */
  seek: (year: number, settled?: boolean) => void
  toggle: () => void
  nextSpeed: () => void
  /** Called on every change of the moment, each frame while playing. Returns the way to stop listening. */
  listen: (fn: (at: number, prev: number) => void) => () => void
  /** Called when the clock comes to rest: paused, played to the end, or let go after a drag. */
  onSettle: (fn: (at: number) => void) => () => void
}

export function useStoryClock(s: Schedule, start: number): StoryClock {
  const at = useRef(start)
  const [year, setYear] = useState(Math.floor(start))
  const [playing, setPlaying] = useState(false)
  const [rest, setRest] = useState(start)
  const [speed, setSpeed] = useState<Speed>(readSpeed)
  const listeners = useRef(new Set<(at: number, prev: number) => void>())
  const settlers = useRef(new Set<(at: number) => void>())
  const set = useCallback((y: number) => {
    const prev = at.current
    at.current = y
    setYear(Math.floor(y))
    for (const fn of listeners.current) fn(y, prev)
  }, [])
  const settle = useCallback(() => { for (const fn of settlers.current) fn(at.current) }, [])

  const seek = useCallback((y: number, settled = false) => {
    setPlaying(false)
    const to = Math.max(s.min, Math.min(s.max, y))
    set(to)
    setRest(to)
    if (settled) settle()
  }, [s.min, s.max, set, settle])

  // Someone else's edit shrank the years (a person deleted, a date corrected): the moment comes back inside them,
  // so the map never stands on a year that no longer exists, blank.
  useEffect(() => {
    if (at.current < s.min || at.current > s.max) seek(at.current, true)
  }, [s.min, s.max, seek])

  // Play: each frame moves the clock by the time passed, through the pacing, so quiet years pass quickly.
  const spd = useRef(speed)
  useLayoutEffect(() => { spd.current = speed })
  useEffect(() => {
    if (!playing) return
    let last = performance.now(), raf = 0
    const step = (now: number) => {
      // A frame after a long stall (a hidden tab) moves at most a tenth of a second.
      const dt = Math.min(100, now - last)
      last = now
      const y = Math.min(s.max, yearAtMs(s, msAt(s, at.current) + dt * spd.current))
      set(y)
      if (y >= s.max) { setPlaying(false); setRest(y); settle(); return }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing, s, set, settle])

  const toggle = useCallback(() => {
    if (playing) { setPlaying(false); setRest(at.current); settle(); return }
    // Play at the end starts again from the beginning.
    if (at.current >= s.max) set(s.min)
    setPlaying(true)
  }, [playing, s.max, s.min, set, settle])

  const nextSpeed = useCallback(() => {
    setSpeed((cur) => {
      const next = SPEEDS[(SPEEDS.indexOf(cur) + 1) % SPEEDS.length]
      try { sessionStorage.setItem(SPEED_KEY, String(next)) } catch {}
      return next
    })
  }, [])

  const listen = useCallback((fn: (at: number, prev: number) => void) => { listeners.current.add(fn); return () => { listeners.current.delete(fn) } }, [])
  const onSettle = useCallback((fn: (at: number) => void) => { settlers.current.add(fn); return () => { settlers.current.delete(fn) } }, [])
  return { at, year, playing, speed, shown: playing ? year : rest, seek, toggle, nextSpeed, listen, onSettle }
}
