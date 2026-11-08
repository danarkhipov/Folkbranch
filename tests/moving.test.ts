// Moving from Gramps or webtrees: invented families written the way those programs write them. What comes across,
// and the little that does not, which the preview names before anything changes.
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseGedcom, unreadTags, writeGedcom } from '../lib/gedcom'

const file = (name: string) => fs.readFileSync(`tests/fixtures/moving/${name}.ged`, 'utf8')

describe('from Gramps', () => {
  const g = parseGedcom(file('gramps'))
  const [petr, anna] = g.persons
  it('keeps names, the patronymic, the surname from birth, and dates in any form', () => {
    expect(petr).toMatchObject({ givenName: 'Пётр', patronymic: 'Иванович', surname: 'Миронов', birthDate: '12.03.1890', deathDate: '~1950', deathPlace: 'Москва' })
    expect(anna).toMatchObject({ givenName: 'Анна', surname: 'Миронова', maidenName: 'Котова', birthDate: '1892–1894' })
  })
  it('keeps baptism, occupation and burial as facts, and the shared note', () => {
    expect(petr.facts.map((f) => f.kind)).toEqual(expect.arrayContaining(['Крещение', 'Профессия', 'Погребение']))
    expect(petr.notes.join(' ')).toContain('Работал плотником')
  })
  it('keeps the source with its archive and sheet, and how sure it is', () => {
    expect(petr.sources[0]).toMatchObject({ title: 'Метрическая книга Воскресенской церкви (Государственный архив Тверской области)', page: '15' })
    expect(petr.quality).toBe(3)
  })
  it('keeps both families, with the date and place of the marriage', () => {
    expect(g.families[0]).toMatchObject({ date: '1915', place: 'Тверь', children: [{ xref: '@I0002@', adopted: false }] })
  })
  it('leaves nothing unread', () => {
    expect(unreadTags(file('gramps'))).toEqual([])
  })
})

describe('from webtrees', () => {
  const g = parseGedcom(file('webtrees'))
  const [ivan, maria, pavel] = g.persons
  it('keeps a period of residence as a period', () => {
    expect(ivan.facts.find((f) => f.kind === 'Место жительства')).toMatchObject({ date: '1900–1910', place: 'Петербург' })
  })
  it('keeps someone marked private as private', () => {
    expect(maria.keepPrivate).toBe(true)
    expect(ivan.keepPrivate).toBe(false)
  })
  it('keeps a godfather as a fact naming him, and a divorce as the end of the marriage', () => {
    expect(pavel.facts).toContainEqual({ kind: 'Крёстный отец', date: '', place: '', note: 'Иван Лесков' })
    expect(g.families[0]).toMatchObject({ date: '1903', end: '1912' })
  })
  it('says before importing that photos do not come across', () => {
    expect(unreadTags(file('webtrees'))).toEqual([{ tag: 'OBJE', count: 1 }])
  })
})

describe('and back out again', () => {
  it('writes the private mark so another program keeps it', () => {
    const g = parseGedcom(file('webtrees'))
    const out = writeGedcom({ persons: g.persons.map((p, i) => ({ id: p.xref, givenName: p.givenName, surname: p.surname, maidenName: p.maidenName, patronymic: p.patronymic, otherNames: p.otherNames, sex: p.sex, birthDate: p.birthDate, birthYear: null, birthPlace: p.birthPlace, deathDate: p.deathDate, deathYear: null, deathPlace: p.deathPlace, living: false, keepPrivate: p.keepPrivate, certainty: 'documented', avatarMediaId: null, avatarCrop: null, updatedAt: i, tags: [], facts: p.facts, sources: p.sources, claims: [] })), parentChild: [], unions: [] }, { hideLiving: false, source: 'test' })
    expect(parseGedcom(out).persons.find((p) => p.surname === 'Лескова')?.keepPrivate).toBe(true)
  })
})
