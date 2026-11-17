'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, RotateCcw, Undo2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api, undoFailure, useApp, useWrite } from '@/lib/client'
import { cn } from '@/lib/utils'
import type { HistoryEntry } from '@/lib/types'

const PERSON_WORD = { added: 'Добавлен человек', updated: 'Изменён', removed: 'Удалён человек' } as const

/** Who changed what, newest first, and one press to take it back. */
export function HistoryList({ rows, onlyOne }: { rows: HistoryEntry[]; onlyOne?: boolean }) {
  const { t, canEdit, lang, focus, byId, notify, confirm } = useApp()
  const qc = useQueryClient()
  const done = () => { qc.invalidateQueries() }
  const fail = (e: unknown) => notify(undoFailure(e, t))
  const undo = useWrite((id: string) => api(`history/${id}/undo`, { json: {} }).then(done, fail))
  const rollback = useWrite((id: string) => api(`history/${id}/rollback`, { json: {} }).then(done, fail))
  const undoPerson = useWrite(({ id, personId }: { id: string; personId: string }) => api(`history/${id}/undo-person`, { json: { personId } }).then(done, fail))
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const time = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' })
  const date = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric' })
  const day = (at: number) => {
    const d = new Date(at).toDateString()
    if (d === new Date().toDateString()) return t('Сегодня')
    if (d === new Date(Date.now() - 86_400_000).toDateString()) return t('Вчера')
    return date.format(at)
  }
  const askRollback = async (r: HistoryEntry, i: number) => {
    // Everything newer plus this entry, in the same order the server takes them back.
    const count = rows.slice(0, i + 1).filter((x) => !x.undoneAt && !x.undoOf).length
    const ok = await confirm(t('Вернуть архив к состоянию перед этим изменением?'), t('Откатить'), t('Будет отменено изменений: {n}').replace('{n}', String(count)))
    if (ok) rollback.mutate(r.id)
  }
  return (
    <>
      {!rows.length && <p className="text-sm text-ink-faint">{t('Пока ничего не менялось')}</p>}
      {rows.map((r, i) => {
        const onePerson = r.personIds.length === 1
        const person = onePerson ? byId.get(r.personIds[0]) : undefined
        const hasMore = !!r.details?.length || !!r.people?.length
        const show = onlyOne || onePerson || !!open[r.id]
        const summary = <span className="block w-full text-left text-sm leading-snug break-anywhere">{r.summary}</span>
        return (
          <div key={r.id}>
            {(i === 0 || day(rows[i - 1].at) !== day(r.at)) && <h4 className="mt-3 mb-1 text-xs font-medium text-ink-soft first:mt-0">{day(r.at)}</h4>}
            <div className="flex items-start gap-2 border-b border-border py-2">
              <div className={cn('min-w-0 flex-1', r.undoneAt && 'text-ink-soft')}>
                {onlyOne || !hasMore ? summary : (
                  <button type="button" aria-expanded={onePerson ? undefined : !!open[r.id]} className="block w-full text-left text-sm leading-snug break-anywhere hover:underline" onClick={() => person ? focus(person.id, { center: true }) : setOpen((o) => ({ ...o, [r.id]: !o[r.id] }))}>{r.summary}</button>
                )}
                {show && r.people && r.people.length > 1 && (
                  <div className="mt-1 space-y-0.5">
                    {r.people.map((p) => (
                      <div key={p.id} className="flex items-center gap-1 text-xs text-ink-soft break-anywhere">
                        <span>{t(PERSON_WORD[p.change])}: {p.name}</span>
                        {canEdit && !r.undoneAt && !r.undoOf && (
                          <button type="button" className="flex-none text-ink-faint hover:text-ink" aria-label={t('Откатить только этого человека')} title={t('Откатить только этого человека')} disabled={undoPerson.isPending} onClick={() => undoPerson.mutate({ id: r.id, personId: p.id })}><Undo2 size={11} /></button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {show && r.details?.map((d, j) => (
                  <div key={j} className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-ink-soft break-anywhere">
                    <span>{d.label}{(d.before || d.after) && ':'}</span>
                    {d.before && <span className="line-through">{d.before}</span>}
                    {d.before && d.after && <ArrowRight size={11} className="flex-none" aria-hidden="true" />}
                    {d.after && <span className="text-ink">{d.after}</span>}
                  </div>
                ))}
                <div className="mt-1 text-xs text-ink-soft">{r.actorName}{r.byAgent ? ` (${t('агент')})` : ''} · {time.format(r.at)}{r.undoneAt ? ` · ${t('Откачено')}` : ''}</div>
              </div>
              {canEdit && !r.undoneAt && !r.undoOf && (
                <div className="flex flex-none flex-col gap-1">
                  <Button size="sm" variant="outline" title={t('Откатить это изменение')} data-hint={t('Вернёт всё как было до него. Откат тоже останется в истории.')} disabled={undo.isPending} onClick={() => undo.mutate(r.id)}><Undo2 /> {t('Откатить')}</Button>
                  <Button size="sm" variant="ghost" title={t('Откатить до этого места')} aria-label={t('Откатить до этого места')} disabled={rollback.isPending} onClick={() => askRollback(r, i)}><RotateCcw /> {t('Откатить до этого места')}</Button>
                </div>
              )}
            </div>
          </div>
        )
      })}
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
