'use client'
// The chronicle's front page on a wide screen: a column on the left of the map that reads like a newspaper for the
// year shown. It follows the clock; between entries it says so and offers the nearest before and after. Folded, it is
// a small tab. It makes room for itself through two variables on the page (--map-left, --chronicle-tab), which the
// bar, the missing-people chip and the camera read.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { EyeOff, List, Newspaper, PanelLeftClose } from 'lucide-react'
import { useApp } from '@/lib/client'
import { activeIn, around, byStanding, formatSpan, pickText, type Entry, type Shape } from '@/lib/chronicle'
import { ChronicleArticle, type ArticleActions, type ChronicleShow } from './chronicle-card'

const KEY = 'folkbranch.map.chronicle'
const readPref = (): 'open' | 'closed' | null => { try { const v = localStorage.getItem(KEY); return v === 'open' || v === 'closed' ? v : null } catch { return null } }
const writePref = (v: 'open' | 'closed') => { try { localStorage.setItem(KEY, v) } catch { /* a private window: kept for this page only */ } }
/** Below this width the page and the person card do not both fit: the page folds while the card is open. */
const BOTH = '(min-width: 1360px)'

export interface ChroniclePageProps {
  entries: Entry[]
  shapes: Map<string, Shape>
  /** The whole year shown. */
  year: number
  status: 'loading' | 'error' | 'ready'
  owner: boolean
  /** The person card is open on the right. */
  personCard: boolean
  /** An entry to bring into view, asked by the bar's chip; `n` counts the asks, so the same entry can be asked again. */
  ask: { key: string; n: number } | null
  /** Go to an entry: the moment moves to its start. */
  onJump: (e: Entry) => void
  /** The page failed to load and the tab was pressed: ask again. */
  onRetry: () => void
  actions: ArticleActions
  /** For the owner: who sees the chronicle (changed under Settings > Map). */
  show?: ChronicleShow
}

export function ChroniclePage({ entries, shapes, year, status, owner, personCard, ask, onJump, onRetry, actions, show }: ChroniclePageProps) {
  const { t, lang, archiveLang } = useApp()
  const [pref, setPref] = useState(readPref)
  const [both, setBoth] = useState(() => matchMedia(BOTH).matches)
  useEffect(() => {
    const q = matchMedia(BOTH), on = () => setBoth(q.matches)
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [])
  const [listing, setListing] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  // Not there at all: a reader with nothing to read. While loading, only someone who left it open sees it at once.
  const absent = (status === 'ready' && !entries.length && !owner) || (status === 'loading' && pref !== 'open')
  const wanted = pref ? pref === 'open' : entries.length > 0
  const folded = personCard && !both
  const open = !absent && status !== 'error' && wanted && !folded
  const setOpen = (v: boolean) => setPref(v ? 'open' : 'closed')
  useEffect(() => { if (pref) writePref(pref) }, [pref])

  // The room it takes, for the bar, the chip of people not on the map and the camera.
  useLayoutEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--map-left', open ? '372px' : '0px')
    root.setProperty('--chronicle-tab', !absent && !open ? '44px' : '0px')
  }, [open, absent])
  useEffect(() => () => { const root = document.documentElement.style; root.removeProperty('--map-left'); root.removeProperty('--chronicle-tab') }, [])

  // The chip asked for an entry: the page opens (and leaves the list of all entries), then brings its article into view.
  const [asked, setAsked] = useState(ask)
  if (ask !== asked) {
    setAsked(ask)
    if (ask) { setListing(false); if (!wanted) setOpen(true) }
  }
  useEffect(() => {
    if (!ask) return
    const raf = requestAnimationFrame(() => document.getElementById(`chronicle-${ask.key}`)?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }))
    return () => cancelAnimationFrame(raf)
  }, [ask])
  // Escape closes the list of all entries.
  useEffect(() => {
    if (!listing) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setListing(false) }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [listing])

  if (absent) return null
  const active = activeIn(entries, year).sort(byStanding)
  const { before, after } = around(entries, year)
  const title = (e: Entry) => pickText(e.title, lang, archiveLang)
  const jumpLabel = (e: Entry) => `${Math.floor(e.fromYear)} · ${title(e)}`
  // While only the owner sees it, the tab and the masthead say so, so a draft is never taken for something shared.
  const draft = owner && show === 'owner' && <EyeOff size={12} className="chronicle-draft" aria-hidden />

  if (!open) {
    return (
      <button type="button" className="chronicle-tab float" aria-label={t('Open the chronicle')} title={t('Open the chronicle')} aria-expanded={false}
        onClick={() => { if (status === 'error') onRetry(); else setOpen(true) }}>
        <Newspaper size={15} aria-hidden />
        <span>{t('Chronicle')}</span>
        {draft}
        {active.length > 0 && <span className="chronicle-dot" aria-hidden />}
      </button>
    )
  }

  const jump = (e: Entry) => { setListing(false); onJump(e) }
  return (
    <aside className="chronicle float" aria-label={t('Chronicle')}>
      <header className="chronicle-mast">
        <span className="chronicle-label">{t('Chronicle')}{draft}</span>
        <span className="chronicle-year">{year}</span>
        <button type="button" className="chronicle-icon" aria-label={t('All entries')} title={t('All entries')} aria-pressed={listing} disabled={!entries.length} onClick={() => setListing(!listing)}><List size={16} /></button>
        <button type="button" className="chronicle-icon" aria-label={t('Fold the chronicle away')} title={t('Fold the chronicle away')} onClick={() => setOpen(false)}><PanelLeftClose size={16} /></button>
      </header>
      <div ref={scroller} className="chronicle-scroll">
        {status === 'loading' ? (
          <div className="chronicle-loading" aria-hidden><i style={{ width: '80%' }} /><i style={{ width: '100%' }} /><i style={{ width: '60%' }} /></div>
        ) : !entries.length ? (
          <p className="chronicle-empty">{t('No entries yet. Agents add them through the API.')}</p>
        ) : listing ? (
          <ul className="chronicle-list" aria-label={t('All entries')}>
            {[...entries].sort((a, b) => a.fromYear - b.fromYear || a.key.localeCompare(b.key)).map((e) => (
              <li key={e.key}>
                <button type="button" className={active.includes(e) ? 'current' : undefined} aria-current={active.includes(e) || undefined} onClick={() => jump(e)}>
                  <span className="chronicle-kicker">{formatSpan(e.from, e.to, lang)}</span>
                  <span className="chronicle-list-title">{title(e)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : active.length ? (
          active.map((e, i) => <ChronicleArticle key={e.key} entry={e} shape={shapes.get(e.key)} short={i > 0} actions={actions} />)
        ) : (
          <div className="chronicle-none">
            <p className="chronicle-empty">{t('Nothing in the chronicle for this year.')}</p>
            {[before, after].map((e) => e && (
              <button key={e.key} type="button" className="chronicle-near" onClick={() => jump(e)}>
                <span className="chronicle-kicker">{formatSpan(e.from, e.to, lang)}</span>
                <span className="chronicle-list-title">{title(e)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {entries.length > 0 && (
        <footer className="chronicle-foot">
          <button type="button" disabled={!before} title={before ? jumpLabel(before) : undefined} onClick={() => before && jump(before)}><span>← {before ? jumpLabel(before) : ''}</span></button>
          <button type="button" disabled={!after} title={after ? jumpLabel(after) : undefined} onClick={() => after && jump(after)}><span>{after ? jumpLabel(after) : ''} →</span></button>
        </footer>
      )}
    </aside>
  )
}
