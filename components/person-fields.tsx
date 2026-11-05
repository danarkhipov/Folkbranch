'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@/lib/client'
import { cn } from '@/lib/utils'
import { type Certainty } from '@/lib/types'

export function Field({ value, onSave, placeholder, className, readOnly, id, list, fit }: { fit?: boolean; value: string; onSave: (v: string) => void; placeholder?: string; className?: string; readOnly?: boolean; id?: string; list?: string }) {
  const [v, setV] = useState(value)
  const { t, notify } = useApp()
  const typingOver = useRef<string | null>(null)
  // A relative's edit arriving now must not wipe what is being typed; the comparison on save settles it.
  useEffect(() => { if (typingOver.current === null) setV(value) }, [value])
  return (
    <input
      id={id}
      list={list}
      className={cn('inline-input', fit && 'inline-fit', className)}
      size={fit ? Math.max(v.length || (placeholder ?? '').length, 2) : undefined}
      value={v}
      aria-label={placeholder}
      placeholder={readOnly ? '' : placeholder}
      readOnly={readOnly}
      onChange={(e) => setV(e.target.value)}
      onFocus={() => { typingOver.current = value }}
      onBlur={() => {
        const started = typingOver.current
        typingOver.current = null
        if (v === value) return
        // Someone changed it while this was being typed: theirs stands, and what was typed is not lost from view.
        if (started !== null && started !== value) {
          notify(`${t('Это поле только что изменил другой человек. Показано новое значение, проверьте его.')} ${t('Ваш вариант')}: ${v}`)
          return setV(value)
        }
        onSave(v)
      }}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  )
}

export const CERTAINTY: Record<Certainty, string> = { documented: 'по документу', family: 'со слов семьи', assumed: 'предположение' }

/** Adds a label on Enter; suggests existing ones so the same group is reused, not retyped. */
export function TagInput({ existing, onAdd }: { existing: string[]; onAdd: (tag: string) => void }) {
  const { t, graph } = useApp()
  const [v, setV] = useState('')
  const known = useMemo(() => [...new Set(graph.persons.flatMap((p) => p.tags))].filter((x) => !existing.includes(x)), [graph, existing])
  const hint = known.filter((x) => v.trim() && x.toLowerCase().startsWith(v.trim().toLowerCase())).slice(0, 3)
  const add = (tag: string) => {
    const clean = tag.trim()
    if (clean && !existing.includes(clean)) onAdd(clean)
    setV('')
  }
  return (
    <span className="relative">
      <input
        value={v}
        placeholder={t('Название группы')}
        aria-label={t('Название группы')}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(hint[0] ?? v) } }}
        onBlur={() => v.trim() && add(v)}
        className="h-7 w-40 rounded-full border border-dashed border-ink-faint bg-transparent px-2.5 text-xs outline-none focus:border-ink focus:border-solid"
      />
      {hint.length > 0 && (
        <span className="absolute left-0 top-7 z-10 flex flex-col rounded-lg border border-border bg-white shadow-sm text-xs overflow-hidden">
          {hint.map((h) => <button key={h} type="button" className="px-2.5 py-1 text-left hover:bg-muted" onMouseDown={(e) => { e.preventDefault(); add(h) }}>{h}</button>)}
        </span>
      )}
    </span>
  )
}

const QUALIFIERS: [string, string][] = [['', 'точно'], ['~', 'около'], ['<', 'до'], ['>', 'после']]

/** A date with how sure it is: stored as the "~1890", "<1890", ">1890" that GEDCOM export understands. */
export function DateField({ value, onSave, readOnly, placeholder, id }: { value: string; onSave: (v: string) => void; readOnly: boolean; placeholder: string; id?: string }) {
  const { t } = useApp()
  const m = value.match(/^([~<>])\s*(.*)$/)
  const q = m?.[1] ?? ''
  const rest = m ? m[2] : value
  return (
    <div className="flex items-baseline gap-1 min-w-0">
      {rest && (readOnly
        ? q && <span className="text-ink-soft">{t(QUALIFIERS.find(([k]) => k === q)![1])}</span>
        : <select aria-label={t('Точность даты')} value={q} onChange={(e) => onSave(e.target.value + rest)} className="flex-none bg-transparent text-ink-soft text-xs rounded hover:bg-muted max-sm:min-h-9">{QUALIFIERS.map(([k, label]) => <option key={k} value={k}>{t(label)}</option>)}</select>)}
      <Field id={id} readOnly={readOnly} value={rest} placeholder={placeholder} onSave={(v) => onSave(v.trim() ? (/^[~<>]/.test(v) ? v : q + v) : '')} />
    </div>
  )
}

/** A row of choices shown at once: one click picks, nothing hides behind a drop-down. */
export function Segmented<T extends string>({ value, options, disabled, onChange, label, id }: { value: T; options: [T, string][]; disabled?: boolean; onChange: (v: T) => void; label: string; id?: string }) {
  // Someone who cannot change it needs the value, not a row of dead buttons.
  if (disabled) return <span>{options.find(([v]) => v === value)?.[1]}</span>
  return (
    <div id={id} tabIndex={id ? -1 : undefined} role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-lg bg-muted p-0.5 gap-0.5">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          disabled={disabled}
          onClick={() => onChange(v)}
          className={cn('h-7 px-2.5 rounded-md text-sm transition-colors disabled:cursor-default', value === v ? 'bg-white text-ink shadow-sm font-medium' : 'text-ink-soft hover:text-ink')}
        >
          {text}
        </button>
      ))}
    </div>
  )
}
