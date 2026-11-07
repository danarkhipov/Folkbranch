'use client'
import dynamic from 'next/dynamic'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, useApp } from '@/lib/client'
import { lifeYears, personName } from '@/lib/types'

const MergeDialog = dynamic(() => import('./merge-dialog').then((m) => m.MergeDialog), { ssr: false })

/** Cards that may be one person. Only a person decides: nothing here merges by itself. */
export function SameList() {
  const { t, byId } = useApp()
  const qc = useQueryClient()
  const { data = [], isLoading } = useQuery({ queryKey: ['duplicates'], queryFn: () => api<{ a: string; b: string; why: string[] }[]>('duplicates') })
  const [pair, setPair] = useState<{ a: string; b: string } | null>(null)
  const person = (id: string) => { const p = byId.get(id); return p ? [personName(p) || t('Без названия'), lifeYears(p)].join(', ') : '' }
  /** The fuller card stays by default. */
  const fuller = (a: string, b: string) => { const n = (id: string) => Object.values(byId.get(id) ?? {}).filter((v) => (Array.isArray(v) ? v.length : !!v)).length; return n(a) >= n(b) ? { a, b } : { a: b, b: a } }
  return (
    <div className="flex-1 overflow-auto px-1.5 pb-2">
      {!isLoading && !data.length && <p className="px-2 text-sm text-ink-soft">{t('Похожих людей не нашлось')}</p>}
      {data.map((d) => (
        <div key={`${d.a}.${d.b}`} className="rounded-md px-2 py-1.5 text-sm flex flex-col gap-0.5">
          <span className="font-medium break-anywhere">{person(d.a)}</span>
          <span className="font-medium break-anywhere">{person(d.b)}</span>
          {d.why.length > 0 && <span className="text-xs text-ink-soft">{t('Совпадает')}: {d.why.map(t).join(', ')}</span>}
          <span className="mt-0.5 flex flex-wrap gap-1.5">
            <button className="bar-btn border border-border !h-7" onClick={() => setPair(fuller(d.a, d.b))}>{t('Сравнить')}</button>
            <button className="bar-btn !h-7 text-ink-soft" onClick={async () => { await api('duplicates/dismiss', { json: { a: d.a, b: d.b } }); qc.invalidateQueries({ queryKey: ['duplicates'] }) }}>{t('Это разные люди')}</button>
          </span>
        </div>
      ))}
      {pair && <MergeDialog a={pair.a} b={pair.b} onClose={() => { setPair(null); qc.invalidateQueries({ queryKey: ['duplicates'] }) }} />}
    </div>
  )
}

const MISSING: Record<string, string> = { birthDate: 'дата рождения', birthPlace: 'место рождения', deathDate: 'дата смерти', deathPlace: 'место смерти', parents: 'родители', sex: 'пол' }

/** People whose record is unfinished, those with conflicting versions first. */
export function GapsList() {
  const { t, byId, focus } = useApp()
  const { data = [] } = useQuery({ queryKey: ['gaps'], queryFn: () => api<{ id: string; missing: string[]; unsourced: number; conflicts: string[] }[]>('gaps') })
  return (
    <div className="flex-1 overflow-auto px-1.5 pb-2">
      {!data.length && <p className="px-2 text-sm text-ink-soft">{t('Всё заполнено')}</p>}
      {data.map((r) => {
        const p = byId.get(r.id)
        if (!p) return null
        return (
          <button key={r.id} className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-muted" onClick={() => focus(r.id, { center: true })}>
            <span className="block text-sm font-medium">{personName(p) || t('Без названия')}</span>
            {r.conflicts.length > 0 && <span className="block text-xs text-destructive">{t('Версии расходятся')}: {r.conflicts.length}</span>}
            {r.missing.length > 0 && <span className="block text-xs text-ink-soft">{t('Не указано')}: {r.missing.map((k) => t(MISSING[k])).join(', ')}</span>}
            {r.unsourced > 0 && <span className="block text-xs text-ink-soft">{t('Нет источников')}: {r.unsourced}</span>}
          </button>
        )
      })}
    </div>
  )
}
