// Spanish and Catalan come as chunks of their own, fetched only by a page that reads in them: a Russian or English
// reader never downloads them. Until a table is here, translate() shows English.
import { use } from 'react'
import { addTable, hasTable } from './i18n'
import type { Lang } from './types'

const TABLES: Partial<Record<Lang, () => Promise<{ default: Record<string, string> }>>> = {
  es: () => import('./i18n-es'),
  ca: () => import('./i18n-ca'),
}

/** A promise React reads at once, without waiting, when it is marked as done. */
type Tracked = Promise<void> & { status?: 'fulfilled'; value?: void }
const done = (): Tracked => Object.assign(Promise.resolve(), { status: 'fulfilled' as const, value: undefined })
const loading = new Map<Lang, Tracked>()

/** Resolves once `lang` can be translated, at once if it already can. */
export function loadTable(lang: Lang): Promise<void> {
  let p = loading.get(lang)
  if (!p) {
    const get = TABLES[lang]
    p = hasTable(lang) || !get ? done() : get().then((m) => { addTable(lang, m.default); Object.assign(p!, { status: 'fulfilled', value: undefined }) })
    loading.set(lang, p)
  }
  return p
}

/** Waits for the table during render, so the first paint is already in the reader's language. Called on every render, the same way. */
export const useTable = (lang: Lang) => use(loadTable(lang))
