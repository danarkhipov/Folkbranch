import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { getDb, schema } from '../lib/db'
import { loadDemo } from '../lib/demo'
import { langFromHeader, translate } from '../lib/i18n'
import { langFromCookie, viewerLang } from '../lib/languages'
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

  it('respects the quality order and falls back to the archive language', () => {
    expect(langFromHeader('en;q=0.5,ca;q=0.9')).toBe('ca')
    expect(langFromHeader('de-DE,es;q=0.4,ru;q=0.6')).toBe('ru')
    expect(langFromHeader('es;q=0.2,ca;q=0.8,en;q=0.9')).toBe('en')
    expect(langFromHeader('de-DE', 'ru')).toBe('ru')
    expect(langFromHeader('de-DE,fr;q=0.5', 'es')).toBe('es')
  })

  it("reads a cookie first, then the browser, then the archive's language", () => {
    expect(langFromCookie('seen=1; folkbranch-lang=ca; other=2')).toBe('ca')
    expect(langFromCookie(' folkbranch-lang=es')).toBe('es')
    expect(langFromCookie('folkbranch-lang=xx')).toBeNull()
    expect(langFromCookie(null)).toBeNull()
    expect(viewerLang('folkbranch-lang=ca', 'es-ES,es;q=0.9', 'ru')).toBe('ca')
    expect(viewerLang(null, 'es-ES,es;q=0.9,en;q=0.8', 'ru')).toBe('es')
    expect(viewerLang(null, 'de-DE', 'ru')).toBe('ru')
    expect(viewerLang('folkbranch-lang=xx', 'de-DE', 'ca')).toBe('ca')
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
