'use client'
import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Undo2, X } from 'lucide-react'
import { api, undoFailure, useApp, useWrite } from '@/lib/client'
import { cn } from '@/lib/utils'
import { personName, type HistoryEntry } from '@/lib/types'
import { Mini, PersonPopover } from './person-pickers'
import { Segmented } from './person-fields'

/** "Кем приходится?": two people, an answer in words, the path lit on the graph. */
export function HowRelated({ onPath, onClose }: { onPath: (ids: string[] | null) => void; onClose: () => void }) {
  const { t, byId, family, lang, me } = useApp()
  const [a, setA] = useState<string | null>(me.personId)
  const [b, setB] = useState<string | null>(null)
  const kin = useMemo(() => (a && b && a !== b ? family.relation(a, b, lang) : null), [a, b, family, lang])
  const lastPath = useRef<string>('')
  const key = kin?.path.join() ?? ''
  if (key !== lastPath.current) {
    lastPath.current = key
    queueMicrotask(() => onPath(kin?.path ?? null))
  }
  const slot = (id: string | null, set: (v: string) => void, placeholder: string) => {
    const p = id ? byId.get(id) : null
    return (
      <PersonPopover onPick={set}>
        <button className="flex items-center gap-2 h-9 px-2 rounded-lg border border-input bg-white w-full text-left text-sm">
          {p ? <><Mini person={p} /> <span className="truncate">{personName(p)}</span></> : <span className="text-ink-faint">{t(placeholder)}</span>}
        </button>
      </PersonPopover>
    )
  }
  return (
    <div className="float side-sheet fixed left-3 top-[60px] w-80 p-3 z-10 flex flex-col gap-2">
      <div className="flex items-center justify-between"><h3 className="font-serif font-medium text-lg">{t('Кем приходится?')}</h3><button className="text-ink-faint hover:text-ink" aria-label={t('Закрыть')} title={t('Закрыть')} onClick={onClose}><X size={15} /></button></div>
      <p className="text-sm text-ink-soft">{t('Выберите двух людей, и мы покажем, кем они приходятся друг другу.')}</p>
      {slot(a, setA, 'Выбрать первого')}
      {slot(b, setB, 'Выбрать второго')}
      {a && b && a !== b && !kin && <p className="text-sm text-ink-soft">{t('Кровного родства и связи через брак не найдено')}</p>}
      {kin && (
        <div className="pt-1">
          <p className="font-serif text-lg leading-snug"><span className="text-rust">{kin.label}</span></p>
          <p className="text-xs text-ink-soft">{personName(byId.get(b!)!)} — {lang === 'en' ? 'to' : 'для'} {personName(byId.get(a!)!)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-ink-soft">
            {kin.path.map((id, i) => (
              <span key={id} className="flex items-center gap-1">
                {i > 0 && <ArrowRight size={11} className="text-ink-faint" />}
                {personName(byId.get(id)!) || t('Скрыто')}
                {i > 0 && <span className="text-ink-faint">({family.relation(kin.path[i - 1], id, lang)?.label})</span>}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function HistoryPanel({ onClose }: { onClose: () => void }) {
  const { t, canEdit, lang, focus, byId, notify } = useApp()
  const { data: rows = [] } = useQuery({ queryKey: ['history'], queryFn: () => api<HistoryEntry[]>('history') })
  const qc = useQueryClient()
  const undo = useWrite((id: string) => api(`history/${id}/undo`, { json: {} }).then(() => { qc.invalidateQueries() }).catch((e) => notify(undoFailure(e, t))))
  const fmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const [view, setView] = useState<'history' | 'gaps'>('history')
  return (
    <div className="float side-sheet fixed left-3 top-[60px] bottom-3 w-80 flex flex-col z-10">
      <div className="flex items-center justify-between px-3 pt-3 pb-2"><h3 className="font-serif font-medium text-lg">{t(view === 'gaps' ? 'Что проверить' : 'История')}</h3><button className="text-ink-faint hover:text-ink" aria-label={t('Закрыть')} title={t('Закрыть')} onClick={onClose}><X size={15} /></button></div>
      {canEdit && (
        <div className="px-3 pb-2">
          <Segmented label={t('Что показать')} value={view} onChange={setView} options={[['history', t('История')], ['gaps', t('Что проверить')]]} />
        </div>
      )}
      {view === 'gaps' && <GapsList />}
      <div hidden={view !== 'history'} className="flex-1 overflow-auto px-1.5 pb-2">
        {!rows.length && <p className="px-2 text-sm text-ink-faint">{t('Пока ничего не менялось')}</p>}
        {rows.map((r) => (
          <div key={r.id} className={cn('group rounded-md px-2 py-1.5 hover:bg-muted', r.undoneAt && 'opacity-50')}>
            <button className="text-left text-sm leading-snug" onClick={() => r.personIds[0] && byId.has(r.personIds[0]) && focus(r.personIds[0], { center: true })}>{r.summary}</button>
            <div className="flex items-center text-xs text-ink-faint mt-0.5">
              <span>{r.actorName} · {fmt.format(r.at)}</span>
              {r.undoneAt && <span className="ml-2">{t('Отменено')}</span>}
              {canEdit && !r.undoneAt && !r.undoOf && (
                <button className="ml-auto hidden group-hover:flex [@media(hover:none)]:flex items-center gap-1 hover:text-ink" onClick={() => undo.mutate(r.id)}><Undo2 size={11} /> {t('Отменить')}</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const MISSING: Record<string, string> = { birthDate: 'дата рождения', birthPlace: 'место рождения', deathDate: 'дата смерти', deathPlace: 'место смерти', parents: 'родители', sex: 'пол' }

/** People whose record is unfinished, those with conflicting versions first. */
function GapsList() {
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
            {r.missing.length > 0 && <span className="block text-xs text-ink-soft">{t('Нет')}: {r.missing.map((k) => t(MISSING[k])).join(', ')}</span>}
            {r.unsourced > 0 && <span className="block text-xs text-ink-soft">{t('Без источника')}: {r.unsourced}</span>}
          </button>
        )
      })}
    </div>
  )
}
