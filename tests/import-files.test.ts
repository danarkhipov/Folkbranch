import { describe, expect, it } from 'vitest'
import { matchFiles, splitDropped } from '../lib/import-files'

const people = [
  { xref: '@P001@', name: 'Даниил Павлович Архипов' },
  { xref: '@P002@', name: 'Павел Анатольевич Архипов' },
  { xref: '@P003@', name: 'Елена Армиевна Айтджанова' },
  { xref: '@I12@', name: 'Мария Иванова' },
]
const how = (name: string, links: { xref: string; file: string }[] = []) => matchFiles([{ name }], people, links)[0]

describe('files that come with a tree', () => {
  it('goes by what the tree says first, whatever the folder', () => {
    expect(how('wedding.jpg', [{ xref: '@P003@', file: 'C:\\old\\scans\\Wedding.JPG' }])).toMatchObject({ xrefs: ['@P003@'], how: 'link' })
  })
  it('one file linked from two people goes to both', () => {
    expect(how('group.jpg', [{ xref: '@P001@', file: 'group.jpg' }, { xref: '@P002@', file: 'photos/group.jpg' }]).xrefs).toEqual(['@P001@', '@P002@'])
  })
  it('reads a person number in the name', () => {
    expect(how('P002_1985.jpg')).toMatchObject({ xrefs: ['@P002@'], how: 'id' })
    expect(how('i12-passport.pdf')).toMatchObject({ xrefs: ['@I12@'], how: 'id' })
    expect(how('P9999.jpg').how).toBeNull()
  })
  it('reads a person name in the name, but not when two people fit', () => {
    expect(how('Елена Айтджанова 1990.jpg')).toMatchObject({ xrefs: ['@P003@'], how: 'name' })
    expect(how('Архипов Даниил.jpg')).toMatchObject({ xrefs: ['@P001@'], how: 'name' })
    expect(how('Архипов.jpg').how).toBeNull()
  })
  it('in a Spanish or Catalan archive, reads a name without its accents, as files are often named', () => {
    const family = [{ xref: '@I1@', name: 'Inés Peñalver' }, { xref: '@I2@', name: 'Lluís Gonçal' }, { xref: '@I3@', name: 'José García' }]
    for (const lang of ['es', 'ca'] as const) {
      expect(matchFiles([{ name: 'ines_penalver_1950.jpg' }], family, [], lang)[0]).toMatchObject({ xrefs: ['@I1@'], how: 'name' })
      expect(matchFiles([{ name: 'Lluis Goncal.jpg' }], family, [], lang)[0]).toMatchObject({ xrefs: ['@I2@'], how: 'name' })
      expect(matchFiles([{ name: 'García José.pdf' }], family, [], lang)[0]).toMatchObject({ xrefs: ['@I3@'], how: 'name' })
    }
    // A Russian or English archive reads names as before.
    for (const lang of ['ru', 'en', undefined] as const) expect(matchFiles([{ name: 'ines_penalver_1950.jpg' }], family, [], lang)[0].how).toBeNull()
  })
  it('leaves a file nobody claims', () => {
    expect(how('IMG_2041.jpg')).toMatchObject({ xrefs: [], how: null })
  })
  it('takes the tree from the dropped files and the rest as what goes with it', () => {
    const f = (n: string) => new File(['x'], n)
    const { tree, rest } = splitDropped([f('a.jpg'), f('family.ged'), f('b.pdf'), f('notes.txt')])
    expect(tree?.name).toBe('family.ged')
    expect(rest.map((x) => x.name)).toEqual(['a.jpg', 'b.pdf', 'notes.txt'])
  })
})
