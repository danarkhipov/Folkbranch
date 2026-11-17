// The scrubber under the map, as numbers: how busy each year is (the quiet histogram over the track), where the
// year labels and decade ticks go, and which year "previous / next event" jumps to. Pure, so it is tested alone.
import type { Lang } from './types'

/** An event as the scrubber sees it: its year, and whether it brought someone somewhere new. */
export interface ScrubEvent { year: number; moved?: boolean }

export interface Bins {
  /** Events per year from min to max (one number per year), and the moves among them. */
  all: number[]; moves: number[]
  /** The busiest year's count, at least 1, for scaling the bars. */
  peak: number
}

export function bins(events: ScrubEvent[], min: number, max: number): Bins {
  const n = Math.max(0, max - min + 1)
  const all = new Array<number>(n).fill(0), moves = new Array<number>(n).fill(0)
  for (const e of events) {
    const i = Math.floor(e.year) - min
    if (i < 0 || i >= n) continue
    all[i]++
    if (e.moved) moves[i]++
  }
  return { all, moves, peak: Math.max(1, ...all) }
}

/** Labelled years (every 50, or 25 on a short range) and small ticks at each decade, inside min..max. */
export function axisTicks(min: number, max: number): { labels: number[]; minor: number[] } {
  const every = max - min <= 120 ? 25 : 50
  const within = (step: number) => { const out: number[] = []; for (let y = Math.ceil(min / step) * step; y <= max; y += step) out.push(y); return out }
  const labels = within(every)
  return { labels, minor: within(10).filter((y) => !labels.includes(y)) }
}

/**
 * The year "next" (dir 1) or "previous" (dir −1) event jumps to from a moment: the nearest event year strictly
 * after it, or strictly before the year it is in. `years` is sorted and has no repeats. Null when there is none.
 */
export function stepYear(years: number[], at: number, dir: 1 | -1): number | null {
  if (dir > 0) { for (const y of years) if (y > at + 1e-9) return y; return null }
  // Mid-way through a year with an event (after a drag), "previous" goes to that year's start first.
  const from = at - Math.floor(at) > 1e-9 ? at : Math.floor(at)
  for (let i = years.length - 1; i >= 0; i--) if (years[i] < from - 1e-9) return years[i]
  return null
}

/** Where a year sits on the track, 0 at min and 1 at the end of max (a year is a slot, as on the histogram). */
export const share = (year: number, min: number, max: number) => Math.max(0, Math.min(1, (year - min) / Math.max(1, max - min + 1)))
/** The year under a point of the track (0–1), the inverse of share. */
export const yearAt = (s: number, min: number, max: number) => Math.max(min, Math.min(max, min + s * (max - min + 1)))

/** One line for what happened in a year: the first event in full, and how many more ("+2"). */
export function caption<E extends { year: number; what: string; name: string; place: string }>(events: E[], year: number, withYear = true): string {
  const here = events.filter((e) => Math.floor(e.year) === year)
  if (!here.length) return ''
  const [e] = here
  return `${withYear ? `${year} · ` : ''}${e.what} · ${e.name} · ${e.place}${here.length > 1 ? ` +${here.length - 1}` : ''}`
}

/** Russian has three forms for a counted noun (for 1, for 2 to 4, for 5 and up); the same rule as lib/names. */
const ruForm = (n: number, one: string, few: string, many: string) => {
  const a = n % 100, b = n % 10
  return a >= 11 && a <= 14 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many
}
/** One and many, for the languages with only these two forms (as lib/names does for years and people). */
const OTHER: Record<Exclude<Lang, 'ru'>, { event: [string, string]; generation: [string, string] }> = {
  en: { event: ['event', 'events'], generation: ['generation', 'generations'] },
  es: { event: ['hecho', 'hechos'], generation: ['generación', 'generaciones'] },
  ca: { event: ['fet', 'fets'], generation: ['generació', 'generacions'] },
}
const form = (n: number, [one, many]: [string, string]) => `${n} ${n === 1 ? one : many}`
/** "1 событие", "3 события" / "1 event", "3 events" / "3 hechos" / "3 fets". */
export const eventWords = (n: number, lang: Lang) => (lang === 'ru' ? `${n} ${ruForm(n, 'событие', 'события', 'событий')}` : form(n, OTHER[lang].event))
/** "1 поколение", "6 поколений" / "6 generations" / "6 generaciones" / "6 generacions": the length of a line of descent. */
export const generationWords = (n: number, lang: Lang) => (lang === 'ru' ? `${n} ${ruForm(n, 'поколение', 'поколения', 'поколений')}` : form(n, OTHER[lang].generation))
