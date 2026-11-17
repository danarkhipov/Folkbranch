// Gramps' own XML keeps what its GEDCOM loses: place names with their years, what a place is part of, and points.
// The family and places in the fixture are invented.
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { desc } from 'drizzle-orm'
import { getDb, schema } from '../lib/db'
import { type Actor, undo } from '../lib/ops/core'
import { exportGedcom, importGedcom, previewGedcom } from '../lib/ops/gedcom'
import { getGraph } from '../lib/ops/people'
import { listPlaces, savePlace } from '../lib/ops/places'
import { grampsDate, grampsPoint, parseGramps, parseXml } from '../lib/gramps'
import { detectKind, isGrampsXml } from '../lib/import-formats'
import { findPlace } from '../lib/places'

const owner: Actor = { userId: 'o', name: 'Owner', role: 'owner', personId: null }
const FILE = fs.readFileSync('tests/fixtures/moving/family.gramps', 'utf8')

describe('reading Gramps XML', () => {
  const g = parseGramps(FILE)
  const who = (given: string) => g.persons.find((p) => p.givenName === given)!

  it('is told from GEDCOM by its name or its first lines', () => {
    expect(detectKind('family.gramps', '\x1f\x8b')).toBe('gramps')
    expect(detectKind('export.xml', FILE.slice(0, 4000))).toBe('gramps')
    expect(detectKind('other.xml', '<?xml version="1.0"?><list/>')).not.toBe('gramps')
  })

  it('gives people their names, patronymic, married surname, dates and places as Gramps titles them', () => {
    expect(who('Тихон')).toMatchObject({ xref: 'I0001', patronymic: 'Саввич', surname: 'Мельников', otherNames: 'Тиша', sex: 'M', birthDate: '02.04.1885', birthPlace: 'Ольховка, Тихореченский уезд', deathDate: '~1950', dead: true, quality: 2 })
    expect(who('Тихон').notes).toEqual(['Держал мельницу на реке.'])
    expect(who('Тихон').facts).toContainEqual(expect.objectContaining({ kind: 'Профессия', note: 'Miller & baker' }))
    expect(who('Агафья')).toMatchObject({ surname: 'Мельникова', maidenName: 'Зорина', birthDate: '1888–1889', dead: false })
  })

  it('writes the place by the name it had in the year of the event, and keeps who stood as godparent', () => {
    const baptism = who('Ульяна').facts.find((f) => f.kind === 'Крещение')!
    expect(baptism).toMatchObject({ place: 'Старореченск, Тихореченский уезд', note: 'in the cathedral' })
    expect(baptism.people).toEqual([{ personId: 'I0001', name: 'Тихон Саввич Мельников', role: 'Крёстный отец' }])
  })

  it('links the marriage and the child', () => {
    expect(g.families).toEqual([{ husb: 'I0001', wife: 'I0002', children: [{ xref: 'I0003', adopted: false }], date: '06.1910', end: '', place: 'Ольховка, Тихореченский уезд', kind: 'marriage', hasEvent: true }])
  })

  it('lists every place parent first, with its point, kind and other names with years', () => {
    expect(g.places.map((p) => p.text)).toEqual(['Тихореченский уезд', 'Ольховка, Тихореченский уезд', 'Новоречье, Тихореченский уезд'])
    expect(g.places[0]).toMatchObject({ name: 'Тихореченский уезд', kind: 'Уезд', lat: null, lon: null, parent: undefined })
    expect(g.places[1]).toMatchObject({ name: 'Ольховка', kind: 'Деревня', lat: 51.25, lon: 40.5, parent: 'Тихореченский уезд' })
    expect(g.places[2]).toMatchObject({ name: 'Новоречье', lat: 52.25, lon: 41.5, otherNames: [{ name: 'Старореченск', years: '1780–1925' }] })
  })

  it('names what will not come across', () => {
    expect(g.unread).toEqual([{ tag: 'attribute', count: 1 }])
  })

  it('reads the date and point forms Gramps writes', () => {
    const date = (xml: string) => grampsDate(parseXml(`<e>${xml}</e>`).children[0])
    expect(date('<dateval val="1890-00-00" type="before"/>')).toBe('<1890')
    expect(date('<dateval val="1890" quality="estimated"/>')).toBe('~1890')
    expect(date('<datespan start="1900" stop="1910"/>')).toBe('1900–1910')
    expect(date('<datestr val="зимой"/>')).toBe('зимой')
    expect(grampsPoint('-33.86', '151.2')).toEqual({ lat: -33.86, lon: 151.2 })
    expect(grampsPoint('33°51\'36"S', '151°12\'E')).toEqual({ lat: -33.86, lon: 151.2 })
    expect(grampsPoint('0', '0')).toBeNull()
  })
})

describe('importing Gramps XML', () => {
  it('is previewed like a GEDCOM file', () => {
    expect(previewGedcom(owner, FILE)).toMatchObject({ format: 'gramps', persons: 3, families: 1, points: 2, unread: [{ tag: 'attribute', count: 1 }] })
  })

  it('makes the places with their hierarchy, keeps a point chosen here, and links the people', () => {
    savePlace(owner, null, { name: 'Новоречье', lat: 52.3, lon: 41.6 })
    const r = importGedcom(owner, FILE, 'add') as { places: Record<string, number> }
    expect(r.places).toEqual({ filled: 0, created: 2, kept: 1, ambiguous: 0 })
    const places = listPlaces(owner)
    const county = places.find((p) => p.name === 'Тихореченский уезд')!
    const village = places.find((p) => p.name === 'Ольховка')!
    const town = places.find((p) => p.name === 'Новоречье')!
    expect(village).toMatchObject({ parentId: county.id, kind: 'Деревня', lat: 51.25, lon: 40.5, note: expect.stringContaining('Gramps') })
    expect(town).toMatchObject({ parentId: county.id, lat: 52.3, lon: 41.6, otherNames: [{ name: 'Старореченск', years: '1780–1925' }] })
    // The old name an event was written with finds the town on the map.
    expect(findPlace('Старореченск, Тихореченский уезд', places)?.id).toBe(town.id)
    const graph = getGraph(owner)
    const child = graph.persons.find((p) => p.givenName === 'Ульяна')!
    expect(graph.parentChild.filter((l) => l.childId === child.id)).toHaveLength(2)
    expect(graph.unions).toHaveLength(1)
  })

  it('sends the points out again in a GEDCOM export', () => {
    expect(exportGedcom(owner, false)).toContain('2 PLAC Ольховка, Тихореченский уезд\n3 MAP\n4 LATI N51.25\n4 LONG E40.5')
  })

  it('is taken back, places and all, by one undo', () => {
    const last = getDb().select().from(schema.history).orderBy(desc(schema.history.at)).limit(1).get()!
    expect(last.summary).toContain('Gramps')
    undo(owner, last.id, 'undo')
    const names = listPlaces(owner).map((p) => p.name)
    expect(names).toEqual(['Новоречье'])
    expect(listPlaces(owner)[0].otherNames).toEqual([])
  })
})

describe('recognising a Gramps file by its first lines', () => {
  const NS = 'xmlns="http://gramps-project.org/xml/1.7.1/"'
  it('accepts the usual starts: a declaration, a doctype, comments, a byte-order mark, none of them', () => {
    expect(isGrampsXml(`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE database PUBLIC "x" "y">\n<database ${NS}>`)).toBe(true)
    expect(isGrampsXml(`\uFEFF<?xml version="1.0"?>\n<!-- made by Gramps -->\n<!-- again -->\n<database ${NS}>`)).toBe(true)
    expect(isGrampsXml(`<database ${NS}>`)).toBe(true)
  })
  it('refuses another XML, a GEDCOM and a table', () => {
    expect(isGrampsXml('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">')).toBe(false)
    expect(isGrampsXml('<database>no namespace</database>')).toBe(false)
    expect(isGrampsXml('0 HEAD\n1 CHAR UTF-8')).toBe(false)
    expect(isGrampsXml('name,born\nAnn,1900')).toBe(false)
  })
  it('answers at once on a crafted start made of comments, which the old regular expression could be kept busy with for minutes', () => {
    for (const text of ['<!-->'.repeat(400), '<!--' + ' -->'.repeat(300), '<!---->'.repeat(280) + 'x', ('<!-- -->' + ' '.repeat(5)).repeat(150) + 'x', '<!--'.repeat(500)]) {
      const t = Date.now()
      expect(isGrampsXml(text)).toBe(false)
      expect(Date.now() - t).toBeLessThan(100)
    }
  })
})
