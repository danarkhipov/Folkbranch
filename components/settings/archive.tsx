'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Section } from '@/components/ui/section'
import { Select } from '@/components/ui/select'
import { api, useApp } from '@/lib/client'
import { type Lang } from '@/lib/types'

export function Archive({ familyName, lang }: { familyName: string; lang: Lang }) {
  const { t } = useApp()
  const router = useRouter()
  const [name, setName] = useState(familyName)
  const [saved, setSaved] = useState(false)
  const { data: voices } = useQuery({ queryKey: ['stories', 'usage'], queryFn: () => api<{ used: number; limit: number }>('stories/usage') })
  const mb = (n: number) => Math.ceil(n / 1024 / 1024)
  const save = async (json: unknown) => {
    await api('settings', { method: 'PATCH', json })
    router.refresh()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }
  return (
    <div className="flex min-w-0 max-w-md flex-col gap-7 text-sm">
      <Section title={t('Название и язык')}>
        <Field label={t('Название семьи')} hint={t('Видно всем в верхней панели. Сохраняется само.')}><Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== familyName && name && save({ familyName: name })} /></Field>
        <Field label={t('Язык')} hint={t('Язык интерфейса и новых записей в истории для всех участников.')}><Select aria-label={t('Язык')} value={lang} onChange={(language) => save({ language })} options={[{ value: 'ru', label: 'Русский' }, { value: 'en', label: 'English' }]} /></Field>
        {saved && <p role="status" className="flex items-center gap-1 text-xs text-ink-soft"><Check size={13} /> {t('Сохранено')}</p>}
      </Section>
      {voices && (
        <Section title={t('Место под записи голоса')}>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-ink" style={{ width: `${Math.min(100, (voices.used / voices.limit) * 100)}%` }} /></div>
          <p className="text-xs text-ink-soft">{t('Записи голоса занимают')} {mb(voices.used)} {t('МБ из')} {mb(voices.limit)}.</p>
        </Section>
      )}
    </div>
  )
}
