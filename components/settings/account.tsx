'use client'
import { LogOut } from 'lucide-react'
import { api, useApp } from '@/lib/client'
import { personName } from '@/lib/types'
import { Brand } from '../brand-icons'
import { PersonPopover } from '../person-pickers'
import { roleHelp } from './roles'

/** Who I am here: my card on the chart, how I get back in, where I am signed in. */
export function Account({ providers }: { providers: { google: boolean; yandex: boolean } }) {
  const { t, me, byId, notify } = useApp()
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
    <div className="flex flex-col gap-5 text-sm">
      <section className="flex flex-col gap-1">
        <h3 className="text-base font-medium">{me.name}</h3>
        <p className="text-xs text-ink-soft">{t(roleHelp[me.role])}</p>
      </section>
      {me.role !== 'reader' && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-base font-medium">{t('Моя карточка на схеме')}</h3>
          <p className="text-xs text-ink-soft">{t('Выберите себя, и схема покажет, кем вам приходится каждый человек. Подойдёт только живой человек.')}</p>
          <div className="flex items-center gap-2">
            <PersonPopover onPick={claim} exclude={[...byId.values()].filter((p) => !p.living || p.deathDate).map((p) => p.id)}>
              <button type="button" className="h-9 max-w-64 truncate rounded-lg border border-input bg-white px-3">{mine ? personName(mine) : t('Выбрать свою карточку')}</button>
            </PersonPopover>
            {mine && <button type="button" className="text-xs text-ink-soft underline" onClick={() => claim(null)}>{t('Убрать')}</button>}
          </div>
        </section>
      )}
      {(providers.google || providers.yandex) && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-base font-medium">{t('Вход без ссылки')}</h3>
          <p className="text-xs text-ink-soft">{t('Привяжите аккаунт, чтобы входить снова без новой ссылки.')}</p>
          <div className="flex flex-wrap gap-2">
            {providers.google && <button className="bar-btn border border-border" onClick={() => linkAccount('/api/auth/link-social', { provider: 'google', callbackURL: '/' })}><Brand name="google" /> {t('Привязать Google')}</button>}
            {providers.yandex && <button className="bar-btn border border-border" onClick={() => linkAccount('/api/auth/oauth2/link', { providerId: 'yandex', callbackURL: '/' })}><Brand name="yandex" className="text-[#fc3f1d]" /> {t('Привязать Яндекс ID')}</button>}
          </div>
        </section>
      )}
      <section className="flex flex-col gap-1.5">
        <h3 className="text-base font-medium">{t('Устройства')}</h3>
        <p className="text-xs text-ink-soft">{t('Если потеряли телефон или входили на чужом компьютере. Выйдут все устройства, кроме этого.')}</p>
        <button type="button" className="bar-btn self-start border border-border" onClick={async () => { await fetch('/api/auth/revoke-other-sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); notify(t('Другие устройства отключены')) }}>{t('Выйти на других устройствах')}</button>
      </section>
      <section className="flex flex-col gap-1.5">
        <h3 className="text-base font-medium">{t('Выход')}</h3>
        <p className="text-xs text-ink-soft">{t('Войти снова можно будет по новой ссылке или через Google и Яндекс, если вы их подключили.')}</p>
        <button type="button" className="bar-btn self-start border border-border" onClick={async () => { await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); location.href = '/login' }}><LogOut size={14} /> {t('Выйти с этого устройства')}</button>
      </section>
    </div>
  )
}

async function linkAccount(url: string, body: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json()
  if (j.url) location.href = j.url
}
