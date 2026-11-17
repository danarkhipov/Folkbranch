// The viewer's language reaches the server, both for what it says back and for the pages shown before an account.
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb, schema } from '../lib/db'
import { translate } from '../lib/i18n'
import '../lib/i18n-server'
import { langOfRequest, setSetting, withViewerLang } from '../lib/ops/app-config'
import { openShare } from '../lib/ops/share'
import { readableSummary } from '../lib/ops/history-text'
import type { Lang } from '../lib/types'

const state = vi.hoisted(() => ({ cookie: '', accept: '' }))
vi.mock('next/headers', () => ({ headers: async () => new Headers({ cookie: state.cookie, 'accept-language': state.accept }) }))
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`redirect ${to}`) } }))

import Invite from '../app/invite/[token]/page'
import Login from '../app/login/page'
import NotFound from '../app/not-found'
import Setup from '../app/setup/page'
import Share from '../app/share/[token]/page'
import Tell from '../app/tell/[token]/page'

const requestHeaders = (cookie: string | null, accept: string | null) => ({
  get: (name: string) => (name === 'cookie' ? cookie : name === 'accept-language' ? accept : null),
})
const langFor = (cookie: string | null, accept: string | null) => langOfRequest(requestHeaders(cookie, accept))

const sayError = (cookie: string | null, accept: string | null) => withViewerLang(langFor(cookie, accept), () => {
  try {
    openShare('no-such-token', undefined)
  } catch (e) {
    return (e as Error).message
  }
  return ''
})

const historyLine = (cookie: string | null, accept: string | null) =>
  withViewerLang(langFor(cookie, accept), () => readableSummary('Удалить человека: Ana', [], (id) => id))

describe('the viewer language on the server', () => {
  it('says the same error and history line in the browser language or in the cookie language', () => {
    setSetting('language', 'en')
    expect(sayError(null, 'es-ES,es;q=0.9')).toBe('Este enlace no es válido')
    expect(sayError('folkbranch-lang=ru', 'es-ES,es;q=0.9')).toBe('Ссылка недействительна')
    expect(sayError(null, 'de-DE')).toBe('This link is not valid')
    expect(historyLine(null, 'es-ES,es;q=0.9')).toBe('Persona eliminada: Ana')
    expect(historyLine('folkbranch-lang=ru', 'es-ES,es;q=0.9')).toBe('Удалён человек: Ana')
  })
})

const pages: { name: string; word: string; render: () => Promise<string> }[] = [
  { name: 'login', word: 'Вход только по приглашению', render: async () => renderToStaticMarkup(await Login({ searchParams: Promise.resolve({}) })) },
  { name: 'invite', word: 'Приглашение больше не работает', render: async () => renderToStaticMarkup(await Invite({ params: Promise.resolve({ token: 'none' }), searchParams: Promise.resolve({}) })) },
  { name: 'setup', word: 'Вы станете владельцем архива.', render: async () => renderToStaticMarkup(await Setup({ searchParams: Promise.resolve({}) })) },
  { name: 'share', word: 'Ссылка больше не работает', render: async () => renderToStaticMarkup(await Share({ params: Promise.resolve({ token: 'none' }) })) },
  { name: 'tell', word: 'Ссылка недействительна', render: async () => renderToStaticMarkup(await Tell({ params: Promise.resolve({ token: 'none' }) })) },
  { name: 'not-found', word: 'Такой страницы нет', render: async () => renderToStaticMarkup(await NotFound()) },
]

const shows = (html: string, lang: Lang, word: string) => html.includes(translate(lang, word))

describe('pages shown before an account', () => {
  beforeEach(() => {
    getDb().delete(schema.user).run()
  })

  it("read in the cookie's language, over the browser's", async () => {
    state.cookie = 'folkbranch-lang=es'
    state.accept = 'ru-RU,ru;q=0.9'
    for (const page of pages) expect([page.name, shows(await page.render(), 'es', page.word)]).toEqual([page.name, true])
  })

  it("read in the browser's language when no cookie is set, not the archive's", async () => {
    // The archive is English, the browser asks for Russian: a page that ignored the header would
    // show English here, so the two inputs disagree on purpose.
    setSetting('language', 'en')
    state.cookie = ''
    state.accept = 'ru-RU,ru;q=0.9'
    for (const page of pages) expect([page.name, shows(await page.render(), 'ru', page.word)]).toEqual([page.name, true])
  })
})
