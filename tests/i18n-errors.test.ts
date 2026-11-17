// Short protocol errors: a person reads them in their language, a program keeps the English it matches on.
import { describe, expect, it } from 'vitest'
import { errorFor } from '../lib/i18n-errors'

describe('protocol errors for a person', () => {
  it('are worded in the person\'s language, and anything not listed stays as it is', () => {
    expect(errorFor('not found', 'ru')).toMatch(/Не найдено/)
    expect(errorFor('forbidden', 'es')).toMatch(/permiso/)
    expect(errorFor('not found', 'en')).toBe('not found')
    expect(errorFor('Сервис не принял этот ключ', 'en')).toBe('Сервис не принял этот ключ')
  })
})
