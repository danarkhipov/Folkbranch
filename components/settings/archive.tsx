'use client'
import { useState } from 'react'
import { Check } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { api, useApp } from '@/lib/client'
import { LANG_NAMES, LANGS } from '@/lib/languages'
import { type Lang } from '@/lib/types'

export function Archive({ familyName, lang }: { familyName: string; lang: Lang }) {
  const { t } = useApp()
  const router = useRouter()
  const [name, setName] = useState(familyName)
  const [saved, setSaved] = useState(false)
  const save = async (json: unknown) => {
    await api('settings', { method: 'PATCH', json })
    router.refresh()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }
  return (
    <div className="flex min-w-0 max-w-md flex-col gap-7 text-sm">
      <div className="flex flex-col gap-3">
        <Field label={t('Название семьи')} hint={t('Видно всем в верхней панели. Сохраняется само.')}><Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== familyName && name && save({ familyName: name })} /></Field>
        <Field label={t('Язык')} hint={t('Язык интерфейса и новых записей в истории для всех участников.')}><Select aria-label={t('Язык')} value={lang} onChange={(language) => save({ language })} options={LANGS.map((l) => ({ value: l, label: LANG_NAMES[l] }))} /></Field>
        {saved && <p role="status" className="flex items-center gap-1 text-xs text-ink-soft"><Check size={13} /> {t('Сохранено')}</p>}
      </div>
    </div>
  )
}
