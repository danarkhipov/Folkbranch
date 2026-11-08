'use client'
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, useApp } from '@/lib/client'
import { findPlace, placeChain } from '@/lib/places'
import type { Contacts } from '@/lib/types'
import { GrowText } from './person-fields'
import { usePlaces } from './places-tab'

/** Under a place as written: what it belonged to and what it was also called, once someone has said so. */
export function PlaceHint({ text }: { text: string }) {
  const { t } = useApp()
  const { data: places = [] } = usePlaces()
  const place = findPlace(text, places)
  if (!place) return null
  const up = placeChain(place, places).slice(1).map((p) => p.name)
  const also = place.otherNames.map((n) => n.name).filter((n) => n.toLowerCase() !== text.trim().toLowerCase())
  if (!up.length && !also.length) return null
  return (
    <span className="text-xs text-ink-soft break-anywhere">
      {up.join(' → ')}{up.length && also.length ? ' · ' : ''}{also.length ? `${t('также')} ${also.join(', ')}` : ''}
    </span>
  )
}

const FIELDS: [keyof Contacts, string, string][] = [['phone', 'Телефон', '+7 …'], ['email', 'Почта', 'name@example.org'], ['address', 'Адрес', 'город, улица, дом'], ['note', 'Заметка', 'например, звонить вечером']]

/** How to reach a living relative. Asked for only by editors, and kept away from everything that leaves the archive. */
export function ContactsBlock({ personId }: { personId: string }) {
  const { t, notify } = useApp()
  const qc = useQueryClient()
  const key = ['contacts', personId]
  const { data } = useQuery({ queryKey: key, queryFn: () => api<Contacts>(`persons/${personId}/contacts`) })
  const [c, setC] = useState<Contacts | null>(null)
  useEffect(() => { if (data) setC(data) }, [data])
  if (!c) return null
  const save = async () => {
    if (JSON.stringify(c) === JSON.stringify(data)) return
    try {
      qc.setQueryData(key, await api<Contacts>(`persons/${personId}/contacts`, { method: 'PUT', json: c }))
    } catch {
      notify(t('Не сохранилось. Написанное осталось на этом экране. Проверьте интернет и повторите.'), [], true)
    }
  }
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="text-base font-medium">{t('Как связаться')}</h4>
      <p className="text-xs text-ink-soft">{t('Видят только редакторы. В файлы, выгрузки и ответы ассистенту не попадает.')}</p>
      <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-2 gap-y-1 items-baseline">
        {FIELDS.map(([k, label, hint]) => (
          <label key={k} className="contents">
            <span className="text-xs text-ink-faint">{t(label)}</span>
            <GrowText value={c[k]} placeholder={t(hint)} aria-label={t(label)} className="text-ink" onChange={(e) => setC({ ...c, [k]: e.target.value })} onBlur={save} />
          </label>
        ))}
      </div>
    </section>
  )
}
