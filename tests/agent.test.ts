// What the assistant writes: one fact added next to the others, and a place the map cannot show said in words.
import { beforeAll, describe, expect, it } from 'vitest'
import { assistantActor } from '../lib/agent/agent'
import { getDb, schema } from '../lib/db'
import type { Fact } from '../lib/types'
import { createPerson, getGraph, updatePerson } from '../lib/ops/people'
import * as places from '../lib/ops/places'
import { dispatch } from '../lib/ops/proposals'
import { toolsFor } from '../lib/ops/tools'
import { owner } from './fixture-family'

const factsOf = (id: string): Fact[] => getGraph(owner).persons.find((p) => p.id === id)!.facts

beforeAll(() => {
  places.savePlace(owner, null, { name: 'Кострома', lat: 57.77, lon: 40.93 })
  places.savePlace(owner, null, { name: 'Безточкино' })
  // A point an older version saved as 0, 0 must not stop the archive from opening or the place from being fixed.
  getDb().insert(schema.places).values({ id: 'old-zero', name: 'Нулевое', kind: '', parentId: null, otherNames: '[]', lat: 0, lon: 0, note: '', updatedAt: Date.now() }).run()
})

describe('facts', () => {
  it('adds one fact and keeps the ones already there', async () => {
    const id = createPerson(owner, { givenName: 'Фаддей', surname: 'Фактов', birthDate: '1880', deathDate: '1950' }).id
    updatePerson(owner, id, { facts: [{ kind: 'Служба', date: '1900', place: '', note: 'писарь' }, { kind: 'Награда', date: '1910', place: '', note: '' }] })
    await dispatch(owner, 'add_fact', { personId: id, fact: { kind: 'Переезд', date: '1912', place: 'Кострома', note: 'к реке' } })
    expect(factsOf(id).map((f) => f.kind)).toEqual(['Служба', 'Награда', 'Переезд'])
    expect(factsOf(id)[0].note).toBe('писарь')
  })

  it('still replaces the whole list through update_person', async () => {
    const id = createPerson(owner, { givenName: 'Марфа', surname: 'Фактова', birthDate: '1890', deathDate: '1960' }).id
    updatePerson(owner, id, { facts: [{ kind: 'Служба', date: '1910', place: '', note: '' }] })
    await dispatch(owner, 'add_fact', { personId: id, fact: { kind: 'Награда', date: '1915', place: '' } })
    await dispatch(owner, 'update_person', { id, patch: { facts: [{ kind: 'Правка', date: '', place: '', note: 'одна' }] } })
    expect(factsOf(id).map((f) => f.kind)).toEqual(['Правка'])
  })
})

describe('a place the map cannot show', () => {
  it('is named in the answer, with what to call to fix it', async () => {
    const id = createPerson(owner, { givenName: 'Аким', surname: 'Местов', birthDate: '1900', deathDate: '1980' }).id
    const unknown = await dispatch(owner, 'add_fact', { personId: id, fact: { kind: 'Переезд', date: '1920', place: 'Калуга' } })
    expect(unknown.places).toHaveLength(1)
    expect(unknown.places[0]).toMatchObject({ name: 'Калуга', problem: 'unknown' })
    expect(unknown.places[0].message).toContain('Калуга')
    expect(unknown.places[0].message).toContain('create_place')

    const empty = await dispatch(owner, 'add_fact', { personId: id, fact: { kind: 'Переезд', date: '1921', place: 'Безточкино' } })
    expect(empty.places[0]).toMatchObject({ name: 'Безточкино', problem: 'no-coords' })
    expect(empty.places[0].message).toContain('update_place')

    // A place typed into a card's field comes through the same answer, not only a fact's place.
    const card = await dispatch(owner, 'update_person', { id, patch: { birthPlace: 'Калуга' } })
    expect(card.places[0]).toMatchObject({ name: 'Калуга', problem: 'unknown' })
  })

  it('warns about an older 0, 0 point as a place with no point, not as a place that is fine', async () => {
    const id = createPerson(owner, { givenName: 'Глеб', surname: 'Нулев', birthDate: '1900', deathDate: '1970' }).id
    const r = await dispatch(owner, 'add_fact', { personId: id, fact: { kind: 'Переезд', place: 'Нулевое' } })
    expect(r.places[0]).toMatchObject({ name: 'Нулевое', problem: 'no-coords' })
  })

  it('says nothing when the place is known and has a point', async () => {
    const id = createPerson(owner, { givenName: 'Зоя', surname: 'Точкина', birthDate: '1901', deathDate: '1981' }).id
    const r = await dispatch(owner, 'add_fact', { personId: id, fact: { kind: 'Переезд', place: 'Кострома' } })
    expect(r.places).toBeUndefined()
  })

  it('reaches the model through the tool, not only through dispatch', async () => {
    const tool = toolsFor(assistantActor(owner), 'assistant').find((t) => t.name === 'add_fact')
    expect(tool).toBeDefined()
    const id = createPerson(owner, { givenName: 'Илья', surname: 'Проверкин', birthDate: '1902', deathDate: '1972' }).id
    const out: any = await tool!.run(assistantActor(owner), tool!.input.parse({ personId: id, fact: { kind: 'Переезд', place: 'Калуга' } }))
    expect(out.places?.[0]).toMatchObject({ name: 'Калуга', problem: 'unknown' })
  })
})

describe('a point that cannot be a place', () => {
  it('refuses 0, 0 in words, and an older 0, 0 place can still be given its real point', async () => {
    await expect(dispatch(owner, 'create_place', { name: 'Пустое', lat: 0, lon: 0 })).rejects.toThrow(/0, 0 is not a place/)
    // The same point on an existing place, as a hurried edit or an old import leaves it.
    getDb().insert(schema.places).values({ id: 'old-zero-fix', name: 'Нулевое старое', kind: '', parentId: null, otherNames: '[]', lat: 0, lon: 0, note: '', updatedAt: Date.now() }).run()
    await expect(dispatch(owner, 'update_place', { id: 'old-zero-fix', patch: { lat: 0, lon: 0 } })).rejects.toThrow(/0, 0 is not a place/)
    await dispatch(owner, 'update_place', { id: 'old-zero-fix', patch: { lat: 54.5, lon: 36.2 } })
    expect(places.getPlace('old-zero-fix')).toMatchObject({ lat: 54.5, lon: 36.2 })
  })

  it('refuses a latitude or longitude out of range, saying which', async () => {
    await expect(dispatch(owner, 'create_place', { name: 'Далеко', lat: 91, lon: 10 })).rejects.toThrow(/latitude must be between -90 and 90/)
    await expect(dispatch(owner, 'create_place', { name: 'Далеко', lat: 10, lon: 181 })).rejects.toThrow(/longitude must be between -180 and 180/)
  })
})
