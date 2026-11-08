'use client'
import { useEffect, useRef, useState } from 'react'
import { inputClass } from '@/components/ui/input'
import { buttonVariants } from '@/components/ui/button'
import type { SignInMethods } from '@/lib/sign-in-methods'
import { Brand } from './brand-icons'

export const authPost = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

/** Off to Google, Yandex or VK: the provider brings the person back to the address the server names. */
export async function goOAuth(id: 'google' | 'yandex' | 'vk', link = false) {
  const url = link ? '/api/auth/link-social' : '/api/auth/sign-in/social'
  const j = await (await authPost(url, { provider: id, callbackURL: '/', errorCallbackURL: link ? '/' : '/login' })).json().catch(() => ({}))
  if (j.url) location.href = j.url
}

const OAUTH = [['yandex', 'Яндекс ID', 'text-[#fc3f1d]'], ['vk', 'VK ID', 'text-[#0077ff]'], ['google', 'Google', '']] as const

/** One button per way the owner switched on, in the order most people in Russia would look for them. */
export function OAuthButtons({ methods, t, link, linked = [] }: { methods: SignInMethods; t: (k: string) => string; link?: boolean; linked?: string[] }) {
  return <>{OAUTH.filter(([id]) => methods[id]).map(([id, name, color]) => (
    <button key={id} type="button" className={buttonVariants({ variant: 'outline', size: link ? 'default' : 'lg' })} disabled={linked.includes(id)} onClick={() => goOAuth(id, link)}>
      <Brand name={id} className={color} /> {linked.includes(id) ? `${t(name)}: ${t('привязан')}` : `${link ? t('Привязать') : t('Войти через')} ${t(name)}`}
    </button>
  ))}</>
}

/**
 * Telegram's own sign-in button. It is drawn by Telegram in a frame and hands back signed data, which
 * the server checks with the bot's token. It works only at the domain the bot was given in @BotFather.
 */
export function TelegramButton({ bot, onAuth }: { bot: string; onAuth: (data: Record<string, unknown>) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const latest = useRef(onAuth)
  latest.current = onAuth
  useEffect(() => {
    const el = box.current
    if (!el) return
    const name = `folkbranchTelegram${Math.random().toString(36).slice(2)}`
    ;(window as unknown as Record<string, unknown>)[name] = (user: Record<string, unknown>) => latest.current(user)
    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.async = true
    script.dataset.telegramLogin = bot
    script.dataset.size = 'large'
    script.dataset.radius = '8'
    script.dataset.onauth = `${name}(user)`
    el.appendChild(script)
    return () => {
      delete (window as unknown as Record<string, unknown>)[name]
      el.replaceChildren()
    }
  }, [bot])
  return <div ref={box} className="flex min-h-10 justify-center" />
}

/**
 * A code sent by mail. `mode` sign-in asks for the address already on an account; change sets the
 * address on one's own account, which is how a relative who came by a link gets one.
 */
export function MailCode({ t, mode, onDone }: { t: (k: string) => string; mode: 'sign-in' | 'change'; onDone: () => void }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const send = async () => {
    setBusy(true)
    setError('')
    const r = mode === 'sign-in'
      ? await authPost('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' })
      : await authPost('/api/auth/email-otp/request-email-change', { newEmail: email })
    setBusy(false)
    if (r.ok) setSent(true)
    else setError(r.status === 429 ? t('Слишком много попыток. Подождите минуту.') : t('Не получилось отправить код. Проверьте адрес.'))
  }
  const check = async () => {
    setBusy(true)
    setError('')
    const r = mode === 'sign-in'
      ? await authPost('/api/auth/sign-in/email-otp', { email, otp: code })
      : await authPost('/api/auth/email-otp/change-email', { newEmail: email, otp: code })
    setBusy(false)
    if (r.ok) onDone()
    else setError(r.status === 429 ? t('Слишком много попыток. Подождите минуту.') : mode === 'sign-in' ? t('Код не подошёл, или эта почта ещё не привязана ни к кому в архиве.') : t('Код не подошёл. Проверьте его или попросите новый.'))
  }
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void (sent ? check() : send()) }}>
      {!sent ? (
        <>
          <label className="flex flex-col gap-1 text-sm">
            {mode === 'sign-in' ? t('Почта') : t('Ваша почта')}
            <input className={inputClass} type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value.trim())} />
          </label>
          <button className={buttonVariants({ variant: mode === 'sign-in' ? 'outline' : 'default', size: mode === 'sign-in' ? 'lg' : 'default' })} disabled={busy || !email}>{t('Прислать код')}</button>
        </>
      ) : (
        <>
          <p className="text-sm break-anywhere">{t('Код отправлен на')} {email}. {t('Если письма нет, загляните в «Спам».')}</p>
          <label className="flex flex-col gap-1 text-sm">
            {t('Код из письма')}
            <input className={inputClass} autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]*" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
          </label>
          <div className="flex flex-wrap gap-2">
            <button className={buttonVariants({ size: mode === 'sign-in' ? 'lg' : 'default' })} disabled={busy || code.length < 6}>{mode === 'sign-in' ? t('Войти') : t('Подтвердить')}</button>
            <button type="button" className={buttonVariants({ variant: 'ghost', size: mode === 'sign-in' ? 'lg' : 'default' })} onClick={() => { setSent(false); setCode(''); setError('') }}>{t('Другая почта')}</button>
          </div>
        </>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </form>
  )
}
