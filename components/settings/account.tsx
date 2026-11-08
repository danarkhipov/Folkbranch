'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronsUpDown, LogOut, MonitorX, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/ui/section'
import { api, useApp } from '@/lib/client'
import { draftsLeft } from '@/lib/autosave'
import { signOut } from '@/lib/sign-out'
import { personName } from '@/lib/types'
import type { SignInMethods } from '@/lib/sign-in-methods'
import { MailCode, OAuthButtons, TelegramButton, authPost } from '../sign-in-buttons'
import { PersonPopover } from '../person-pickers'
import { roleHelp, roleName } from './roles'

/** Who I am here: my card on the chart, how I get back in, where I am signed in. */
export function Account({ providers }: { providers: SignInMethods }) {
  const { t, me, byId, notify, confirm } = useApp()
  const mine = me.personId ? byId.get(me.personId) : null
  const claim = async (personId: string | null) => {
    try {
      await api('me', { method: 'PATCH', json: { personId } })
      location.reload()
    } catch (e) {
      notify((e as Error).message)
    }
  }
  return (
    <div className="flex min-w-0 flex-col gap-7 text-sm">
      <Section title={`${me.name} · ${t(roleName[me.role])}`} description={t(roleHelp[me.role])} />
      {me.role !== 'reader' && (
        <Section title={t('Моя карточка на схеме')} description={t('Выберите себя, и схема покажет, кем вам приходится каждый человек. Подойдёт только живой человек.')}>
          <div className="flex flex-wrap items-center gap-2">
            <PersonPopover onPick={claim} exclude={[...byId.values()].filter((p) => !p.living || p.deathDate).map((p) => p.id)}>
              <button type="button" className="flex h-9 min-w-48 max-w-64 items-center justify-between gap-1.5 rounded-lg border border-input bg-white pl-3 pr-2.5 text-left"><span className="truncate">{mine ? personName(mine) : t('Выбрать свою карточку')}</span><ChevronsUpDown size={14} className="flex-none text-ink-soft" /></button>
            </PersonPopover>
            {mine && <Button type="button" size="sm" variant="ghost" onClick={() => claim(null)}><X /> {t('Убрать')}</Button>}
          </div>
        </Section>
      )}
      {!me.guest && (providers.google || providers.yandex || providers.vk || providers.telegram || providers.email) && <SignInWays providers={providers} />}
      <Section title={t('Устройства')} description={t('Если потеряли телефон или входили на чужом компьютере, выйдите на других устройствах. Вернуться можно по новой ссылке или через привязанный аккаунт.')}>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={async () => { await fetch('/api/auth/revoke-other-sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); notify(t('Другие устройства отключены')) }}><MonitorX /> {t('Выйти на других устройствах')}</Button>
          <Button type="button" variant="outline" onClick={async () => { if (!draftsLeft().length || await confirm(t('На этом устройстве есть текст, который ещё не дошёл до сервера. После выхода его не будет.'), t('Выйти'))) await signOut() }}><LogOut /> {t('Выйти с этого устройства')}</Button>
        </div>
      </Section>
    </div>
  )
}

/** What this account can come back in with, besides a new link. */
function SignInWays({ providers }: { providers: SignInMethods }) {
  const { t, notify } = useApp()
  const qc = useQueryClient()
  const { data: accounts = [] } = useQuery({ queryKey: ['my-accounts'], queryFn: async () => ((await (await fetch('/api/auth/list-accounts')).json()) as { providerId: string }[]).map((a) => a.providerId) })
  const { data: email } = useQuery({ queryKey: ['my-email'], queryFn: async () => ((await (await fetch('/api/auth/get-session')).json())?.user?.email as string | undefined) ?? '' })
  // Relatives who came by a link have a stand-in address; it is not shown as theirs.
  const realEmail = email && !/\.invalid$/.test(email) ? email : ''
  const [mailOpen, setMailOpen] = useState(false)
  const [telegramError, setTelegramError] = useState('')
  const telegram = async (data: Record<string, unknown>) => {
    const r = await authPost('/api/auth/family/telegram/link', data)
    if (r.ok) { notify(t('Telegram привязан')); void qc.invalidateQueries({ queryKey: ['my-accounts'] }) }
    else setTelegramError(r.status === 409 ? t('Этот Telegram уже привязан к другому человеку в архиве.') : t('Telegram не подтвердил вход. Попробуйте ещё раз.'))
  }
  return (
    <Section title={t('Вход без ссылки')} description={t('Привяжите удобный способ, чтобы входить снова без новой ссылки.')}>
      <div className="flex flex-wrap gap-2">
        <OAuthButtons methods={providers} t={t} link linked={accounts} />
      </div>
      {providers.telegram && (
        <div className="flex flex-col items-start gap-1">
          {accounts.includes('telegram') ? <p className="text-sm">Telegram: {t('привязан')}</p> : <TelegramButton bot={providers.telegram} onAuth={telegram} />}
          {telegramError && <p role="alert" className="text-sm text-destructive">{telegramError}</p>}
        </div>
      )}
      {providers.email && (
        <div className="flex max-w-sm flex-col gap-2">
          <p className="text-sm break-anywhere">{realEmail ? `${t('Почта для входа')}: ${realEmail}` : t('Добавьте почту, и на неё будет приходить код для входа.')}</p>
          {mailOpen
            ? <MailCode t={t} mode="change" onDone={() => { setMailOpen(false); notify(t('Почта сохранена')); void qc.invalidateQueries({ queryKey: ['my-email'] }) }} />
            : <Button type="button" variant="outline" className="self-start" onClick={() => setMailOpen(true)}>{realEmail ? t('Сменить почту') : t('Добавить почту')}</Button>}
        </div>
      )}
    </Section>
  )
}
