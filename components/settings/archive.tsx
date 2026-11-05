'use client'
import { useState } from 'react'
import { api, useApp } from '@/lib/client'
import { type Lang } from '@/lib/types'

export function Archive({ familyName, lang }: { familyName: string; lang: Lang }) {
  const { t } = useApp()
  const [name, setName] = useState(familyName)
  const save = (json: unknown) => api('settings', { method: 'PATCH', json }).then(() => location.reload())
  return (
    <div className="flex max-w-sm flex-col gap-3 text-sm">
      <label className="flex flex-col gap-1 text-ink-soft">{t('Название семьи')}
        <input className="h-9 rounded-lg border border-input bg-white px-3 text-ink" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== familyName && name && save({ familyName: name })} />
      </label>
      <label className="flex flex-col gap-1 text-ink-soft">{t('Язык')}
        <select className="h-9 rounded-lg border border-input bg-white px-2 text-ink" value={lang} onChange={(e) => save({ language: e.target.value })}>
          <option value="ru">Русский</option><option value="en">English</option>
        </select>
      </label>
    </div>
  )
}
