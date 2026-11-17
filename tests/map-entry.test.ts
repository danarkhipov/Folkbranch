// The entry lens: how a life of moves gets into the archive, and what the map and the card then show.
// Each case is one thing a person writing a family story does, and what they see afterwards.
import { beforeAll, describe, expect, it } from 'vitest'
import type { Graph, Person, Place } from '../lib/types'
import { mapTimeline, periodEnd, positionAt, routeStopLabel, routeStops } from '../lib/map-timeline'
import { lifeStops, placeProblem, unplacedStops } from '../lib/places'
import { undatedEvents } from '../lib/family-dates'
import { guessMapping } from '../lib/import-formats'
import { translate } from '../lib/i18n'

const place = (id: string, name: string, lat: number | null, lon: number | null): Place => ({ id, name, kind: '', parentId: null, otherNames: [], lat, lon, note: '' })
const person = (id: string, patch: Partial<Person>): Person => ({
  id, givenName: 'Анна', surname: 'Тестова', maidenName: '', patronymic: '', otherNames: '', sex: 'F',
  birthDate: '', birthYear: null, birthPlace: '', deathDate: '', deathYear: null, deathPlace: '',
  living: false, certainty: 'family', avatarMediaId: null, avatarCrop: null, updatedAt: 0, tags: [], facts: [], sources: [], claims: [],
  ...patch,
})

const places = [
  place('v', 'Верхнее', 56.5, 44.0),
  place('k', 'Казань', 55.79, 49.12),
  place('s', 'Саратов', 51.53, 46.03),
  place('p', 'Пермь', 58.01, 56.24),
  place('n', 'Новосёлки', null, null),
]

/** Born in a village, studied in a city, evacuated, came back, moved to her daughter, died there. */
const anna = person('anna', {
  birthDate: '03.04.1921', birthYear: 1921, birthPlace: 'Верхнее',
  deathDate: '1999', deathYear: 1999, deathPlace: 'Пермь',
  facts: [
    { kind: 'Education', date: '1938', place: 'Казань', note: 'педагогический институт' },
    { kind: 'Residence', date: '1941–1944', place: 'Саратов', note: 'эвакуация' },
    { kind: 'Residence', date: '1944', place: 'Казань', note: '' },
    { kind: 'Residence', date: '1946', place: 'Новосёлки', note: 'дом мужа' },
    { kind: 'Residence', date: '', place: 'Пермь', note: 'жила у дочери' },
    { kind: 'Residence', date: '1960', place: 'Пермь', note: 'переехала к дочери' },
  ],
})
const graph: Graph = { persons: [anna], parentChild: [], unions: [] }

describe('a place written on a card', () => {
  it('says why it cannot be drawn: no such place, or a place with no point', () => {
    expect(placeProblem('', places)).toBeNull()
    expect(placeProblem('Верхнее', places)).toBeNull()
    expect(placeProblem('Новосёлки', places)).toBe('no-coords')
    expect(placeProblem('Нижнее', places)).toBe('unknown')
  })
  it('finds a place by another of its names, so a renamed town still has its point', () => {
    const withOld = [...places, { ...place('t', 'Тверь', 56.86, 35.9), otherNames: [{ name: 'Калинин', years: '1931–1990' }] }]
    expect(placeProblem('Калинин', withOld)).toBeNull()
  })
})

describe('the little map on the card', () => {
  it('draws the stops that have a point, in order, from birth to death', () => {
    expect(lifeStops(anna, graph, places).map((s) => s.place.name)).toEqual(['Верхнее', 'Казань', 'Саратов', 'Казань', 'Пермь'])
  })
  it('names the stops it left out and why, instead of dropping them in silence', () => {
    expect(unplacedStops(anna, graph, places)).toEqual([{ text: 'Новосёлки', what: 'Residence', date: '1946', why: 'no-coords' }])
  })
  it('lists a fact with no year too, which the chronology in years cannot place', () => {
    expect(undatedEvents(anna).map((e) => [e.title, e.place])).toEqual([['Residence', 'Пермь']])
  })
  it('leaves an undated move off the card too, with its reason, so the card and the map tell one route', () => {
    const noYear = person('no-year', {
      birthDate: '1920', birthYear: 1920, birthPlace: 'Верхнее',
      deathDate: '1990', deathYear: 1990, deathPlace: 'Пермь',
      facts: [{ kind: 'Move', date: '', place: 'Саратов', note: '' }],
    })
    const g: Graph = { persons: [noYear], parentChild: [], unions: [] }
    expect(lifeStops(noYear, g, places).map((s) => s.place.name)).toEqual(['Верхнее', 'Пермь'])
    expect(unplacedStops(noYear, g, places)).toEqual([{ text: 'Саратов', what: 'Move', date: '', why: 'no-date' }])
    const tl = mapTimeline(g, places)
    expect(tl.tracks[0].stops.map((s) => s.place)).toEqual(['Верхнее', 'Пермь'])
    expect(tl.missing).toContainEqual(expect.objectContaining({ what: 'Move', place: 'Саратов', gap: 'no-date' }))
  })
})

describe('a route as it is labelled on the map', () => {
  it('keeps the dates as written, so a stay of 1941–1944 is not shown as 1941', () => {
    expect(routeStopLabel({ dates: ['1941–1944'], years: [1941], place: 'Саратов' })).toBe('1941–1944 · Саратов')
    expect(routeStopLabel({ dates: [], years: [1960], place: 'Пермь' })).toBe('1960 · Пермь')
  })
  it('collects the dates of a place visited twice', () => {
    const stop = routeStops(mapTimeline(graph, places).tracks[0]).find((s) => s.place === 'Казань')
    expect(stop?.dates).toEqual(['1938', '1944'])
    expect(routeStopLabel(stop!)).toBe('1938, 1944 · Казань')
  })
})

describe('playing a life on the map', () => {
  const track = mapTimeline(graph, places).tracks[0]
  it('stands where the archive last put her and moves in time for the map', () => {
    expect(positionAt(track, 1942)).toMatchObject({ lat: 51.53, lon: 46.03 })
    expect(positionAt(track, 1950)).toMatchObject({ lat: 55.79, lon: 49.12 })
  })
  it('does not show her in a place after the period she lived there ends', () => {
    // "1941–1944" used to be read as 1941 alone, so a reader playing 1955 saw her still in Saratov, though the
    // archive says nothing after 1944. She is still drawn at her last known place, but marked as not known there.
    const alone = person('alone', {
      birthDate: '1941', birthYear: 1941, birthPlace: 'Саратов',
      deathDate: '1999', deathYear: 1999, deathPlace: 'Пермь',
      facts: [{ kind: 'Residence', date: '1941–1944', place: 'Саратов', note: '' }, { kind: 'Residence', date: '1960', place: 'Пермь', note: '' }],
    })
    const t = mapTimeline({ persons: [alone], parentChild: [], unions: [] }, places).tracks[0]
    expect(positionAt(t, 1943)?.after).toBeUndefined()
    expect(positionAt(t, 1944.9)?.after).toBeUndefined()
    expect(positionAt(t, 1955)).toMatchObject({ lat: 51.53, lon: 46.03, after: 1944 })
    // On the way to Perm and there, she is known again.
    expect(positionAt(t, 1959.5)?.after).toBeUndefined()
    expect(positionAt(t, 1965)).toMatchObject({ lat: 58.01 })
    expect(positionAt(t, 1965)?.after).toBeUndefined()
  })

  it('reads a period only from two years with a dash', () => {
    expect(['1941–1944', '1941 - 1944', 'c. 1941—1944', '1936-07-18', '1944–1941', '1941'].map(periodEnd)).toEqual([1944, 1944, 1944, null, null, null])
  })

  it('ends an event inside the stay with the stay', () => {
    const worked = person('worked', {
      birthDate: '1920', birthYear: 1920, birthPlace: 'Пермь',
      facts: [{ kind: 'Residence', date: '1941–1944', place: 'Саратов', note: '' }, { kind: 'Work', date: '1943', place: 'Саратов', note: '' }],
    })
    const t = mapTimeline({ persons: [worked], parentChild: [], unions: [] }, places).tracks[0]
    expect(positionAt(t, 1950)?.after).toBe(1944)
  })
})

let ops: typeof import('../lib/ops/people')
let opsPlaces: typeof import('../lib/ops/places')
const actor = { userId: 'o', name: 'Owner', role: 'owner' as const, personId: null }

beforeAll(async () => {
  ops = await import('../lib/ops/people')
  opsPlaces = await import('../lib/ops/places')
})

describe('the way in through the archive itself', () => {
  it('offers two differently named kinds for a move and a residence, and no two items read the same', () => {
    // The add-fact list is read in the interface language; two Russian kinds used to read "Military service"
    // and gave a menu with one item twice. Both move kinds stay apart so a residence and a move can be told.
    expect([translate('en', 'Место жительства'), translate('en', 'Переезд')]).toEqual(['Residence', 'Move'])
    expect(translate('en', 'Служба')).not.toBe(translate('en', 'Воинская служба'))
  })
  it('offers a residence column and pairs it with its year', () => {
    const mapping = guessMapping(['Имя', 'Дата рождения', 'Место рождения', 'Год', 'Где жил'])
    expect(mapping.slice(0, 3)).toEqual(['given', 'birthDate', 'birthPlace'])
    // A year column is a residence only because a residence place is there: it has somewhere to belong.
    expect(mapping.slice(3)).toEqual(['residenceDate', 'residencePlace'])
  })
  it('stores a residence fact as written and keeps the period, the place as typed and its missing point', () => {
    opsPlaces.savePlace(actor, null, { name: 'Верхнее', lat: 56.5, lon: 44.0 })
    opsPlaces.savePlace(actor, null, { name: 'Новосёлки' })
    const id = ops.createPerson(actor, {
      givenName: 'Анна', surname: 'Тестова', living: false, birthDate: '1921', birthPlace: 'Верхнее',
      facts: [{ kind: 'Residence', date: '1941–1944', place: 'Новосёлки', note: '' }],
    }).id
    const g = ops.getGraph(actor)
    const saved = g.persons.find((p) => p.id === id)!
    expect(saved.facts[0]).toMatchObject({ kind: 'Residence', date: '1941–1944', place: 'Новосёлки' })
    const list = opsPlaces.listPlaces(actor)
    expect(placeProblem(saved.facts[0].place, list)).toBe('no-coords')
    expect(unplacedStops(saved, g, list)).toContainEqual({ text: 'Новосёлки', what: 'Residence', date: '1941–1944', why: 'no-coords' })
    // A residence at a place with no point never becomes a stop on the map; it is only reported as a gap.
    const tl = mapTimeline(g, list)
    expect(tl.tracks.find((t) => t.personId === id)?.stops.map((s) => s.what)).toEqual(['Рождение'])
    expect(tl.missing).toContainEqual(expect.objectContaining({ what: 'Residence', place: 'Новосёлки', gap: 'no-coords' }))
  })
})
