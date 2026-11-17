// A place written on a card keeps beside it the record it means, so two villages of one name are told apart and
// a second one added later does not move anyone. The text stays as written; the link follows only that text.
import { beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../lib/ops/core'
import { findPlace, placeLink, placeMatches, placeProblem, similarPlaces } from '../lib/places'
import { mapTimeline } from '../lib/map-timeline'
import { maskPerson } from '../lib/ops/privacy'
import type { Graph, Person, Place } from '../lib/types'

const owner: Actor = { userId: 'o', name: 'Owner', role: 'owner', personId: null }
const place = (id: string, name: string, parentId: string | null, lat: number | null, lon: number | null): Place => ({ id, name, kind: '', parentId, otherNames: [], lat, lon, note: '' })
const person = (id: string, patch: Partial<Person>): Person => ({
  id, givenName: 'Анна', surname: 'Тестова', maidenName: '', patronymic: '', otherNames: '', sex: 'F',
  birthDate: '1900', birthYear: 1900, birthPlace: '', deathDate: '', deathYear: null, deathPlace: '',
  living: false, certainty: 'family', avatarMediaId: null, avatarCrop: null, updatedAt: 0, tags: [], facts: [], sources: [], claims: [],
  ...patch,
})
const atlas = [
  place('tver', 'Тверская губерния', null, null, null),
  place('ryaz', 'Рязанская губерния', null, null, null),
  place('iv-t', 'Ивановка', 'tver', 57.1, 35.2),
  place('iv-r', 'Ивановка', 'ryaz', 54.3, 40.1),
]

describe('two villages of one name', () => {
  it('are not guessed between: the map lists the event as ambiguous instead of putting it in the first', () => {
    const tl = mapTimeline({ persons: [person('a', { birthPlace: 'Ивановка' })], parentChild: [], unions: [] } as Graph, atlas)
    expect(tl.tracks).toEqual([])
    expect(tl.missing).toContainEqual(expect.objectContaining({ personId: 'a', gap: 'ambiguous-place' }))
  })
  it('are told apart by a link, or by what the text says the village belongs to', () => {
    const linked = mapTimeline({ persons: [person('a', { birthPlace: 'Ивановка', birthPlaceId: 'iv-r' })], parentChild: [], unions: [] } as Graph, atlas)
    expect(linked.tracks[0].stops[0]).toMatchObject({ lat: 54.3, lon: 40.1 })
    expect(findPlace('Ивановка, Тверская губерния', atlas)?.id).toBe('iv-t')
    expect(findPlace('Ивановка, Тверская', atlas)?.id).toBe('iv-t')
    expect(placeMatches('Ивановка', atlas).map((p) => p.id)).toEqual(['iv-t', 'iv-r'])
  })
  it('follow a link only while the text still names that place, so a corrected place is not held to the old one', () => {
    expect(findPlace('Пермь', [...atlas, place('perm', 'Пермь', null, 58, 56)], 'iv-r')?.id).toBe('perm')
    expect(findPlace('Москва', atlas, 'iv-r')).toBeNull()
  })
  it('keep a fact linked to its own village on the map', () => {
    const p = person('f', { birthPlace: 'Ивановка', birthPlaceId: 'iv-t', facts: [{ kind: 'Residence', date: '1930', place: 'Ивановка', placeId: 'iv-r', note: '' }] })
    const tl = mapTimeline({ persons: [p], parentChild: [], unions: [] } as Graph, atlas)
    expect(tl.tracks[0].stops.map((s) => s.lat)).toEqual([57.1, 54.3])
  })
})

describe('a deleted place', () => {
  it('does not hand its people to a namesake: the event is a question, and the link stays for an undo', () => {
    const left = atlas.filter((p) => p.id !== 'iv-r')
    const tl = mapTimeline({ persons: [person('a', { birthPlace: 'Ивановка', birthPlaceId: 'iv-r' })], parentChild: [], unions: [] } as Graph, left)
    expect(tl.tracks).toEqual([])
    expect(tl.missing).toContainEqual(expect.objectContaining({ personId: 'a', gap: 'ambiguous-place' }))
    expect(placeLink('Ивановка', left, 'iv-r')).toBe('iv-r')
    expect(placeProblem('Ивановка', left, 'iv-r')).toBe('ambiguous')
    // With no namesake left there is nothing to mistake it for: the place is simply unknown.
    expect(placeProblem('Москва', left, 'gone')).toBe('unknown')
  })
})

describe('similar places', () => {
  it('pairs one name under one parent, or two points within 2 km, and leaves apart villages of one name in other provinces', () => {
    const list = [...atlas, place('k1', 'Кукуево', 'tver', 56, 36), place('k2', 'Кукуево.', 'tver', null, null), place('m1', 'Москва', null, 55.75, 37.62), place('m2', 'Moskva', null, 55.751, 37.621)]
    list[7] = { ...list[7], otherNames: [{ name: 'Москва', years: '' }] }
    const pairs = similarPlaces(list).map(([a, b]) => [a.id, b.id].sort().join('+'))
    expect(pairs).toContain('k1+k2')
    expect(pairs).toContain('m1+m2')
    expect(pairs).not.toContain('iv-r+iv-t')
  })
})

describe('the archive keeps links as it is written to', () => {
  let places: typeof import('../lib/ops/places')
  let people: typeof import('../lib/ops/people')
  beforeAll(async () => {
    ;[places, people] = await Promise.all([import('../lib/ops/places'), import('../lib/ops/people')])
  })
  const fresh = (id: string) => people.getGraph(owner).persons.find((p) => p.id === id)!
  let tver = '', ryaz = '', ivT = '', ivR = '', annaId = ''

  it('links a place the moment its text means one record', () => {
    tver = (places.savePlace(owner, null, { name: 'Тверская губерния' }) as { id: string }).id
    ryaz = (places.savePlace(owner, null, { name: 'Рязанская губерния' }) as { id: string }).id
    ivT = (places.savePlace(owner, null, { name: 'Ивановка', parentId: tver, lat: 57.1, lon: 35.2 }) as { id: string }).id
    annaId = (people.createPerson(owner, { givenName: 'Анна', surname: 'Иванова', birthPlace: 'Ивановка', facts: [{ id: 'f1', kind: 'Residence', date: '1930', place: 'Ивановка', note: '' }] }) as { id: string }).id
    const anna = fresh(annaId)
    expect(anna.birthPlaceId).toBe(ivT)
    expect(anna.facts[0].placeId).toBe(ivT)
  })
  it('keeps the people of the first village where they were when a second of that name is added', async () => {
    // One written by an older version, with no link: it is linked to the first village before the second appears.
    const { getDb } = await import('../lib/db')
    getDb().$client.prepare("insert into persons (id, given_name, surname, birth_place, facts) values ('older', 'Мария', 'Старая', 'Ивановка', '[{\"kind\":\"Residence\",\"date\":\"1920\",\"place\":\"Ивановка\",\"note\":\"\"}]')").run()
    ivR = (places.savePlace(owner, null, { name: 'Ивановка', parentId: ryaz, lat: 54.3, lon: 40.1 }) as { id: string }).id
    const anna = fresh(annaId)
    expect(anna.birthPlaceId).toBe(ivT)
    expect(anna.facts[0].placeId).toBe(ivT)
    expect(fresh('older').birthPlaceId).toBe(ivT)
    expect(fresh('older').facts[0].placeId).toBe(ivT)
    // Someone written later with the bare name is a question to answer, not a guess.
    const ivan = people.createPerson(owner, { givenName: 'Иван', surname: 'Иванов', birthPlace: 'Ивановка' }) as { id: string }
    expect(fresh(ivan.id).birthPlaceId ?? null).toBeNull()
    const both = places.placeWarnings([{ text: 'Ивановка' }])
    expect(both[0]).toMatchObject({ problem: 'ambiguous' })
    expect(both[0].choices?.map((c) => c.id).sort()).toEqual([ivR, ivT].sort())
    // Picked on the card, or written with its province, it is linked.
    people.updatePerson(owner, ivan.id, { birthPlaceId: ivR })
    expect(fresh(ivan.id).birthPlaceId).toBe(ivR)
    const olga = people.createPerson(owner, { givenName: 'Ольга', surname: 'Иванова', birthPlace: 'Ивановка, Рязанская губерния' }) as { id: string }
    expect(fresh(olga.id).birthPlaceId).toBe(ivR)
  })
  it('drops a link when the text is changed to another place, and keeps a fact\'s link when the list is saved again without it', () => {
    people.updatePerson(owner, annaId, { birthPlace: 'Москва' })
    expect(fresh(annaId).birthPlaceId ?? null).toBeNull()
    const anna = fresh(annaId)
    people.updatePerson(owner, annaId, { facts: anna.facts.map(({ placeId: _, ...f }) => ({ ...f, note: 'дом' })) })
    expect(fresh(annaId).facts[0]).toMatchObject({ note: 'дом', placeId: ivT })
  })
  it('merges two records of one place: names joined, cards moved to the kept one, the other gone', () => {
    const keep = (places.savePlace(owner, null, { name: 'Кукуево', parentId: tver, lat: 56, lon: 36 }) as { id: string }).id
    const drop = (places.savePlace(owner, null, { name: 'Кукуево.', parentId: tver }) as { id: string }).id
    const p = people.createPerson(owner, { givenName: 'Пётр', surname: 'Кукуев', birthPlace: 'Кукуево.', birthPlaceId: drop }) as { id: string }
    places.mergePlaces(owner, keep, drop)
    const all = places.listPlaces(owner)
    expect(all.some((x) => x.id === drop)).toBe(false)
    expect(all.find((x) => x.id === keep)?.otherNames.map((n) => n.name)).toContain('Кукуево.')
    expect(fresh(p.id).birthPlaceId).toBe(keep)
    expect(findPlace('Кукуево.', all, fresh(p.id).birthPlaceId)?.id).toBe(keep)
  })
  it('merging a place into one that sat inside it leaves the kept one where the other was, not under a record gone', () => {
    const outer = (places.savePlace(owner, null, { name: 'Тула', parentId: tver }) as { id: string }).id
    const inner = (places.savePlace(owner, null, { name: 'Тула город', parentId: outer, lat: 54.2, lon: 37.6 }) as { id: string }).id
    places.mergePlaces(owner, inner, outer)
    expect(places.listPlaces(owner).find((x) => x.id === inner)?.parentId).toBe(tver)
  })
  it('reads a card an older version wrote, with no link columns filled in', async () => {
    const { getDb } = await import('../lib/db')
    getDb().$client.prepare("insert into persons (id, given_name, surname, birth_place, birth_date) values ('old1', 'Старый', 'Формат', 'Ивановка, Тверская губерния', '1880')").run()
    const old = fresh('old1')
    expect(old.birthPlaceId ?? null).toBeNull()
    expect(findPlace(old.birthPlace, places.listPlaces(owner), old.birthPlaceId)?.id).toBe(ivT)
  })
})

describe('privacy', () => {
  it('a hidden person keeps no link that would say where they were born', () => {
    const masked = maskPerson(person('h', { birthPlace: 'Ивановка', birthPlaceId: 'iv-t', deathPlaceId: 'iv-r' }))
    expect(masked.birthPlaceId).toBeNull()
    expect(masked.deathPlaceId).toBeNull()
  })
})
