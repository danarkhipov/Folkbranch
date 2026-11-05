'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy } from 'lucide-react'
import { api, useApp } from '@/lib/client'
import type { ChartView } from '@/lib/ops/views'

interface Share { id: string; name: string; viewId: string | null; hasPassword: boolean; expiresAt: number | null; opens: number }

/** Viewing without an account: for a relative who will never sign up. */
export function ShareLinks() {
  const { t, lang, confirm: ask } = useApp()
  const qc = useQueryClient()
  const { data: links = [] } = useQuery({ queryKey: ['shares'], queryFn: () => api<Share[]>('shares') })
  const { data: views = [] } = useQuery({ queryKey: ['views'], queryFn: () => api<ChartView[]>('views') })
  const named = views.filter((v) => v.id !== 'main')
  const [name, setName] = useState('')
  const [viewId, setViewId] = useState('')
  const [days, setDays] = useState('30')
  const [password, setPassword] = useState('')
  const [link, setLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const refresh = () => qc.invalidateQueries({ queryKey: ['shares'] })
  const date = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric' })
  const select = 'h-9 min-w-0 rounded-lg border border-input bg-white px-2 text-sm text-ink'
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-base font-medium">{t('Ссылка для просмотра')}</h3>
      <p className="text-xs text-ink-soft">{t('Для тех, кому не нужен вход: только смотреть, без регистрации. Живые родственники скрыты, как у читателя.')}</p>
      <form className="flex flex-col gap-2" onSubmit={async (e) => {
        e.preventDefault()
        setError('')
        try {
          const { token } = await api<{ token: string }>('shares', { json: { name: name.trim(), viewId: viewId || null, expiresInDays: days ? Number(days) : null, ...(password ? { password } : {}) } })
          setLink(`${location.origin}/share/${token}`)
          setCopied(false)
          setName('')
          setPassword('')
          refresh()
        } catch (x) {
          setError(String((x as Error).message ?? x))
        }
      }}>
        <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
          <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Для кого')}
            <input className="h-9 min-w-0 rounded-lg border border-input bg-white px-3 text-sm text-ink" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Что показать по ссылке')}
            <select className={select} value={viewId} onChange={(e) => setViewId(e.target.value)}>
              <option value="">{t('Всю семью')}</option>
              {named.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Срок')}
            <select className={select} value={days} onChange={(e) => setDays(e.target.value)}>
              <option value="7">{t('7 дней')}</option>
              <option value="30">{t('30 дней')}</option>
              <option value="90">{t('90 дней')}</option>
              <option value="">{t('Пока не закрою')}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Пароль (необязательно)')}
            <input className="h-9 min-w-0 rounded-lg border border-input bg-white px-3 text-sm text-ink" type="text" autoComplete="off" minLength={4} maxLength={200} value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        </div>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <button className="h-9 self-start rounded-lg bg-ink px-3 whitespace-nowrap text-white">{t('Создать ссылку')}</button>
        {link && (
          <div className="flex items-center gap-2 rounded-lg bg-muted px-2 py-1.5">
            <code className="truncate text-xs flex-1">{link}</code>
            <button type="button" className="flex items-center gap-1 text-xs hover:text-ink text-ink-soft" onClick={() => { navigator.clipboard.writeText(link); setCopied(true) }}>{copied ? <Check size={13} /> : <Copy size={13} />}{t(copied ? 'Скопировано' : 'Копировать')}</button>
          </div>
        )}
      </form>
      {links.length > 0 && (
        <div>
          <h4 className="text-base font-medium mb-1">{t('Открытые ссылки')}</h4>
          {links.map((l) => (
            <div key={l.id} className="flex items-center gap-2 py-1">
              <div className="min-w-0 flex-1">
                <div className="truncate">{l.name}</div>
                <div className="text-xs text-ink-soft truncate">
                  {[l.viewId ? (named.find((v) => v.id === l.viewId)?.name ?? '') : t('Всю семью'), l.hasPassword && t('с паролем'), l.expiresAt ? `${t('до')} ${date.format(l.expiresAt)}` : t('Пока не закрою'), `${t('открывали')}: ${l.opens}`].filter(Boolean).join(' · ')}
                </div>
              </div>
              <button className="bar-btn border border-border whitespace-nowrap" onClick={async () => { if (await ask(`${t('Закрыть ссылку')}: ${l.name}?`, t('Закрыть ссылку'))) { await api(`shares/${l.id}`, { method: 'DELETE' }); refresh() } }}>{t('Закрыть ссылку')}</button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
