'use client'
// One chronicle entry as an article: its dates, its headline, the key to its zones, the story, the relatives it
// touched and where to read more. The front page (wide screens) and the card in the bar (phones and tablets) both
// print entries this way.
import { useEffect, useState, type CSSProperties } from 'react'
import { X } from 'lucide-react'
import { useApp } from '@/lib/client'
import { formatSpan, pickText, type Entry, type Shape, type Tone } from '@/lib/chronicle'
import { shortUrl } from '@/lib/linkify'
import { ChronicleText, paragraphs } from './chronicle-text'

/** Who sees the chronicle, for the owner: only them, or everyone who can open the archive. */
export type ChronicleShow = 'owner' | 'all'

export interface ArticleActions {
  /** The headline: the moment goes to the entry's start and the camera to its shape. */
  onHeadline?: (e: Entry) => void
  /** A relative's line or a mention: follow them, at the line's year when it has one. */
  onPerson: (id: string, year?: number) => void
  /** A relative's line hovered: their face on the map looks as if hovered too. */
  onHover?: (id: string | null) => void
  faceFor: (id: string) => string
  nameOf: (id: string) => string
  /** Story focus: the entry whose relatives alone stay in full ink, or none; pressed again, the whole family. */
  story?: string | null
  onStory?: (e: Entry | null) => void
}

/** A zone's swatch in the key, drawn as the map draws its hatch. */
export function swatch(tone: Tone): CSSProperties {
  if (tone === 1) return { background: 'repeating-linear-gradient(45deg, color-mix(in srgb, var(--ink) 22%, transparent) 0 1px, transparent 1px 4.24px), color-mix(in srgb, var(--ink) 5%, transparent)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--ink) 45%, transparent)' }
  if (tone === 2) return { background: 'repeating-linear-gradient(-45deg, color-mix(in srgb, var(--accent) 30%, transparent) 0 1px, transparent 1px 4.24px), color-mix(in srgb, var(--accent) 7%, transparent)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--accent) 60%, transparent)' }
  return { background: 'radial-gradient(circle, color-mix(in srgb, var(--ink-soft) 35%, transparent) 0.6px, transparent 0.9px) 0 0 / 6px 6px', outline: '1px dashed color-mix(in srgb, var(--ink-soft) 50%, transparent)', outlineOffset: '-1px' }
}

/** `short`: the first paragraph and "Keep reading", for an article below the first. */
export function ChronicleArticle({ entry, shape, short = false, actions }: { entry: Entry; shape?: Shape; short?: boolean; actions: ArticleActions }) {
  const { t, lang, archiveLang } = useApp()
  const [more, setMore] = useState(false)
  const pick = (x: Entry['title']) => pickText(x, lang, archiveLang)
  const title = pick(entry.title), body = pick(entry.body), link = pick(entry.link)
  const cut = short && !more && paragraphs(body).length > 1
  const when = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(entry.updatedAt))
  return (
    <article id={`chronicle-${entry.key}`} className="chronicle-article" aria-label={title}>
      <p className="chronicle-kicker">{formatSpan(entry.from, entry.to, lang)}</p>
      <h3 className="chronicle-headline">
        {actions.onHeadline ? <button type="button" onClick={() => actions.onHeadline!(entry)}>{title}</button> : title}
      </h3>
      {shape?.kind === 'zones' && (
        <ul className="chronicle-legend">
          {shape.zones.map((z) => <li key={z.id}><span className="chronicle-swatch" style={swatch(z.tone)} aria-hidden />{pick(z.name)}</li>)}
        </ul>
      )}
      {body && (
        <div className="chronicle-body">
          <ChronicleText value={body} first={cut} onPerson={(id) => actions.onPerson(id)} />
          {cut && <button type="button" className="chronicle-more" onClick={() => setMore(true)}>{t('Keep reading')}</button>}
        </div>
      )}
      {entry.people.length > 0 && (
        <section className="chronicle-family" aria-label={t('In the family')}>
          <p className="chronicle-kicker">{t('In the family')}</p>
          {entry.people.map((l) => {
            const year = l.year === undefined ? undefined : Math.floor(l.year)
            const face = actions.faceFor(l.personId)
            return (
              <button key={`${l.personId}-${l.at ?? ''}`} type="button" className="chronicle-line" onClick={() => actions.onPerson(l.personId, l.year)}
                onPointerEnter={() => actions.onHover?.(l.personId)} onPointerLeave={() => actions.onHover?.(null)} onFocus={() => actions.onHover?.(l.personId)} onBlur={() => actions.onHover?.(null)}>
                <span className="chronicle-line-head">
                  {face ? <img src={face} alt="" className="chronicle-face" /> : <span className="chronicle-face" aria-hidden />}
                  <span className="chronicle-line-name">{actions.nameOf(l.personId)}</span>
                  {year !== undefined && <span className="chronicle-line-year">{year}</span>}
                </span>
                <span className="chronicle-line-text">{pick(l.text)}</span>
              </button>
            )
          })}
        </section>
      )}
      {link && <a className="chronicle-link" href={link} target="_blank" rel="noreferrer noopener">{t('More at {host}').replace('{host}', () => shortUrl(link))}</a>}
      {actions.onStory && entry.people.length > 0 && (
        <button type="button" className="bar-btn chronicle-story" aria-pressed={actions.story === entry.key} onClick={() => actions.onStory!(actions.story === entry.key ? null : entry)}>
          {actions.story === entry.key ? t('The whole family_nominative') : t('Show only those it touched')}
        </button>
      )}
      {entry.by && <p className="chronicle-print">{t('Entry by {by}, {date}').replace('{by}', () => entry.by).replace('{date}', () => when)}</p>}
    </article>
  )
}

/**
 * The card in the bar, on phones and tablets: the entry the chip names, a row of the others going on to switch to,
 * and a close button. Escape closes it.
 */
export function ChronicleCard({ entries, shown, shapes, onShow, onClose, actions }: { entries: Entry[]; shown: Entry; shapes: Map<string, Shape>; onShow: (key: string) => void; onClose: () => void; actions: ArticleActions }) {
  const { t, lang, archiveLang } = useApp()
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); onClose() } }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [onClose])
  const others = entries.filter((e) => e.key !== shown.key)
  return (
    <div className="chronicle-card" role="region" aria-label={t('Chronicle')}>
      <button type="button" className="chronicle-close" aria-label={t('Close')} title={t('Close')} onClick={onClose}><X size={16} /></button>
      {others.length > 0 && (
        <div className="chronicle-switch">
          {others.map((e) => <button key={e.key} type="button" onClick={() => onShow(e.key)}>{pickText(e.title, lang, archiveLang)}</button>)}
        </div>
      )}
      <ChronicleArticle key={shown.key} entry={shown} shape={shapes.get(shown.key)} actions={actions} />
    </div>
  )
}
