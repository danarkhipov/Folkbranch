// What goes on a map: places with a point, the people at each, and one life's stops in order.
import { beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../lib/ops/core'
import { lifeStops, mapSpots } from '../lib/places'

const owner: Actor = { userId: 'o', name: 'Owner', role: 'owner', personId: null }
const reader: Actor = { userId: 'r', name: 'Reader', role: 'reader', personId: null }

let people: typeof import('../lib/ops/people')
let places: typeof import('../lib/ops/places')
const id = { ivan: '', wife: '', secret: '' }

beforeAll(async () => {
  people = await import('../lib/ops/people')
  places = await import('../lib/ops/places')
  const tver = places.savePlace(owner, null, { name: 'Тверь', otherNames: [{ name: 'Калинин', years: '1931–1990' }], lat: 56.86, lon: 35.9 }).id
  places.savePlace(owner, null, { name: 'Ивановка', lat: 54.2, lon: 37.6 })
  places.savePlace(owner, null, { name: 'Москва', lat: 55.75, lon: 37.62 })
  places.savePlace(owner, null, { name: 'Безточкино' })
  places.savePlace(owner, null, { name: 'Пустое', lat: 50, lon: 30, parentId: tver })
  id.ivan = people.createPerson(owner, { givenName: 'Иван', surname: 'Картов', birthDate: '1890', birthPlace: 'Ивановка', deathDate: '1960', deathPlace: 'Калинин', living: false }).id
  id.wife = people.createPerson(owner, { givenName: 'Мария', surname: 'Картова', birthDate: '1895', birthPlace: 'Москва', living: false }).id
  id.secret = people.createPerson(owner, { givenName: 'Живой', surname: 'Картов', birthDate: '1990', birthPlace: 'Москва', living: true }).id
  people.updatePerson(owner, id.ivan, { facts: [
    { kind: 'Переезд', date: '', place: 'Безточкино', note: '' },
    { kind: 'Работа', date: '1930', place: 'Москва', note: '' },
    { kind: 'Служба', date: '1920', place: 'Ивановка', note: '' },
    { kind: 'Без даты', date: '', place: 'Тверь', note: '' },
  ] })
  people.linkPeople(owner, 'spouse', id.ivan, id.wife)
})

describe('one life on a map', () => {
  it('goes from birth to death in order, skips places with no point and joins a place repeated in a row', () => {
    const g = people.getGraph(owner)
    const ivan = g.persons.find((p) => p.id === id.ivan)!
    const stops = lifeStops(ivan, g, places.listPlaces(owner))
    // Birth and service in Ивановка are one stop; Безточкино has no point; the undated Тверь merges with death in Калинин.
    expect(stops.map((s) => s.place.name)).toEqual(['Ивановка', 'Москва', 'Тверь'])
    expect(stops[0].what).toBe('Рождение')
    expect(stops.at(-1)!.place.name).toBe('Тверь')
  })
})

describe('places on a map', () => {
  it('gathers the people at each place, by any of its names, and keeps a place no one is written at', () => {
    const spots = mapSpots(people.getGraph(owner), places.listPlaces(owner))
    const at = (name: string) => spots.find((s) => s.place.name === name)
    expect(at('Тверь')?.people).toEqual([id.ivan])
    expect(at('Москва')?.people).toEqual(expect.arrayContaining([id.ivan, id.wife, id.secret]))
    expect(at('Пустое')?.people).toEqual([])
    expect(at('Безточкино')).toBeUndefined()
  })
  it('shows a reader no one hidden from them', () => {
    const spots = mapSpots(people.getGraph(reader), places.listPlaces(reader))
    expect(spots.find((s) => s.place.name === 'Москва')?.people).not.toContain(id.secret)
    expect(spots.find((s) => s.place.name === 'Пустое')).toBeUndefined()
  })
})
