// A research case keeps its rules in the archive: nothing unproved becomes a line, nobody unknown becomes dead.
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../lib/ops/core'
import { planCase, type CaseFiles } from '../lib/kinship-case'

const read = (f: string) => readFileSync(`tests/fixtures/kinship-case/${f}`, 'utf8')
const files: CaseFiles = { persons: read('person-register.csv'), relationships: read('relationship-register.csv'), claims: read('claims-register.csv'), artifacts: read('artifact-register.csv') }
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
    expect(by('P-004').living).toBe(true)
    expect(by('P-001').living).toBe(false)
  })

  it('draws only what was established, however confident a hypothesis sounds', () => {
    expect(plan.parents.map((l) => `${l.parent}>${l.child}:${l.certainty}:${l.kind}`).sort()).toEqual(['P-001>P-003:documented:birth', 'P-002>P-003:documented:adopted'])
    expect(plan.unions).toEqual([{ a: 'P-001', b: 'P-002', kind: 'marriage', certainty: 'assumed' }])
    expect(plan.openRelations).toBe(1)
    expect(by('P-003').facts.some((f) => f.kind.startsWith('Возможная связь') && f.note.includes('Совпало только имя'))).toBe(true)
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
    expect(ops.previewCase(owner, files)).toMatchObject({ people: 4, already: 0, parents: 2, unions: 1, candidates: 1, openRelations: 1, leftOut: 1, living: 2 })
    expect(inCase()).toHaveLength(0)
  })

  it('adds the cards and only the established lines', () => {
    ops.importCase(owner, files)
    const g = people.getGraph(owner)
    const id = (t: string) => g.persons.find((p) => p.tags.includes(t))!.id
    expect(inCase()).toHaveLength(4)
    expect(g.parentChild.filter((l) => l.childId === id('case:P-003')).map((l) => l.parentId).sort()).toEqual([id('case:P-001'), id('case:P-002')].sort())
    expect(g.parentChild.some((l) => l.parentId === id('case:P-004'))).toBe(false)
    expect(g.unions.filter((u) => u.aId === id('case:P-001'))).toHaveLength(1)
  })

  it('doubles nothing when the same case comes again', () => {
    const before = people.getGraph(owner)
    expect(ops.previewCase(owner, files)).toMatchObject({ people: 0, already: 4 })
    ops.importCase(owner, files)
    const after = people.getGraph(owner)
    expect(after.persons.length).toBe(before.persons.length)
    expect(after.parentChild.length).toBe(before.parentChild.length)
    expect(after.unions.length).toBe(before.unions.length)
  })

  it('refuses what is not a case', () => {
    expect(() => ops.previewCase(owner, { persons: 'a,b\n1,2\n' })).toThrow()
  })

  it('is not for readers', () => {
    expect(() => ops.importCase({ userId: 'r', name: 'R', role: 'reader', personId: null }, files)).toThrow()
  })
})
