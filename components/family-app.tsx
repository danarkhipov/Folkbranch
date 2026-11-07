'use client'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { UserPlus, X } from 'lucide-react'
import { App, Presence, api, undoFailure, useProposals, useTr, useWrite, type AppCtx, type QuickType } from '@/lib/client'
import { Family } from '@/lib/kinship'
import { personName, type Graph, type HistoryEntry, type Lang, type Me } from '@/lib/types'
import { GraphCanvas, type CanvasHandle } from './graph-canvas'
import { ConnectionNotice, MainBar, ViewBar, type Side } from './chart-bars'
import { useChartScope } from './chart-scope'
import { QuickAdd } from './quick-add'
import { ConfirmDialog, SearchDialog, type SearchHit } from './person-pickers'
import type { AssistantState } from '@/lib/types'
import { useLive } from '@/lib/use-live'
import { useAssistantWidth } from './panel-size'

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
// Opened now and then, and they bring the photo viewer, the importers and the settings along.
const PhotoDialog = dynamic(() => import('./photo-dialog').then((m) => m.PhotoDialog), { ssr: false })
const ImportDialog = dynamic(() => import('./import-dialog').then((m) => m.ImportDialog), { ssr: false })
const SettingsDialog = dynamic(() => import('./settings/settings-dialog').then((m) => m.SettingsDialog), { ssr: false })
const HistoryPanel = dynamic(() => import('./side-panels').then((m) => m.HistoryPanel), { ssr: false })
const ReviewPanel = dynamic(() => import('./review-panel').then((m) => m.ReviewPanel), { ssr: false })
const PrintDialog = dynamic(() => import('./print-dialog').then((m) => m.PrintDialog), { ssr: false })
// The card opens on a press, so its tabs need not come with the first screen.
const PersonPanel = dynamic(() => import('./person-panel').then((m) => m.PersonPanel), { ssr: false })
const Onboarding = dynamic(() => import('./onboarding').then((m) => m.Onboarding), { ssr: false })
const TextDialog = dynamic(() => import('./text-dialog').then((m) => m.TextDialog), { ssr: false })

/** Below this, the chat and the card do not fit side by side. */
const NARROW = 960
/** Long enough to read and to reach the button in it from the keyboard; it stays while in use. */
const TOAST_MS = 12_000

/** Closing a panel puts the keyboard back where it was, not at the top of the page. */
function useFocusReturn(open: boolean) {
  const from = useRef<HTMLElement | null>(null)
  const was = useRef(open)
  useEffect(() => {
    if (open === was.current) return
    was.current = open
    if (open) { from.current = document.activeElement as HTMLElement | null; return }
    const back = from.current
    requestAnimationFrame(() => {
      if (back?.isConnected && (document.activeElement === document.body || !document.activeElement)) back.focus({ preventScroll: true })
    })
  }, [open])
}

export function FamilyApp({ me, lang, familyName, providers, assistant }: Props) {
  const t = useTr(lang)
  const { data: graph } = useQuery({ queryKey: ['graph'], queryFn: () => api<Graph>('graph') })
  const canvas = useRef<CanvasHandle>(null)
  const [focusId, setFocusId] = useState<string | null>(() => (typeof location !== 'undefined' ? new URLSearchParams(location.search).get('p') : null))
  const present = useLive(focusId, !me.guest)
  const [search, setSearch] = useState(false)
  // Nothing of the bars is drawn before the data comes, so reading this here cannot differ from the server's page.
  const [barsHidden, setBarsHidden] = useState(() => { try { return typeof localStorage !== 'undefined' && localStorage.getItem('bars-hidden') === '1' } catch { return false } })
  const hideBars = (hidden: boolean) => {
    setBarsHidden(hidden)
    if (hidden) setSide(null)
    try { localStorage.setItem('bars-hidden', hidden ? '1' : '0') } catch {}
    // The button just pressed is going away: the keyboard moves to the one that brings it back.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(hidden ? '.show-bars' : '.hide-bars')?.focus({ preventScroll: true }))
  }
  const [searchHit, setSearchHit] = useState<SearchHit | null>(null)
  const [side, setSide] = useState<Side>(null)
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
  const [printing, setPrinting] = useState(false)
  // Only straight after the archive is made: it says so in the address, once.
  const [welcome, setWelcome] = useState(() => typeof location !== 'undefined' && me.role === 'owner' && new URLSearchParams(location.search).has('welcome'))
  const endWelcome = () => { setWelcome(false); const url = new URL(location.href); url.searchParams.delete('welcome'); history.replaceState(null, '', url) }
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
  const rootsBelowRef = useRef(rootsBelow)
  rootsBelowRef.current = rootsBelow
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
  const [confirmState, setConfirm] = useState<{ text: string; action: string; note?: string; resolve: (v: boolean) => void } | null>(null)

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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j' && !me.guest) {
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

  // On the chart, arrows walk the family: up and down through generations, sideways to a spouse or a brother or sister.
  const lookupsRef = useRef<{ family: Family } | null>(null)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      // Zoom works anywhere on the chart, for those who cannot pinch or scroll.
      if (!e.metaKey && !e.ctrlKey && !e.altKey && !target.closest?.('input, textarea, select, [contenteditable=true], [role=dialog], [role=listbox], [role=menu], aside')) {
        if (e.key === '+' || e.key === '=') { e.preventDefault(); return canvas.current?.zoomBy(1.33) }
        if (e.key === '-' || e.key === '−') { e.preventDefault(); return canvas.current?.zoomBy(0.75) }
        if (e.key === '0') { e.preventDefault(); return canvas.current?.fit() }
      }
      const here = target.closest?.<HTMLElement>('.pcard[data-person]')
      const family = lookupsRef.current?.family
      if (!here || !family || !e.key.startsWith('Arrow') || !target.matches('.card-main')) return
      const id = here.dataset.person!
      const parents = family.parents.get(id) ?? []
      const children = family.children.get(id) ?? []
      const side = [...(family.spouses.get(id) ?? []), ...parents.flatMap((p) => family.children.get(p) ?? []).filter((c) => c !== id)]
      const older = rootsBelowRef.current ? e.key === 'ArrowDown' : e.key === 'ArrowUp'
      const younger = rootsBelowRef.current ? e.key === 'ArrowUp' : e.key === 'ArrowDown'
      const next = older ? parents[0] : younger ? children[0] : e.key === 'ArrowRight' ? side[0] : side.at(-1)
      if (!next) return
      e.preventDefault()
      canvas.current?.center(next)
      requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector<HTMLElement>(`.pcard[data-person="${next}"] .card-main`)?.focus({ preventScroll: true })))
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  useFocusReturn(!!focusId)
  useFocusReturn(!!side)

  const qc = useQueryClient()
  const [toast, setToast] = useState<{ text: string; actions: { label: string; run: () => void }[] } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const notify = useCallback((text: string, actions: { label: string; run: () => void }[] = []) => {
    clearTimeout(toastTimer.current)
    setToast({ text, actions })
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS)
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

  // Rebuilt when the family changes, not on each click.
  const lookups = useMemo(() => (graph ? { byId: new Map(graph.persons.map((p) => [p.id, p])), family: new Family(graph) } : null), [graph])
  lookupsRef.current = lookups
  const ctx = useMemo<AppCtx | null>(() => {
    if (!graph || !lookups) return null
    return {
      me, lang, familyName, t, graph, focusId, focus,
      canEdit: me.role !== 'reader',
      rootsBelow,
      ...lookups,
      openPhoto: (id, list) => setPhoto({ id, list }),
      confirm: (text, action, note) => new Promise((resolve) => setConfirm({ text, action, note, resolve })),
      quickAdd: (type, to, otherParent) => setQuick({ type, to, otherParent }),
      notify,
      undoLast,
    }
  }, [graph, lookups, me, lang, familyName, focusId, focus, rootsBelow]) // eslint-disable-line react-hooks/exhaustive-deps

  const delPerson = useWrite((id: string) => api(`persons/${id}`, { method: 'DELETE' }))

  const scope = useChartScope(graph, lookups?.family, focusId, () => requestAnimationFrame(() => requestAnimationFrame(() => canvas.current?.fit())))

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
      if (bar && !bar.classList.contains('compact') && !bar.classList.contains('no-name') && !bar.classList.contains('folded') && !bar.style.width) {
        barFull.current = bar.offsetWidth
        barName.current = (bar.querySelector<HTMLElement>('.family-name')?.offsetWidth ?? 90) + 30 // the name, its divider, tighter buttons
      }
      const room = window.innerWidth - (card?.offsetWidth ?? 0) - 32
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
    if (await ctx.confirm(`${t('Удалить человека')} «${personName(p!) || t('Без названия')}»?`, t('Удалить'), t('Вернуть можно в разделе «История».'))) {
      await delPerson.mutateAsync(id)
      if (focusId === id) focus(null)
    }
  }

  return (
    <App.Provider value={ctx}>
      <Presence.Provider value={present}>
      <ConnectionNotice t={t} />
      <a href="#chart" className="skip-link bar-btn float" onClick={(e) => { e.preventDefault(); document.querySelector<HTMLElement>('.card-main')?.focus() }}>{t('Перейти к схеме')}</a>
      <MainBar folded={barsHidden} onHide={() => hideBars(true)} onShow={() => hideBars(false)} guest={!!me.guest} familyName={familyName} present={present} mode={barMode} navRef={nav} side={side} draftOps={draftOps} onSearch={() => setSearch(true)} onSide={(next) => { setSide(next); setPath(null) }} onAssistant={toggleAssistant} onSettings={() => setSettings(true)} />
      <main id="chart" aria-label={t('Схема семьи')}>
      <GraphCanvas ref={canvas} scope={scope} pathIds={path} groupIds={groupIds} panelOpen={panelOpen} leftInset={side === 'assistant' ? assistantWidth + 12 : 0}/>

      <ViewBar folded={barsHidden} onPrint={() => setPrinting(true)} scope={scope} canvas={canvas} rootsBelow={rootsBelow} onFlip={flipChart} groups={groups} onGroups={setGroups} allGroups={allGroups} left={side === 'assistant' ? assistantWidth + 24 : side === 'history' || side === 'review' ? 408 : 12} crowded={panelOpen || !!side} />
      </main>

      {!ctx.graph.persons.length && ctx.canEdit && (
        <div className="fixed inset-0 grid place-items-center pointer-events-none">
          <button className="float pointer-events-auto px-5 h-12 flex items-center gap-2 font-serif text-base hover:bg-muted" onClick={() => setQuick({ type: null, to: null })}><UserPlus size={17} /> {t('Первый человек в архиве')}</button>
        </div>
      )}

      {side === 'history' && <HistoryPanel onClose={() => setSide(null)} />}
      {side === 'review' && <ReviewPanel onClose={() => setSide(null)} />}
      {!assistant.ready && <AssistantSetup state={assistant} open={side === 'assistant'} width={assistantWidth} onWidth={setAssistantWidth} onClose={() => setSide(null)} />}
      {assistant.ready && assistantUsed && <AssistantPanel open={side === 'assistant'} width={assistantWidth} onWidth={setAssistantWidth} onClose={() => setSide(null)} onPath={setPath} onDirection={directChart} />}
      {panelOpen && <PersonPanel key={focused!.id} person={focused!} hit={searchHit?.personId === focused!.id ? searchHit : null} onClearHit={() => setSearchHit(null)} onClose={() => focus(null)} onDelete={onDelete} />}

      <SearchDialog open={search} onOpenChange={setSearch} onPick={(id, hit) => { setSearchHit(hit ?? null); focus(id) }} />
      <QuickAdd state={quick} onClose={(id) => { setQuick(null); if (id) focus(id) }} />
      {photo && <PhotoDialog state={photo} onClose={() => setPhoto(null)} />}
      {toast && (
        <div role="status" onMouseEnter={() => clearTimeout(toastTimer.current)} onFocus={() => clearTimeout(toastTimer.current)} onMouseLeave={() => { toastTimer.current = setTimeout(() => setToast(null), TOAST_MS) }} className="float fixed left-1/2 -translate-x-1/2 bottom-3 max-lg:bottom-[68px] z-30 flex items-center gap-1 pl-3 pr-1 py-1 text-sm max-w-[calc(100vw-24px)]">
          <span className="truncate mr-1">{toast.text}</span>
          {toast.actions.map((a) => <button key={a.label} className="bar-btn !h-7 whitespace-nowrap" onClick={() => { setToast(null); a.run() }}>{a.label}</button>)}
          <button className="bar-btn !h-7 !min-w-7 !p-0" aria-label={t('Закрыть')} title={t('Закрыть')} onClick={() => setToast(null)}><X size={13} /></button>
        </div>
      )}
      {textOpen && <TextDialog open onOpenChange={setTextOpen} />}
      {importing && <ImportDialog open file={dropped} onOpenChange={setImporting} />}
      {welcome && <Onboarding onClose={endWelcome} onImport={() => { endWelcome(); setDropped(null); setImporting(true) }} onFirstPerson={() => { endWelcome(); setQuick({ type: null, to: null }) }} />}
      {printing && <PrintDialog graph={scope.shown ?? ctx.graph} onClose={() => setPrinting(false)} />}
      <ConfirmDialog state={confirmState} onClose={() => setConfirm(null)} />
      {settings && <SettingsDialog open onOpenChange={setSettings} familyName={familyName} providers={providers} onText={() => setTextOpen(true)} />}
      </Presence.Provider>
    </App.Provider>
  )
}
