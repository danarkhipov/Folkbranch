import { describe, expect, it } from 'vitest'
import { detectKind, guessMapping, jsonToTable, parseCsv, rowsToText, sheetCell } from '../lib/import-formats'
import { parseFamilyText, planFamilyText } from '../lib/textformat'
import type { Graph } from '../lib/types'

const empty = { persons: [], parentChild: [], unions: [] } as Graph
const planOf = (text: string, g: Graph = empty) => { const parsed = parseFamilyText(text); return { parsed, plan: planFamilyText(parsed, g) } }

describe('detecting a file', () => {
  it.each([
    ['tree.ged', 'x', 'gedcom'], ['a.txt', '0 HEAD\n1 GEDC', 'gedcom'], ['a.xlsx', '', 'xlsx'], ['a.csv', 'x', 'table'],
    ['a.json', '[]', 'json'], ['a.txt', '[{"a":1}]', 'json'], ['a.txt', 'Имя;Фамилия;Дата', 'table'], ['a.txt', 'family Род\nПётр Иванов b: 1880', 'text'], ['a.txt', 'Пётр Иванов b: 1880, sex: m', 'text'],
  ])('%s', (name, head, kind) => expect(detectKind(name, head)).toBe(kind))
})

describe('csv', () => {
  it('finds the separator, keeps quotes, skips empty rows and a BOM', () => {
    expect(parseCsv('﻿Имя;Место\nАнна;"Пермь; центр"\n\n;\nИван;"он ""старший"""\n')).toEqual([['Имя', 'Место'], ['Анна', 'Пермь; центр'], ['Иван', 'он "старший"']])
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']])
  })
  it('guesses columns in Russian and English', () => {
    expect(guessMapping(['ФИО', 'Дата рождения', 'Место рождения', 'Отец', 'Мать', 'Что-то'])).toEqual(['name', 'birthDate', 'birthPlace', 'father', 'mother', ''])
    expect(guessMapping(['First name', 'Last name', 'Born', 'Birth place', 'Died', 'Spouse', 'Gender'])).toEqual(['given', 'surname', 'birthDate', 'birthPlace', 'deathDate', 'spouse', 'sex'])
    expect(guessMapping(['Фамилия', 'Имя', 'Отчество', 'Девичья фамилия', 'Пол'])).toEqual(['surname', 'given', 'patronymic', 'maiden', 'sex'])
    expect(guessMapping(['Nombre', 'Apellidos', 'Fecha de nacimiento', 'Lugar de nacimiento', 'Fecha de defunción', 'Lugar de defunción', 'Padre', 'Madre', 'Cónyuge', 'Sexo'])).toEqual(['given', 'surname', 'birthDate', 'birthPlace', 'deathDate', 'deathPlace', 'father', 'mother', 'spouse', 'sex'])
    expect(guessMapping(['Nom', 'Cognoms', 'Data de naixement', 'Lloc de naixement', 'Data de defunció', 'Pare', 'Mare', 'Parella', 'Sexe'])).toEqual(['given', 'surname', 'birthDate', 'birthPlace', 'deathDate', 'father', 'mother', 'spouse', 'sex'])
    expect(guessMapping(['Nombre completo', 'Apellido de soltera'])).toEqual(['name', 'maiden'])
    expect(guessMapping(['Nom del pare', 'Nom de la mare', 'Lloc de mort'])).toEqual(['father', 'mother', 'deathPlace'])
  })
  it('reads an English or Russian table exactly as before, though a header holds a Spanish or Catalan word', () => {
    expect(guessMapping(['Parent', 'Marital status', 'Num', 'Nightmare', 'Mortgage place', 'Obituary'])).toEqual(['', '', '', '', '', ''])
    expect(guessMapping(['Name', 'Parents', 'Spouse', 'Born'])).toEqual(['given', '', 'spouse', 'birthDate'])
    expect(guessMapping(['ФИО', 'Отец', 'Мать', 'Супруг'])).toEqual(['name', 'father', 'mother', 'spouse'])
  })
})

describe('a table becomes the text format', () => {
  const headers = ['ФИО', 'Пол', 'Родился', 'Место рождения', 'Отец', 'Мать', 'Супруг']
  const rows = [
    ['Пётр Иванов', 'м', '1880', 'Пермь, Россия', '', '', 'Анна Смирнова'],
    ['Анна Смирнова', 'ж', '~1885', '', '', '', ''],
    ['Мария Иванова', 'Ж', '1906', '', 'Пётр Иванов', 'Анна Смирнова', ''],
    ['Сергей Иванов', '', '1910', '', 'Пётр Иванов', '', ''],
    ['Ольга Петрова', 'ж', '1930', '', 'Павел Новый', '', ''],
  ]
  const { text, people } = rowsToText(rows, guessMapping(headers), 'Род')
  const { parsed, plan } = planOf(text)

  it('makes valid text with everyone, relatives named only in a cell included', () => {
    expect(plan.errors).toEqual([])
    expect(people).toBe(6)
    expect(plan.creates).toHaveLength(6)
    expect(plan.creates).toContain('Павел Новый')
  })
  it('keeps attributes, including a place with a comma', () => {
    const peter = [...parsed.people.values()].find((p) => p.givenName === 'Пётр')!
    expect(peter.attrs).toMatchObject({ b: '1880', bp: 'Пермь, Россия', sex: 'm' })
  })
  it('links parents and spouses, and knows a father is a man', () => {
    expect(plan.relations).toBe(1 + 2 + 1 + 1)
    expect([...parsed.people.values()].find((p) => p.givenName === 'Павел')!.attrs.sex).toBe('m')
  })
  it('finds a person already in the archive instead of adding a copy', () => {
    const g = { ...empty, persons: [{ id: 'x', givenName: 'Пётр', patronymic: '', surname: 'Иванов', birthYear: 1880, birthDate: '1880', sex: 'M' }] } as unknown as Graph
    const again = planOf(text, g).plan
    expect(again.creates).not.toContain('Пётр Иванов')
    expect(again.creates).toHaveLength(5)
  })
  it('matches a row number in a relative cell', () => {
    const r = rowsToText([['1', 'Анна Белова', ''], ['2', 'Иван Белов', '1']], ['id', 'name', 'mother'])
    const p = planOf(r.text)
    expect(p.plan.errors).toEqual([])
    expect(p.plan.relations).toBe(1)
    expect(p.plan.creates).toHaveLength(2)
  })
  it('joins name columns and separates the patronymic on import', () => {
    const r = rowsToText([['Иванов', 'Пётр', 'Сергеевич']], ['surname', 'given', 'patronymic'])
    const op = planOf(r.text).plan.ops[0].args.person as Record<string, string>
    expect([op.givenName, op.patronymic, op.surname]).toEqual(['Пётр', 'Сергеевич', 'Иванов'])
  })
  it('finds an existing person whatever way the patronymic is stored', () => {
    const r = rowsToText([['Пётр Сергеевич Иванов']], ['name'])
    const g = { ...empty, persons: [{ id: 'x', givenName: 'Пётр', patronymic: 'Сергеевич', surname: 'Иванов', sex: 'M' }] } as unknown as Graph
    expect(planOf(r.text, g).plan.creates).toEqual([])
  })
  it('warns about namesakes rather than guessing silently', () => {
    const r = rowsToText([['Иван Белов', '1900'], ['Иван Белов', '1950']], ['name', 'birthDate'])
    expect(r.warnings.map((w) => w.key)).toContain('Одинаковые имена в файле будут считаться одним человеком')
  })
  it('cannot be tricked by syntax inside a cell', () => {
    const r = rowsToText([['Анна + Иван: b: 1900', '1950']], ['name', 'birthDate'])
    expect(planOf(r.text).plan.errors).toEqual([])
    expect(planOf(r.text).plan.creates).toHaveLength(1)
  })
})

describe('json', () => {
  it('reads a list of records', () => {
    const t = jsonToTable('[{"name":"Анна Белова","born":1900,"extra":{"x":1}},{"name":"Иван Белов"}]')!
    expect(t.headers).toEqual(['name', 'born'])
    expect(t.rows).toEqual([['Анна Белова', '1900'], ['Иван Белов', '']])
  })
  it("reads this app's own graph, links included", () => {
    const t = jsonToTable(JSON.stringify({ persons: [{ id: 'a', givenName: 'Пётр', surname: 'Белов', sex: 'M' }, { id: 'b', givenName: 'Анна', surname: 'Белова', sex: 'F' }, { id: 'c', givenName: 'Иван', surname: 'Белов', sex: 'M' }], parentChild: [{ parentId: 'a', childId: 'c' }, { parentId: 'b', childId: 'c' }], unions: [{ aId: 'a', bId: 'b' }] }))!
    const r = rowsToText(t.rows, guessMapping(t.headers))
    const p = planOf(r.text)
    expect(p.plan.errors).toEqual([])
    expect(p.plan.creates).toHaveLength(3)
    expect(p.plan.relations).toBe(3)
  })
  it('refuses what it cannot read', () => {
    expect(jsonToTable('not json')).toBeNull()
    expect(jsonToTable('{"a":1}')).toBeNull()
    expect(jsonToTable('[1,2]')).toBeNull()
  })
})

it('turns Excel dates into text', () => {
  expect(sheetCell(new Date(Date.UTC(1925, 2, 7)))).toBe('07.03.1925')
  expect(sheetCell(1925)).toBe('1925')
  expect(sheetCell(null)).toBe('')
})
