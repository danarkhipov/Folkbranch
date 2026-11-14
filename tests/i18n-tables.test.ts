// The Spanish and Catalan tables may be unfinished: a missing word shows in English (`pnpm i18n:gaps` lists them).
// What they hold must be right, though: a key the app has, the same slots as the English, and no Russian left in.
import { describe, expect, it } from 'vitest'
import { english } from '../lib/i18n'
import ca from '../lib/i18n-ca'
import es from '../lib/i18n-es'
import { pairs, wanted } from '../scripts/i18n-words'

const all = wanted(english, pairs())
const cyrillic = /[А-Яа-яЁё]/
/** {domain}, ${name}, {n}, %s: what the code fills in. */
const slots = (s: string) => [...s.matchAll(/\$?\{[^{}]*\}|%[sd]/g)].map((m) => m[0]).sort()
/** Words that are names, not language: they must stay as they are. */
const NAMES = ['GEDCOM', 'Folkbranch', 'https', 'BETTER_AUTH_URL', 'OWNER_EMAIL']

describe.each([['es', es], ['ca', ca]] as const)('the %s table', (_, table) => {
  const lines = Object.entries(table)

  it('only has keys the app shows', () => {
    expect(lines.filter(([key]) => !all.has(key)).map(([key]) => key)).toEqual([])
  })

  it('fills in the same slots as the English', () => {
    expect(lines.filter(([key, value]) => slots(value).join() !== slots(all.get(key) ?? '').join()).map(([key, value]) => `${key} → ${value}`)).toEqual([])
  })

  it('has no Russian left in a value, and no empty one', () => {
    expect(lines.filter(([, value]) => cyrillic.test(value) || !value.trim()).map(([key]) => key)).toEqual([])
  })

  it('keeps the names the English keeps', () => {
    expect(lines.flatMap(([key, value]) => NAMES.filter((n) => (all.get(key) ?? '').includes(n) && !value.includes(n)).map((n) => `${key}: ${n}`))).toEqual([])
  })

  it('starts and ends a line the way the English does', () => {
    // A label glued to a value by the code ("Born: 1890") loses its colon or gains a space and reads wrong.
    const edge = (s: string) => [/^\s/.test(s), /\s$/.test(s), /:\s*$/.test(s)].join()
    expect(lines.filter(([key, value]) => edge(value) !== edge(all.get(key) ?? '')).map(([key, value]) => `${key} → ${value}`)).toEqual([])
  })
})
