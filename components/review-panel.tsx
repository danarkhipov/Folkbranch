'use client'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, X } from 'lucide-react'
import { api, useApp, useProposals } from '@/lib/client'
import { GapsList, SameList } from './check-lists'
import { FaceReview } from './face-review'
import { Segmented } from './person-fields'

/** Everything that waits for a person: suggested edits, unfinished cards, and cards that may be one person. */
export function ReviewPanel({ onClose }: { onClose: () => void }) {
  const { t } = useApp()
  const qc = useQueryClient()
  const { data: drafts = [] } = useProposals(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [view, setView] = useState<'edits' | 'gaps' | 'same' | 'faces'>(drafts.length ? 'edits' : 'gaps')
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    await fn().catch((e) => setError(String(e.message ?? e)))
    await qc.invalidateQueries()
    setBusy(false)
  }
  return (
    <aside aria-label={t('Проверка')} className="float side-sheet fixed left-3 top-[60px] bottom-3 w-96 max-w-[calc(100vw-24px)] flex flex-col z-10">
      <div className="flex items-center justify-between px-3 pt-3 pb-2"><h3 className="font-serif font-medium text-lg">{t('Проверка')}</h3><button className="text-ink-faint hover:text-ink" aria-label={t('Закрыть')} title={t('Закрыть')} onClick={onClose}><X size={15} /></button></div>
      <div className="px-3 pb-2"><Segmented label={t('Что показать')} value={view} onChange={setView} options={[['edits', `${t('Правки')}${drafts.length ? ` ${drafts.length}` : ''}`], ['gaps', t('Что заполнить')], ['same', t('Похожие')], ['faces', t('Лица')]]} /></div>
      {view === 'gaps' && <GapsList />}
      {view === 'same' && <SameList />}
      {view === 'faces' && <FaceReview />}
      <div hidden={view !== 'edits'} className="flex-1 overflow-auto px-3 pb-3 flex flex-col gap-4">
        {!drafts.length && <p className="text-sm text-ink-faint">{t('Правок на проверку нет')}</p>}
        {drafts.map((d) => (
          <section key={d.id} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between text-xs text-ink-soft"><b className="font-medium text-ink">{d.authorName}</b><span>{t('Правок')}: {d.ops.length}</span></div>
            {d.error && <p className="text-xs text-destructive flex gap-1"><AlertTriangle size={13} className="flex-none mt-px" /> {d.error}</p>}
            <div className="flex flex-col rounded-lg border border-border divide-y divide-border max-h-[50vh] overflow-auto bg-white/60">
              {d.ops.map((o, i) => (
                <div key={i} className="group flex gap-2 px-2 py-1.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="leading-snug break-words">{o.text}</div>
                    {o.details?.map((line, j) => <div key={j} className="text-xs text-ink-soft break-words whitespace-pre-wrap">{line}</div>)}
                    {o.audio && <audio controls preload="none" className="mt-1 h-8 w-full" src={`/api/v1/proposals/${d.id}/ops/${i}/audio`} />}
                  </div>
                  <button title={t('Убрать эту правку')} disabled={busy} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 text-ink-faint hover:text-destructive flex-none self-start" onClick={() => act(() => api(`proposals/${d.id}/ops/${i}`, { method: 'DELETE' }))}><X size={13} /></button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button className="bar-btn on" disabled={busy} onClick={() => act(() => api(`proposals/${d.id}/accept`, { json: {} }))}><Check size={14} /> {t('Принять')}</button>
              <button className="bar-btn border border-border" disabled={busy} onClick={() => act(() => api(`proposals/${d.id}/reject`, { json: {} }))}>{t('Отклонить')}</button>
            </div>
          </section>
        ))}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </aside>
  )
}
