// What the archive now records besides names and dates, and who may see it.
import { beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../lib/ops/core'
import { parseGedcom, writeGedcom } from '../lib/gedcom'
import { findPlace, placeChain, placeWords } from '../lib/places'

const owner: Actor = { userId: 'o', name: 'Owner', role: 'owner', personId: null }
const reader: Actor = { userId: 'r', name: 'Reader', role: 'reader', personId: null }
const token: Actor = { userId: 'o', name: 'Agent', role: 'editor', personId: null, tokenId: 't' }

let people: typeof import('../lib/ops/people')
let places: typeof import('../lib/ops/places')
let contacts: typeof import('../lib/ops/contacts')
let gedcom: typeof import('../lib/ops/gedcom')
let file: typeof import('../lib/ops/family-file')
let search: typeof import('../lib/ops/search')
let db: typeof import('../lib/db')
const id = { child: '', godfather: '', living: '' }

beforeAll(async () => {
  people = await import('../lib/ops/people')
  places = await import('../lib/ops/places')
  contacts = await import('../lib/ops/contacts')
  gedcom = await import('../lib/ops/gedcom')
  file = await import('../lib/ops/family-file')
  search = await import('../lib/ops/search')
  db = await import('../lib/db')
  id.living = people.createPerson(owner, { givenName: 'Живой', surname: 'Кум', birthDate: '1960', living: true }).id
  id.godfather = people.createPerson(owner, { givenName: 'Степан', surname: 'Крёстный', birthDate: '1880', deathDate: '1950', living: false }).id
  id.child = people.createPerson(owner, { givenName: 'Ефим', surname: 'Крещёный', birthDate: '1910', birthPlace: 'Калинин', deathDate: '1980', living: false, noChildren: true }).id
  people.updatePerson(owner, id.child, { facts: [
    { kind: 'Крещение', date: '1910', place: 'Калинин', note: '', people: [{ personId: id.godfather, name: 'Степан Крёстный', role: 'Крёстный отец' }, { personId: id.living, name: 'Живой Кум', role: 'Свидетель' }, { personId: null, name: 'о. Иоанн', role: 'Священник' }] },
    { kind: 'Воинская служба', date: '1941', place: '', note: '', fields: { 'Часть': '112 стрелковый полк', 'Звание': 'сержант' } },
  ] })
})

describe('facts with fields and the people at them', () => {
  it('keep a unit, a rank, a godparent and the priest', () => {
    const p = people.getGraph(owner).persons.find((x) => x.id === id.child)!
    expect(p.facts[1].fields).toEqual({ 'Часть': '112 стрелковый полк', 'Звание': 'сержант' })
    expect(p.facts[0].people!.map((x) => x.role)).toEqual(['Крёстный отец', 'Свидетель', 'Священник'])
    expect(p.noChildren).toBe(true)
  })
  it('never name someone living to a reader, even as a witness at another person\'s baptism', () => {
    const p = people.getGraph(reader).persons.find((x) => x.id === id.child)!
    const witness = p.facts[0].people!.find((x) => x.role === 'Свидетель')!
    expect(witness).toEqual({ personId: null, name: '', role: 'Свидетель' })
    expect(p.facts[0].people!.find((x) => x.role === 'Крёстный отец')!.name).toBe('Степан Крёстный')
    expect(JSON.stringify(people.getGraph(reader))).not.toContain('Живой Кум')
  })
  it('are found by search, as written', () => {
    expect(search.findPeople(owner, '112 стрелковый', 10).map((p) => p.id)).toContain(id.child)
  })
})

describe('places', () => {
  it('know what they belong to and their old names, and find people by them', () => {
    const gub = places.savePlace(owner, null, { name: 'Тверская губерния', kind: 'Губерния' }).id
    const town = places.savePlace(owner, null, { name: 'Тверь', kind: 'Город', parentId: gub, otherNames: [{ name: 'Калинин', years: '1931–1990' }] }).id
    const all = places.listPlaces(owner)
    expect(findPlace('Калинин', all)?.id).toBe(town)
    expect(placeChain(findPlace('Калинин', all)!, all).map((p) => p.name)).toEqual(['Тверь', 'Тверская губерния'])
    expect(placeWords('Калинин', all)).toContain('Тверская губерния')
    expect(search.findPeople(owner, 'Тверь', 10).map((p) => p.id)).toContain(id.child)
    expect(() => places.savePlace(owner, gub, { name: 'Тверская губерния', parentId: town })).toThrow('inside itself')
  })
  it('are the editors\' to change, and a deleted place hands its villages up', () => {
    expect(() => places.savePlace(reader, null, { name: 'Нет' })).toThrow()
    const top = places.savePlace(owner, null, { name: 'Уезд' }).id
    const mid = places.savePlace(owner, null, { name: 'Волость', parentId: top }).id
    const low = places.savePlace(owner, null, { name: 'Деревня', parentId: mid }).id
    places.deletePlace(owner, mid)
    expect(places.listPlaces(owner).find((p) => p.id === low)?.parentId).toBe(top)
  })
})

describe('archives', () => {
  it('are kept once and named by sources', () => {
    const repo = places.saveRepository(owner, null, { name: 'ГАТО', url: 'https://example.org' }).id
    people.updatePerson(owner, id.child, { sources: [{ title: 'Метрическая книга', ref: 'ф. 160', page: '15', url: '', record: '№ 42', date: '1910', transcription: 'Крещён Ефим', repositoryId: repo }] })
    expect(places.listRepositories(owner)[0].name).toBe('ГАТО')
    expect(people.getGraph(owner).persons.find((p) => p.id === id.child)!.sources[0]).toMatchObject({ record: '№ 42', transcription: 'Крещён Ефим', repositoryId: repo })
  })
})

describe('contacts of the living', () => {
  it('are kept for editors, and refused to readers and to keys', () => {
    contacts.saveContacts(owner, id.living, { phone: '+7 000 000-00-00', email: 'kum@example.org' })
    expect(contacts.getContacts(owner, id.living).phone).toBe('+7 000 000-00-00')
    expect(() => contacts.getContacts(reader, id.living)).toThrow()
    expect(() => contacts.getContacts(token, id.living)).toThrow()
  })
  it('never reach the graph, GEDCOM or the file for relatives', async () => {
    expect(JSON.stringify(people.getGraph(owner))).not.toContain('kum@example.org')
    expect(gedcom.exportGedcom(owner, false)).not.toContain('kum@example.org')
    expect((await file.buildFamilyFile(owner)).html).not.toContain('kum@example.org')
  })
  it('go with the person', () => {
    people.deletePerson(owner, id.living)
    expect(db.getDb().select().from(db.schema.contacts).all()).toHaveLength(0)
  })
})

describe('in GEDCOM', () => {
  it('says "no children" and "never married", and puts godparents with a card under the event', () => {
    const g = people.getGraph(owner)
    const out = writeGedcom(g, { hideLiving: false, source: 'test' })
    expect(out).toContain('1 NCHI 0')
    expect(out).toMatch(/2 ASSO @I\d+@\n3 ROLE OTHER\n4 PHRASE Крёстный отец/)
    expect(out).toContain('Часть: 112 стрелковый полк')
    const back = parseGedcom(out).persons.find((p) => p.surname === 'Крещёный')!
    expect(back.noChildren).toBe(true)
    expect(back.facts.find((f) => f.kind === 'Крещение')!.people![0]).toMatchObject({ name: 'Степан Крёстный', role: 'Крёстный отец' })
  })
})
