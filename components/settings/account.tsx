'use client'
import { ChevronsUpDown, LogOut, MonitorX, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/ui/section'
import { api, useApp } from '@/lib/client'
import { draftsLeft } from '@/lib/autosave'
import { signOut } from '@/lib/sign-out'
import { personName } from '@/lib/types'
import { Brand } from '../brand-icons'
import { PersonPopover } from '../person-pickers'
import { roleHelp, roleName } from './roles'

/** Who I am here: my card on the chart, how I get back in, where I am signed in. */
export function Account({ providers }: { providers: { google: boolean; yandex: boolean } }) {
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
      {(providers.google || providers.yandex) && (
        <Section title={t('Вход без ссылки')} description={t('Привяжите аккаунт, чтобы входить снова без новой ссылки.')}>
          <div className="flex flex-wrap gap-2">
            {providers.google && <Button variant="outline" onClick={() => linkAccount('/api/auth/link-social', { provider: 'google', callbackURL: '/' })}><Brand name="google" /> {t('Привязать Google')}</Button>}
            {providers.yandex && <Button variant="outline" onClick={() => linkAccount('/api/auth/oauth2/link', { providerId: 'yandex', callbackURL: '/' })}><Brand name="yandex" className="text-[#fc3f1d]" /> {t('Привязать Яндекс ID')}</Button>}
          </div>
        </Section>
      )}
      <Section title={t('Устройства')} description={t('Если потеряли телефон или входили на чужом компьютере, выйдите на других устройствах. Вернуться можно по новой ссылке или через привязанный аккаунт.')}>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={async () => { await fetch('/api/auth/revoke-other-sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); notify(t('Другие устройства отключены')) }}><MonitorX /> {t('Выйти на других устройствах')}</Button>
          <Button type="button" variant="outline" onClick={async () => { if (!draftsLeft().length || await confirm(t('На этом устройстве есть текст, который ещё не дошёл до сервера. После выхода его не будет.'), t('Выйти'))) await signOut() }}><LogOut /> {t('Выйти с этого устройства')}</Button>
        </div>
      </Section>
    </div>
  )
}

async function linkAccount(url: string, body: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json()
  if (j.url) location.href = j.url
}
