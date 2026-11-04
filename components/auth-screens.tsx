'use client'
import { useState } from 'react'
import { translate } from '@/lib/i18n'
import type { Lang } from '@/lib/types'

const shell = 'canvas !overflow-auto !cursor-default grid place-items-center p-4'
const card = 'float w-full max-w-sm p-6 flex flex-col gap-3'
const field = 'h-10 rounded-lg border border-input bg-white px-3 outline-none focus:ring-2 focus:ring-ring/40'
const primary = 'h-10 rounded-lg bg-ink text-white disabled:opacity-40'

const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export function SetupScreen({ needsCode, initialCode = '' }: { needsCode: boolean; initialCode?: string }) {
  const [lang, setLang] = useState<Lang>('ru')
  const t = (k: string) => translate(lang, k)
  const [name, setName] = useState('')
  const [familyName, setFamilyName] = useState('')
  const [code, setCode] = useState(initialCode)
  const [demo, setDemo] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <main className={shell}>
      <form className={card} onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        const r = await post('/api/auth/family/setup', { name, familyName, language: lang, demo, code })
        if (r.ok) location.href = '/'
        else { setBusy(false); setError((await r.json().catch(() => null))?.message ?? 'error') }
      }}>
        <h1 className="font-serif text-2xl font-medium">{t('Семейный архив')}</h1>
        <p className="text-ink-soft -mt-2 text-[13px]">{t('Вы станете владельцем архива.')}</p>
        <div className="flex gap-1">
          {(['ru', 'en'] as const).map((l) => <button type="button" key={l} onClick={() => setLang(l)} className={lang === l ? 'bar-btn on' : 'bar-btn'}>{l === 'ru' ? 'Русский' : 'English'}</button>)}
        </div>
        <input required autoFocus className={field} placeholder={t('Ваше имя')} value={name} onChange={(e) => setName(e.target.value)} />
        <input required className={field} placeholder={t('Название семьи')} value={familyName} onChange={(e) => setFamilyName(e.target.value)} />
        {needsCode && <input required className={field} placeholder={t('Код настройки')} value={code} onChange={(e) => setCode(e.target.value)} />}
        <label className="flex items-center gap-2 text-ink-soft text-[13px]"><input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} /> {t('Загрузить демо-семью')}</label>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <button className={primary} disabled={busy}>{t('Создать архив')}</button>
      </form>
    </main>
  )
}

export function LoginScreen({ lang, familyName, providers }: { lang: Lang; familyName: string; providers: { google: boolean; yandex: boolean } }) {
  const t = (k: string) => translate(lang, k)
  const go = async (url: string, body: unknown) => {
    const j = await (await post(url, body)).json()
    if (j.url) location.href = j.url
  }
  return (
    <main className={shell}>
      <div className={card}>
        <h1 className="font-serif text-2xl font-medium">{familyName || t('Семейный архив')}</h1>
        <p className="font-medium">{t('Вход только по приглашению')}</p>
        <p className="text-ink-soft text-[13px] -mt-2">{t('Попросите родственника прислать ссылку.')}</p>
        {providers.google && <button className="bar-btn border border-border !h-10" onClick={() => go('/api/auth/sign-in/social', { provider: 'google', callbackURL: '/' })}>{t('Войти через Google')}</button>}
        {providers.yandex && <button className="bar-btn border border-border !h-10" onClick={() => go('/api/auth/sign-in/oauth2', { providerId: 'yandex', callbackURL: '/' })}>{t('Войти через Яндекс ID')}</button>}
      </div>
    </main>
  )
}

export function InviteScreen({ token, lang, familyName, name, valid }: { token: string; lang: Lang; familyName: string; name: string; valid: boolean }) {
  const t = (k: string) => translate(lang, k)
  const [busy, setBusy] = useState(false)
  return (
    <main className={shell}>
      <div className={card}>
        {valid ? (
          <>
            <p className="text-ink-soft text-[13px]">{t('Вас пригласили в семейный архив')}</p>
            <h1 className="font-serif text-2xl font-medium -mt-2">{familyName}</h1>
            <p>{name}</p>
            {/* A button, not an automatic sign-in: link previews in messengers must not burn the one-time link. */}
            <button className={primary} disabled={busy} onClick={async () => {
              setBusy(true)
              const r = await post('/api/auth/family/accept', { token })
              if (r.ok) location.href = '/'
              else location.reload()
            }}>{t('Войти')}</button>
          </>
        ) : (
          <>
            <h1 className="font-serif text-xl font-medium">{t('Ссылка недействительна')}</h1>
            <p className="text-ink-soft text-[13px]">{t('Ссылка устарела или уже использована. Попросите новую.')}</p>
          </>
        )}
      </div>
    </main>
  )
}
