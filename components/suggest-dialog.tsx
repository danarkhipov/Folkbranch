'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { api, useApp } from '@/lib/client'
import { personName, type Person } from '@/lib/types'
import type { Proposal } from '@/lib/ops/proposals'
import { inputClass } from '@/components/ui/input'
import { textareaClass } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'

const FIELDS: [keyof Person & string, string][] = [
  ['givenName', 'Имя'], ['patronymic', 'Отчество'], ['surname', 'Фамилия'], ['maidenName', 'Девичья фамилия'],
  ['birthDate', 'Дата рождения'], ['birthPlace', 'Место рождения'], ['deathDate', 'Дата смерти'], ['deathPlace', 'Место смерти'],
]
const STATUS: Record<string, string> = { pending: 'Ждёт проверки', applied: 'Принято', rejected: 'Отклонено' }

/** A reader's way to say what is wrong. The archive stays as it is until someone accepts. */
export function SuggestDialog({ person, onClose }: { person: Person; onClose: () => void }) {
  const { t, notify } = useApp()
  const qc = useQueryClient()
  const { data: mine = [] } = useQuery({ queryKey: ['proposals', 'mine'], queryFn: () => api<Proposal[]>('proposals/mine') })
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map(([k]) => [k, String(person[k] ?? '')])))
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = inputClass
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg max-h-[calc(100dvh-32px)] overflow-auto">
        <DialogTitle className="font-serif text-lg font-medium">{t('Предложить правку')}: {personName(person)}</DialogTitle>
        <form className="flex flex-col gap-3" onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError('')
          try {
            await api('proposals/suggest', { json: { personId: person.id, patch: values, text, note } })
            await qc.invalidateQueries({ queryKey: ['proposals', 'mine'] })
            notify(t('Предложение отправлено. Его посмотрит тот, кто ведёт архив.'))
            onClose()
          } catch (x) {
            setError(String((x as Error).message ?? x))
            setBusy(false)
          }
        }}>
          <p className="text-sm text-ink-soft">{t('Измените то, что неверно. В архиве ничего не поменяется, пока правку не примут.')}</p>
          <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
            {FIELDS.map(([k, label]) => (
              <label key={k} className="flex flex-col gap-1 text-xs text-ink-soft">{t(label)}
                <input className={input} maxLength={120} value={values[k]} onChange={(e) => setValues({ ...values, [k]: e.target.value })} />
              </label>
            ))}
          </div>
          <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Что ещё рассказать')}
            <textarea className={`${textareaClass} min-h-20`} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Откуда это известно')}
            <input className={input} maxLength={300} placeholder={t('Например, со слов тёти или из письма')} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button className="self-start" disabled={busy}>{t('Отправить')}</Button>
        </form>
        {mine.length > 0 && (
          <section className="text-sm">
            <h4 className="font-medium mb-1">{t('Ваши предложения')}</h4>
            {mine.slice(0, 5).flatMap((d) => d.ops.map((o, i) => (
              <div key={`${d.id}.${i}`} className="flex items-baseline gap-2 py-0.5">
                <span className="truncate flex-1">{o.text}</span>
                <span className="text-xs text-ink-soft whitespace-nowrap">{t(STATUS[d.status] ?? d.status)}</span>
              </div>
            )))}
          </section>
        )}
      </DialogContent>
    </Dialog>
  )
}
