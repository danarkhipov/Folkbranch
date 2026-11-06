import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { translate } from '../i18n'
import type { Lang } from '../types'

/** English unless the archive chose Russian, so a place with no answer yet reads in English. */
export const archiveLang = (): Lang => (getSetting('language') === 'ru' ? 'ru' : 'en')

/** A label in the archive's language, for summaries written on the server. */
export const say = (key: string) => translate(archiveLang(), key)

export function getSetting(key: string): string | null {
  return getDb().select().from(schema.settings).where(eq(schema.settings.key, key)).get()?.value ?? null
}

export function setSetting(key: string, value: string) {
  getDb().insert(schema.settings).values({ key, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } }).run()
}
