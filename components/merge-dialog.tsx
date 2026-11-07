'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { api, useApp } from '@/lib/client'
import { lifeYears } from '@/lib/types'
import { Button } from '@/components/ui/button'

interface Side { id: string; name: string; updatedAt: number; parents: number; children: number; unions: number; pages: number; photos: number; stories: number }
interface Plan { blocked: string | null; warnings: string[]; fields: { field: string; keep: string; drop: string }[]; keep: Side; drop: Side }

const LABEL: Record<string, string> = { givenName: 'Имя', patronymic: 'Отчество', surname: 'Фамилия', maidenName: 'Девичья фамилия', birthDate: 'Рождение', birthPlace: 'Место рождения', deathDate: 'Смерть', deathPlace: 'Место смерти', sex: 'Пол' }
const SEX: Record<string, string> = { M: 'Мужской', F: 'Женский', U: 'Неизвестно' }

/** Side by side, with a choice only where the two cards disagree. Nothing changes until the button is pressed. */
export function MergeDialog({ a, b, onClose }: { a: string; b: string; onClose: () => void }) {
  const { t, byId, focus, notify } = useApp()
  const qc = useQueryClient()
  const [ids, setIds] = useState([a, b])
  const [choose, setChoose] = useState<Record<string, 'keep' | 'drop'>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { data: plan } = useQuery({ queryKey: ['merge', ids[0], ids[1]], queryFn: () => api<Plan>(`merge/preview?keep=${ids[0]}&drop=${ids[1]}`), gcTime: 0 })
  /** Two cards of one person usually carry one name, so the name alone says nothing. */
  const whose = (side: Side) => { const p = byId.get(side.id); return [side.name || t('Без названия'), p && lifeYears(p)].filter(Boolean).join(', ') }
  const shown = (field: string, v: string) => (field === 'sex' ? t(SEX[v] ?? v) : v)
  const differ = plan?.fields.filter((f) => f.field !== 'otherNames' && f.keep && f.drop && f.keep !== f.drop && !(f.field === 'sex' && (f.keep === 'U' || f.drop === 'U'))) ?? []
  const moved = plan ? [['Родители', plan.drop.parents], ['Дети', plan.drop.children], ['Супруги', plan.drop.unions], ['Страницы', plan.drop.pages], ['Фото', plan.drop.photos], ['Рассказы', plan.drop.stories]].filter(([, n]) => n) : []
  const go = async () => {
    if (!plan) return
    setBusy(true)
    setError('')
    try {
      const { keepId, historyId } = await api<{ keepId: string; historyId: string }>('merge', { json: { keepId: plan.keep.id, dropId: plan.drop.id, choose, seen: { keep: plan.keep.updatedAt, drop: plan.drop.updatedAt } } })
      await qc.invalidateQueries()
      focus(keepId, { center: true })
      notify(t('Карточки объединены'), [{ label: t('Отменить'), run: () => { api(`history/${historyId}/undo`, { json: {} }).then(() => qc.invalidateQueries()).catch((e) => notify(String(e.message))) } }])
      onClose()
    } catch (e) {
      setError(String((e as Error).message))
      setBusy(false)
      qc.invalidateQueries({ queryKey: ['merge'] })
    }
  }
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-xl max-h-[calc(100dvh-32px)] overflow-auto">
        <DialogTitle className="font-serif text-lg font-medium">{t('Объединить карточки')}</DialogTitle>
        {plan && (
          <div className="flex min-w-0 flex-col gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="break-anywhere min-w-0"><span className="text-ink-soft">{t('Останется')}:</span> <b className="font-medium">{whose(plan.keep)}</b></span>
              <button type="button" className="bar-btn border border-border !h-7 flex-none" onClick={() => { setIds([ids[1], ids[0]]); setChoose({}) }}><ArrowLeftRight size={13} /> {t('Поменять местами')}</button>
            </div>
            <p className="break-anywhere"><span className="text-ink-soft">{t('Будет убрана')}:</span> {whose(plan.drop)}</p>
            {plan.blocked && <p role="alert" className="rounded-lg bg-muted px-3 py-2 text-destructive">{t('Объединить нельзя')}: {plan.blocked}</p>}
            {!plan.blocked && differ.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-ink-soft">{t('Что считать основным? Другое значение не пропадёт, а останется как другая версия.')}</p>
                {differ.map((f) => (
                  <fieldset key={f.field} className="min-w-0">
                    <legend className="text-xs text-ink-soft">{t(LABEL[f.field] ?? f.field)}</legend>
                    <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
                      {(['keep', 'drop'] as const).map((side) => (
                        <label key={side} className="flex min-w-0 min-h-8 items-start gap-2 rounded-lg border border-border px-2 py-1.5 cursor-pointer has-[:checked]:border-ink">
                          <input type="radio" className="accent-[var(--ink)] mt-0.5 size-4 flex-none" name={f.field} checked={(choose[f.field] ?? 'keep') === side} onChange={() => setChoose({ ...choose, [f.field]: side })} />
                          <span className="break-anywhere min-w-0">{shown(f.field, f[side])}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
            )}
            {!plan.blocked && moved.length > 0 && <p className="text-ink-soft">{t('Перейдёт на оставшуюся карточку')}: {moved.map(([k, n]) => `${t(String(k)).toLowerCase()} ${n}`).join(', ')}.</p>}
            {plan.warnings.map((w) => <p key={w} className="text-destructive break-anywhere">{w}</p>)}
            {error && <p role="alert" className="text-destructive break-anywhere">{error}</p>}
            <p className="text-xs text-ink-soft">{t('Вернуть всё как было можно в разделе «История».')}</p>
            <div className="flex gap-2">
              <Button type="button" disabled={busy || !!plan.blocked} onClick={go}>{t('Объединить')}</Button>
              <button type="button" className="bar-btn border border-border" onClick={onClose}>{t('Отмена')}</button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
