// A child recorded under one parent whose partner is not a parent is called a stepchild: the check says so.
import { describe, expect, it } from 'vitest'
import { findGaps } from '../lib/ops/gaps'
import { createPerson, linkPeople } from '../lib/ops/people'
import { owner } from './fixture-family'

const add = (givenName: string, sex: 'M' | 'F') => createPerson(owner, { givenName, surname: 'Тестов', sex })
const missingOf = (id: string) => findGaps(owner, { limit: 200 }).find((g) => g.person.id === id)?.missing ?? []

describe('the second parent', () => {
  const pavel = add('Павел', 'M'), elena = add('Елена', 'F'), danil = add('Данил', 'M'), ilya = add('Илья', 'M'), anna = add('Анна', 'F'), kid = add('Ребёнок', 'M')
  linkPeople(owner, 'spouse', pavel.id, elena.id)
  linkPeople(owner, 'son', pavel.id, danil.id, elena.id)
  linkPeople(owner, 'son', pavel.id, ilya.id)
  it('is asked for when a brother through the same parent has both parents', () => expect(missingOf(ilya.id)).toContain('secondParent'))
  it('is not asked for when both parents are recorded', () => expect(missingOf(danil.id)).not.toContain('secondParent'))
  it('is not asked for on a stepchild alone: a partner of the only parent is no evidence', () => {
    const anton = add('Антон', 'M'), vera = add('Вера', 'F'), step = add('Пасынок', 'M')
    linkPeople(owner, 'spouse', anton.id, vera.id)
    linkPeople(owner, 'son', anton.id, step.id)
    expect(missingOf(step.id)).not.toContain('secondParent')
  })
  it('is not asked for when the only parent has no partner', () => {
    linkPeople(owner, 'son', anna.id, kid.id)
    expect(missingOf(kid.id)).not.toContain('secondParent')
  })
  it('goes away once the mother is added', () => {
    // It must be there first, or this test passes even if the gap is never reported at all.
    expect(missingOf(ilya.id)).toContain('secondParent')
    linkPeople(owner, 'mother', ilya.id, elena.id)
    expect(missingOf(ilya.id)).not.toContain('secondParent')
  })
})
