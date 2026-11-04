'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpDown, CircleHelp, Clock, FileText, GitFork, LogOut, Maximize, Minus, Plus, Search, Settings, Sparkles, Tags, UserPlus, X } from 'lucide-react'
import { App, api, useTr, useWrite, type AppCtx, type QuickType } from '@/lib/client'
import { Family } from '@/lib/kinship'
import { personName, type Graph, type HistoryEntry, type Lang, type Me } from '@/lib/types'
import { GraphCanvas, Legend, type CanvasHandle } from './graph-canvas'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { PersonPanel } from './person-panel'
import { QuickAdd } from './quick-add'
import { PhotoDialog } from './photo-dialog'
import { ConfirmDialog, SearchDialog } from './person-pickers'
import { HistoryPanel, HowRelated, SettingsDialog } from './side-panels'
import { ReviewPanel, TextDialog, useProposals } from './ai-panels'

interface Props {
  me: Me
  lang: Lang
  familyName: string
  providers: { google: boolean; yandex: boolean }
}

export function FamilyApp({ me, lang, familyName, providers }: Props) {
  const t = useTr(lang)
  const { data: graph } = useQuery({ queryKey: ['graph'], queryFn: () => api<Graph>('graph') })
  const canvas = useRef<CanvasHandle>(null)
  const [focusId, setFocusId] = useState<string | null>(() => (typeof location !== 'undefined' ? new URLSearchParams(location.search).get('p') : null))
  const [search, setSearch] = useState(false)
  const [side, setSide] = useState<'related' | 'history' | 'review' | null>(null)
  const [textOpen, setTextOpen] = useState(false)
  const { data: drafts = [] } = useProposals(me.role !== 'reader')
  const draftOps = drafts.reduce((n, d) => n + d.ops.length, 0)
  const [settings, setSettings] = useState(false)
  const [path, setPath] = useState<string[] | null>(null)
  const [groups, setGroups] = useState<string[]>([])
  const [rootsBelow, setRootsBelow] = useState(true)
  useEffect(() => {
    try { if (localStorage.getItem('chart-direction') === 'down') setRootsBelow(false) } catch {}
  }, [])
  const flipChart = () => {
    const next = !rootsBelow
    setRootsBelow(next)
    try { localStorage.setItem('chart-direction', next ? 'up' : 'down') } catch {}
    requestAnimationFrame(() => requestAnimationFrame(() => canvas.current?.fit()))
  }
  const [photo, setPhoto] = useState<{ id: string; list?: string[] } | null>(null)
  const [quick, setQuick] = useState<{ type: QuickType; to: string; otherParent?: string } | { type: null; to: null } | null>(null)
  const [confirmState, setConfirm] = useState<{ text: string; action: string; resolve: (v: boolean) => void } | null>(null)

  const focus = useCallback((id: string | null, opts?: { center?: boolean }) => {
    setFocusId(id)
    const url = new URL(location.href)
    if (id) url.searchParams.set('p', id)
    else url.searchParams.delete('p')
    history.replaceState(null, '', url)
    if (id && opts?.center !== false) requestAnimationFrame(() => canvas.current?.center(id))
  }, [])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearch((s) => !s)
      }
      const typing = (e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable=true], [role=dialog]')
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing && me.role !== 'reader') {
        e.preventDefault()
        undoRef.current()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const qc = useQueryClient()
  const [toast, setToast] = useState<{ text: string; actions: { label: string; run: () => void }[] } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const notify = useCallback((text: string, actions: { label: string; run: () => void }[] = []) => {
    clearTimeout(toastTimer.current)
    setToast({ text, actions })
    toastTimer.current = setTimeout(() => setToast(null), 8000)
  }, [])
  const undoLast = useCallback(async () => {
    const rows = await api<HistoryEntry[]>('history?limit=20')
    const last = rows.find((r) => !r.undoneAt && !r.undoOf)
    if (!last) return notify(t('Пока ничего не менялось'))
    await api(`history/${last.id}/undo`, { json: {} })
    await qc.invalidateQueries()
    notify(`${t('Отменено')}: ${last.summary}`)
  }, [notify, qc]) // eslint-disable-line react-hooks/exhaustive-deps
  const undoRef = useRef(undoLast)
  undoRef.current = undoLast

  const ctx = useMemo<AppCtx | null>(() => {
    if (!graph) return null
    return {
      me, lang, familyName, t, graph, focusId, focus,
      canEdit: me.role !== 'reader',
      rootsBelow,
      byId: new Map(graph.persons.map((p) => [p.id, p])),
      family: new Family(graph),
      openPhoto: (id, list) => setPhoto({ id, list }),
      confirm: (text, action) => new Promise((resolve) => setConfirm({ text, action, resolve })),
      quickAdd: (type, to, otherParent) => setQuick({ type, to, otherParent }),
      notify,
      undoLast,
    }
  }, [graph, me, lang, familyName, focusId, focus, rootsBelow]) // eslint-disable-line react-hooks/exhaustive-deps

  const delPerson = useWrite((id: string) => api(`persons/${id}`, { method: 'DELETE' }))
  const delRelation = useWrite(({ type, id }: { type: string; id: string }) => api(`relations/${type}/${id}`, { method: 'DELETE' }))

  const allGroups = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of graph?.persons ?? []) for (const tag of p.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    return [...counts].sort((a, b) => a[0].localeCompare(b[0]))
  }, [graph])
  const groupIds = useMemo(() => {
    const on = groups.filter((g) => allGroups.some(([name]) => name === g))
    return on.length ? new Set((graph?.persons ?? []).filter((p) => p.tags.some((tag) => on.includes(tag))).map((p) => p.id)) : null
  }, [groups, allGroups, graph])

  if (!ctx) return <div className="canvas" />
  const focused = focusId ? ctx.byId.get(focusId) : undefined
  const panelOpen = !!focused && !focused.hidden

  const onDelete = async (id: string) => {
    const p = ctx.byId.get(id)
    if (await ctx.confirm(`${t('Удалить человека')} «${personName(p!) || t('Без названия')}»? ${t('Отменить можно в «Что нового».')}`, t('Удалить'))) {
      await delPerson.mutateAsync(id)
      if (focusId === id) focus(null)
    }
  }

  return (
    <App.Provider value={ctx}>
      <GraphCanvas ref={canvas} pathIds={path} groupIds={groupIds} panelOpen={panelOpen} onDelete={onDelete} onRemoveRelation={(type, id) => delRelation.mutate({ type, id })} />

      <nav className="float fixed left-3 top-3 z-10 flex items-center gap-0.5 p-1">
        <span className="font-serif font-medium text-[15px] px-2.5 max-w-[120px] lg:max-w-[220px] truncate">{familyName}</span>
        <span className="w-px h-5 bg-border mx-0.5" />
        <button className="bar-btn" aria-label={t('Поиск людей')} onClick={() => setSearch(true)}><Search size={15} /> <span className="hidden lg:inline">{t('Поиск людей')}</span> <kbd className="hidden lg:inline">⌘K</kbd></button>
        <button className={side === 'related' ? 'bar-btn on' : 'bar-btn'} aria-label={t('Кем приходится?')} onClick={() => { setSide(side === 'related' ? null : 'related'); setPath(null) }}><GitFork size={15} /> <span className="hidden lg:inline">{t('Кем приходится?')}</span></button>
        <button className={side === 'history' ? 'bar-btn on' : 'bar-btn'} aria-label={t('Что нового')} onClick={() => { setSide(side === 'history' ? null : 'history'); setPath(null) }}><Clock size={15} /> <span className="hidden lg:inline">{t('Что нового')}</span></button>
        <button className="bar-btn" title={t('Текст')} aria-label={t('Текст')} onClick={() => setTextOpen(true)}><FileText size={15} /></button>
        {(draftOps > 0 || side === 'review') && <button className={side === 'review' ? 'bar-btn on' : 'bar-btn !text-rust'} onClick={() => { setSide(side === 'review' ? null : 'review'); setPath(null) }}><Sparkles size={15} /> <span className="hidden lg:inline">{t('Правки ИИ')}</span> {draftOps}</button>}
        <button className="bar-btn" title={t('Настройки')} aria-label={t('Настройки')} onClick={() => setSettings(true)}><Settings size={15} /></button>
        <button className="bar-btn" title={t('Выйти')} aria-label={t('Выйти')} onClick={async () => { if (!(await ctx.confirm(t('После выхода войти снова можно будет только по новой ссылке или через привязанный Google и Яндекс ID.'), t('Выйти')))) return; await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); location.href = '/login' }}><LogOut size={15} /></button>
      </nav>

      <div className="float fixed left-3 bottom-3 z-10 flex items-center gap-0.5 p-1">
        <button className="bar-btn" title={t('Отдалить')} aria-label={t('Отдалить')} onClick={() => canvas.current?.zoomBy(0.75)}><Minus size={15} /></button>
        <button className="bar-btn" title={t('Приблизить')} aria-label={t('Приблизить')} onClick={() => canvas.current?.zoomBy(1.33)}><Plus size={15} /></button>
        <button className="bar-btn" onClick={() => { focus(null); canvas.current?.fit() }}><Maximize size={14} /> {t('Показать всех')}</button>
        <button className="bar-btn" title={t(rootsBelow ? 'Сейчас старшие снизу. Показать старших сверху' : 'Сейчас старшие сверху. Показать старших снизу')} aria-label={t(rootsBelow ? 'Сейчас старшие снизу. Показать старших сверху' : 'Сейчас старшие сверху. Показать старших снизу')} onClick={flipChart}><ArrowUpDown size={15} /> <span className="hidden lg:inline">{t(rootsBelow ? 'Старшие снизу' : 'Старшие сверху')}</span></button>
        {allGroups.length > 0 && (
          <Popover>
            <PopoverTrigger asChild><button className={groups.length ? 'bar-btn on' : 'bar-btn'} title={t('Группы')} aria-label={t('Группы')}><Tags size={15} />{groups.length > 0 && ` ${groups.length}`}</button></PopoverTrigger>
            <PopoverContent side="top" align="start" className="w-56 text-[13px] flex flex-col gap-0.5 p-2 max-h-72 overflow-auto">
              {allGroups.map(([name, count]) => (
                <label key={name} className="flex items-center gap-2 min-h-7 px-1 rounded hover:bg-muted cursor-pointer">
                  <input type="checkbox" className="accent-[var(--ink)] size-4" checked={groups.includes(name)} onChange={(e) => setGroups(e.target.checked ? [...groups, name] : groups.filter((g) => g !== name))} />
                  <span className="truncate flex-1">{name}</span>
                  <span className="text-ink-faint">{count}</span>
                </label>
              ))}
              {groups.length > 0 && <button className="bar-btn self-start mt-1" onClick={() => setGroups([])}>{t('Показать всех')}</button>}
            </PopoverContent>
          </Popover>
        )}
        <Popover>
          <PopoverTrigger asChild><button className="bar-btn" title={t('Условные обозначения')} aria-label={t('Условные обозначения')}><CircleHelp size={15} /></button></PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-64 text-[13px]"><Legend /></PopoverContent>
        </Popover>
      </div>

      {!ctx.graph.persons.length && ctx.canEdit && (
        <div className="fixed inset-0 grid place-items-center pointer-events-none">
          <button className="float pointer-events-auto px-5 h-12 flex items-center gap-2 font-serif text-base hover:bg-muted" onClick={() => setQuick({ type: null, to: null })}><UserPlus size={17} /> {t('Первый человек в архиве')}</button>
        </div>
      )}

      {side === 'related' && <HowRelated onPath={setPath} onClose={() => { setSide(null); setPath(null) }} />}
      {side === 'history' && <HistoryPanel onClose={() => setSide(null)} />}
      {side === 'review' && <ReviewPanel onClose={() => setSide(null)} />}
      {panelOpen && <PersonPanel key={focused!.id} person={focused!} onClose={() => focus(null)} onDelete={onDelete} />}

      <SearchDialog open={search} onOpenChange={setSearch} onPick={(id) => focus(id)} />
      <QuickAdd state={quick} onClose={(id) => { setQuick(null); if (id) focus(id) }} />
      <PhotoDialog state={photo} onClose={() => setPhoto(null)} />
      {toast && (
        <div role="status" className="float fixed left-1/2 -translate-x-1/2 bottom-3 max-lg:bottom-[68px] z-30 flex items-center gap-1 pl-3 pr-1 py-1 text-[13px] max-w-[calc(100vw-24px)]">
          <span className="truncate mr-1">{toast.text}</span>
          {toast.actions.map((a) => <button key={a.label} className="bar-btn !h-7 whitespace-nowrap" onClick={() => { setToast(null); a.run() }}>{a.label}</button>)}
          <button className="bar-btn !h-7 !min-w-7 !p-0" aria-label={t('Закрыть')} onClick={() => setToast(null)}><X size={13} /></button>
        </div>
      )}
      <TextDialog open={textOpen} onOpenChange={setTextOpen} />
      <ConfirmDialog state={confirmState} onClose={() => setConfirm(null)} />
      <SettingsDialog open={settings} onOpenChange={setSettings} familyName={familyName} providers={providers} />
    </App.Provider>
  )
}
