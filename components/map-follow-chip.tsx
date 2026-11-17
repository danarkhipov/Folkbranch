'use client'
// Who the map is following, over the track: their face, name and years, the card to open, and the way out. Someone
// with nothing placed yet is still named here, with what the map is missing, rather than the whole family shown.
// When the person followed is an ancestor of the line's end, a two-way choice: their own life, or the line of
// descent from them down to the end; in line mode the chip says the line in a few words.
import { useRef, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { useApp } from '@/lib/client'

export interface ChipLine {
  /** Following the line now, or offered it. */
  on: boolean
  /** The choice's words: "Line to you", or "Line → <name>". */
  choice: string
  onChange: (on: boolean) => void
  /** In line mode: "6 generations · 1838–now", and how many in the line are not on the map (opens the list). */
  summary?: string
  notOnMap?: { count: number; words: string; onShow: () => void }
}

export interface FollowChipProps {
  name: string; face: string; years: string
  /** Along a line, where it ends ("you", or a name): kept whole after the arrow while the name gives way. */
  to?: string | null
  /** Why they are not on the map yet ("Birth — place unknown"), or null when they are. */
  missing: string | null
  cardOpen: boolean
  onOpen: () => void
  onStop: () => void
  line?: ChipLine | null
}

export function FollowChip({ name, face, years, to, missing, cardOpen, onOpen, onStop, line }: FollowChipProps) {
  const { t } = useApp()
  const radios = useRef<(HTMLButtonElement | null)[]>([])
  // One Tab stop for the choice; the arrows move it, as in any radio group.
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!line || !['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
    e.preventDefault()
    line.onChange(!line.on)
    radios.current[line.on ? 0 : 1]?.focus()
  }
  return (
    <div role="group" aria-label={`${t('Следим')}: ${name}${to ? ` → ${to}` : ''}`} className={`map-chip flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1${line?.on ? ' lining' : ''}`}>
      <img src={face} alt="" className="map-place-face" />
      <span className="map-chip-who flex min-w-0 flex-1 flex-col leading-tight">
        <span className="flex min-w-0 font-serif text-base text-ink"><span className="truncate">{name}</span>{to && <span className="flex-none whitespace-pre"> → {to}</span>}</span>
        {line?.on
          ? <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm tabular-nums text-ink-soft">
              <span className="truncate">{line.summary}</span>
              {line.notOnMap && line.notOnMap.count > 0 && <button type="button" className="map-chip-gaps underline decoration-dotted underline-offset-2" onClick={line.notOnMap.onShow}>{line.notOnMap.words}</button>}
            </span>
          : years && <span className="truncate text-sm tabular-nums text-ink-soft">{years}</span>}
        {missing !== null && <span className="line-clamp-2 text-sm text-ink-soft">{t('Пока не на карте')}{missing && `: ${missing}`}</span>}
      </span>
      {line && (
        <div role="radiogroup" aria-label={t('Что показать о человеке')} className="map-chip-mode flex flex-none rounded-md border border-border text-sm" onKeyDown={keys}>
          {[false, true].map((on, i) => (
            <button key={i} ref={(el) => { radios.current[i] = el }} type="button" role="radio" aria-checked={line.on === on} tabIndex={line.on === on ? 0 : -1}
              className={`px-2 py-1 ${line.on === on ? 'bg-muted text-ink' : 'text-ink-soft'}`} onClick={() => line.onChange(on)}>{on ? line.choice : t('Жизнь')}</button>
          ))}
        </div>
      )}
      <span className="map-chip-acts flex flex-none items-center gap-1">
        {!cardOpen && <button type="button" className="bar-btn flex-none" onClick={onOpen}>{t('Открыть')}</button>}
        <button type="button" className="bar-btn flex-none !px-0" aria-label={t('Не следить')} title={t('Не следить')} onClick={onStop}><X size={15} /></button>
      </span>
    </div>
  )
}
