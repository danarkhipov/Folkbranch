// "La esposa de Iván", "l'avi d'en Joan": who is whose, asked in Spanish and Catalan. Russian and English are in search.test.ts.
import { beforeAll, describe, expect, it } from 'vitest'
import { setSetting } from '../lib/ops/app-config'
import type { Actor } from '../lib/ops/core'
import { createPerson, linkPeople } from '../lib/ops/people'
import { searchPeople } from '../lib/ops/people-search'

const owner: Actor = { userId: 'u-relation-owner', name: 'Laia', role: 'owner', personId: null }
// An invented family: Jordi and Montse, their children Iván, Ana and Anna; Iván and Laia, their children Juan, María and Joan.
const id: Record<string, string> = {}
beforeAll(() => {
  const add = (key: string, givenName: string, surname: string, sex: 'M' | 'F') => { id[key] = createPerson(owner, { givenName, surname, sex }).id }
  add('jordi', 'Jordi', 'Vidal', 'M'); add('montse', 'Montse', 'Pons', 'F')
  add('ivan', 'Iván', 'Vidal', 'M'); add('ana', 'Ana', 'Vidal', 'F'); add('anna', 'Anna', 'Vidal', 'F')
  add('laia', 'Laia', 'Roca', 'F')
  add('juan', 'Juan', 'Vidal', 'M'); add('maria', 'María', 'Vidal', 'F'); add('joan', 'Joan', 'Vidal', 'M')
  linkPeople(owner, 'spouse', id.jordi, id.montse)
  for (const c of ['ivan', 'ana', 'anna']) linkPeople(owner, c === 'ivan' ? 'son' : 'daughter', id.jordi, id[c], id.montse)
  linkPeople(owner, 'spouse', id.ivan, id.laia)
  for (const c of ['juan', 'maria', 'joan']) linkPeople(owner, c === 'maria' ? 'daughter' : 'son', id.ivan, id[c], id.laia)
})

const nameOf = (pid: string) => Object.entries(id).find(([, v]) => v === pid)?.[0]
/** Only the people the search found as someone's relative. */
const related = (query: string) => searchPeople(owner, query).filter((r) => r.matches.some((m) => m.key === 'relation')).map((r) => nameOf(r.personId)).sort()

describe('who is whose, in Spanish', () => {
  it('reads the phrase the search hint shows', () => {
    setSetting('language', 'es')
    expect(related('la esposa de Iván')).toEqual(['laia'])
  })

  it('takes the article or leaves it, and "de" or "del"', () => {
    setSetting('language', 'es')
    expect(related('el padre de Ana')).toEqual(['jordi'])
    expect(related('la madre de Juan')).toEqual(['laia'])
    expect(related('el abuelo de María')).toEqual(['jordi'])
    expect(related('esposa de Ivan')).toEqual(['laia'])
    expect(related('la mujer del Iván')).toEqual(['laia'])
    expect(related('el marido de Laia')).toEqual(['ivan'])
    expect(related('el esposo de Laia')).toEqual(['ivan'])
  })

  it('knows the relatives the English knows', () => {
    setSetting('language', 'es')
    expect(related('los padres de Iván')).toEqual(['jordi', 'montse'])
    expect(related('el hijo de Laia')).toEqual(['joan', 'juan'])
    expect(related('la hija de Laia')).toEqual(['maria'])
    expect(related('los hijos de Laia')).toEqual(['joan', 'juan', 'maria'])
    expect(related('el hermano de Ana')).toEqual(['ivan'])
    expect(related('la hermana de Iván')).toEqual(['ana', 'anna'])
    expect(related('el nieto de Montse')).toEqual(['joan', 'juan'])
    expect(related('la nieta de Montse')).toEqual(['maria'])
    expect(related('la abuela de Juan')).toEqual(['montse'])
  })
})

describe('who is whose, in Catalan', () => {
  it('reads the phrase the search hint shows', () => {
    setSetting('language', 'ca')
    expect(related("la dona de l'Ivan")).toEqual(['laia'])
  })

  it('takes the personal articles en, na, el, la and l\', and "de" or "d\'"', () => {
    setSetting('language', 'ca')
    expect(related("el pare de l'Anna")).toEqual(['jordi'])
    expect(related('la mare de la Maria')).toEqual(['laia'])
    expect(related("l'avi d'en Joan")).toEqual(['jordi'])
    expect(related('l’avi d’en Joan')).toEqual(['jordi'])
    expect(related('la muller de l’Ivan')).toEqual(['laia'])
    expect(related("esposa de l'Ivan")).toEqual(['laia'])
    expect(related('el marit de na Laia')).toEqual(['ivan'])
    expect(related("l'espòs de la Laia")).toEqual(['ivan'])
    expect(related('el home de la Laia')).toEqual(['ivan'])
  })

  it('knows the relatives the English knows', () => {
    setSetting('language', 'ca')
    expect(related("els pares de l'Ivan")).toEqual(['jordi', 'montse'])
    expect(related('el fill de la Laia')).toEqual(['joan', 'juan'])
    expect(related('la filla de la Laia')).toEqual(['maria'])
    expect(related('els fills de la Laia')).toEqual(['joan', 'juan', 'maria'])
    expect(related('el germà de la Ana')).toEqual(['ivan'])
    expect(related("la germana de l'Ivan")).toEqual(['ana', 'anna'])
    expect(related('el nét de la Montse')).toEqual(['joan', 'juan'])
    expect(related('la néta de la Montse')).toEqual(['maria'])
    expect(related("l'àvia d'en Joan")).toEqual(['montse'])
  })
})

describe('a Russian or English archive', () => {
  it('reads these phrases as before: as names, not as who is whose', () => {
    setSetting('language', 'en')
    expect(related('la esposa de Iván')).toEqual([])
    expect(related("la dona de l'Ivan")).toEqual([])
    setSetting('language', 'ru')
    expect(related('la esposa de Iván')).toEqual([])
  })
})
