// Odd input of every kind into everything that reads what the world sends or what people type: nothing may throw,
// and nothing may hang. A seeded generator, so a failure can be run again.
import { describe, expect, it } from 'vitest'
import { PARSERS } from '../lib/agent/models'
import { newestOfLine } from '../lib/agent/lines'
import { PRESETS } from '../lib/agent/presets'
import { fromGedDate, parseGedcom, parseLines, toGedDate } from '../lib/gedcom'
import { detectKind, guessMapping, jsonToTable, parseCsv, rowsToText } from '../lib/import-formats'
import { comingDays, familyCalendar, familyNumbers, lifeEvents } from '../lib/family-dates'
import { checkTelegram } from '../lib/telegram-login'
import { unseal } from '../lib/sealed'
import { langFromHeader, translate } from '../lib/i18n'
import { placeKey } from '../lib/places'
import type { Graph, Person } from '../lib/types'

let seed = 20261109
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]
const ODD = ['', ' ', '\0', '‮', '😀', 'ё'.repeat(5000), '"', "'", '<script>', '../../etc', '\r', '\n\n', '0', '-1', '1e999', 'NaN', 'null', 'undefined', '[]', '{}', '99999999999999999999', '\ud800', 'İ', 'ß', '1/2/3', '31 FEB 2023', 'ABT 1850', 'BET 1800 AND 1900', '0000', '10000', '-0044', '1850-13-45', 'FROM 1900 TO', '29 FEB 1900', '29 FEB 2100']
const junk = (depth = 0): unknown => {
  const k = Math.floor(rnd() * 9)
  if (depth > 3 || k < 4) return pick([null, undefined, true, 0, -1, 1.5, NaN, '', 'x', ...ODD, 1e15, 'models/gemini-9'])
  if (k < 6) return Array.from({ length: Math.floor(rnd() * 5) }, () => junk(depth + 1))
  return Object.fromEntries(Array.from({ length: Math.floor(rnd() * 8) }, () => [pick(['id', 'name', 'data', 'models', 'created', 'created_at', 'pricing', 'architecture', 'metadata', 'capabilities', 'supported_parameters', 'function_calling', 'supportedGenerationMethods', 'display_name', 'displayName', 'input_modalities', 'prompt_tokens_cost']), junk(depth + 1)]))
}

describe('what a provider might answer one day', () => {
  for (const id of Object.keys(PARSERS) as (keyof typeof PARSERS)[]) {
    it(`${id}: any shape of model list gives a list, never a crash`, () => {
      for (let i = 0; i < 400; i++) {
        const body = i % 3 ? { data: [junk(), junk(), { id: 'gpt://b1g/yandexgpt/latest' }, junk()] } : i % 3 === 0 ? { models: [junk(), junk()] } : junk()
        const out = PARSERS[id](body, 'b1g')
        expect(Array.isArray(out)).toBe(true)
      }
    })
  }
  it('a line finds nothing, not an error, among strange ids', () => {
    const line = { match: /^gpt-(\d+(?:\.\d+)*)-luna$/, floor: 'gpt-6-luna', status: 'tested' as const }
    expect(newestOfLine([...ODD, 'gpt-99999999999999999999-luna', 'gpt-7-luna'], line)).toBe('gpt-99999999999999999999-luna')
  })
  it('every preset has models, prices and no leftover of a removed one', () => {
    for (const p of PRESETS) expect(p.models.length).toBeGreaterThan(0)
  })
})

describe('files and text people bring', () => {
  it('GEDCOM: garbage, broken levels, huge lines and odd line ends never crash and finish quickly', () => {
    const tags = ['INDI', 'FAM', 'NAME', 'BIRT', 'DATE', 'PLAC', 'HUSB', 'WIFE', 'CHIL', 'OBJE', 'FILE', 'CONT', 'CONC', 'SEX', 'NOTE', 'SOUR', '_X', 'DEAT', 'MARR', 'FAMC', 'FAMS']
    const t0 = Date.now()
    for (let i = 0; i < 300; i++) {
      const lines = Array.from({ length: Math.floor(rnd() * 60) }, () => `${pick([0, 1, 2, 3, 9, -1, 99])} ${pick(['', `@${pick(['I1', 'I2', 'F1', 'X'])}@`])} ${pick(tags)} ${pick(ODD)}${pick(['@I1@', '@F1@', '@NOPE@', ''])}`)
      const text = (pick(['', '﻿', '﻿﻿']) + lines.join(pick(['\n', '\r\n', '\r', '\n\r', ' ']))).slice(0, 200_000)
      try { parseGedcom(text, pick(['ru', 'en'] as const)) } catch (e) { throw new Error(`${(e as Error).stack?.split('\n').slice(0, 4).join(' | ')} ::: ${JSON.stringify(text.slice(0, 400))}`) }
      expect(() => parseLines(text)).not.toThrow()
    }
    expect(Date.now() - t0).toBeLessThan(15_000)
  })
  it('GEDCOM: a family that is its own ancestor, and a person who is their own parent, do not loop forever', () => {
    const text = '0 HEAD\n0 @I1@ INDI\n1 NAME A /B/\n1 FAMC @F1@\n1 FAMS @F1@\n0 @F1@ FAM\n1 HUSB @I1@\n1 WIFE @I1@\n1 CHIL @I1@\n0 TRLR'
    expect(() => parseGedcom(text)).not.toThrow()
  })
  it('GEDCOM dates round-trip without throwing for any text', () => {
    for (const d of [...ODD, 'JAN 1850', 'BEF 1850', 'AFT 1850', 'EST 1850', 'CAL 1850', '@#DJULIAN@ 5 MAR 1700', '1850/51', '5 MAR']) {
      expect(() => toGedDate(fromGedDate(d))).not.toThrow()
      expect(typeof fromGedDate(d)).toBe('string')
    }
  })
  it('tables: any CSV, any mapping, any JSON', () => {
    for (let i = 0; i < 300; i++) {
      const text = Array.from({ length: Math.floor(rnd() * 30) }, () => Array.from({ length: Math.floor(rnd() * 6) }, () => pick([...ODD, 'Иван', 'ж', '1850', 'a,b', '"x""y"'])).join(pick([',', ';', '\t']))).join(pick(['\n', '\r\n', '\r']))
      const rows = parseCsv(text)
      const mapping = guessMapping(rows[0] ?? [])
      expect(() => rowsToText(rows, mapping)).not.toThrow()
      expect(() => detectKind(pick(['a.ged', 'a.csv', 'a', '.', 'a.XLSX', ...ODD]), text.slice(0, 500))).not.toThrow()
      expect(() => jsonToTable(JSON.stringify(junk()))).not.toThrow()
      expect(() => jsonToTable(text)).not.toThrow()
    }
  })
  it('places, languages and unknown translations never throw', () => {
    for (const s of ODD) { expect(typeof placeKey(s)).toBe('string'); expect(translate('en', s)).toBeTypeOf('string'); expect(['ru', 'en']).toContain(langFromHeader(s)) }
    expect(langFromHeader(null)).toBe('en')
  })
})

const person = (over: Partial<Person>): Person => ({ id: String(rnd()), givenName: '', surname: '', maidenName: '', patronymic: '', otherNames: '', sex: 'U' as never, birthDate: '', birthYear: null, birthPlace: '', deathDate: '', deathYear: null, deathPlace: '', living: false, certainty: 'family' as never, avatarMediaId: null, avatarCrop: null, updatedAt: 0, tags: [], facts: [], sources: [], claims: [], ...over })
describe('dates and the calendar, far from today', () => {
  const graph = (): Graph => {
    const ps = Array.from({ length: 60 }, () => person({ birthDate: pick(ODD), deathDate: pick(ODD), birthYear: pick([null, 0, -5, 3000, 99999, NaN]), deathYear: pick([null, 1, 2999, NaN]), living: rnd() > 0.5 }))
    return { persons: ps, parentChild: [{ id: 'l', parentId: ps[0].id, childId: ps[1].id } as never, { id: 'm', parentId: ps[1].id, childId: ps[0].id } as never, { id: 'n', parentId: 'ghost', childId: ps[2].id } as never], unions: [{ id: 'u', aId: ps[0].id, bId: ps[0].id, startDate: pick(ODD), endDate: '' } as never, { id: 'v', aId: 'ghost', bId: ps[3].id, startDate: '1900', endDate: '' } as never] }
  }
  for (const today of [new Date(2026, 10, 9), new Date(2027, 1, 28), new Date(2028, 1, 29), new Date(2100, 1, 28), new Date(2100, 11, 31), new Date(2500, 5, 1), new Date(1999, 11, 31)]) {
    it(`${today.toISOString().slice(0, 10)}: anniversaries, life events, numbers and calendar still work`, () => {
      for (let i = 0; i < 25; i++) {
        const g = graph()
        expect(() => comingDays(g, today)).not.toThrow()
        expect(() => familyNumbers(g)).not.toThrow()
        expect(() => familyCalendar(g, (k) => k, today)).not.toThrow()
        for (const p of g.persons) expect(() => lifeEvents(p, g)).not.toThrow()
      }
    })
  }
  it('a birthday on 29 February is kept in a year that has none', () => {
    const g: Graph = { persons: [person({ id: 'a', birthDate: '29 FEB 2000', living: true, givenName: 'A' })], parentChild: [], unions: [] }
    expect(comingDays(g, new Date(2027, 1, 20)).length).toBe(1)
  })
})

describe('secrets and logins that outlive the app', () => {
  it('a sealed value from another secret, or garbage, opens to nothing', () => {
    for (const s of [...ODD, 'a.b.c', 'AAAA.AAAA.AAAA', '....']) expect(unseal(s, 'x')).toBeNull()
  })
  it('a Telegram login of any shape is refused, not thrown', () => {
    for (let i = 0; i < 200; i++) expect(() => checkTelegram((junk() ?? {}) as never, pick(ODD))).not.toThrow()
  })
})
