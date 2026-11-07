'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, Plus } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useApp } from '@/lib/client'
import { isUrl, splitText } from '@/lib/linkify'
import { cn } from '@/lib/utils'
import { type Certainty } from '@/lib/types'
import { Select } from '@/components/ui/select'

/** Text that wraps and grows with what is typed, so no value is ever cut off, in a line of its own or inside a sentence. */
export function GrowText({ value, fit, className, ...rest }: { value: string; fit?: boolean; className?: string } & Omit<React.ComponentProps<'textarea'>, 'value'>) {
  return (
    <span className={cn('grow-text', fit && 'fit')} data-value={value || rest.placeholder || ' '}>
      <textarea
        rows={1}
        value={value}
        className={cn('inline-input', className)}
        {...rest}
        // One line of meaning: pasted line breaks become spaces, and Enter finishes.
        onChange={(e) => { e.target.value = e.target.value.replace(/\s*\n\s*/g, ' '); rest.onChange?.(e) }}
      />
    </span>
  )
}

/** A value to read: long ones wrap, and an address can be pressed. */
export function ReadText({ value, className }: { value: string; className?: string }) {
  return (
    <span className={cn('break-anywhere whitespace-pre-wrap', className)}>
      {splitText(value).map((p, i) => (p.href ? <a key={i} href={p.href} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-ink">{p.text}</a> : p.text))}
    </span>
  )
}

/** Beside a field holding an address: open it without having to copy it. */
export function OpenAddress({ value }: { value: string }) {
  const { t } = useApp()
  if (!isUrl(value)) return null
  return <a href={value.trim()} target="_blank" rel="noreferrer noopener" aria-label={t('Открыть ссылку')} title={t('Открыть ссылку')} className="flex-none grid place-items-center size-6 [@media(pointer:coarse)]:size-10 text-ink-soft hover:text-ink"><ExternalLink size={13} /></a>
}

/** A button that opens a short list, for adding something: an action, not a field holding a value. */
export function AddMenu({ label, items, onPick }: { label: string; items: [string, string][]; onPick: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="add-btn self-start"><Plus size={14} /> {label}</button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 max-h-72 overflow-auto p-1 text-sm flex flex-col">
        {items.map(([value, text]) => <button key={value} type="button" className="text-left rounded px-2 min-h-8 hover:bg-muted" onClick={() => { setOpen(false); onPick(value) }}>{text}</button>)}
      </PopoverContent>
    </Popover>
  )
}

export function Field({ value, onSave, placeholder, className, readOnly, id, suggestions, fit }: { fit?: boolean; value: string; onSave: (v: string) => void; placeholder?: string; className?: string; readOnly?: boolean; id?: string; suggestions?: string[] }) {
  const [v, setV] = useState(value)
  const [focused, setFocused] = useState(false)
  const { t, notify } = useApp()
  const typingOver = useRef<string | null>(null)
  // A relative's edit arriving now must not wipe what is being typed; the comparison on save settles it.
  useEffect(() => { if (typingOver.current === null) setV(value) }, [value])
  if (readOnly) return value ? <ReadText value={value} className={className} /> : fit ? null : <span />
  const typed = v.trim().toLowerCase()
  const hints = focused && typed && suggestions ? suggestions.filter((s) => s.toLowerCase().includes(typed) && s.toLowerCase() !== typed).slice(0, 5) : []
  return (
    <span className={cn('relative min-w-0', fit ? 'inline-flex max-w-full' : 'block w-full')}>
      <GrowText
        id={id}
        fit={fit}
        className={className}
        value={v}
        aria-label={placeholder}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onFocus={() => { typingOver.current = value; setFocused(true) }}
        onBlur={() => {
          setFocused(false)
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
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
      />
      {hints.length > 0 && <Hints items={hints} onPick={(x) => { setV(x); (document.activeElement as HTMLElement | null)?.blur(); onSave(x) }} />}
    </span>
  )
}

/** What was typed before, under the field. The press must not take focus away, or the field would save half a word. */
export function Hints({ items, onPick }: { items: string[]; onPick: (value: string) => void }) {
  return (
    <span className="absolute left-0 top-full z-20 mt-0.5 flex max-w-full min-w-40 flex-col overflow-hidden rounded-lg border border-border bg-white text-sm shadow-sm">
      {items.map((h) => <button key={h} type="button" className="px-2.5 min-h-7 py-1 text-left break-anywhere hover:bg-muted" onMouseDown={(e) => { e.preventDefault(); onPick(h) }}>{h}</button>)}
    </span>
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
        className="h-7 w-40 max-w-full rounded-full border border-dashed border-ink-faint bg-transparent px-2.5 text-xs outline-none focus:border-ink focus:border-solid"
      />
      {hint.length > 0 && (
        <span className="absolute left-0 top-7 z-10 flex flex-col max-w-56 rounded-lg border border-border bg-white shadow-sm text-xs overflow-hidden">
          {hint.map((h) => <button key={h} type="button" className="px-2.5 py-1 text-left break-anywhere hover:bg-muted" onMouseDown={(e) => { e.preventDefault(); add(h) }}>{h}</button>)}
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
    <div className="flex items-baseline gap-1 min-w-0 w-full">
      {rest && (readOnly
        ? q && <span className="text-ink-soft flex-none">{t(QUALIFIERS.find(([k]) => k === q)![1])}</span>
        : <Select look="quiet" className="flex-none" aria-label={t('Точность даты')} value={q} onChange={(v) => onSave(v + rest)} options={QUALIFIERS.map(([k, label]) => ({ value: k, label: t(label) }))} />)}
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
