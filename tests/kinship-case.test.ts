// A research case keeps its rules in the archive: nothing unproved becomes a line, nobody unknown becomes dead.
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../lib/ops/core'
import { personInput } from '../lib/ops/op-defs'
import { caseTag, planCase, type CaseFiles } from '../lib/kinship-case'

const read = (f: string) => readFileSync(`tests/fixtures/kinship-case/${f}`, 'utf8')
const files: CaseFiles = { caseId: 'sokolov-2026', persons: read('person-register.csv'), relationships: read('relationship-register.csv'), claims: read('claims-register.csv'), artifacts: read('artifact-register.csv') }
const owner: Actor = { userId: 'o', name: 'Owner', role: 'owner', personId: null }

describe('a kinship case as a plan', () => {
  const plan = planCase(files)
  const by = (id: string) => plan.people.find((p) => p.caseId === id)!

  it('reads names in either order', () => {
    expect(by('P-001')).toMatchObject({ givenName: 'Иван', patronymic: 'Петрович', surname: 'Соколов', sex: 'M' })
    expect(by('P-002')).toMatchObject({ givenName: 'Анна', patronymic: 'Ивановна', surname: 'Соколова', sex: 'F' })
  })

  it('keeps out who the case rejected, and keeps a candidate apart', () => {
    expect(by('P-005')).toBeUndefined()
    expect(plan.leftOut).toEqual(['P-005'])
    expect(by('P-004').certainty).toBe('assumed')
    expect(by('P-004').facts[0].kind).toContain('Кандидат')
  })

  it('counts as living whoever is not known to be dead', () => {
    expect(by('P-003').living).toBe(true)
    expect(planCase({ caseId: 'x', persons: 'person_id,preferred_label,living_status,birth_estimate\nP-1,Анна Лис,presumed deceased,1950\nP-2,Ян Лис,,около 1881\n' }).people.map((p) => p.living)).toEqual([true, false])
    expect(by('P-001').living).toBe(false)
  })

  it('draws only what was established, however confident a hypothesis sounds', () => {
    expect(plan.parents.map((l) => `${l.parent}>${l.child}:${l.certainty}:${l.kind}`).sort()).toEqual(['P-001>P-003:documented:birth', 'P-002>P-003:documented:adopted'])
    expect(plan.unions).toEqual([{ a: 'P-001', b: 'P-002', kind: 'marriage', certainty: 'assumed' }])
    expect(plan.openRelations).toBe(1)
    expect(by('P-003').facts.some((f) => f.kind.startsWith('Возможная связь') && f.note.includes('Совпало только имя'))).toBe(true)
  })

  const relation = (type: string, status = 'corroborated') => planCase({
    caseId: 'x', persons: 'person_id,preferred_label,living_status\nP-1,Ян Лис,deceased\nP-2,Ева Лис,deceased\nP-3,Ада Лис,deceased\n',
    relationships: `relationship_id,person_a_id,relationship_type,person_b_id,status\nR-1,P-1,${type},P-2,${status}\n`,
  })

  it.each(['grandparent-of', 'grandchild-of', 'godfather', 'son-in-law', 'mother-in-law', 'great-grandson', 'крёстный отец', 'дедушка', 'sibling-of', 'possible-parent'])('a %s is a note, not a line', (type) => {
    const p = relation(type)
    expect(p.parents).toEqual([])
    expect(p.unions).toEqual([])
    expect(p.openRelations).toBe(1)
  })

  it.each([['parent-of', 'P-1', 'P-2'], ['father', 'P-1', 'P-2'], ['Мать', 'P-1', 'P-2'], ['child-of', 'P-2', 'P-1'], ['son_of', 'P-2', 'P-1'], ['дочь', 'P-2', 'P-1']])('%s draws the line the right way', (type, parent, child) => {
    expect(relation(type).parents).toMatchObject([{ parent, child, kind: 'birth' }])
  })

  it('reads a stepfather and an adoptive mother as what they are', () => {
    expect(relation('stepfather').parents[0].kind).toBe('step')
    expect(relation('adoptive-mother').parents[0].kind).toBe('adopted')
    expect(relation('spouse-of').unions).toHaveLength(1)
  })

  const many = (lines: string) => planCase({ caseId: 'x', persons: 'person_id,preferred_label,living_status\nP-1,Ян Лис,deceased\nP-2,Ева Лис,deceased\nP-3,Ада Лис,deceased\nP-4,Лев Кац,deceased\n', relationships: `relationship_id,person_a_id,relationship_type,person_b_id,status\n${lines}` })

  it('keeps a contradiction from reaching the chart', () => {
    const loop = many('R-1,P-1,parent-of,P-2,corroborated\nR-2,P-2,parent-of,P-3,corroborated\nR-3,P-3,parent-of,P-1,corroborated\n')
    expect(loop.parents).toHaveLength(2)
    expect(loop.openRelations).toBe(1)
    const both = many('R-1,P-1,parent-of,P-4,corroborated\nR-2,P-2,parent-of,P-4,corroborated\n')
    expect(both.unions).toEqual([{ a: 'P-1', b: 'P-2', kind: 'marriage', certainty: 'assumed' }])
    const three = many('R-1,P-1,parent-of,P-4,corroborated\nR-2,P-2,parent-of,P-4,corroborated\nR-3,P-3,parent-of,P-4,corroborated\n')
    expect(three.parents).toHaveLength(2)
    expect(three.openRelations).toBe(1)
    const marriage = many('R-1,P-1,parent-of,P-2,corroborated\nR-2,P-1,spouse,P-2,corroborated\n')
    expect(marriage.unions).toEqual([])
    expect(marriage.openRelations).toBe(1)
    expect(many('R-1,P-1,parent-of,P-9,corroborated\n').broken).toBe(1)
    expect(many('R-1,P-1,parent-of,P-2,contradicted\n').disputed).toEqual([{ a: 'P-1', b: 'P-2' }])
  })

  it('names who a note is about, but not somebody living', () => {
    const p = planCase({ caseId: 'x', persons: 'person_id,preferred_label,living_status\nP-1,Ян Лис,deceased\nP-2,Ева Лис,living\n', relationships: 'relationship_id,person_a_id,relationship_type,person_b_id,status\nR-1,P-1,parent-of,P-2,hypothesis\n' })
    const note = p.people[0].facts.at(-1)!.note
    expect(note).toContain('Ян Лис')
    expect(note).not.toContain('Ева')
    expect(note).toContain('P-2')
  })

  it('reads a surname written first, and guesses no sex from a surname', () => {
    expect(planCase({ caseId: 'x', persons: 'person_id,preferred_label\nP-1,Соколов Иван\nP-2,Иван Петрович Рабинович\nP-3,Костя Щербина\nP-4,Константин Кац\n' }).people.map((p) => [p.givenName, p.patronymic, p.surname, p.sex])).toEqual([
      ['Иван', '', 'Соколов', 'U'], ['Иван', 'Петрович', 'Рабинович', 'M'], ['Костя', '', 'Щербина', 'U'], ['Константин', '', 'Кац', 'U'],
    ])
  })

  it('keeps every status and contradiction with what it describes', () => {
    const kinds = by('P-001').facts.map((f) => f.kind)
    for (const k of ['Один источник', 'Гипотеза', 'Опровергается']) expect(kinds).toContain(k)
  })

  it('carries sources, but not a path on the researcher\'s disk', () => {
    expect(by('P-001').sources.map((s) => s.title)).toEqual(['Метрическая книга', 'Перепись'])
    expect(by('P-001').sources[0]).toMatchObject({ reliability: 'original', url: 'https://example.org/record/1', ref: 'ГАКО, ф. 130 оп. 1 д. 5' })
    expect(JSON.stringify(plan)).not.toContain('/Users/someone')
    expect(by('P-004').sources[0].reliability).toBe('guess')
  })
})

describe('a kinship case in the archive', () => {
  let ops: typeof import('../lib/ops/kinship-case')
  let people: typeof import('../lib/ops/people')
  beforeAll(async () => { ops = await import('../lib/ops/kinship-case'); people = await import('../lib/ops/people') })
  const inCase = () => people.getGraph(owner).persons.filter((p) => p.tags.some((t) => t.startsWith('case:')))

  it('says what will happen before anything changes', () => {
    expect(ops.previewCase(owner, files)).toMatchObject({ people: 4, already: 0, parents: 2, unions: 1, candidates: 1, openRelations: 1, leftOut: 1, living: 1 })
    expect(inCase()).toHaveLength(0)
  })

  it('adds the cards and only the established lines', () => {
    ops.importCase(owner, files)
    const g = people.getGraph(owner)
    const id = (t: string) => g.persons.find((p) => p.tags.includes(caseTag(files.caseId, t.slice(5))))!.id
    expect(inCase()).toHaveLength(4)
    expect(g.parentChild.filter((l) => l.childId === id('case:P-003')).map((l) => l.parentId).sort()).toEqual([id('case:P-001'), id('case:P-002')].sort())
    expect(g.parentChild.some((l) => l.parentId === id('case:P-004'))).toBe(false)
    expect(g.unions.filter((u) => u.aId === id('case:P-001'))).toHaveLength(1)
  })

  it('doubles nothing when the same case comes again', () => {
    const before = people.getGraph(owner)
    expect(ops.previewCase(owner, files)).toMatchObject({ people: 0, already: 4, updated: 0, parents: 0, unions: 0 })
    ops.importCase(owner, files)
    const after = people.getGraph(owner)
    expect(after.persons.length).toBe(before.persons.length)
    expect(after.parentChild.length).toBe(before.parentChild.length)
    expect(after.unions.length).toBe(before.unions.length)
  })

  it('keeps two cases apart, though both number their people from the start', () => {
    const before = people.getGraph(owner)
    const other: CaseFiles = { caseId: 'lisin-2027', persons: 'person_id,preferred_label,living_status\nP-001,Ян Лисин,deceased\nP-003,Ева Лисина,deceased\n', relationships: 'relationship_id,person_a_id,relationship_type,person_b_id,status\nR-1,P-001,parent-of,P-003,corroborated\n' }
    expect(ops.previewCase(owner, other)).toMatchObject({ people: 2, already: 0, parents: 1 })
    ops.importCase(owner, other)
    const after = people.getGraph(owner)
    expect(after.persons.length).toBe(before.persons.length + 2)
    const sokolov = after.persons.find((p) => p.tags.includes(caseTag(files.caseId, 'P-003')))!
    expect(after.parentChild.filter((l) => l.childId === sokolov.id)).toHaveLength(2)
  })

  it('hides the name of the case from its tag', () => {
    expect(caseTag('sokolov-2026', 'P-1')).not.toContain('sokolov')
    expect(caseTag('a', 'P-1')).not.toBe(caseTag('b', 'P-1'))
  })

  it('a case that grew adds to its cards and keeps what a person wrote', () => {
    const g = people.getGraph(owner)
    const card = g.persons.find((p) => p.tags.includes(caseTag(files.caseId, 'P-001')))!
    people.updatePerson(owner, card.id, { birthDate: '1881', facts: [...card.facts, { kind: 'Мой рассказ', date: '', place: '', note: 'от бабушки' }] })
    const grown: CaseFiles = {
      ...files,
      persons: files.persons.replace('Ивана Петрова Соколова,Sokolov Ivan,1880,', 'Ивана Петрова Соколова,Sokolov Ivan,1879,'),
      claims: `${files.claims}C-009,Служил в полку,P-001,service,A-001,G1,,corroborated,high,Послужной список,\n`,
      relationships: `${files.relationships}R-009,P-002,mother,P-004,biological,,A-002,,G2,corroborated,high,Новая находка\n`.replace('R-009,P-002,mother,P-004', 'R-009,P-001,spouse,P-003'),
    }
    expect(ops.previewCase(owner, grown)).toMatchObject({ people: 0, already: 4 })
    expect(ops.previewCase(owner, grown).updated).toBeGreaterThan(0)
    ops.importCase(owner, grown)
    const after = people.getPersonRow(card.id) as unknown as { birthDate: string; facts: string; claims: string }
    expect(after.birthDate).toBe('1881')
    expect(after.facts).toContain('от бабушки')
    expect(after.facts).toContain('Служил в полку')
    expect(after.claims).toContain('1879')
    ops.importCase(owner, grown)
    expect((people.getPersonRow(card.id) as unknown as { facts: string }).facts.match(/Служил в полку/g)).toHaveLength(1)
  })

  it('a line the case has since proved firms up, and never the other way', () => {
    const line = () => people.getGraph(owner).unions.find((u) => [u.aId, u.bId].includes(people.getGraph(owner).persons.find((p) => p.tags.includes(caseTag(files.caseId, 'P-002')))!.id))!
    expect(line().certainty).toBe('assumed')
    const proved = { ...files, relationships: files.relationships!.replace('G1,single-source,moderate,Запись о браке', 'G1;G2,corroborated,high,Запись о браке') }
    expect(ops.previewCase(owner, proved).proved).toBe(1)
    ops.importCase(owner, proved)
    expect(line().certainty).toBe('documented')
    ops.importCase(owner, files)
    expect(line().certainty).toBe('documented')
  })

  it('a card from a case can still be edited', () => {
    const long = 'длинно '.repeat(400)
    const big: CaseFiles = { caseId: 'long', persons: `person_id,preferred_label,living_status,notes\nP-1,Ян Длинный,deceased,${long}\n`, artifacts: `artifact_id,source_title,person_ids,archival_reference\nA-1,${'т'.repeat(300)},P-1,${'ф'.repeat(300)}\n` }
    expect(ops.previewCase(owner, big).trimmed).toBe(1)
    ops.importCase(owner, big)
    const card = people.getGraph(owner).persons.find((p) => p.tags.includes(caseTag('long', 'P-1')))!
    expect(() => personInput.parse({ facts: card.facts, sources: card.sources, otherNames: card.otherNames })).not.toThrow()
    expect(card.facts.map((f) => f.note).join('')).toBe(long.trim())
  })

  it('refuses what is not a case', () => {
    expect(() => ops.previewCase(owner, { caseId: 'x', persons: 'a,b\n1,2\n' })).toThrow()
  })

  it('is not for readers', () => {
    expect(() => ops.importCase({ userId: 'r', name: 'R', role: 'reader', personId: null }, files)).toThrow()
  })
})
