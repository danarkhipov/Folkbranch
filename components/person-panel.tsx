'use client'
import { useContext, useEffect, useRef, useState, type RefObject } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import { History, Maximize2, Minimize2, PencilLine, Search, Trash2, X } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, Presence, useApp, usePersonSave } from '@/lib/client'
import { yourTerm } from '@/lib/kinship'
import { editValue,  } from '@/lib/claims'
import { patronymicFrom } from '@/lib/names'
import { normal } from '@/lib/search/words'
import { cn } from '@/lib/utils'
import { personName, type ClaimField, type HistoryEntry, type PageMeta, type Person } from '@/lib/types'
import { PanelEdge, useStoredSize } from './panel-size'
import { MatchLine, useEsc, type SearchHit } from './person-pickers'
import { Field, SearchTerms } from './person-fields'
import { AvatarButton } from './person-avatar'
import { Pages } from './person-pages'
import { FamilyTab } from './person-family'
import { PhotosTab } from './person-photos'
import { Details } from './person-details'
import { StoriesTab } from './person-stories'
import { PersonHistory } from './side-panels'

const NO_TERMS: string[] = []
const RECENT = 7 * 24 * 3600 * 1000
/** Found in the card's own heading: no need to leave the tab the card opens on. */
const HEADER_KEYS = new Set(['givenName', 'surname', 'patronymic', 'maidenName'])

/**
 * Colours the found words in whatever the tab shows, a biography included, and brings the first one into view.
 * Text boxes do theirs themselves: see GrowText.
 */
function useSearchMarks(box: RefObject<HTMLElement | null>, terms: string[], tab: string | null) {
  useEffect(() => {
    const registry = (globalThis as unknown as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights
    const Paint = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight
    const root = box.current
    if (!root || !terms.length) { registry?.delete('search'); return }
    const wanted = [...new Set(terms.map(normal))].filter(Boolean)
    let scrolled = false
    const paint = () => {
      const ranges: Range[] = []
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const parent = n.parentElement
        if (!n.nodeValue || !parent || parent.closest('textarea, input, .grow-marks, mark, [hidden], [data-state=inactive]')) continue
        const low = normal(n.nodeValue)
        for (const w of wanted) for (let i = low.indexOf(w); i >= 0; i = low.indexOf(w, i + w.length)) {
          const r = new Range()
          r.setStart(n, i)
          r.setEnd(n, i + w.length)
          ranges.push(r)
        }
      }
      if (registry && Paint) registry.set('search', new Paint(...ranges))
      if (scrolled) return
      const panel = root.querySelector('[role=tabpanel][data-state=active]')
      const first = panel?.querySelector('.grow-marks mark') ?? ranges.find((r) => panel?.contains(r.startContainer))?.startContainer.parentElement
      if (first) {
        scrolled = true
        first.closest('details')?.setAttribute('open', '')
        first.scrollIntoView({ block: 'center' })
      }
    }
    paint()
    // The tab and the biography's editor fill in a moment later.
    let timer: ReturnType<typeof setTimeout>
    const watcher = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(paint, 100) })
    watcher.observe(root, { childList: true, subtree: true, characterData: true })
    return () => { watcher.disconnect(); clearTimeout(timer); registry?.delete('search') }
  }, [box, terms, tab])
}

const SuggestDialog = dynamic(() => import('./suggest-dialog').then((m) => m.SuggestDialog), { ssr: false })

export function PersonPanel({ person, hit, onClearHit, onClose, onDelete }: { person: Person; hit: SearchHit | null; onClearHit: () => void; onClose: () => void; onDelete: (id: string) => void }) {
  const [width, setWidth] = useStoredSize('person-panel-width', 480, (w) => Math.round(Math.max(360, Math.min(w, window.innerWidth - 80))))
  const [height, setHeight] = useStoredSize('person-panel-height', 560, (h) => Math.round(Math.max(240, Math.min(h, window.innerHeight - 16))))
  const app = useApp()
  const { t, canEdit, me, family, lang, graph, byId, notify } = app
  const present = useContext(Presence)
  const hereToo = present.filter((o) => o.focusId === person.id).map((o) => o.name)
  const [full, setFull] = useState(false)
  useEsc(onClose)
  const qc = useQueryClient()
  const patch = usePersonSave(person, (e) => {
    const { status } = e as Error & { status?: number }
    if (status === 409 || status === 404) {
      notify(t(status === 409 ? 'Это поле только что изменил другой человек. Показано новое значение, проверьте его.' : 'Этого человека только что удалили.'))
      qc.invalidateQueries({ queryKey: ['graph'] })
    }
  })
  /** A name with versions keeps them in step: typing corrects the main one. */
  const saveName = (key: ClaimField) => (v: string) => patch.mutate(person.claims.some((c) => c.field === key) ? editValue(person, key, v) : { [key]: v })
  const { data: pageList } = useQuery({ queryKey: ['pages', person.id], queryFn: () => api<PageMeta[]>(`persons/${person.id}/pages`) })
  const { data: changes } = useQuery({ queryKey: ['history', person.id], queryFn: () => api<HistoryEntry[]>(`persons/${person.id}/history`), enabled: !me.guest })
  // Someone else's recent edit is worth a word before anyone relies on the card.
  const last = changes?.find((r) => !r.undoOf && !r.undoneAt)
  const changedByOther = last && last.userId !== me.id && Date.now() - last.at < RECENT ? last : null
  const [tab, setTab] = useState<string | null>(hit?.matches.find((m) => !HEADER_KEYS.has(m.key))?.tab ?? (hit ? 'details' : null))
  const [pageId, setPageId] = useState<string | undefined>(hit?.matches.find((m) => m.tab === 'pages')?.refId)
  const box = useRef<HTMLElement>(null)
  // From the keyboard, the card that just opened is where to go on from. A mouse stays where it is.
  useEffect(() => { if (document.activeElement?.matches('.card-main:focus-visible')) box.current?.focus({ preventScroll: true }) }, [])
  useSearchMarks(box, hit?.terms ?? [], tab)
  /** Opens a tab and, when given, puts the cursor in that field. */
  const go = (next: string, fieldId?: string) => {
    setTab(next)
    if (fieldId) setTimeout(() => document.getElementById(fieldId)?.focus(), 60)
  }
  const father = graph.parentChild.filter((l) => l.childId === person.id && l.kind === 'birth').map((l) => byId.get(l.parentId)).find((p) => p?.sex === 'M')
  const suggested = canEdit && lang === 'ru' && !person.patronymic && father ? patronymicFrom(father.givenName, person.sex) : ''
  const toMe = me.personId && me.personId !== person.id ? family.relation(me.personId, person.id, lang) : null
  const ro = !canEdit
  const [addPatronymic, setAddPatronymic] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  // Beside the buttons a long name would break inside its words, so it takes a line of its own.
  const longName = personName(person).length > 28

  return (
    <SearchTerms.Provider value={hit?.terms ?? NO_TERMS}>
    <aside ref={box} tabIndex={-1} aria-label={personName(person) || t('Без названия')} className={cn('panel', full && 'full')} style={{ '--panel-w': `${width}px`, '--panel-h': `${height}px` } as React.CSSProperties}>
      <PanelEdge edge="left" label="Ширина карточки" width={width} home={480} onWidth={setWidth} className="max-sm:hidden" />
      <PanelEdge edge="top" label="Высота карточки" width={height} home={Math.round((typeof window === 'undefined' ? 800 : window.innerHeight) * 0.7)} onWidth={setHeight} className="sm:hidden" />
      <header className={cn('flex flex-none items-start gap-3 pl-4 pr-2 pt-3 pb-2 max-h-[38%] overflow-y-auto', longName && 'flex-wrap')}>
        <div className="flex-none"><AvatarButton person={person} /></div>
        <div className={cn('min-w-0 flex-1', longName && 'order-last basis-full')}>
          <div className="flex flex-wrap items-baseline gap-x-1.5 font-serif text-lg font-medium leading-snug min-w-0">
            <Field fit readOnly={ro} value={person.givenName} placeholder={t('Имя')} onSave={saveName('givenName')} />
            {(person.patronymic || addPatronymic) && <Field id="f-patronymic" fit readOnly={ro} value={person.patronymic} placeholder={t('Отчество')} onSave={saveName('patronymic')} />}
            <Field fit readOnly={ro} value={person.surname} placeholder={t('Фамилия')} onSave={saveName('surname')} />
          </div>
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-ink-soft [&>button]:whitespace-nowrap">
            {(person.maidenName || (!ro && person.sex === 'F')) && <Field fit readOnly={ro} value={person.maidenName} placeholder={t('девичья фамилия')} onSave={saveName('maidenName')} />}
            {!person.patronymic && !addPatronymic && !ro && lang === 'ru' && !suggested && <button className="pick !px-0 hover:text-ink" onClick={() => { setAddPatronymic(true); setTimeout(() => document.getElementById('f-patronymic')?.focus(), 30) }}>{t('Добавить отчество')}</button>}
            {!person.patronymic && !ro && lang === 'ru' && suggested && <button className="pick !px-0 underline underline-offset-2 hover:text-ink" title={t('Подставить отчество по имени отца')} onClick={() => patch.mutate({ patronymic: suggested })}>{t('Добавить отчество')} «{suggested}»</button>}
            {toMe && <span className="text-rust">{yourTerm(toMe.label, person.sex, lang)}</span>}
            {me.personId === person.id && <span className="text-rust">{t('Это вы')}</span>}
            {hereToo.length > 0 && <span className="whitespace-nowrap">{t('Здесь также')}: {hereToo.join(', ')}</span>}
            {ro && !me.guest && <button className="pick !px-0 flex items-center gap-1 underline underline-offset-2 hover:text-ink" onClick={() => setSuggesting(true)}><PencilLine size={12} /> {t('Предложить правку')}</button>}
          </div>
        </div>
        <div className="flex flex-none gap-0.5 -mt-1 ml-auto">
          {canEdit && <button className="bar-btn !p-0 w-7 !h-7 mr-1.5 hover:!text-destructive" aria-label={t('Удалить человека')} title={t('Удалить человека')} onClick={() => onDelete(person.id)}><Trash2 size={14} /></button>}
          <button className="bar-btn !p-0 w-7 !h-7" aria-label={t(full ? 'Свернуть' : 'Развернуть')} title={t(full ? 'Свернуть' : 'Развернуть')} onClick={() => setFull(!full)}>{full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
          <button className="bar-btn !p-0 w-7 !h-7" aria-label={t('Закрыть')} title={t('Закрыть')} onClick={onClose}><X size={15} /></button>
        </div>
      </header>

      {changedByOther && !hit && (
        <button className="mx-3 mb-2 flex flex-none items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-left text-xs text-ink-soft hover:text-ink" onClick={() => setTab('history')}>
          <History size={13} className="flex-none" />
          <span className="min-w-0 break-anywhere">{t('Последнее изменение')}: {changedByOther.actorName}, {new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(changedByOther.at)}{changedByOther.details?.length ? ` · ${changedByOther.details.map((d) => d.label).join(', ')}` : ''}</span>
        </button>
      )}
      {hit && (
        <div className="mx-3 mb-2 flex flex-none items-start gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-xs max-h-28 overflow-y-auto">
          <Search size={13} className="mt-0.5 flex-none text-ink-soft" />
          <div className="min-w-0 flex-1">
            <div className="text-ink-soft">{t('Найдено по запросу')} «{hit.query}»</div>
            {hit.matches.slice(0, 5).map((m, i) => <button key={i} className="block w-full text-left hover:underline" onClick={() => { setTab(m.tab); if (m.tab === 'pages') setPageId(m.refId) }}><MatchLine match={m} /></button>)}
          </div>
          <button className="flex-none text-ink-faint hover:text-ink" aria-label={t('Убрать подсветку')} title={t('Убрать подсветку')} onClick={onClearHit}><X size={13} /></button>
        </div>
      )}
      <Tabs value={tab ?? (pageList && !pageList.length ? (!canEdit ? 'family' : person.birthDate || person.deathDate ? 'details' : 'pages') : 'pages')} onValueChange={setTab} className="flex-1 min-h-0 flex flex-col gap-0">
        <TabsList className="panel-tabs mx-3 w-fit max-w-[calc(100%-1.5rem)] overflow-x-auto justify-start bg-muted">
          <TabsTrigger value="pages" className="text-sm">{t('Биография')}</TabsTrigger>
          <TabsTrigger value="details" className="text-sm">{t('Сведения')}</TabsTrigger>
          <TabsTrigger value="family" className="text-sm">{t('Семья')}</TabsTrigger>
          <TabsTrigger value="photos" className="text-sm">{t('Фото')}</TabsTrigger>
          <TabsTrigger value="stories" className="text-sm">{t('Рассказы')}</TabsTrigger>
          {!me.guest && <TabsTrigger value="history" aria-label={t('История изменений')} title={t('История изменений')} data-hint={t('Кто и что менял в этой карточке. Любое изменение можно откатить.')} className="text-sm"><History size={15} /></TabsTrigger>}
        </TabsList>
        <TabsContent value="pages" className="flex-1 min-h-0 overflow-hidden"><Pages key={pageId} person={person} full={full} startAt={pageId} onDetails={() => go('details')} /></TabsContent>
        <TabsContent value="details" className="flex-1 min-h-0 overflow-auto pt-3">
          <Details person={person} patch={patch.mutateAsync} />
        </TabsContent>
        <TabsContent value="family" className="flex-1 min-h-0 overflow-auto pt-3"><FamilyTab person={person} /></TabsContent>
        <TabsContent value="photos" className="flex-1 min-h-0 overflow-auto"><PhotosTab person={person} /></TabsContent>
        <TabsContent value="stories" className="flex-1 min-h-0 overflow-auto"><StoriesTab person={person} /></TabsContent>
        {!me.guest && <TabsContent value="history" className="flex-1 min-h-0 overflow-auto pt-3"><PersonHistory personId={person.id} /></TabsContent>}
      </Tabs>
      {suggesting && <SuggestDialog person={person} onClose={() => setSuggesting(false)} />}
    </aside>
    </SearchTerms.Provider>
  )
}
