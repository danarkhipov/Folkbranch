// What the family's dates add up to. Invented people only.
import { describe, expect, it } from 'vitest'
import { comingDays, fanSlots, familyNumbers, lifeEvents } from '../lib/family-dates'
import type { Graph, Person } from '../lib/types'

const person = (id: string, extra: Partial<Person> = {}): Person => ({ id, givenName: id, surname: 'Лис', maidenName: '', patronymic: '', otherNames: '', sex: 'U', birthDate: '', birthYear: null, birthPlace: '', deathDate: '', deathYear: null, deathPlace: '', living: false, certainty: 'documented', avatarMediaId: null, avatarCrop: null, updatedAt: 0, tags: [], facts: [], sources: [], claims: [], ...extra })
const link = (parentId: string, childId: string) => ({ id: `${parentId}-${childId}`, parentId, childId, kind: 'birth' as const, certainty: 'documented' as const })
const graph: Graph = {
  persons: [
    person('дед', { sex: 'M', birthDate: '12.03.1890', birthYear: 1890, deathDate: '20 марта 1960', deathYear: 1960, birthPlace: 'Тверь', facts: [{ kind: 'Служба', date: '1914', place: 'Рига', note: 'полк' }, { kind: 'Без даты', date: '', place: '', note: '' }] }),
    person('бабка', { sex: 'F', birthDate: '1895', birthYear: 1895, maidenName: 'Кот' }),
    person('сын', { sex: 'M', birthDate: '15.03.1950', birthYear: 1950, living: true, birthPlace: 'Тверь' }),
    person('скрытая', { hidden: true, living: true, birthDate: '14.03.1980', birthYear: 1980 }),
  ],
  parentChild: [link('дед', 'сын'), link('бабка', 'сын'), link('сын', 'скрытая')],
  unions: [{ id: 'u', aId: 'дед', bId: 'бабка', kind: 'marriage', startDate: '16.03.1915', endDate: '', place: '', certainty: 'documented' }],
}
const today = new Date(2026, 2, 12)

describe('coming days', () => {
  const days = comingDays(graph, today, 10)
  it('comes in order, with the years it will be', () => {
    expect(days.map((d) => [d.kind, d.personIds[0], d.daysAway, d.years])).toEqual([
      ['birth-memory', 'дед', 0, 136], ['birthday', 'сын', 3, 76], ['wedding-memory', 'дед', 4, 111], ['death-memory', 'дед', 8, 66],
    ])
  })
  it('never names someone hidden from this reader', () => {
    expect(days.some((d) => d.personIds.includes('скрытая'))).toBe(false)
  })
  it('skips a date without a day, and one that is past for this year comes round next year', () => {
    expect(days.some((d) => d.personIds[0] === 'бабка' && d.kind !== 'wedding-memory')).toBe(false)
    expect(comingDays(graph, new Date(2026, 2, 21), 360).find((d) => d.kind === 'birthday')?.years).toBe(77)
  })
})

describe('a life in order', () => {
  it('reads the card and the family, in years, with the age', () => {
    expect(lifeEvents(graph.persons[0], graph).map((e) => [e.year, e.title, e.age])).toEqual([
      [1890, 'Рождение', null], [1914, 'Служба', 24], [1915, 'Брак', 25], [1950, 'Рождение ребёнка', 60], [1960, 'Смерть', 70],
    ])
  })
  it('leaves out a child hidden from this reader', () => {
    expect(lifeEvents(graph.persons[2], graph).some((e) => e.otherId === 'скрытая')).toBe(false)
  })
})

describe('the family in numbers', () => {
  const n = familyNumbers(graph)
  it('counts everyone, but names no one hidden', () => {
    expect(n).toMatchObject({ people: 4, living: 2, generations: 3, oldest: { id: 'дед', age: 70 }, earliest: { id: 'дед', year: 1890 } })
    expect(n.surnames[0]).toEqual(['Лис', 3])
    expect(n.places[0]).toEqual(['Тверь', 2])
  })
  it('survives a loop in the data', () => {
    expect(familyNumbers({ persons: [person('a'), person('b')], parentChild: [link('a', 'b'), link('b', 'a')], unions: [] }).generations).toBeGreaterThan(0)
  })
})

describe('the fan', () => {
  it('puts the father first and doubles each ring', () => {
    const levels = fanSlots('сын', graph, 3)
    expect(levels.map((l) => l.length)).toEqual([1, 2, 4, 8])
    expect(levels[1].map((p) => p?.id)).toEqual(['дед', 'бабка'])
    expect(levels[2].every((p) => p === null)).toBe(true)
  })
  it('has a place for a mother with no father known', () => {
    expect(fanSlots('x', { persons: [person('x'), person('m', { sex: 'F' })], parentChild: [link('m', 'x')], unions: [] }, 1)[1].map((p) => p?.id)).toEqual([undefined, 'm'])
  })
})
