'use client'
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, useApp } from '@/lib/client'
import { findPlace, onMap, placeChain, placeMatches, placeProblem } from '@/lib/places'
import { DATE_PROBLEM_TEXT, dateProblem } from '@/lib/date-checks'
import { yearOf, type Contacts, type Person } from '@/lib/types'
import { GrowText } from './person-fields'
import { usePlaces } from './places-tab'

/**
 * Under a place as written: what it belonged to and what it was also called, once someone has said so.
 * A place the archive does not know, or one with no point, is said out loud: without it the event never
 * reaches the map, and nobody would guess why from the empty field alone.
 */
export function PlaceHint({ text, placeId, onPick }: { text: string; placeId?: string | null; onPick?: (placeId: string) => void }) {
  const { t, canEdit, notify } = useApp()
  const qc = useQueryClient()
  const { data: places = [] } = usePlaces()
  const problem = placeProblem(text, places, placeId)
  if (problem === 'ambiguous') {
    // Two villages of one name: which one is the person's call, made here, once; the text stays as written.
    const choices = placeMatches(text, places)
    return (
      <span className="text-xs text-ink-soft break-anywhere">
        {t('несколько мест с таким названием, какое из них?')}
        {choices.map((p) => (
          <button key={p.id} type="button" disabled={!onPick} className="ml-1.5 underline underline-offset-2 hover:text-ink disabled:no-underline" onClick={() => onPick?.(p.id)}>
            {placeChain(p, places).map((x) => x.name).join(' → ')}
          </button>
        ))}
      </span>
    )
  }
  if (problem) {
    const add = async () => {
      try {
        await api('places', { method: 'POST', json: { name: text.split(',')[0].trim() } })
        await qc.invalidateQueries({ queryKey: ['places'] })
      } catch { notify(t('Не сохранилось. Написанное осталось на этом экране. Проверьте интернет и повторите.'), [], true) }
    }
    return (
      <span className="text-xs text-ink-soft break-anywhere">
        {t(problem === 'unknown' ? 'нет в списке мест' : 'у места нет координат')} · {t('событие не попадёт на карту')}
        {problem === 'unknown' && canEdit && onPick && <> · <button type="button" className="underline underline-offset-2 hover:text-ink" onClick={add}>{t('добавить место')}</button></>}
      </span>
    )
  }
  const place = findPlace(text, places, placeId)
  if (!onMap(place)) return null
  const up = placeChain(place, places).slice(1).map((p) => p.name)
  const also = place.otherNames.map((n) => n.name).filter((n) => n.toLowerCase() !== text.trim().toLowerCase())
  if (!up.length && !also.length) return null
  return (
    <span className="text-xs text-ink-soft break-anywhere">
      {up.join(' → ')}{up.length && also.length ? ' · ' : ''}{also.length ? `${t('также')} ${also.join(', ')}` : ''}
    </span>
  )
}

/**
 * Under a date: a year that cannot be right for this life, said at once, with the likely slip mended in one press
 * (2034 → 1934). A date that may be right is never changed for the person.
 */
export function DateHint({ date, field, person, what, onFix }: { date: string; field: 'birth' | 'death' | 'fact'; person: Person; what?: string; onFix?: (date: string) => void }) {
  const { t } = useApp()
  const life = { born: yearOf(person.birthDate) ?? person.birthYear ?? null, died: yearOf(person.deathDate) ?? person.deathYear ?? null, what }
  const problem = dateProblem(date, field, life)
  if (!problem) return null
  return (
    <span role="status" className="text-xs text-rust break-anywhere">
      {t(DATE_PROBLEM_TEXT[problem.kind])}
      {problem.fix && onFix && <> · <button type="button" className="underline underline-offset-2 hover:text-ink" onClick={() => onFix(problem.fix!)}>{t('исправить на')} {problem.fix}</button></>}
    </span>
  )
}

const FIELDS: [keyof Contacts, string, string][] = [['phone', 'Телефон', '+7 …'], ['email', 'Почта', 'name@example.org'], ['address', 'Адрес', 'город, улица, дом'], ['note', 'Заметка', 'например, звонить вечером']]

/** How to reach a living relative. Asked for only by editors, and kept away from everything that leaves the archive. */
export function ContactsBlock({ personId }: { personId: string }) {
  const { t, notify } = useApp()
  const qc = useQueryClient()
  const key = ['contacts', personId]
  const { data } = useQuery({ queryKey: key, queryFn: () => api<Contacts>(`persons/${personId}/contacts`) })
  const [c, setC] = useState<Contacts | null>(null)
  useEffect(() => { if (data) setC(data) }, [data])
  if (!c) return null
  const save = async () => {
    if (JSON.stringify(c) === JSON.stringify(data)) return
    try {
      qc.setQueryData(key, await api<Contacts>(`persons/${personId}/contacts`, { method: 'PUT', json: c }))
    } catch {
      notify(t('Не сохранилось. Написанное осталось на этом экране. Проверьте интернет и повторите.'), [], true)
    }
  }
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="text-base font-medium">{t('Как связаться')}</h4>
      <p className="text-xs text-ink-soft">{t('Видят только редакторы. В файлы, выгрузки и ответы ассистенту не попадает.')}</p>
      <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-2 gap-y-1 items-baseline">
        {FIELDS.map(([k, label, hint]) => (
          <label key={k} className="contents">
            <span className="text-xs text-ink-faint">{t(label)}</span>
            <GrowText value={c[k]} placeholder={t(hint)} aria-label={t(label)} className="text-ink" onChange={(e) => setC({ ...c, [k]: e.target.value })} onBlur={save} />
          </label>
        ))}
      </div>
    </section>
  )
}
