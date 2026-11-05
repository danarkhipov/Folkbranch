import { beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../lib/ops/core'
import * as people from '../lib/ops/people'
import * as views from '../lib/ops/views'

const owner: Actor = { userId: 'o', name: 'О', role: 'owner', personId: null }
const reader: Actor = { userId: 'r', name: 'Р', role: 'reader', personId: null }
let living: string, dead: string

beforeAll(() => {
  living = (people.createPerson(owner, { givenName: 'Жива', surname: 'Я', living: true } as never) as unknown as { id: string }).id
  dead = (people.createPerson(owner, { givenName: 'Ушёл', surname: 'Он', living: false } as never) as unknown as { id: string }).id
})

describe('saved views', () => {
  const save = (name: string, focusId: string | null) => views.createView(owner, { name, scope: 'descendants', focusId, collapsed: [] })

  it('are saved and listed', () => {
    const { id } = save('Ветка ушедшего', dead)
    expect(views.listViews(owner).find((v) => v.id === id)).toMatchObject({ name: 'Ветка ушедшего', scope: 'descendants', focusId: dead })
  })

  it('a reader cannot save or change them', () => {
    expect(() => views.createView(reader, { name: 'x', scope: 'all', focusId: null, collapsed: [] })).toThrow()
    expect(() => views.setPin(reader, views.MAIN_VIEW, { personId: dead, x: 1 })).toThrow()
  })

  it('a reader does not get one built around someone hidden from them', () => {
    save('Ветка живой', living)
    const names = views.listViews(reader).map((v) => v.name)
    expect(names).toContain('Ветка ушедшего')
    expect(names).not.toContain('Ветка живой')
  })

  it('refuses nonsense', () => {
    expect(() => views.createView(owner, { name: '', scope: 'all', focusId: null, collapsed: [] })).toThrow()
    expect(() => views.createView(owner, { name: 'x', scope: 'evil', focusId: null, collapsed: [] })).toThrow()
    expect(() => views.setPin(owner, views.MAIN_VIEW, { personId: dead, x: 'far' })).toThrow()
    expect(() => views.setPin(owner, 'no-such-view', { personId: dead, x: 1 })).toThrow()
    expect(() => views.deleteView(owner, views.MAIN_VIEW)).toThrow()
  })
})

describe('placing by hand', () => {
  const main = () => views.listViews(owner).find((v) => v.id === views.MAIN_VIEW)

  it('the main chart gets its row on the first move, and two moves both stay', () => {
    views.setPin(owner, views.MAIN_VIEW, { personId: dead, x: 100 })
    views.setPin(owner, views.MAIN_VIEW, { personId: living, x: 200 })
    expect(main()?.pins).toEqual({ [dead]: 100, [living]: 200 })
  })

  it('letting one go leaves the other, and all can be let go', () => {
    views.setPin(owner, views.MAIN_VIEW, { personId: living, x: null })
    expect(main()?.pins).toEqual({ [dead]: 100 })
    views.clearPins(owner, views.MAIN_VIEW)
    expect(main()?.pins).toEqual({})
  })
})
