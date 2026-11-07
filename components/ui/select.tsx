'use client'
import type { ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Select as Primitive } from 'radix-ui'
import { cn } from '@/lib/utils'

export interface SelectOption { value: string; label: ReactNode; disabled?: boolean }

// The list cannot hold an empty value, and "nothing chosen" is a real choice in several places.
const EMPTY = '__empty'
const toList = (v: string) => (v === '' ? EMPTY : v)
const fromList = (v: string) => (v === EMPTY ? '' : v)

const LOOK = {
  field: 'h-9 w-full rounded-lg border border-input bg-white pl-3 pr-2.5 text-sm text-ink focus-visible:ring-2 focus-visible:ring-ring/40',
  small: 'h-7 w-full rounded-md border border-input bg-white pl-2 pr-1.5 text-xs text-ink focus-visible:ring-2 focus-visible:ring-ring/40',
  quiet: 'pick min-h-6 max-w-full flex-none rounded-md pl-1 pr-0.5 text-xs text-ink-soft hover:bg-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/40',
}

/** The one dropdown of the app: change it here and every list follows. */
export function Select({ value, onChange, options, look = 'field', placeholder, disabled, className, title, 'aria-label': ariaLabel }: {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  look?: keyof typeof LOOK
  placeholder?: string
  disabled?: boolean
  className?: string
  title?: string
  'aria-label'?: string
}) {
  return (
    <Primitive.Root value={toList(value)} onValueChange={(v) => onChange(fromList(v))} disabled={disabled}>
      <Primitive.Trigger title={title} aria-label={ariaLabel} className={cn('inline-flex min-w-0 items-center justify-between gap-1.5 text-left outline-none disabled:opacity-50 data-[placeholder]:text-ink-faint', LOOK[look], className)}>
        <span className="min-w-0 truncate"><Primitive.Value placeholder={placeholder} /></span>
        <Primitive.Icon className="flex-none text-ink-soft"><ChevronDown size={look === 'field' ? 15 : 12} /></Primitive.Icon>
      </Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content position="popper" sideOffset={4} collisionPadding={8} className="float z-[60] max-h-[min(320px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] max-w-[min(420px,calc(100vw-16px))] overflow-hidden !bg-[#fffdf8] text-sm text-ink">
          <Primitive.Viewport className="p-1">
            {options.map((o) => (
              <Primitive.Item key={o.value} value={toList(o.value)} disabled={o.disabled} className="relative flex min-h-8 cursor-pointer select-none items-center rounded-md py-1 pl-2 pr-7 outline-none data-[highlighted]:bg-muted data-[disabled]:cursor-default data-[disabled]:opacity-50">
                <Primitive.ItemText>{o.label}</Primitive.ItemText>
                <Primitive.ItemIndicator className="absolute right-2 text-ink-soft"><Check size={14} /></Primitive.ItemIndicator>
              </Primitive.Item>
            ))}
          </Primitive.Viewport>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  )
}
