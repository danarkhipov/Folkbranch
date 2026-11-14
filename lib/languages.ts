// The languages the interface speaks. Russian and English are complete; Spanish and Catalan show English wherever they have no words yet.
import type { Lang } from './types'

export const LANGS: Lang[] = ['ru', 'en', 'es', 'ca']

/** Each language named in itself, as the language picker shows it. */
export const LANG_NAMES: Record<Lang, string> = { ru: 'Русский', en: 'English', es: 'Español', ca: 'Català' }

export const isLang = (s: unknown): s is Lang => typeof s === 'string' && (LANGS as string[]).includes(s)

/** The language a page or browser names ("es-ES", "ca"), English when the app does not speak it. */
export const langOf = (code: string | null | undefined): Lang => {
  const two = (code ?? '').slice(0, 2).toLowerCase()
  return isLang(two) ? two : 'en'
}

/** The language of the page being shown, for code that runs outside React. */
export const pageLang = (): Lang => langOf(typeof document === 'undefined' ? null : document.documentElement.lang)

