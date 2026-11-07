'use client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Undo2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api, undoFailure, useApp, useWrite } from '@/lib/client'
import { cn } from '@/lib/utils'
import type { HistoryEntry } from '@/lib/types'

/** Who changed what, newest first, and one press to take it back. */
export function HistoryList({ rows, onlyOne }: { rows: HistoryEntry[]; onlyOne?: boolean }) {
  const { t, canEdit, lang, focus, byId, notify } = useApp()
  const qc = useQueryClient()
  const undo = useWrite((id: string) => api(`history/${id}/undo`, { json: {} }).then(() => { qc.invalidateQueries() }).catch((e) => notify(undoFailure(e, t))))
  const time = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' })
  const date = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric' })
  const day = (at: number) => {
    const d = new Date(at).toDateString()
    if (d === new Date().toDateString()) return t('Сегодня')
    if (d === new Date(Date.now() - 86_400_000).toDateString()) return t('Вчера')
    return date.format(at)
  }
  return (
    <>
      {!rows.length && <p className="text-sm text-ink-faint">{t('Пока ничего не менялось')}</p>}
      {rows.map((r, i) => (
        <div key={r.id}>
          {(i === 0 || day(rows[i - 1].at) !== day(r.at)) && <h4 className="mt-3 mb-1 text-xs font-medium text-ink-soft first:mt-0">{day(r.at)}</h4>}
          <div className="flex items-start gap-2 border-b border-border py-2">
            <div className={cn('min-w-0 flex-1', r.undoneAt && 'text-ink-soft')}>
              {onlyOne ? <div className="text-sm leading-snug break-anywhere">{r.summary}</div> : <button className="block w-full text-left text-sm leading-snug break-anywhere hover:underline" disabled={!byId.has(r.personIds[0])} onClick={() => focus(r.personIds[0], { center: true })}>{r.summary}</button>}
              {r.details?.map((d, j) => (
                <div key={j} className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-ink-soft break-anywhere">
                  <span>{d.label}{(d.before || d.after) && ':'}</span>
                  {d.before && <span className="line-through">{d.before}</span>}
                  {d.before && d.after && <ArrowRight size={11} className="flex-none" aria-hidden="true" />}
                  {d.after && <span className="text-ink">{d.after}</span>}
                </div>
              ))}
              <div className="mt-1 text-xs text-ink-soft">{r.actorName}{r.byAgent ? ` (${t('агент')})` : ''} · {time.format(r.at)}{r.undoneAt ? ` · ${t('Откачено')}` : ''}</div>
            </div>
            {canEdit && !r.undoneAt && !r.undoOf && <Button size="sm" variant="outline" className="flex-none" title={t('Откатить это изменение')} data-hint={t('Вернёт всё как было до него. Откат тоже останется в истории.')} disabled={undo.isPending} onClick={() => undo.mutate(r.id)}><Undo2 /> {t('Откатить')}</Button>}
          </div>
        </div>
      ))}
    </>
  )
}

export function HistoryPanel({ onClose }: { onClose: () => void }) {
  const { t } = useApp()
  const { data: rows = [] } = useQuery({ queryKey: ['history'], queryFn: () => api<HistoryEntry[]>('history') })
  return (
    <aside aria-label={t('История')} className="float side-sheet fixed left-3 top-[60px] bottom-3 w-96 max-w-[calc(100vw-24px)] flex flex-col z-10">
      <div className="flex items-center justify-between px-3 pt-3 pb-2"><h3 className="font-serif font-medium text-lg">{t('История')}</h3><button className="text-ink-faint hover:text-ink" aria-label={t('Закрыть')} title={t('Закрыть')} onClick={onClose}><X size={15} /></button></div>
      <div className="flex-1 overflow-auto px-3 pb-3"><HistoryList rows={rows} /></div>
    </aside>
  )
}

/** A person's own changes, for the card. */
export function PersonHistory({ personId }: { personId: string }) {
  const { data: rows = [] } = useQuery({ queryKey: ['history', personId], queryFn: () => api<HistoryEntry[]>(`persons/${personId}/history`) })
  return <div className="px-4 pb-3"><HistoryList rows={rows} onlyOne /></div>
}
