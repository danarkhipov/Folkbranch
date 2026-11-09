// A living person's range is open at the end, in the language of the archive, also where the server writes it.
import { describe, expect, it } from 'vitest'
import '../lib/ops/settings'
import { setSetting } from '../lib/ops/app-config'
import { lifeYears, type Person } from '../lib/types'

const living = { living: true, birthDate: '1972', birthYear: 1972, deathDate: '', deathYear: null } as Person

describe('the open end of a living range', () => {
  it('follows the archive language on the server', () => {
    setSetting('language', 'en')
    expect(lifeYears(living)).toBe('1972 – now')
    setSetting('language', 'ru')
    expect(lifeYears(living)).toBe('1972 – н. в.')
  })
  it('can be told the word, for a file in another language', () => {
    expect(lifeYears(living, '?', 'now')).toBe('1972 – now')
  })
})
