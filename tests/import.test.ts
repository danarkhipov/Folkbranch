// A spreadsheet keeps where a person lived as a place and a year, sometimes several of them in one row.
// These tests guard that the import takes them as residence facts, keeps a period as written, and says
// plainly which places the map will not have and which columns it could not read.
import { beforeAll, describe, expect, it } from 'vitest'
import { COLUMN_FIELDS, guessMapping, parseCsv, rowsToText } from '../lib/import-formats'
import { placesOffMap } from '../lib/places'
import { parseFamilyText, planFamilyText } from '../lib/textformat'
import type { Actor } from '../lib/ops/core'
import type { Graph, Place } from '../lib/types'

const owner: Actor = { userId: 'o', name: 'Owner', role: 'owner', personId: null }
const empty = { persons: [], parentChild: [], unions: [] } as Graph
const place = (name: string, lat: number | null = null, lon: number | null = null): Place => ({ id: name, name, kind: 'town', parentId: null, otherNames: [], lat, lon, note: '' })
const planOf = (text: string) => planFamilyText(parseFamilyText(text), empty)

let people: typeof import('../lib/ops/people')
let proposals: typeof import('../lib/ops/proposals')
let tokens: typeof import('../lib/ops/tokens')
let core: typeof import('../lib/ops/core')
beforeAll(async () => {
  ;[people, proposals, tokens, core] = await Promise.all([import('../lib/ops/people'), import('../lib/ops/proposals'), import('../lib/ops/tokens'), import('../lib/ops/core')])
})

describe('a table of where people lived', () => {
  it('turns every place lived into a residence fact on that person, through review and undo', async () => {
    const headers = ['Имя', 'Где жил', 'Год', 'Место жительства', 'Год 2']
    const rows = [['Анна Тестова', 'Тула', '1941–1944', 'Москва', '1946'], ['Иван Тестов', 'Тула', '1938', '', '']]
    const mapping = guessMapping(headers)
    expect(mapping).toEqual(['given', 'residencePlace', 'residenceDate', 'residencePlace2', 'residenceDate2'])
    // The picker offers both columns, and a second pair for a second move.
    expect(COLUMN_FIELDS.map(([f]) => f)).toEqual(expect.arrayContaining(['residencePlace', 'residenceDate', 'residencePlace2', 'residenceDate2']))
    expect(guessMapping(['Имя', 'Где жил 1', 'Год 1', 'Где жил 2', 'Год 2'])).toEqual(['given', 'residencePlace', 'residenceDate', 'residencePlace2', 'residenceDate2'])
    expect(guessMapping(['Имя', 'Residencia', 'Año'])).toEqual(['given', 'residencePlace', 'residenceDate'])
    expect(guessMapping(['Nom', 'Residència', 'Any'])).toEqual(['given', 'residencePlace', 'residenceDate'])
    const { text } = rowsToText(rows, mapping, 'Тестовы', headers)

    // A reviewer's import waits for the owner first; nothing reaches the archive before that.
    const { token } = tokens.createToken(owner, { name: 'table-reviewer', role: 'editor', review: true })
    const draft = await proposals.dispatch(tokens.actorFromToken(token)!, 'import_text', { text })
    expect(draft.status).toBe('pending_review')
    expect(people.getGraph(owner).persons.find((p) => p.givenName === 'Анна')).toBeUndefined()

    const imported = proposals.acceptProposal(owner, draft.proposalId!)
    const g = people.getGraph(owner)
    const anna = g.persons.find((p) => p.givenName === 'Анна')!
    const ivan = g.persons.find((p) => p.givenName === 'Иван')!
    expect(anna.facts).toEqual([
      { kind: 'Место жительства', date: '1941–1944', place: 'Тула', note: '' },
      { kind: 'Место жительства', date: '1946', place: 'Москва', note: '' },
    ])
    expect(ivan.facts).toEqual([{ kind: 'Место жительства', date: '1938', place: 'Тула', note: '' }])

    // The import stays one change: undoing it takes the people and their residences away together.
    core.undo(owner, imported.historyId!, 'undo')
    expect(people.getGraph(owner).persons.find((p) => p.givenName === 'Анна')).toBeUndefined()
  })

  it('adds a residence to someone already in the archive and keeps an edit made while the import waited for review', async () => {
    const { id } = people.createPerson(owner, { givenName: 'Ольга', surname: 'Ждущая', facts: [{ kind: 'Occupation', date: '1930', place: '', note: '' }] }) as { id: string }
    const { token } = tokens.createToken(owner, { name: 'late-reviewer', role: 'editor', review: true })
    const draft = await proposals.dispatch(tokens.actorFromToken(token)!, 'import_text', { text: 'family Ждущие\n\nОльга Ждущая resi: Тула, resiDate: 1941\n' })
    expect(draft.status).toBe('pending_review')
    // Meanwhile a relative writes another fact on her card.
    const now = people.getGraph(owner).persons.find((p) => p.id === id)!
    people.updatePerson(owner, id, { facts: [...now.facts, { kind: 'Service', date: '1942', place: '', note: '' }] })
    proposals.acceptProposal(owner, draft.proposalId!)
    const after = people.getGraph(owner).persons.find((p) => p.id === id)!
    expect(after.facts.map((f) => f.kind)).toEqual(['Occupation', 'Service', 'Место жительства'])
  })

  it('keeps a period of residence exactly as the file wrote it', () => {
    const text = rowsToText([['Анна Периодова', 'с 1941 по 1944', 'с. Верхнее']], ['name', 'residenceDate', 'residencePlace']).text
    const person = planOf(text).ops[0].args.person as { facts: unknown[] }
    expect(person.facts).toEqual([{ kind: 'Место жительства', date: 'с 1941 по 1944', place: 'с. Верхнее', note: '' }])
    // A period is one fact, not two years, and it is not rewritten into another date style.
    expect(parseCsv('Имя;Где жил;Год\nАнна;Верхнее;1941–1944').at(-1)![2]).toBe('1941–1944')
  })

  it('names the places from the file that will not be on the map, once each', () => {
    const archive = [place('Тула', 54.19, 37.61), place('Новосёлки')]
    expect(placesOffMap(['Тула', 'Новосёлки', 'Новосёлки', 'Тмутаракань', 'тула', ''], archive)).toEqual(['Новосёлки', 'Тмутаракань'])
  })

  it('warns by name about a column it could not use instead of dropping it in silence', () => {
    const headers = ['Имя', 'Где жил', 'Цвет глаз']
    const mapping = guessMapping(headers)
    expect(mapping).toEqual(['given', 'residencePlace', ''])
    const said = rowsToText([['Анна Тестова', 'Тула', 'серые']], mapping, '', headers).warnings.map((w) => `${w.key} ${w.detail ?? ''}`).join(' ')
    expect(said).toContain('Цвет глаз')
    expect(said).not.toContain('Где жил')
  })
})
