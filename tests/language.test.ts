import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { getDb, schema } from '../lib/db'
import { loadDemo } from '../lib/demo'
import { langFromHeader, translate } from '../lib/i18n'
import { archiveLang, say, setSetting } from '../lib/ops/app-config'

describe('the language', () => {
  it('is English until an archive chooses Russian', () => {
    getDb().delete(schema.settings).where(eq(schema.settings.key, 'language')).run()
    expect(archiveLang()).toBe('en')
    expect(say('Удалить')).toBe('Delete')
    setSetting('language', 'ru')
    expect(archiveLang()).toBe('ru')
    expect(say('Удалить')).toBe('Удалить')
    setSetting('language', 'es')
    expect(archiveLang()).toBe('es')
    setSetting('language', 'xx')
    expect(archiveLang()).toBe('en')
  })

  it("offers the browser's first choice when the app speaks it, English otherwise", () => {
    expect(langFromHeader('ru-RU,ru;q=0.9,en;q=0.8')).toBe('ru')
    expect(langFromHeader('es-ES,es;q=0.9,en;q=0.8')).toBe('es')
    expect(langFromHeader('ca,es;q=0.8')).toBe('ca')
    expect(langFromHeader('CA-es')).toBe('ca')
    expect(langFromHeader('en-GB,es;q=0.9')).toBe('en')
    expect(langFromHeader('cat')).toBe('en')
    expect(langFromHeader('RU')).toBe('ru')
    expect(langFromHeader('en-US,ru;q=0.9')).toBe('en')
    expect(langFromHeader('de-DE')).toBe('en')
    expect(langFromHeader('rus')).toBe('en')
    expect(langFromHeader(null)).toBe('en')
  })

  it('has English for every word it was missing', () => {
    for (const word of ['Слишком много запросов подряд. Подождите минуту.', 'Загрузка и скачивание', 'Уверенность', 'Версии', 'Самая дешёвая', 'Копировать', 'л.'])
      expect(translate('en', word)).not.toMatch(/[а-яё]/i)
  })

  it('gives an English archive an English demo family, with the same people and links', async () => {
    await loadDemo('demo-owner', 'Ann', 'en')
    const db = getDb()
    const words = JSON.stringify([db.select().from(schema.persons).all(), db.select().from(schema.pages).all(), db.select().from(schema.media).all()])
    expect(words).toContain('Whitlock')
    expect(words).not.toMatch(/[а-яё]/i)
    expect(db.select().from(schema.persons).all()).toHaveLength(27)
  })
})
