'use client'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpDown, CircleHelp, Clock, Minus, Plus, Search, Settings, Tags, UserPlus, Users, X } from 'lucide-react'
import { App, api, undoFailure, useTr, useWrite, type AppCtx, type QuickType } from '@/lib/client'
import { Family } from '@/lib/kinship'
import { personName, type Graph, type HistoryEntry, type Lang, type Me } from '@/lib/types'
import { GraphCanvas, Legend, type CanvasHandle } from './graph-canvas'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { PersonPanel } from './person-panel'
import { QuickAdd } from './quick-add'
import { PhotoDialog } from './photo-dialog'
import { ConfirmDialog, SearchDialog } from './person-pickers'
import { HistoryPanel, HowRelated, SettingsDialog } from './side-panels'
import type { AssistantState } from '@/lib/types'
import { AssistantIcon } from './assistant-icon'
import { cn } from '@/lib/utils'
import { useAssistantWidth } from './assistant-setup'
import { ReviewPanel, TextDialog, useProposals } from './ai-panels'
import { ImportDialog } from './import-dialog'

interface Props {
  me: Me
  lang: Lang
  familyName: string
  providers: { google: boolean; yandex: boolean }
  assistant: AssistantState
}

// Its libraries are heavy and most visits never open it.
const AssistantPanel = dynamic(() => import('./assistant-panel'), { ssr: false })
const AssistantSetup = dynamic(() => import('./assistant-setup'), { ssr: false })

/** Below this, the chat and the card do not fit side by side. */
const NARROW = 960

export function FamilyApp({ me, lang, familyName, providers, assistant }: Props) {
  const t = useTr(lang)
  const { data: graph } = useQuery({ queryKey: ['graph'], queryFn: () => api<Graph>('graph') })
  const canvas = useRef<CanvasHandle>(null)
  const [focusId, setFocusId] = useState<string | null>(() => (typeof location !== 'undefined' ? new URLSearchParams(location.search).get('p') : null))
  const [search, setSearch] = useState(false)
  const [side, setSide] = useState<'related' | 'history' | 'review' | 'assistant' | null>(null)
  // Mounted on first use and kept, so the conversation survives closing the panel.
  const [assistantUsed, setAssistantUsed] = useState(false)
  const [assistantWidth, setAssistantWidth] = useAssistantWidth()
  const toggleAssistant = useCallback(() => {
    setAssistantUsed(true)
    // A narrow window holds one panel at a time.
    if (window.innerWidth < NARROW) setFocusId(null)
    setPath(null)
    setSide((s) => (s === 'assistant' ? null : 'assistant'))
  }, [])
  useEffect(() => { document.documentElement.lang = lang }, [lang])
  useEffect(() => { if (focusId && window.innerWidth < NARROW) setSide((s) => (s === 'assistant' ? null : s)) }, [focusId])
  const [textOpen, setTextOpen] = useState(false)
  const { data: drafts = [] } = useProposals(me.role !== 'reader')
  const draftOps = drafts.reduce((n, d) => n + d.ops.length, 0)
  const [settings, setSettings] = useState(false)
  const [path, setPath] = useState<string[] | null>(null)
  const [groups, setGroups] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [dropped, setDropped] = useState<File | null>(null)
  // A file dropped on the chart opens the import; inside the editor it stays a picture in the text.
  useEffect(() => {
    const isFile = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files') && !(e.target as HTMLElement).closest?.('.panel, .assistant, [role=dialog]')
    const over = (e: DragEvent) => { if (isFile(e)) e.preventDefault() }
    const drop = (e: DragEvent) => {
      if (!isFile(e) || me.role === 'reader') return
      e.preventDefault()
      setDropped(e.dataTransfer!.files[0] ?? null)
      setImporting(true)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('drop', drop) }
  }, [me.role])
  const [rootsBelow, setRootsBelow] = useState(true)
  useEffect(() => {
    try { if (localStorage.getItem('chart-direction') === 'down') setRootsBelow(false) } catch {}
  }, [])
  const directChart = (next: boolean) => {
    setRootsBelow(next)
    try { localStorage.setItem('chart-direction', next ? 'up' : 'down') } catch {}
    requestAnimationFrame(() => requestAnimationFrame(() => canvas.current?.fit()))
  }
  const flipChart = () => directChart(!rootsBelow)
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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        toggleAssistant()
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
    try {
      await api(`history/${last.id}/undo`, { json: {} })
    } catch (e) {
      return notify(undoFailure(e, t))
    }
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

  // When the card leaves too little room, the family name goes first and the labels last.
  const nav = useRef<HTMLElement>(null)
  const barFull = useRef(720)
  const barName = useRef(90)
  const [barMode, setBarMode] = useState<'full' | 'no-name' | 'compact'>('full')
  useEffect(() => {
    const card = document.querySelector<HTMLElement>('aside.panel')
    const measure = () => {
      const bar = nav.current
      if (bar && !bar.classList.contains('compact') && !bar.classList.contains('no-name')) {
        barFull.current = bar.offsetWidth
        barName.current = (bar.querySelector<HTMLElement>('.family-name')?.offsetWidth ?? 90) + 30 // the name, its divider, tighter buttons
      }
      const room = card ? window.innerWidth - card.offsetWidth - 32 : Infinity
      setBarMode(room >= barFull.current ? 'full' : room >= barFull.current - barName.current ? 'no-name' : 'compact')
    }
    measure()
    const seen = new ResizeObserver(measure)
    if (card) seen.observe(card)
    window.addEventListener('resize', measure)
    return () => { seen.disconnect(); window.removeEventListener('resize', measure) }
  }, [focusId, ctx])
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
      <ConnectionNotice t={t} />
      <GraphCanvas ref={canvas} pathIds={path} groupIds={groupIds} panelOpen={panelOpen} leftInset={side === 'assistant' ? assistantWidth + 12 : 0} onDelete={onDelete} onRemoveRelation={(type, id) => delRelation.mutate({ type, id })} />

      <nav aria-label={t('Главное меню')} ref={nav} className={cn('float main-bar fixed left-3 top-3 z-10 flex items-center gap-0.5 p-1', barMode !== 'full' && barMode)}>
        <span className="family-name font-serif font-medium text-[15px] px-2.5 max-w-[220px] truncate">{familyName}</span>
        <span className="sep w-px h-5 bg-border mx-0.5" />
        <button className="bar-btn" title={`${t('Поиск людей')} (⌘K)`} aria-label={t('Поиск людей')} onClick={() => setSearch(true)}><Search size={16} /> <span className="nav-label">{t('Поиск')}</span></button>
        <button className={side === 'related' ? 'bar-btn on' : 'bar-btn'} title={t('Кем приходится?')} aria-label={t('Кем приходится?')} onClick={() => { setSide(side === 'related' ? null : 'related'); setPath(null) }}><Users size={16} /> <span className="nav-label">{t('Родство')}</span></button>
        <button className={side === 'assistant' ? 'bar-btn on' : 'bar-btn'} title={`${t('Ассистент')} (⌘J)`} aria-label={t('Ассистент')} onClick={toggleAssistant}><AssistantIcon /> <span className="nav-label">{t('Ассистент')}</span></button>
        <button className={side === 'history' || side === 'review' ? 'bar-btn on relative' : 'bar-btn relative'} title={draftOps > 0 ? `${t('Что нового')}: ${t('Правки ассистента')} ${draftOps}` : t('Что нового')} aria-label={t('Что нового')} onClick={() => { setSide(side === 'review' ? 'history' : side === 'history' ? null : draftOps > 0 ? 'review' : 'history'); setPath(null) }}><Clock size={16} /> <span className="nav-label">{t('Что нового')}</span>{draftOps > 0 && <span className="absolute right-1 top-1 min-w-4 rounded-full bg-rust px-1 text-center text-[11px] leading-4 text-white">{draftOps}</span>}</button>
        <button className="bar-btn" title={t('Настройки')} aria-label={t('Настройки')} onClick={() => setSettings(true)}><Settings size={16} /> <span className="nav-label">{t('Настройки')}</span></button>
      </nav>

      {/* Only about how the chart looks; it steps aside for a panel on the left. */}
      <div aria-label={t('Вид схемы')} role="group" className={cn('float view-bar fixed bottom-3 z-10 flex items-center gap-0.5 p-1', (panelOpen || side) && 'crowded')} style={{ left: side === 'assistant' ? assistantWidth + 24 : side === 'history' ? 344 : side === 'review' ? 408 : 12 }}>
        <button className="bar-btn" title={t('Отдалить')} aria-label={t('Отдалить')} onClick={() => canvas.current?.zoomBy(0.75)}><Minus size={15} /></button>
        <button className="bar-btn" title={t('Приблизить')} aria-label={t('Приблизить')} onClick={() => canvas.current?.zoomBy(1.33)}><Plus size={15} /></button>
        <button className="bar-btn" title={t(rootsBelow ? 'Сейчас старшие снизу. Показать старших сверху' : 'Сейчас старшие сверху. Показать старших снизу')} aria-label={t(rootsBelow ? 'Сейчас старшие снизу. Показать старших сверху' : 'Сейчас старшие сверху. Показать старших снизу')} onClick={flipChart}><ArrowUpDown size={15} /></button>
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
      {!assistant.ready && <AssistantSetup state={assistant} open={side === 'assistant'} width={assistantWidth} onWidth={setAssistantWidth} onClose={() => setSide(null)} />}
      {assistant.ready && assistantUsed && <AssistantPanel open={side === 'assistant'} width={assistantWidth} onWidth={setAssistantWidth} onClose={() => setSide(null)} onPath={setPath} onDirection={directChart} />}
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
      <ImportDialog open={importing} file={dropped} onOpenChange={setImporting} />
      <ConfirmDialog state={confirmState} onClose={() => setConfirm(null)} />
      <SettingsDialog open={settings} onOpenChange={setSettings} familyName={familyName} providers={providers} onText={() => setTextOpen(true)} />
    </App.Provider>
  )
}

/** Says so when the server cannot be reached, so nobody types into a chart that will not save. */
function ConnectionNotice({ t }: { t: (key: string) => string }) {
  const [down, setDown] = useState(false)
  useEffect(() => {
    const check = () => fetch('/api/health', { cache: 'no-store' }).then((r) => setDown(!r.ok)).catch(() => setDown(true))
    const timer = setInterval(check, 15_000)
    window.addEventListener('online', check)
    window.addEventListener('offline', check)
    return () => {
      clearInterval(timer)
      window.removeEventListener('online', check)
      window.removeEventListener('offline', check)
    }
  }, [])
  if (!down) return null
  return <div role="alert" className="float fixed left-1/2 -translate-x-1/2 top-3 z-50 px-3 py-1.5 text-xs text-destructive">{t('Нет связи с сервером. Схема показана как при последней загрузке, новые правки могут не сохраниться')}</div>
}
