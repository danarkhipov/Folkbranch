// The tag that remembers which research case a card came from is bookkeeping: searching must not turn it up.
import { describe, expect, it } from 'vitest'
import type { Actor } from '../lib/ops/core'
import { importCase } from '../lib/ops/kinship-case'
import { updatePerson, getGraph } from '../lib/ops/people'
import { searchPeople } from '../lib/ops/people-search'

const owner: Actor = { userId: 'o', name: 'Owner', role: 'owner', personId: null }

describe('searching a card from a research case', () => {
  it('finds the person, and groups people gave them, but not the case\'s tag', () => {
    importCase(owner, { caseId: 'поисковое-дело', persons: 'person_id,preferred_label,living_status,death_estimate,candidate_status\nP-0042,Ефросинья Искомая,deceased,1900,confirmed\n' })
    const person = getGraph(owner).persons.find((p) => p.surname === 'Искомая')!
    updatePerson(owner, person.id, { tags: [...person.tags, 'старообрядцы'] })
    expect(searchPeople(owner, 'Искомая').map((r) => r.personId)).toContain(person.id)
    expect(JSON.stringify(searchPeople(owner, 'Искомая'))).not.toContain('case:')
    expect(searchPeople(owner, 'P-0042').filter((r) => r.personId === person.id)).toEqual([])
    expect(searchPeople(owner, 'старообрядцы').map((r) => r.personId)).toContain(person.id)
  })
})
