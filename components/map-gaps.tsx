'use client'
// The people and events the map cannot show, and why: no place, a place with no coordinates, or no year. Opens
// into a list; a click opens the person.
import { useState } from 'react'
import { MapPinOff, X } from 'lucide-react'
import { useApp } from '@/lib/client'
import type { Gap, MapTimeline, Unplaced } from '@/lib/map-timeline'
import { eventWords } from '@/lib/map-scrub'
import { peopleWords } from '@/lib/names'

export const GAP_LABEL: Record<Gap, string> = { 'no-place': 'место неизвестно', 'no-coords': 'у места нет координат', 'bad-coords': 'координаты места вне допустимого', 'unknown-place': 'такого места нет в списке мест', 'no-date': 'дата неизвестна', 'outside-span': 'вне лет жизни человека', future: 'этот год ещё не наступил', 'death-before-birth': 'смерть раньше рождения' }

/**
 * `only`: the list opened from a line's chip shows just the people of that line who are not on the map, and why.
 * `open` and `onOpen` let the chip open it; on its own it opens and closes itself.
 */
export function MapGaps({ data, only = null, open, onOpen }: { data: MapTimeline; only?: Set<string> | null; open?: boolean; onOpen?: (open: boolean) => void }) {
  const { t, lang, focus } = useApp()
  const [own, setOwn] = useState(false)
  const listOpen = open ?? own
  const setListOpen = (v: boolean) => { setOwn(v); onOpen?.(v) }
  // The chip counts two different things: people with nowhere to stand, and events of people who are on the map.
  const absentIds = new Set(data.absent.map((a) => a.personId))
  const absent = only ? data.absent.filter((a) => only.has(a.personId)) : data.absent
  const gapsByPerson = only ? [] : [...data.missing.filter((m) => !absentIds.has(m.personId)).reduce((acc, m) => acc.set(m.personId, [...(acc.get(m.personId) ?? []), m]), new Map<string, Unplaced[]>())]
  const gapEvents = gapsByPerson.reduce((n, [, list]) => n + list.length, 0)
  const gapLine = (m: Unplaced) => `${m.what}${m.date ? `, ${m.date}` : ''}${m.place ? `, ${m.place}` : ''}`
  return (
    <>
      {(data.absent.length > 0 || gapEvents > 0) && (
        <div className="map-gaps fixed left-3 top-16 z-10 max-sm:top-[max(12px,env(safe-area-inset-top))] flex max-h-[calc(100vh-180px)] flex-col items-start gap-1">
          <button type="button" className="float flex min-h-9 items-center gap-1.5 px-2.5 py-1.5 text-left text-sm text-ink-soft" aria-expanded={listOpen} onClick={() => setListOpen(!listOpen)}>
            <MapPinOff size={13} className="flex-none" />
            <span>
              {data.absent.length > 0 && <>{peopleWords(data.absent.length, lang)} {t('не на карте')}</>}
              {data.absent.length > 0 && gapEvents > 0 && ' · '}
              {gapEvents > 0 && <>{eventWords(gapEvents, lang)} {t('без места или года')}</>}
            </span>
          </button>
          {listOpen && (
            <div className="float w-80 max-w-[calc(100vw-24px)] overflow-y-auto p-2 text-sm">
              <div className="mb-1 flex items-start justify-between gap-2 px-1">
                <span className="text-ink-soft">{only && <strong className="block font-medium text-ink">{t('В этой линии')}</strong>}{t('Чтобы событие попало на карту, нужны место с координатами и год.')}</span>
                <button type="button" className="flex-none rounded p-1 hover:bg-muted" aria-label={t('Закрыть')} onClick={() => setListOpen(false)}><X size={14} /></button>
              </div>
              {/* One entry per person: first those with nowhere to stand, then those missing some events. */}
              <ul className="flex flex-col">
                {absent.map((a) => (
                  <li key={a.personId}>
                    <button type="button" className="w-full rounded px-1 py-1 text-left hover:bg-muted" onClick={() => focus(a.personId)}>
                      <span className="flex items-baseline justify-between gap-2"><strong className="font-medium text-ink">{a.name}</strong><span className="flex-none text-ink-faint">{t('не на карте')}</span></span>
                      {a.gaps.length ? a.gaps.map((m, i) => <Reason key={i} line={gapLine(m)} why={t(GAP_LABEL[m.gap])} />) : <span className="block pl-2 text-ink-soft">{t('событий не записано')}</span>}
                    </button>
                  </li>
                ))}
                {gapsByPerson.map(([id, list]) => (
                  <li key={id}>
                    <button type="button" className="w-full rounded px-1 py-1 text-left hover:bg-muted" onClick={() => focus(id)}>
                      <strong className="font-medium text-ink">{list[0].name}</strong>
                      {list.map((m, i) => <Reason key={i} line={gapLine(m)} why={t(GAP_LABEL[m.gap])} />)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  )
}

/** One missing event: what it is, then why it is not on the map, in the same calm ink. */
function Reason({ line, why }: { line: string; why: string }) {
  return <span className="block pl-2 text-ink-soft">{line} — <em className="not-italic text-ink">{why}</em></span>
}
