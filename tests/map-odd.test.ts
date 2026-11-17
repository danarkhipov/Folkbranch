// Odd data on the map: bad coordinates, names a record does not carry word for word, and dates outside a life.
import { describe, expect, it } from 'vitest'
import { stackShift } from '../lib/map-layout'
import { mapTimeline, routePoints } from '../lib/map-timeline'
import { badCoords, findPlace, lifeStops, mapSpots, onMap } from '../lib/places'
import type { Graph, Person, Place } from '../lib/types'

const person = (id: string, extra: Partial<Person> = {}): Person => ({ id, givenName: id, surname: 'T', maidenName: '', patronymic: '', otherNames: '', sex: 'U', birthDate: '', birthYear: null, birthPlace: '', deathDate: '', deathYear: null, deathPlace: '', living: false, certainty: 'documented', avatarMediaId: null, avatarCrop: null, updatedAt: 0, tags: [], facts: [], sources: [], claims: [], ...extra })
const place = (id: string, name: string, lat: number | null, lon: number | null, extra: Partial<Place> = {}): Place => ({ id, name, kind: '', parentId: null, otherNames: [], lat, lon, note: '', ...extra })
const graph = (persons: Person[]): Graph => ({ persons, parentChild: [], unions: [] })

const SPB = place('spb', 'Санкт-Петербург', 59.93, 30.31)
const TVER = place('tver', 'Тверь', 56.86, 35.92)
const KUK = place('kuk', 'Кукуево', 55.1, 37.2)
const EMPIRE = place('empire', 'Российская империя', null, null)
const NULL = place('null', 'Атлантида', 0, 0)
const OOB = place('oob', 'Тмутаракань', 200, 400)
const SWAPPED = place('swap', 'Москва (перепутаны)', 37.6173, 55.7558)
const places = [SPB, TVER, KUK, EMPIRE, NULL, OOB, SWAPPED]

describe('a place as written on a card', () => {
  it('finds a record through spelling the record does not carry word for word', () => {
    // The same town from different hands: a hyphen, a missing hyphen, a full stop typed at the end.
    expect(findPlace('Санкт Петербург', places)?.id).toBe('spb')
    expect(findPlace('санкт-петербург', places)?.id).toBe('spb')
    expect(findPlace('Кукуево.', places)?.id).toBe('kuk')
    expect(findPlace('Кукуево, Тверская губерния', places)?.id).toBe('kuk')
    // Other names still answer, and a card's "place, what it belonged to" is read by its first part.
    expect(findPlace('Петербург', [place('p', 'Петербург', 1, 1, { otherNames: [{ name: 'Ленинград', years: '1924–1991' }] })])?.id).toBe('p')
    expect(findPlace('Ленинград', [place('p', 'Петербург', 1, 1, { otherNames: [{ name: 'Ленинград', years: '1924–1991' }] })])?.id).toBe('p')
  })
  it('does not guess between two records that only a spelling apart', () => {
    const twins = [place('a', 'Кукуево', 55.1, 37.2), place('b', 'кукуево!', 55.11, 37.21)]
    expect(findPlace('КУКУЕВО?!', twins)).toBeNull()
  })
  it('does not invent a place that is simply not in the list', () => {
    // A renamed city whose record has no old name: Tver was Kalinin, but only Tver is known here.
    expect(findPlace('Калинин', places)).toBeNull()
  })
})

describe('coordinates the map cannot stand on', () => {
  it('accepts a real point and rejects a range slip, 0,0 and no point at all', () => {
    expect(onMap(place('p', 'X', 55.1, 37.2))).toBe(true)
    expect(onMap(place('p', 'X', -33.9, 151.2))).toBe(true)
    expect(onMap(place('p', 'X', 90, 180))).toBe(true)
    expect(onMap(OOB)).toBe(false)
    expect(onMap(place('p', 'X', 55.1, 400))).toBe(false)
    expect(onMap(NULL)).toBe(false)
    expect(onMap(EMPIRE)).toBe(false)
    expect(badCoords(OOB)).toBe(true)
    expect(badCoords(NULL)).toBe(true)
    expect(badCoords(EMPIRE)).toBe(false)
    // Half a pair is no point; a swapped pair looks like a real one and cannot be told apart here.
    expect(onMap(place('p', 'X', 55.1, null))).toBe(false)
    expect(badCoords(place('p', 'X', 55.1, null))).toBe(false)
    expect(onMap(SWAPPED)).toBe(true)
  })
  it('keeps a bad point out of the tracks, the routes and the Places map', () => {
    const g = graph([
      person('ok', { birthDate: '1900', birthPlace: 'Кукуево', deathDate: '1950', deathPlace: 'Кукуево' }),
      person('oob', { birthDate: '1850', birthPlace: 'Тмутаракань', deathDate: '1900', deathPlace: 'Тмутаракань' }),
      person('null', { birthDate: '1900', birthPlace: 'Атлантида' }),
    ])
    const tl = mapTimeline(g, places)
    expect(tl.tracks.map((t) => t.personId)).toEqual(['ok'])
    expect(tl.tracks[0].stops.every((s) => Math.abs(s.lat) <= 90 && Math.abs(s.lon) <= 180)).toBe(true)
    expect(routePoints(tl.tracks[0]).every(([la, lo]) => Math.abs(la) <= 90 && Math.abs(lo) <= 180)).toBe(true)
    expect(mapSpots(g, places).map((s) => s.place.id)).not.toContain('oob')
    expect(mapSpots(g, places).map((s) => s.place.id)).not.toContain('null')
  })
})

describe('why an event is not on the map', () => {
  const gap = (g: Graph) => {
    const tl = mapTimeline(g, places)
    return { tl, why: tl.absent.flatMap((a) => a.gaps.map((x) => [a.personId, x.gap] as const)) }
  }
  it('tells a missing place record from a record without a point', () => {
    const { tl, why } = gap(graph([
      person('unknown', { birthDate: '1930', birthPlace: 'Калинин' }),
      person('nopoint', { birthDate: '1890', birthPlace: 'Российская империя' }),
      person('range', { birthDate: '1850', birthPlace: 'Тмутаракань' }),
      person('zero', { birthDate: '1900', birthPlace: 'Атлантида' }),
      person('none', { birthDate: '1900' }),
      person('nodate', { birthDate: '?', birthPlace: 'Кукуево' }),
    ]))
    expect(why).toEqual([
      ['unknown', 'unknown-place'],
      ['nopoint', 'no-coords'],
      ['range', 'bad-coords'],
      ['zero', 'bad-coords'],
      ['none', 'no-place'],
      ['nodate', 'no-date'],
    ])
    expect(tl.tracks).toEqual([])
  })
  it('lists an event outside the life and keeps the life itself on the map', () => {
    const g = graph([person('early', { birthDate: '1900', birthPlace: 'Кукуево', deathDate: '1970', deathPlace: 'Кукуево', facts: [{ kind: 'Переезд', date: '1850', place: 'Санкт-Петербург', note: '' }] })])
    const tl = mapTimeline(g, places)
    expect(tl.tracks[0].stops.map((s) => s.what)).toEqual(['Рождение', 'Смерть'])
    expect(tl.missing.map((m) => [m.what, m.gap])).toEqual([['Переезд', 'outside-span']])
    // A death before a birth is a slip in one of the two: the life stays at its birthplace and the death is listed.
    const inverted = mapTimeline(graph([person('db', { birthDate: '1900', birthPlace: 'Кукуево', deathDate: '1880', deathPlace: 'Кукуево' })]), places)
    expect(inverted.tracks.map((t) => t.stops.map((s) => s.what))).toEqual([['Рождение']])
    expect(inverted.missing.map((x) => x.gap)).toEqual(['death-before-birth'])
  })
  it('reads "ок. 1890" and leaves "?" without a year', () => {
    const tl = mapTimeline(graph([
      person('about', { birthDate: 'ок. 1890', birthPlace: 'Кукуево' }),
      person('q', { birthDate: '?', birthPlace: 'Кукуево' }),
    ]), places)
    expect(tl.tracks.map((t) => [t.personId, t.stops[0].year])).toEqual([['about', 1890]])
    expect(tl.absent[0].gaps.map((g) => g.gap)).toEqual(['no-date'])
  })
})

describe('a followed person in a crowded town', () => {
  it('moves the town stack aside so its count and faces stay reachable', () => {
    // 24 px is a face (RING_ZOOM stack face): 3 × 9 px puts the stack clear of the followed face.
    expect(stackShift(true, false, 9)).toBe(27)
    expect(stackShift(true, false, 9)).toBeGreaterThanOrEqual(24)
    // In a ring the faces already stand around the followed one; elsewhere nothing moves.
    expect(stackShift(true, true, 9)).toBe(0)
    expect(stackShift(false, false, 9)).toBe(0)
  })
  it('still draws one life where a bad point is the only place written', () => {
    const stops = lifeStops(person('p', { birthDate: '1850', birthPlace: 'Тмутаракань' }), graph([]), places)
    expect(stops).toEqual([])
  })
})
