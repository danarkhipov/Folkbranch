'use client'
// Candidates for a point on the map, for places that have none: from the GeoNames list shipped with the app, matched on
// the archive's own server. A point is set only when a person presses one, and the place's note says where it came from.
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, useApp } from '@/lib/client'
import type { Candidate } from '@/lib/place-guess'
import type { PointGuess } from '@/lib/ops/place-guesses'

export const usePointGuesses = (enabled: boolean) =>
  useQuery({ queryKey: ['place-guesses'], queryFn: () => api<{ snapshot: string | null; guesses: PointGuess[] }>('place-guesses'), enabled, staleTime: 60_000 })

/** The key a row of the places list finds its guess by: the record, or the place as written when it has none. */
export const guessKey = (placeId: string | null, text: string) => (placeId ? placeId : `text:${text.split(',')[0].trim().toLowerCase().replace(/ё/g, 'е')}`)

/** "Шклов — Могилёвская область, Беларусь, 15 тыс. жителей". */
function useDescribe() {
  const { t, lang } = useApp()
  const countries = (() => { try { return new Intl.DisplayNames([lang], { type: 'region' }) } catch { return null } })()
  return (c: Candidate) => {
    const ru = lang === 'ru'
    const name = ru ? c.ru || c.name : c.name
    const region = ru ? c.regionRu || c.region : c.region
    const pop = c.pop ? `${new Intl.NumberFormat(lang, { notation: 'compact' }).format(c.pop)} ${t('жителей')}` : ''
    const also = c.matched && c.matched !== name ? `${t('записано как')} «${c.matched}»` : ''
    // What should make a person look twice before pressing: said beside the candidate, not hidden in its rank.
    const doubt = [c.why.includes('other-region') && t('не в той области, что записана'), c.why.includes('out-of-years') && t('так назывался в другие годы'), c.why.includes('typo') && t('похожее написание')].filter(Boolean)
    return { name, rest: [region, countries?.of(c.cc) ?? c.cc, pop, also, ...doubt].filter(Boolean).join(', ') }
  }
}

function useApply() {
  const { t, notify } = useApp()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const apply = async (g: PointGuess, c: Candidate) => {
    setBusy(true)
    try {
      await api('place-guesses', { method: 'POST', json: { placeId: g.placeId, text: g.text, geonameId: c.id } })
      await Promise.all([qc.invalidateQueries({ queryKey: ['places'] }), qc.invalidateQueries({ queryKey: ['place-guesses'] })])
      qc.invalidateQueries({ queryKey: ['graph'] })
    } catch (e) {
      notify(`${t('Не сохранилось')}: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }
  return { apply, busy }
}

/** Under one place of the list: up to three candidates, each set with one press. */
export function PointCandidates({ guess }: { guess: PointGuess }) {
  const { t } = useApp()
  const describe = useDescribe()
  const { apply, busy } = useApply()
  if (!guess.candidates.length) return null
  return (
    <div className="flex flex-col gap-1 rounded-md bg-paper p-2 text-xs" aria-label={t('Где это может быть')}>
      <span className="text-ink-soft">{t('Точки нет. Возможно, это:')}</span>
      <ul className="flex flex-col gap-1">
        {guess.candidates.map((c) => {
          const d = describe(c)
          return (
            <li key={c.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{d.name}</span>
              <span className="text-ink-soft break-anywhere">{d.rest}</span>
              <button type="button" disabled={busy} className="ml-auto underline underline-offset-2 hover:text-ink disabled:opacity-50" onClick={() => apply(guess, c)}>{t('Поставить точку')}</button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Every place without a point, with its best guess, to confirm one by one; and the credit GeoNames asks for. */
export function PointGuessList({ data }: { data: { snapshot: string | null; guesses: PointGuess[] } }) {
  const { t } = useApp()
  const describe = useDescribe()
  const { apply, busy } = useApply()
  const [open, setOpen] = useState(false)
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const withGuess = data.guesses.filter((g) => g.candidates.length && !skipped.has(guessKey(g.placeId, g.text)))
  const none = data.guesses.filter((g) => !g.candidates.length).length
  if (!data.snapshot || !data.guesses.length) return null
  return (
    <section className="rounded-md border border-border p-2 text-sm" aria-label={t('Места без точки на карте')}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h4 className="font-medium">{t('Места без точки на карте')}: {data.guesses.length}</h4>
        {withGuess.length > 0 && <button type="button" className="text-xs underline underline-offset-2 hover:text-ink" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? t('Скрыть') : `${t('Проверить догадки')} (${withGuess.length})`}</button>}
      </div>
      <p className="text-xs text-ink-soft">{t('Догадки по списку городов и сёл, который хранится в самом приложении: названия мест никуда не отправляются. Точка ставится, только когда вы её подтвердите.')}</p>
      {open && (
        <ul className="mt-1 flex flex-col">
          {withGuess.map((g) => {
            const best = g.candidates[0]
            const d = describe(best)
            const k = guessKey(g.placeId, g.text)
            return (
              <li key={k} className="flex flex-wrap items-baseline gap-x-2 border-b border-border py-1.5 last:border-0">
                <span className="font-medium break-anywhere">{g.text}</span>
                <span className="text-ink-faint">→</span>
                <span className="break-anywhere">{d.name}<span className="text-xs text-ink-soft">, {d.rest}</span></span>
                {g.candidates.length > 1 && <span className="text-xs text-ink-faint">{t('и ещё вариантов')}: {g.candidates.length - 1}</span>}
                <span className="ml-auto flex gap-3 text-xs">
                  <button type="button" disabled={busy} className="underline underline-offset-2 hover:text-ink disabled:opacity-50" onClick={() => apply(g, best)}>{t('Подтвердить')}</button>
                  <button type="button" className="text-ink-soft hover:text-ink" onClick={() => setSkipped(new Set([...skipped, k]))}>{t('Пропустить')}</button>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {none > 0 && <p className="text-xs text-ink-faint">{t('Без догадки')}: {none}. {t('Их точку можно указать в сведениях о месте.')}</p>}
      <p className="text-xs text-ink-faint">{t('Список мест')}: <a className="underline" href="https://www.geonames.org" target="_blank" rel="noreferrer noopener">GeoNames</a>, CC BY 4.0, {data.snapshot}</p>
    </section>
  )
}
