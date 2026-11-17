import { beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../lib/ops/core'

const owner: Actor = { userId: 'o', name: 'Owner', role: 'owner', personId: null }
const editor: Actor = { userId: 'e', name: 'Editor', role: 'editor', personId: null }

let people: typeof import('../lib/ops/people')
let settings: typeof import('../lib/ops/settings')
let core: typeof import('../lib/ops/core')
let gedcom: typeof import('../lib/ops/gedcom')

beforeAll(async () => {
  ;[people, settings, core, gedcom] = await Promise.all([import('../lib/ops/people'), import('../lib/ops/settings'), import('../lib/ops/core'), import('../lib/ops/gedcom')])
})

const lastEntry = () => settings.listHistory(owner)[0]
const exists = (id: string) => { try { people.getPersonRow(id); return true } catch { return false } }

describe('rolling the archive back', () => {
  it('takes back the chosen change and every later one, newest first, and keeps what came before', () => {
    const before = people.createPerson(owner, { givenName: 'Раньше' })
    const a = people.createPerson(owner, { givenName: 'Точка' })
    const point = lastEntry().id
    people.updatePerson(editor, a.id, { birthDate: '1900' })
    const b = people.createPerson(editor, { givenName: 'Позже' })
    const { count } = core.rollbackTo(owner, point, 'rollback')
    expect(count).toBe(3)
    expect(exists(a.id)).toBe(false)
    expect(exists(b.id)).toBe(false)
    expect(exists(before.id)).toBe(true)
  })

  it('is the owner\'s alone', () => {
    people.createPerson(owner, { givenName: 'Никто' })
    expect(() => core.rollbackTo(editor, lastEntry().id, 'rollback')).toThrow('only the owner')
  })

  it('takes back one person of an import and leaves the others', () => {
    const ged = '0 HEAD\n0 @I1@ INDI\n1 NAME Первый /Импорт/\n0 @I2@ INDI\n1 NAME Второй /Импорт/\n0 TRLR\n'
    gedcom.importGedcom(owner, ged, 'add')
    const entry = lastEntry()
    expect(entry.summary).toMatch(/новых: 2|new: 2/)
    const ids = entry.personIds
    expect(ids).toHaveLength(2)
    const res = core.undoPart(owner, entry.id, ids[0], 'part')
    expect(res.undone).toBe(false)
    expect(exists(ids[0])).toBe(false)
    expect(exists(ids[1])).toBe(true)
    // The rest of the entry can still be taken back.
    expect(core.undoPart(owner, entry.id, ids[1], 'part').undone).toBe(true)
    expect(exists(ids[1])).toBe(false)
  })
})
