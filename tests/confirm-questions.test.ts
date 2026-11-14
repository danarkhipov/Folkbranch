// A confirm question has its own line, with {name} where the name goes. Before, the code glued a button's label to the
// name and a question mark; Russian and English must read exactly as that did, character for character.
import { describe, expect, it } from 'vitest'
import { translate } from '../lib/i18n'
import ca from '../lib/i18n-ca'
import es from '../lib/i18n-es'

// Each question, and how the code built it before from the button's line. `name` is what the code puts in.
const QUESTIONS: [string, (t: (k: string) => string, name: string) => string][] = [
  ['Удалить человека «{name}»?', (t, n) => `${t('Удалить человека')} «${n}»?`],
  ['Удалить «{name}»?', (t, n) => `${t('Удалить')} «${n}»?`],
  ['Удалить рассказ «{name}»?', (t, n) => `${t('Удалить рассказ')} «${n}»?`],
  ['Удалить рассказ?', (t) => `${t('Удалить рассказ')}?`],
  ['Удалить сведения о месте «{name}»?', (t, n) => `${t('Удалить сведения о месте')} «${n}»?`],
  ['Удалить архив «{name}»?', (t, n) => `${t('Удалить архив')} «${n}»?`],
  ['Удалить модель: {name}?', (t, n) => `${t('Удалить модель')}: ${n}?`],
  ['Закрыть доступ: {name}?', (t, n) => `${t('Закрыть доступ')}: ${n}?`],
  ['Выключить вход: {name}?', (t, n) => `${t('Выключить вход')}: ${n}?`],
  ['Закрыть ссылку: {name}?', (t, n) => `${t('Закрыть ссылку')}: ${n}?`],
]
// Names as the code may meet them, including the characters String.replace would read as patterns.
const NAMES = ['Anna Soler', 'Тётя Лена', 'A $& B $1 $$', '']

describe('confirm questions', () => {
  it.each(['ru', 'en'] as const)('read in %s exactly as before', (lang) => {
    const t = (k: string) => translate(lang, k)
    for (const [key, before] of QUESTIONS) for (const name of NAMES) {
      expect(t(key).replace('{name}', () => name)).toBe(before(t, name))
    }
  })

  it('ask as a question in Spanish and Catalan', () => {
    for (const [key] of QUESTIONS) {
      expect(es[key]).toMatch(/^¿.*\?$/)
      expect(ca[key]).toMatch(/^Vols .*\?$/)
    }
  })
})
