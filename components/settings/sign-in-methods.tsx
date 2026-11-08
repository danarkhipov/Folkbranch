'use client'
import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyField } from '@/components/ui/copy'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Section } from '@/components/ui/section'
import { api, useApp } from '@/lib/client'
import { Brand } from '../brand-icons'

type MethodId = 'google' | 'yandex' | 'vk' | 'telegram' | 'email'
interface Method { id: MethodId; on: boolean; source: 'server' | 'app' | null; values: Record<string, string>; returnAddress: string | null; env: string[] }
interface Status { address: string; domain: string; secure: boolean; methods: Method[] }

const link = (href: string, text: string) => <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline underline-offset-2">{text}<ExternalLink size={11} /></a>

/** A step of a guide: [words](address) becomes a link, {domain} the archive's own domain. */
function Rich({ text, domain }: { text: string; domain: string }) {
  const parts = text.replace('{domain}', '\u0000').split(/(\[[^\]]+\]\([^)]+\)|\u0000)/)
  return <>{parts.map((p, i) => {
    if (p === '\u0000') return <b key={i} className="font-medium break-anywhere">{domain}</b>
    const m = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    return m ? <span key={i}>{link(m[2], m[1])}</span> : p
  })}</>
}

/** Who each way suits, the steps on the provider's side, and the fields it needs. Steps are short on purpose. */
const GUIDE: Record<MethodId, { name: string; icon: ReactNode; who: string; steps: string[]; fields: [string, string, string?][] }> = {
  yandex: {
    name: 'Яндекс ID', icon: <Brand name="yandex" className="text-[#fc3f1d]" />, who: 'Самый привычный вход в России: аккаунт Яндекса есть почти у всех.',
    steps: [
      'Откройте [oauth.yandex.ru](https://oauth.yandex.ru/client/new) и создайте приложение для веб-сервисов.',
      'В доступах отметьте «Доступ к адресу электронной почты» и «Доступ к логину, имени и фамилии».',
      'В поле Redirect URI вставьте адрес возврата ниже.',
      'Скопируйте сюда ClientID и Client secret.',
    ],
    fields: [['clientId', 'ClientID'], ['clientSecret', 'Client secret', 'secret']],
  },
  vk: {
    name: 'VK ID', icon: <Brand name="vk" className="text-[#0077ff]" />, who: 'Вход через ВКонтакте, а ещё через Mail.ru и Одноклассники.',
    steps: [
      'Откройте [id.vk.com/about/business](https://id.vk.com/about/business/go) и создайте приложение, платформа Web.',
      'Базовый домен: {domain}. Доверенный Redirect URL: адрес возврата ниже.',
      'Скопируйте сюда ID приложения и защищённый ключ.',
    ],
    fields: [['clientId', 'ID приложения'], ['clientSecret', 'Защищённый ключ', 'secret']],
  },
  telegram: {
    name: 'Telegram', icon: <Brand name="telegram" className="text-[#26a5e4]" />, who: 'Одна кнопка, если Telegram есть на телефоне. Ничего запоминать не нужно.',
    steps: [
      'В Telegram напишите [@BotFather](https://t.me/BotFather) команду /newbot и придумайте боту имя.',
      'Отправьте ему /setdomain, выберите бота и пришлите домен {domain}.',
      'Скопируйте сюда токен, который прислал @BotFather.',
    ],
    fields: [['botToken', 'Токен бота', 'secret']],
  },
  google: {
    name: 'Google', icon: <Brand name="google" />, who: 'Для тех, у кого Gmail или телефон на Android.',
    steps: [
      'Откройте [Google Cloud Console](https://console.cloud.google.com/auth/overview), создайте проект и заполните экран входа: название и вашу почту, тип External.',
      'В разделе Clients создайте клиента Web application. В Authorized redirect URIs вставьте адрес возврата ниже.',
      'Скопируйте сюда Client ID и Client secret.',
      'Пока приложение в режиме Testing, Google пускает только тестовых пользователей. Добавьте их в разделе Audience или нажмите Publish app.',
    ],
    fields: [['clientId', 'Client ID'], ['clientSecret', 'Client secret', 'secret']],
  },
  email: {
    name: 'Код на почту', icon: <Mail size={16} />, who: 'Подходит всем: на почту приходит код из шести цифр. Нужен почтовый ящик, с которого архив будет его отправлять.',
    steps: [
      'Заведите для архива отдельный ящик или возьмите свой.',
      'Создайте в нём пароль приложения: [в Яндексе](https://id.yandex.ru/security/app-passwords), [в Mail.ru](https://account.mail.ru/user/2-step-auth/passwords) или [в Gmail](https://myaccount.google.com/apppasswords). Обычный пароль от почты не подойдёт.',
      'Выберите почту ниже и вставьте адрес ящика и этот пароль.',
    ],
    fields: [['user', 'Адрес ящика'], ['password', 'Пароль приложения', 'secret'], ['host', 'Сервер SMTP'], ['port', 'Порт']],
  },
}
const ORDER: MethodId[] = ['yandex', 'vk', 'telegram', 'google', 'email']
const pressed = 'aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-white aria-pressed:hover:bg-ink'
const MAIL_PRESETS: [string, string, string][] = [['Яндекс', 'smtp.yandex.ru', '465'], ['Mail.ru', 'smtp.mail.ru', '465'], ['Gmail', 'smtp.gmail.com', '465']]

function MethodForm({ status, method, onDone }: { status: Status; method: Method; onDone: () => void }) {
  const { t, notify } = useApp()
  const guide = GUIDE[method.id]
  const [values, setValues] = useState<Record<string, string>>(method.id === 'email' ? { host: 'smtp.yandex.ru', port: '465' } : {})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: string, v: string) => setValues((x) => ({ ...x, [k]: v }))
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await api(`sign-in-methods/${method.id}`, { method: 'PUT', json: values })
      notify(`${t(guide.name)}: ${t('вход включён')}`)
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="flex flex-col gap-3 rounded-lg border border-border bg-white/60 p-3" onSubmit={(e) => { e.preventDefault(); void save() }}>
      <ol className="ml-4 flex list-decimal flex-col gap-1 text-sm leading-snug">
        {guide.steps.map((s, i) => <li key={i}><Rich text={t(s)} domain={status.domain} /></li>)}
      </ol>
      {method.returnAddress && <CopyField label={t('Адрес возврата')} value={method.returnAddress} />}
      {method.id === 'telegram' && <CopyField label={t('Домен')} value={status.domain} />}
      {method.id === 'email' && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('Почта')}>
          {MAIL_PRESETS.map(([name, host, port]) => (
            <Button key={host} type="button" size="sm" variant="outline" className={pressed} aria-pressed={values.host === host} onClick={() => setValues((x) => ({ ...x, host, port }))}>{t(name)}</Button>
          ))}
          <Button type="button" size="sm" variant="outline" className={pressed} aria-pressed={!MAIL_PRESETS.some(([, h]) => h === values.host)} onClick={() => setValues((x) => ({ ...x, host: '' }))}>{t('Другая')}</Button>
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {guide.fields.map(([key, label, kind]) => (
          <Field key={key} label={t(label)}>
            <Input value={values[key] ?? ''} onChange={(e) => set(key, e.target.value)} type={kind === 'secret' ? 'password' : key === 'user' ? 'email' : 'text'} autoComplete="off" spellCheck={false} required={key !== 'port'} inputMode={key === 'port' ? 'numeric' : undefined} />
          </Field>
        ))}
      </div>
      {error && <p role="alert" className="text-sm text-destructive break-anywhere">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>{busy ? t('Проверяю…') : t('Проверить и включить')}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>{t('Отмена')}</Button>
      </div>
    </form>
  )
}

/** The owner turns each way into the archive on or off; nobody gets in who was not invited first. */
export function SignInMethods() {
  const { t, confirm: ask, lang } = useApp()
  const qc = useQueryClient()
  const router = useRouter()
  const { data } = useQuery({ queryKey: ['sign-in-methods'], queryFn: () => api<Status>('sign-in-methods') })
  const [open, setOpen] = useState<MethodId | null>(null)
  if (!data) return null
  // The page was drawn with the old list of ways; My account and the sign-in page need the new one.
  const done = () => { setOpen(null); void qc.invalidateQueries({ queryKey: ['sign-in-methods'] }); router.refresh() }
  const off = async (m: Method) => {
    if (!await ask(`${t('Выключить вход')}: ${t(GUIDE[m.id].name)}?`, t('Выключить'), t('Кто входил так, войдёт другим способом или по новой ссылке.'))) return
    await api(`sign-in-methods/${m.id}`, { method: 'DELETE' })
    done()
  }
  return (
    <div className="flex min-w-0 flex-col gap-7">
      <Section title={t('Как родные входят')} description={t('Первый раз человек всегда входит по ссылке-приглашению. Потом в «Моём аккаунте» он привязывает удобный способ и входит им без ссылок. Чужой войти не сможет: каждый способ пускает только тех, кто уже есть в архиве.')}>
        {!data.secure && <p className="rounded-lg bg-muted px-3 py-2 text-sm">{t('Сейчас архив открыт по адресу без https. Яндекс, VK, Telegram и Google работают только с https: сначала откройте архив по своему домену.')}</p>}
      </Section>
      <div className="flex min-w-0 flex-col divide-y divide-border">
        {ORDER.map((id) => {
          const m = data.methods.find((x) => x.id === id)!
          const g = GUIDE[id]
          return (
            <div key={id} className="flex min-w-0 flex-col gap-2 py-3">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
                <div className="flex min-w-40 flex-1 basis-56 items-start gap-2.5">
                  <span className="mt-0.5 flex-none">{g.icon}</span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{t(g.name)} <span className={m.on ? 'ml-1 text-xs font-normal text-[#2f7a4f]' : 'ml-1 text-xs font-normal text-ink-soft'}>{m.on ? t('включён') : t('выключен')}</span></div>
                    <p className="text-xs leading-snug text-ink-soft">{t(g.who)}</p>
                    {m.source === 'server' && <p className="text-xs text-ink-soft">{t('Задан в настройках сервера')}: {m.env.join(', ')}</p>}
                    {m.source === 'app' && id === 'telegram' && m.values.botName && <p className="text-xs text-ink-soft">@{m.values.botName}</p>}
                    {m.source === 'app' && id === 'email' && <p className="text-xs text-ink-soft break-anywhere">{t('Письма уходят с')} {m.values.from || m.values.user}</p>}
                  </div>
                </div>
                {m.source !== 'server' && open !== id && (
                  <div className="flex flex-none gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => setOpen(id)}>{m.on ? t('Заменить ключи') : t('Включить')}</Button>
                    {m.on && <Button size="sm" variant="ghost" onClick={() => off(m)}>{t('Выключить')}</Button>}
                  </div>
                )}
              </div>
              {open === id && <MethodForm status={data} method={m} onDone={done} />}
            </div>
          )
        })}
      </div>
      <p className="text-xs leading-snug text-ink-soft">{t('Входа по SMS нет: каждое сообщение стоит денег. Telegram и VK ID тоже привязаны к номеру телефона и бесплатны.')} {link(`https://github.com/danarkhipov/folkbranch/blob/main/docs/${lang === 'ru' ? 'SIGN_IN.ru.md' : 'SIGN_IN.md'}`, t('Подробнее о способах входа'))}</p>
    </div>
  )
}
