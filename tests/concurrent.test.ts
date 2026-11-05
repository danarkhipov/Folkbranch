// Several people, and the assistant, working on one archive at once.
import { beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../lib/ops/core'
import { mergeList, reconcile } from '../lib/ops/merge'

let people: typeof import('../lib/ops/people')
let reg: typeof import('../lib/ops/proposals')
const anna: Actor = { userId: 'u-anna', name: 'Анна', role: 'owner', personId: null }
const petr: Actor = { userId: 'u-petr', name: 'Пётр', role: 'editor', personId: null }
const reader: Actor = { userId: 'u-r', name: 'Читатель', role: 'reader', personId: null }

beforeAll(async () => {
  people = await import('../lib/ops/people')
  reg = await import('../lib/ops/proposals')
})
const create = (givenName: string) => people.createPerson(anna, { givenName, surname: 'Тест', birthDate: '1900', deathDate: '1950' } as never) as { id: string }

describe('merging lists', () => {
  it('keeps both additions', () => expect(mergeList(['a'], ['a', 'b'], ['a', 'c'])).toEqual(['a', 'c', 'b']))
  it('honours a removal and leaves the other addition', () => expect(mergeList(['a', 'b'], ['a'], ['a', 'b', 'c'])).toEqual(['a', 'c']))
  it('does not bring back what the other removed', () => expect(mergeList(['a', 'b'], ['a', 'b', 'c'], ['a'])).toEqual(['a', 'c']))
  it('takes my edit of an item by its id', () => expect(mergeList([{ id: 1, v: 'x' }], [{ id: 1, v: 'mine' }], [{ id: 1, v: 'x' }, { id: 2, v: 'y' }])).toEqual([{ id: 1, v: 'mine' }, { id: 2, v: 'y' }]))
  it('adds nothing twice', () => expect(mergeList([], ['a'], ['a'])).toEqual(['a']))
})

describe('a value changed meanwhile', () => {
  it('is refused, not overwritten', () => {
    expect(() => reconcile({ birthPlace: 'Рига' }, { birthPlace: 'Пермь' }, { birthPlace: '' })).toThrow(/meanwhile/)
  })
  it('passes when both wrote the same thing', () => {
    expect(reconcile({ birthPlace: 'Рига' }, { birthPlace: 'Рига' }, { birthPlace: '' })).toEqual({ birthPlace: 'Рига' })
  })
})

describe('two people on one card', () => {
  it('both facts survive when each started from the same copy', async () => {
    const { id } = create('Списки')
    const seen = { facts: [] }
    await reg.dispatch(anna, 'update_person', { id, patch: { facts: [{ kind: 'Служба', date: '', place: '', note: '', source: '' }] }, seen })
    await reg.dispatch(petr, 'update_person', { id, patch: { facts: [{ kind: 'Награда', date: '', place: '', note: '', source: '' }] }, seen })
    expect(people.getGraph(anna).persons.find((p) => p.id === id)!.facts.map((f) => f.kind)).toEqual(['Служба', 'Награда'])
  })
  it('the second writer of one field gets a conflict and the first value stays', async () => {
    const { id } = create('Поле')
    await reg.dispatch(anna, 'update_person', { id, patch: { birthPlace: 'Рига' }, seen: { birthPlace: '' } })
    await expect(reg.dispatch(petr, 'update_person', { id, patch: { birthPlace: 'Пермь' }, seen: { birthPlace: '' } })).rejects.toMatchObject({ status: 409 })
    expect(people.getGraph(anna).persons.find((p) => p.id === id)!.birthPlace).toBe('Рига')
  })
  it('different fields of one card do not collide', async () => {
    const { id } = create('Разные')
    await reg.dispatch(anna, 'update_person', { id, patch: { birthPlace: 'Рига' }, seen: { birthPlace: '' } })
    await reg.dispatch(petr, 'update_person', { id, patch: { deathPlace: 'Пермь' }, seen: { deathPlace: '' } })
    const p = people.getGraph(anna).persons.find((x) => x.id === id)!
    expect([p.birthPlace, p.deathPlace]).toEqual(['Рига', 'Пермь'])
  })
  it('a request without `seen` still works, for API clients', async () => {
    const { id } = create('Без')
    await reg.dispatch(anna, 'update_person', { id, patch: { birthPlace: 'Рига' } })
    await reg.dispatch(petr, 'update_person', { id, patch: { birthPlace: 'Пермь' } })
    expect(people.getGraph(anna).persons.find((x) => x.id === id)!.birthPlace).toBe('Пермь')
  })
  it('editing someone just deleted says so', async () => {
    const { id } = create('Удалён')
    people.deletePerson(anna, id)
    await expect(reg.dispatch(petr, 'update_person', { id, patch: { birthPlace: 'Пермь' }, seen: { birthPlace: '' } })).rejects.toMatchObject({ status: 404 })
  })
})

describe('the same link from two people', () => {
  it('is made once and the second is told plainly', async () => {
    const a = create('Пара1'), b = create('Пара2')
    await reg.dispatch(anna, 'add_relation', { type: 'spouse', to: a.id, other: b.id })
    const second = await reg.dispatch(petr, 'add_relation', { type: 'spouse', to: a.id, other: b.id }).then(() => 200, (e) => e.status)
    expect(second === 200 || (second >= 400 && second < 500)).toBe(true)
    expect(people.getGraph(anna).unions.filter((u) => [u.aId, u.bId].includes(a.id) && [u.aId, u.bId].includes(b.id)).length).toBe(1)
  })
})

describe('the shared graph', () => {
  it('shows a write at once, and is the same object until then', () => {
    const before = people.getGraph(anna)
    expect(people.getGraph(petr)).toBe(before)
    const { id } = create('Новый')
    expect(people.getGraph(anna).persons.some((p) => p.id === id)).toBe(true)
  })
  it('never shows what a rolled-back write put there', async () => {
    const { mutate } = await import('../lib/ops/core')
    const count = people.getGraph(anna).persons.length
    expect(() => mutate(anna, { summary: 'x' }, (c) => {
      people.insertPerson(c, { givenName: 'Призрак' })
      expect(people.getGraph(anna).persons.length).toBe(count + 1)
      throw new Error('stop')
    })).toThrow('stop')
    expect(people.getGraph(anna).persons.length).toBe(count)
    expect(people.getGraph(anna).persons.some((p) => p.givenName === 'Призрак')).toBe(false)
  })
  it('a reader never gets the shared copy of a living person', () => {
    const living = people.createPerson(anna, { givenName: 'Живая', surname: 'Тайная', living: true } as never) as { id: string }
    const seen = people.getGraph(reader).persons.find((p) => p.id === living.id)!
    expect(seen.givenName).toBe('')
    expect(people.graphForPage(reader).body()).not.toContain('Тайная')
    expect(people.graphForPage(anna).body()).toContain('Тайная')
  })
  it('the tag differs by who is asking and moves with a write', () => {
    const a = people.graphForPage(anna).etag
    expect(a).toBe(people.graphForPage(petr).etag)
    expect(a).not.toBe(people.graphForPage(reader).etag)
    create('Ещё')
    expect(people.graphForPage(anna).etag).not.toBe(a)
  })
})

describe('the assistant beside people', () => {
  const assistant = async () => {
    await new Promise((r) => setTimeout(r, 3))
    return { ...(await import('../lib/agent/agent')).assistantActor(anna, Date.now()) }
  }
  it('does not write over an edit it has not read, and passes after looking again', async () => {
    const { id } = create('Агент')
    const a = await assistant()
    await new Promise((r) => setTimeout(r, 3))
    await reg.dispatch(petr, 'update_person', { id, patch: { birthPlace: 'Рига' } })
    await expect(reg.dispatch(a, 'update_person', { id, patch: { birthPlace: 'Пермь' } })).rejects.toMatchObject({ status: 409 })
    await new Promise((r) => setTimeout(r, 3))
    await reg.dispatch(a, 'update_person', { id, patch: { birthPlace: 'Пермь' } })
    expect(people.getGraph(anna).persons.find((p) => p.id === id)!.birthPlace).toBe('Пермь')
  })
  it('does not trip over its own edits', async () => {
    const { id } = create('Своё')
    const a = await assistant()
    await new Promise((r) => setTimeout(r, 3))
    await reg.dispatch(a, 'update_person', { id, patch: { birthPlace: 'Рига' } })
    await new Promise((r) => setTimeout(r, 3))
    await reg.dispatch(a, 'update_person', { id, patch: { deathPlace: 'Пермь' } })
  })
  it('answers run one per person and a few at a time', async () => {
    const { takeRun } = await import('../lib/agent/limits')
    const one = takeRun('a')!
    expect(takeRun('a')).toBeNull()
    const rest = ['b', 'c', 'd'].map((u) => takeRun(u)!)
    expect(takeRun('e')).toBeNull()
    one()
    expect(takeRun('a')).not.toBeNull()
    rest.forEach((r) => r())
  })
})

describe('a list that is not a list', () => {
  it('is refused as a bad request, not a server error', () => {
    for (const seen of [7, 'x', '{}', { a: 1 }]) expect(() => reconcile({ tags: '[]' }, { tags: [] }, { tags: seen })).toThrow(/not a list/)
  })
  it('an empty value counts as an empty list', () => {
    expect(reconcile({ tags: null }, { tags: ['a'] }, { tags: '' })).toEqual({ tags: ['a'] })
  })
})

describe('who may know that a card is open', () => {
  it('a reader may not, for the living; everyone else may', async () => {
    const living = people.createPerson(anna, { givenName: 'Живая', surname: 'Тестова', living: true } as never) as unknown as { id: string }
    const dead = people.createPerson(anna, { givenName: 'Ушедший', surname: 'Тестов', living: false } as never) as unknown as { id: string }
    expect(people.canSeePerson(anna, living.id)).toBe(true)
    expect(people.canSeePerson(reader, living.id)).toBe(false)
    expect(people.canSeePerson(reader, dead.id)).toBe(true)
    expect(people.canSeePerson({ ...reader, personId: living.id }, living.id)).toBe(true)
  })
})
