'use client'
import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Copy } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { api, useApp } from '@/lib/client'
import { layoutFamily, AVATAR_CY, CARD_H } from '@/lib/graph/layout'
import { parseFamilyText, parsedToGraph, planFamilyText, serializeFamilyText, type TextPlan } from '@/lib/textformat'
import { personName } from '@/lib/types'
import { Select } from '@/components/ui/select'
import { textareaClass } from '@/components/ui/textarea'

export function MiniGraph({ text }: { text: string }) {
  const { rootsBelow } = useApp()
  const layout = useMemo(() => {
    try {
      const g = parsedToGraph(parseFamilyText(text))
      return g.persons.length ? { g, l: layoutFamily(g, { rootsBelow }) } : null
    } catch {
      return null
    }
  }, [text, rootsBelow])
  if (!layout) return null
  const { g, l } = layout
  const b = l.bounds
  return (
    <svg viewBox={`${b.x - 10} ${b.y - 10} ${b.w + 20} ${b.h + 20}`} className="w-full h-full">
      {l.edges.map((e) => <path key={e.id} d={e.path} className={e.style === 'solid' ? 'line' : `line ${e.style}`} />)}
      {l.unions.map((u) => <path key={u.id} d={u.path} className="union" />)}
      {l.unions.map((u) => <circle key={u.id} cx={u.x} cy={u.y} r={4.5} className="dot" />)}
      {g.persons.map((p) => {
        const c = l.cards.get(p.id)
        if (!c) return null
        return (
          <g key={p.id}>
            <circle cx={c.x} cy={c.y + AVATAR_CY} r={26} fill="#e7dfcd" stroke="#fffdf8" strokeWidth={3} />
            <text x={c.x} y={c.y + CARD_H - 34} textAnchor="middle" className="font-serif" fontSize={14} fill="var(--ink)">{personName(p).slice(0, 22)}</text>
            <text x={c.x} y={c.y + CARD_H - 17} textAnchor="middle" fontSize={11} fill="var(--ink-soft)">{[p.birthDate, p.deathDate].filter(Boolean).join(' – ')}</text>
          </g>
        )
      })}
    </svg>
  )
}

/** What a text import will do, and the questions it needs answered first. */
export function PlanSummary({ plan, choices, onChoose }: { plan: TextPlan; choices: Record<string, string>; onChoose: (c: Record<string, string>) => void }) {
  const { t } = useApp()
  return (
    <>
      {plan.errors.map((e, i) => <p key={i} className="text-xs text-destructive">{t('Ошибка в строке')} {e.line}: {e.message}</p>)}
      {plan.ambiguous.map((a) => (
        <label key={a.ref} className="flex items-center gap-2 text-xs">
          <span className="text-rust">{t('Несколько совпадений')}: {a.name}</span>
          <Select look="small" className="flex-1" aria-label={a.name} value={choices[a.ref] ?? ''} placeholder="—" onChange={(v) => onChoose({ ...choices, [a.ref]: v })} options={[{ value: '', label: '—', disabled: true }, ...a.candidates.map((c) => ({ value: c.id, label: `${c.name} ${c.years}` })), { value: 'new', label: t('Новый человек') }]} />
        </label>
      ))}
      {!plan.ops.length && !plan.errors.length && !plan.ambiguous.length && <p className="text-xs text-ink-faint">{t('Изменений нет')}</p>}
      {plan.creates.length > 0 && <p className="text-xs"><b className="font-medium">{t('Добавится')} ({plan.creates.length}):</b> {plan.creates.slice(0, 12).join(', ')}{plan.creates.length > 12 ? '…' : ''}</p>}
      {plan.updates.length > 0 && <p className="text-xs"><b className="font-medium">{t('Изменится')} ({plan.updates.length}):</b> {plan.updates.slice(0, 12).join(', ')}{plan.updates.length > 12 ? '…' : ''}</p>}
      {plan.relations > 0 && <p className="text-xs"><b className="font-medium">{t('Связей')}:</b> +{plan.relations}</p>}
    </>
  )
}

/** The graph as editable text, with the result visible before anything is written. */
export function TextDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t, graph, familyName, canEdit } = useApp()
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (open) {
      setText(serializeFamilyText(graph, familyName))
      setChoices({})
      setError('')
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const plan = useMemo(() => planFamilyText(parseFamilyText(text), graph, choices), [text, graph, choices])
  const blocked = plan.errors.length > 0 || plan.ambiguous.length > 0 || !plan.ops.length
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(1200px,calc(100vw-32px))] sm:max-w-[min(1200px,calc(100vw-32px))] h-[calc(100vh-64px)] flex flex-col gap-3">
        <DialogTitle className="font-serif font-medium text-lg">{t('Текстовый вид графа')}</DialogTitle>
        <div className="grid md:grid-cols-2 gap-3 flex-1 min-h-0">
          <textarea value={text} readOnly={!canEdit} spellCheck={false} onChange={(e) => setText(e.target.value)} className={`${textareaClass} min-h-0 h-full resize-none`} />
          <div className="min-h-0 flex flex-col gap-2">
            <div className="flex-1 min-h-0 rounded-lg bg-paper border border-border overflow-hidden"><MiniGraph text={text} /></div>
            <div className="text-sm flex flex-col gap-1 max-h-[40%] overflow-auto">
              <PlanSummary plan={plan} choices={choices} onChoose={setChoices} />
            </div>
          </div>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="bar-btn" onClick={() => { navigator.clipboard.writeText(text); setCopied(true) }}>{copied ? <Check size={14} /> : <Copy size={14} />} {t(copied ? 'Скопировано' : 'Скопировать')}</button>
          {canEdit && <button className="bar-btn on disabled:opacity-40" disabled={blocked} onClick={async () => {
            setError('')
            try {
              await api('text/import', { json: { text, resolutions: choices } })
              await qc.invalidateQueries()
              onOpenChange(false)
            } catch (e) {
              setError(String((e as Error).message))
            }
          }}>{t('Применить')}</button>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
