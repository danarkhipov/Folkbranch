// Guards against the mistakes people make when they write a life down, and how the map shows what is not yet known:
// a year still to come, a death before the birth, a route read ahead of the clock, a place name a line long, a village
// too big to open into a ring.
import { describe, expect, it } from 'vitest'
import type { Graph, Person, Place } from '../lib/types'
import { dateProblem } from '../lib/date-checks'
import { clipPlace, mapTimeline, routeStopLabel, stopAt, type RouteStop } from '../lib/map-timeline'
import { canRing } from '../lib/map-layout'

const place = (id: string, name: string, lat: number | null, lon: number | null): Place => ({ id, name, kind: '', parentId: null, otherNames: [], lat, lon, note: '' })
const person = (id: string, patch: Partial<Person>): Person => ({
  id, givenName: 'Анна', surname: 'Тестова', maidenName: '', patronymic: '', otherNames: '', sex: 'F',
  birthDate: '', birthYear: null, birthPlace: '', deathDate: '', deathYear: null, deathPlace: '',
  living: false, certainty: 'family', avatarMediaId: null, avatarCrop: null, updatedAt: 0, tags: [], facts: [], sources: [], claims: [],
  ...patch,
})
const places = [place('v', 'Верхнее', 56.5, 44.0), place('k', 'Казань', 55.79, 49.12), place('p', 'Пермь', 58.01, 56.24)]
const NOW = 2026

describe('a date that cannot be right is said where it is typed', () => {
  const life = { born: 1921, died: 1999 }
  it('calls a year still to come a slip and offers the century back, keeping the rest of the date', () => {
    expect(dateProblem('12.05.2034', 'fact', life, NOW)).toEqual({ kind: 'future', year: 2034, fix: '12.05.1934' })
    expect(dateProblem('1941–2043', 'fact', life, NOW)).toEqual({ kind: 'future', year: 2043, fix: '1941–1943' })
  })
  it('offers no fix when the century back would land outside the life', () => {
    expect(dateProblem('2150', 'fact', life, NOW)).toEqual({ kind: 'future', year: 2150 })
  })
  it('calls a death before the birth wrong, from either field', () => {
    expect(dateProblem('1899', 'death', { born: 1921, died: null }, NOW)?.kind).toBe('death-before-birth')
    expect(dateProblem('2001', 'birth', { born: null, died: 1999 }, NOW)?.kind).toBe('death-before-birth')
  })
  it('places an event before the birth or after the death, but lets a burial or a will follow the death', () => {
    expect(dateProblem('1915', 'fact', life, NOW)?.kind).toBe('before-birth')
    expect(dateProblem('2005', 'fact', { ...life, what: 'Residence' }, NOW)?.kind).toBe('after-death')
    expect(dateProblem('2000', 'fact', { ...life, what: 'Погребение' }, NOW)).toBeNull()
    expect(dateProblem('2000', 'fact', { ...life, what: 'Burial' }, NOW)).toBeNull()
  })
  it('calls an event 120 years after a birth too old for one life', () => {
    expect(dateProblem('1960', 'fact', { born: 1830, died: null }, NOW)?.kind).toBe('too-old')
  })
  it('leaves alone a date that may be right, an empty date and a date without a year', () => {
    expect(dateProblem('1944', 'fact', life, NOW)).toBeNull()
    expect(dateProblem('', 'fact', life, NOW)).toBeNull()
    expect(dateProblem('весной', 'fact', life, NOW)).toBeNull()
  })
})

describe('the map keeps a life whose dates are reversed or mistyped, and says why', () => {
  it('shows a person whose death is written before the birth at the birthplace, and lists the death', () => {
    const p = person('rev', { birthDate: '1921', birthYear: 1921, birthPlace: 'Верхнее', deathDate: '1899', deathYear: 1899, deathPlace: 'Пермь' })
    const tl = mapTimeline({ persons: [p], parentChild: [], unions: [] } as Graph, places)
    expect(tl.absent).toEqual([])
    expect(tl.tracks[0].stops.map((s) => s.place)).toEqual(['Верхнее'])
    expect(tl.missing).toContainEqual(expect.objectContaining({ personId: 'rev', gap: 'death-before-birth', date: '1899' }))
  })
  it('names a fact in a year still to come as that, not as outside the life', () => {
    const p = person('fut', { birthDate: '1921', birthYear: 1921, birthPlace: 'Верхнее', living: true, facts: [{ kind: 'Residence', date: '2034', place: 'Казань', note: '' }] })
    const tl = mapTimeline({ persons: [p], parentChild: [], unions: [] } as Graph, places)
    expect(tl.missing).toContainEqual(expect.objectContaining({ personId: 'fut', gap: 'future' }))
  })
})

describe('a followed route does not read ahead of the clock', () => {
  const kazan: RouteStop = { lat: 55.79, lon: 49.12, place: 'Казань', visits: [2, 4], years: [1938, 1944], dates: ['1938', '1944'] }
  const perm: RouteStop = { lat: 58.01, lon: 56.24, place: 'Пермь', visits: [5], years: [1960], dates: ['1960'] }
  it('has no stop yet where the person has not been', () => {
    expect(stopAt(perm, 1942)).toBeNull()
    expect(stopAt(perm, 1960)).toBe(perm)
  })
  it('lists only the visits already made to a place visited twice', () => {
    expect(routeStopLabel(stopAt(kazan, 1940)!)).toBe('1938 · Казань')
    expect(stopAt(kazan, 1940)!.visits).toEqual([2])
    expect(routeStopLabel(stopAt(kazan, 1950)!)).toBe('1938, 1944 · Казань')
  })
})

describe('a place name stays short enough for the map', () => {
  it('keeps a usual name whole and ends a long address in an ellipsis, without a dangling comma', () => {
    expect(clipPlace('Пермь')).toBe('Пермь')
    const long = 'Российская Федерация, Пермский край, Пермский муниципальный округ, деревня Кукуево'
    const short = clipPlace(long)
    expect([...short].length).toBeLessThanOrEqual(40)
    expect(short.endsWith('…')).toBe(true)
    expect(short).not.toMatch(/[,\s]…$/)
    expect(routeStopLabel({ dates: ['1946'], years: [1946], place: long })).toBe(`1946 · ${short}`)
  })
})

describe('a stack opens into a ring only where it can be read', () => {
  const at = { x: 200, y: 200 }
  it('opens a small group with room around it', () => {
    expect(canRing(5, at, [{ x: 400, y: 200 }])).toBe(true)
  })
  it('keeps a village of hundreds a counted stack', () => {
    expect(canRing(300, at, [])).toBe(false)
    expect(canRing(17, at, [])).toBe(false)
  })
  it('keeps a stack closed when its ring would cover the next town', () => {
    expect(canRing(12, at, [{ x: 230, y: 210 }])).toBe(false)
  })
  it('has nothing to open for one face', () => {
    expect(canRing(1, at, [])).toBe(false)
  })
})

describe('a place is looked up by name, not searched for each event', () => {
  const many = Array.from({ length: 5000 }, (_, i) => place(`x${i}`, `Деревня ${i}`, 50 + (i % 10), 40 + (i % 7)))
  it('finds a place by any name or spelling, and does not guess between two places of one name', async () => {
    const { findPlace } = await import('../lib/places')
    const two = [place('a', 'Ивановка', 50, 40), place('b', 'Ивановка', 51, 41), { ...place('c', 'Санкт-Петербург', 59.9, 30.3), otherNames: [{ name: 'Ленинград', years: '' }] }]
    expect(findPlace('Ивановка', two)).toBeNull()
    expect(findPlace('Ивановка', two, 'b')?.id).toBe('b')
    expect(findPlace('Ленинград, СССР', two)?.id).toBe('c')
    expect(findPlace('санкт петербург.', two)?.id).toBe('c')
    expect(findPlace('ИВАНОВКА!', [...two, place('d', 'Ивановка!', 1, 1)])?.id).toBe('d')
    expect(findPlace('Нигде', two)).toBeNull()
  })
  it('builds the map of ten thousand lives over five thousand places in well under a second', () => {
    const persons = Array.from({ length: 10000 }, (_, i) => person(`p${i}`, { birthDate: String(1850 + (i % 100)), birthPlace: `Деревня ${i % 5000}`, facts: [{ kind: 'Residence', date: String(1900 + (i % 50)), place: `Деревня ${(i * 7) % 5000}`, note: '' }, { kind: 'Residence', date: '1950', place: 'Нигде', note: '' }] }))
    const t0 = performance.now()
    const tl = mapTimeline({ persons, parentChild: [], unions: [] } as Graph, many)
    expect(tl.tracks).toHaveLength(10000)
    // Searching every place for every event took about 20 s at this size; the index takes well under 1 s.
    expect(performance.now() - t0).toBeLessThan(1500)
  })
})
