'use client'
import { useState } from 'react'
import dynamic from 'next/dynamic'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FilePlus2, Plus, Trash2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { api, useApp } from '@/lib/client'
import { cn } from '@/lib/utils'
import { type PageMeta, type Person } from '@/lib/types'

const PageEditor = dynamic(() => import('./page-editor'), { ssr: false, loading: () => <div className="h-40" /> })

export function Pages({ person, full, onDetails }: { person: Person; full: boolean; onDetails: () => void }) {
  const { t, canEdit, confirm } = useApp()
  const key = ['pages', person.id]
  const { data: pages = [] } = useQuery({ queryKey: key, queryFn: () => api<PageMeta[]>(`persons/${person.id}/pages`) })
  const [openId, setOpenId] = useState<string | null>(null)
  const selected = pages.find((p) => p.id === openId) ?? pages[0]
  const qc = useQueryClient()
  const refresh = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ['history'] }) }

  const add = async (parentPageId?: string) => {
    const p = await api<PageMeta>('pages', { json: { personId: person.id, title: '', parentPageId } })
    refresh()
    setOpenId(p.id)
  }
  const remove = async (p: PageMeta) => {
    if (await confirm(`${t('Удалить')} «${p.title || t('Без названия')}»?`, t('Удалить'))) {
      await api(`pages/${p.id}`, { method: 'DELETE' })
      if (openId === p.id) setOpenId(null)
      refresh()
    }
  }
  /** Drop on a row: top third places before, bottom third after, the middle nests inside. */
  const move = async (dragId: string, target: PageMeta, zone: 'before' | 'inside' | 'after') => {
    if (dragId === target.id) return
    const siblings = pages.filter((p) => p.parentPageId === target.parentPageId && p.id !== dragId)
    const i = siblings.findIndex((p) => p.id === target.id)
    let json: Record<string, unknown>
    if (zone === 'inside') json = { parentPageId: target.id, position: Date.now() }
    else {
      const prev = zone === 'before' ? siblings[i - 1] : target
      const next = zone === 'before' ? target : siblings[i + 1]
      const position = prev && next ? (prev.position + next.position) / 2 : prev ? prev.position + 1 : next.position - 1
      json = { parentPageId: target.parentPageId, position }
    }
    await api(`pages/${dragId}/move`, { json }).catch(() => null)
    refresh()
  }

  const tree = (
    <PageTree pages={pages} selected={selected?.id} onOpen={setOpenId} onAdd={add} onRemove={remove} onMove={move} />
  )
  return (
    <div className={cn('h-full', full ? 'grid grid-cols-[260px_1fr]' : 'flex flex-col')}>
      <div className={cn('px-3 py-1', full ? 'border-r border-border overflow-auto' : 'max-h-24 overflow-auto border-b border-border')}>
        {(pages.length > 1 || full) && tree}
        {canEdit && pages.length > 0 && <button className="flex items-center gap-1.5 text-ink-faint hover:text-ink text-sm px-2 py-1 mt-0.5" onClick={() => add()}><FilePlus2 size={14} /> {t('Новая страница')}</button>}
        {!canEdit && !pages.length && <p className="text-ink-faint text-sm px-2 py-1">{t('Страниц пока нет')}</p>}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {selected && <div className={cn('mx-auto py-2', full ? 'max-w-3xl px-10' : '')}><PageEditor key={selected.id} pageId={selected.id} personId={person.id} onChanged={refresh} /></div>}
        {!selected && canEdit && (
          <div className="px-6 py-8 flex flex-col items-start gap-2">
            <p className="text-base font-medium text-ink">{t('Расскажите о человеке')}</p>
            <div className="flex flex-wrap gap-2">
              <button className="bar-btn on" onClick={() => add()}><FilePlus2 size={14} /> {t('Начать биографию')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const ICONS = ['📖', '🎖️', '✉️', '📜', '🏠', '📷', '🎓', '⚓', '🌾', '🛠️', '❤️', '🗺️']

function PageTree({ pages, selected, onOpen, onAdd, onRemove, onMove }: { pages: PageMeta[]; selected?: string; onOpen: (id: string) => void; onAdd: (parent?: string) => void; onRemove: (p: PageMeta) => void; onMove: (dragId: string, target: PageMeta, zone: 'before' | 'inside' | 'after') => void }) {
  const { t, canEdit } = useApp()
  const [over, setOver] = useState<{ id: string; zone: 'before' | 'inside' | 'after' } | null>(null)
  const qc = useQueryClient()
  const render = (parent: string | null, depth: number): React.ReactNode =>
    pages.filter((p) => (p.parentPageId ?? null) === parent).map((p) => (
      <div key={p.id}>
        <div
          draggable={canEdit}
          onDragStart={(e) => e.dataTransfer.setData('text/page', p.id)}
          onDragOver={(e) => {
            e.preventDefault()
            const r = e.currentTarget.getBoundingClientRect()
            const f = (e.clientY - r.top) / r.height
            setOver({ id: p.id, zone: f < 0.3 ? 'before' : f > 0.7 ? 'after' : 'inside' })
          }}
          onDragLeave={() => setOver(null)}
          onDrop={(e) => { e.preventDefault(); setOver(null); onMove(e.dataTransfer.getData('text/page'), p, over?.zone ?? 'inside') }}
          className={cn('group flex items-center gap-1 rounded-md pr-1 h-7 cursor-pointer text-sm', selected === p.id ? 'bg-accent font-medium' : 'hover:bg-muted', over?.id === p.id && over.zone === 'inside' && 'ring-1 ring-ring', over?.id === p.id && over.zone === 'before' && 'shadow-[0_-2px_0_var(--accent)]', over?.id === p.id && over.zone === 'after' && 'shadow-[0_2px_0_var(--accent)]')}
          style={{ paddingLeft: 6 + depth * 16 }}
          onClick={() => onOpen(p.id)}
        >
          <Popover>
            <PopoverTrigger asChild disabled={!canEdit}><button className="w-5 text-center" aria-label={t('Значок страницы')} title={t('Значок страницы')} onClick={(e) => e.stopPropagation()}>{p.icon || '📄'}</button></PopoverTrigger>
            <PopoverContent className="w-auto p-1.5 grid grid-cols-6 gap-0.5">
              {ICONS.map((i) => (
                <button key={i} className="w-7 h-7 rounded hover:bg-muted" onClick={async (e) => {
                  e.stopPropagation()
                  await api(`pages/${p.id}`, { method: 'PATCH', json: { icon: i } })
                  qc.invalidateQueries({ queryKey: ['pages', p.personId] })
                }}>{i}</button>
              ))}
            </PopoverContent>
          </Popover>
          <span className="truncate flex-1">{p.title || <span className="text-ink-faint">{t('Без названия')}</span>}</span>
          {canEdit && (
            <span className="flex gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity">
              <button title={t('Подстраница')} className="p-0.5 rounded hover:bg-background text-ink-faint hover:text-ink" onClick={(e) => { e.stopPropagation(); onAdd(p.id) }}><Plus size={13} /></button>
              <button title={t('Удалить')} className="p-0.5 rounded hover:bg-background text-ink-faint hover:text-destructive" onClick={(e) => { e.stopPropagation(); onRemove(p) }}><Trash2 size={13} /></button>
            </span>
          )}
        </div>
        {render(p.id, depth + 1)}
      </div>
    ))
  return <div>{render(null, 0)}</div>
}
