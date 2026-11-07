'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Link2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyField } from '@/components/ui/copy'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { List, ListRow, Section } from '@/components/ui/section'
import { Select } from '@/components/ui/select'
import { api, useApp, useLinkOrigin } from '@/lib/client'
import type { ChartView } from '@/lib/ops/views'
import { StoryRequests } from './story-requests'

interface Share { id: string; name: string; viewId: string | null; hasPassword: boolean; expiresAt: number | null; opens: number }

/** One file to send to relatives: it opens anywhere, with no server, so a home install can share too. */
function FamilyFile() {
  const { t } = useApp()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const [error, setError] = useState('')
  const make = async () => {
    setBusy(true)
    setDone('')
    setError('')
    try {
      const r = await fetch('/api/family-file')
      if (!r.ok) throw new Error(t('Не удалось подготовить файл'))
      const stats = JSON.parse(r.headers.get('X-Family-File') ?? '{}')
      const name = decodeURIComponent(r.headers.get('Content-Disposition')?.split("''")[1] ?? 'family.html')
      const url = URL.createObjectURL(await r.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
      setDone(`${t('Людей')}: ${stats.people}. ${t('Живых скрыто')}: ${stats.hidden}. ${t('Фотографий')}: ${stats.photos}${stats.photosLeftOut ? `, ${t('не поместилось')}: ${stats.photosLeftOut}` : ''}. ${stats.bytes < 1048576 ? `${Math.ceil(stats.bytes / 1024)} ${t('КБ')}` : `${(stats.bytes / 1048576).toFixed(1)} ${t('МБ')}`}.`)
    } catch (x) {
      setError(String((x as Error).message ?? x))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section title={t('Файл для родных')} description={t('Один файл со схемой, карточками и фото. Отправьте его в мессенджере: родные откроют его без интернета и регистрации. Живые родственники скрыты, но текст биографий и подписи к фото попадают как написаны: проверьте, нет ли в них имён живых.')}>
      <Button className="self-start" disabled={busy} onClick={make}><Download /> {busy ? t('Готовим файл…') : t('Скачать файл для родных')}</Button>
      {done && <p role="status" className="text-xs text-ink-soft">{done}</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </Section>
  )
}

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
  const [error, setError] = useState('')
  const origin = useLinkOrigin()
  const refresh = () => qc.invalidateQueries({ queryKey: ['shares'] })
  const date = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric' })
  return (
    <div className="flex min-w-0 flex-col gap-7 text-sm">
      <FamilyFile />
      <StoryRequests />
      <Section title={t('Ссылка для просмотра')} description={t('Для тех, кому не нужен вход: только смотреть, без регистрации. Живые родственники скрыты, как у читателя.')}>
        <form className="flex flex-col gap-3" onSubmit={async (e) => {
          e.preventDefault()
          setError('')
          try {
            const { token } = await api<{ token: string }>('shares', { json: { name: name.trim(), viewId: viewId || null, expiresInDays: days ? Number(days) : null, ...(password ? { password } : {}) } })
            setLink(`${origin}/share/${token}`)
            setName('')
            setPassword('')
            refresh()
          } catch (x) {
            setError(String((x as Error).message ?? x))
          }
        }}>
          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <Field label={t('Для кого')}><Input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label={t('Что показать по ссылке')}><Select aria-label={t('Что показать по ссылке')} value={viewId} onChange={setViewId} options={[{ value: '', label: t('Всю семью') }, ...named.map((v) => ({ value: v.id, label: v.name }))]} /></Field>
            <Field label={t('Срок')}><Select aria-label={t('Срок')} value={days} onChange={setDays} options={[{ value: '7', label: t('7 дней') }, { value: '30', label: t('30 дней') }, { value: '90', label: t('90 дней') }, { value: '', label: t('Пока не закрою') }]} /></Field>
            <Field label={t('Пароль (необязательно)')}><Input type="text" autoComplete="off" minLength={4} maxLength={200} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          </div>
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          <Button className="self-start" disabled={!name.trim()}><Link2 /> {t('Создать ссылку')}</Button>
          {link && <CopyField label={t('Отправьте эту ссылку человеку')} value={link} primary />}
        </form>
      </Section>
      <Section title={t('Открытые ссылки')}>
        {!links.length && <p className="text-xs text-ink-soft">{t('Пока ни одной.')}</p>}
        <List>
          {links.map((l) => <ListRow key={l.id} title={l.name} meta={[l.viewId ? (named.find((v) => v.id === l.viewId)?.name ?? '') : t('Всю семью'), l.hasPassword && t('с паролем'), l.expiresAt ? `${t('до')} ${date.format(l.expiresAt)}` : t('Пока не закрою'), `${t('открывали')}: ${l.opens}`].filter(Boolean).join(' · ')} actions={<Button size="sm" variant="danger" onClick={async () => { if (await ask(`${t('Закрыть ссылку')}: ${l.name}?`, t('Закрыть ссылку'))) { await api(`shares/${l.id}`, { method: 'DELETE' }); refresh() } }}><X /> {t('Закрыть ссылку')}</Button>} />)}
        </List>
      </Section>
    </div>
  )
}
