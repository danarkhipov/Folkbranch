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

/** The cookie a person's interface language is kept in, so pages before an account can read it too. */
export const LANG_COOKIE = 'folkbranch-lang'

/**
 * The best language an Accept-Language header offers, or `fallback` when it names none the app speaks.
 * The header's q-values decide the order: "de;q=1, es;q=0.8, ru;q=0.9" picks Russian.
 */
export const matchLanguage = (header: string | null | undefined, fallback: Lang = 'en'): Lang => {
  const choices = (header ?? '').split(',').flatMap((part, order) => {
    const [raw, ...params] = part.split(';')
    const code = raw.trim().toLowerCase()
    if (!code) return []
    const quality = params.map((p) => p.trim()).find((p) => /^q=/i.test(p))
    const weight = quality ? Number(quality.slice(2)) : 1
    if (!Number.isFinite(weight) || weight <= 0) return []
    return [{ code, weight, order }]
  })
  // Stable order: an equal q keeps the order the browser sent.
  choices.sort((a, b) => b.weight - a.weight || a.order - b.order)
  for (const { code } of choices) {
    const primary = code.split('-')[0]
    if (isLang(primary)) return primary
  }
  return fallback
}

/** The language chosen in the cookie, or null when it is absent or not one of ours. */
export const langFromCookie = (cookie: string | null | undefined): Lang | null => {
  const raw = cookie?.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${LANG_COOKIE}=`))?.slice(LANG_COOKIE.length + 1)
  if (!raw) return null
  let value = raw
  try { value = decodeURIComponent(raw) } catch {}
  return isLang(value) ? value : null
}

/** The language a viewer reads: their cookie, then the browser's best match, then the archive's. */
export const viewerLang = (cookie: string | null | undefined, acceptLanguage: string | null | undefined, archive: Lang): Lang =>
  langFromCookie(cookie) ?? matchLanguage(acceptLanguage, archive)

/** Keeps a language choice for the next page, including the ones shown before an account. */
export const setLangCookie = (lang: Lang) => {
  if (typeof document !== 'undefined') document.cookie = `${LANG_COOKIE}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`
}

/** The language of the page being shown, for code that runs outside React. */
export const pageLang = (): Lang => langOf(typeof document === 'undefined' ? null : document.documentElement.lang)

