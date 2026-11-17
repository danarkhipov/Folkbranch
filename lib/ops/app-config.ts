import { AsyncLocalStorage } from 'node:async_hooks'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { translate } from '../i18n'
import '../i18n-server'
import { isLang, viewerLang } from '../languages'
import type { Lang } from '../types'

/** English unless the archive chose another language, so a place with no answer yet reads in English. */
export const archiveLang = (): Lang => { const l = getSetting('language'); return isLang(l) ? l : 'en' }

/** A label in the archive's language, for summaries written on the server. */
export const say = (key: string) => translate(archiveLang(), key)

/** The viewer's language of the request being handled, when one is. */
const viewerStore = new AsyncLocalStorage<Lang>()

/** The viewer's language of the request being handled; the archive's when there is no request. */
export const viewerLangNow = (): Lang => viewerStore.getStore() ?? archiveLang()

/** A message for the person reading it, in their language rather than the archive's. */
export const tell = (key: string) => translate(viewerLangNow(), key)

/** Runs a handler with the viewer's language at hand, so its messages come back in it. */
export const withViewerLang = <T>(lang: Lang, run: () => T): T => viewerStore.run(lang, run)

/** The language those headers name: the cookie, then the browser, then the archive's. */
export const langOfRequest = (h: { get(name: string): string | null }): Lang => viewerLang(h.get('cookie'), h.get('accept-language'), archiveLang())

export function getSetting(key: string): string | null {
  return getDb().select().from(schema.settings).where(eq(schema.settings.key, key)).get()?.value ?? null
}

export function setSetting(key: string, value: string) {
  getDb().insert(schema.settings).values({ key, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } }).run()
}
