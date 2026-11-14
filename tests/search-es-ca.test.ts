// Searching a Spanish or Catalan family: accents typed or not, little words, "nació" and "va morir".
import { describe, expect, it } from 'vitest'
import { buildIndex, search, type SearchDoc } from '../lib/search/engine'
import { normal } from '../lib/search/words'

// An invented family.
const doc = (id: string, given: string, surname: string, birthPlace: string, deathPlace: string, birthDate = '', deathDate = ''): SearchDoc => ({
  id,
  fields: [
    { key: 'givenName', label: 'Nombre', text: given, tab: 'details', weight: 1 },
    { key: 'surname', label: 'Apellidos', text: surname, tab: 'details', weight: 1 },
    { key: 'birthPlace', label: 'Lugar de nacimiento', text: birthPlace, tab: 'details', weight: 0.8 },
    { key: 'deathPlace', label: 'Lugar de defunción', text: deathPlace, tab: 'details', weight: 0.8 },
    { key: 'birthDate', label: 'Fecha de nacimiento', text: birthDate, tab: 'details', weight: 0.8 },
    { key: 'deathDate', label: 'Fecha de defunción', text: deathDate, tab: 'details', weight: 0.8 },
  ],
})
const index = buildIndex([
  doc('ines', 'Inés', 'Peñalver Ruiz', 'Lleida', 'Tarragona', '12 de marzo de 1890', '1961'),
  doc('jordi', 'Jordi', 'Puigdomènech', 'Tarragona', 'Lleida', "5 d'abril de 1931"),
  doc('lluis', 'Lluís', 'Castañer', 'Girona', 'Girona', '1920'),
])
const first = (q: string, lang: 'es' | 'ca' = 'es') => search(index, q, 30, lang)[0]?.personId

describe('search in a Spanish or Catalan archive', () => {
  it('finds a name with or without its accents', () => {
    expect(first('ines')).toBe('ines')
    expect(first('Penalver')).toBe('ines')
    expect(first('puigdomenech')).toBe('jordi')
    expect(first('Lluis Castaner')).toBe('lluis')
  })

  it('keeps every letter where it was, so a match is marked in the right place', () => {
    for (const s of ['Inés Peñalver', 'Puigdomènech', 'Lluís', 'Ça va']) expect(normal(s)).toHaveLength(s.length)
    expect(normal('Ёлка')).toBe('елка')
  })

  it('reads "nació en" and "murió en" as a birth and a death place', () => {
    expect(first('nació en Lleida')).toBe('ines')
    expect(first('murió en Lleida')).toBe('jordi')
    expect(first('va néixer a Tarragona', 'ca')).toBe('jordi')
    expect(first('mort a Tarragona', 'ca')).toBe('ines')
  })

  it('finds a written-out date', () => {
    expect(first('12 de marzo de 1890')).toBe('ines')
    expect(first("5 d'abril de 1931", 'ca')).toBe('jordi')
  })
})

describe('search in a Russian or English archive', () => {
  // An invented pair: only the given name tells them apart.
  const two = buildIndex([doc('al', 'Al', 'Pérez', 'Lleida', ''), doc('ana', 'Ana', 'Pérez', 'Lleida', '')])
  it('keeps the words Spanish and Catalan leave out, as before: "Al" is a name', () => {
    for (const lang of ['ru', 'en'] as const) expect(search(two, 'al perez', 30, lang).map((r) => r.personId)).toEqual(['al'])
    // In Spanish "al" is "to the", and both are a Pérez.
    expect(search(two, 'al perez', 30, 'es').map((r) => r.personId).sort()).toEqual(['al', 'ana'])
  })
})
