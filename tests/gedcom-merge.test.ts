// A file loaded into a tree that already has people: added beside, folded in, or put in place of it.
import { describe, expect, it } from 'vitest'
import { getDb, schema } from '../lib/db'
import type { Actor } from '../lib/ops/core'
import { importGedcom, previewGedcom } from '../lib/ops/gedcom'
import * as people from '../lib/ops/people'

const owner: Actor = { userId: 'o', name: 'Owner', role: 'owner', personId: null }
const editor: Actor = { userId: 'e', name: 'Ed', role: 'editor', personId: null }
const ged = (extra = '') => `0 HEAD
0 @I1@ INDI
1 NAME Пётр /Слияев/
1 SEX M
1 BIRT
2 DATE 1880
2 PLAC Кострома
1 FAMS @F1@
0 @I2@ INDI
1 NAME Анна /Слияева/
1 SEX F
1 FAMS @F1@
0 @I3@ INDI
1 NAME Мария /Слияева/
1 SEX F
1 BIRT
2 DATE 1905
1 FAMC @F1@
${extra}0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
0 TRLR`
const all = () => getDb().select().from(schema.persons).all()
const links = () => getDb().select().from(schema.parentChild).all().length

describe('importing into a tree that already has people', () => {
  it('folds a person already here into one card and adds the rest, with no repeats', () => {
    const petr = people.createPerson(owner, { givenName: 'Пётр', surname: 'Слияев', sex: 'M', birthDate: '1880' })
    const preview = previewGedcom(owner, ged())
    expect(preview).toMatchObject({ matched: 1, added: 2 })
    expect(preview.pairs[0]).toMatchObject({ cardId: petr.id })
    importGedcom(owner, ged(), 'merge')
    expect(all().filter((p) => p.surname === 'Слияев')).toHaveLength(1)
    expect(all().filter((p) => p.surname === 'Слияева')).toHaveLength(2)
    // What the card lacked comes from the file; what it had stays.
    expect(people.getPersonRow(petr.id)).toMatchObject({ birthDate: '1880', birthPlace: 'Кострома' })
    expect(links()).toBe(2)
    // The same file again changes nothing.
    importGedcom(owner, ged(), 'merge')
    expect(all().filter((p) => p.surname.startsWith('Слияев'))).toHaveLength(3)
    expect(links()).toBe(2)
  })

  it('leaves a person alone when two cards fit equally well', () => {
    people.createPerson(owner, { givenName: 'Иван', surname: 'Двойной', sex: 'M' })
    people.createPerson(owner, { givenName: 'Иван', surname: 'Двойной', sex: 'M' })
    const text = '0 HEAD\n0 @I1@ INDI\n1 NAME Иван /Двойной/\n1 SEX M\n0 TRLR'
    expect(previewGedcom(owner, text)).toMatchObject({ matched: 0, added: 1 })
  })

  it('replaces the whole tree, and only for the owner', () => {
    const before = all().length
    expect(() => importGedcom(editor, ged(), 'replace')).toThrow()
    importGedcom(owner, ged('').replace('Слияев', 'Новый'), 'replace')
    expect(all().length).toBe(3)
    expect(all().every((p) => p.surname.startsWith('Нов') || p.surname === 'Слияева')).toBe(true)
    expect(before).toBeGreaterThan(3)
  })
})
