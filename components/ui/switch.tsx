'use client'
import type { ReactNode } from 'react'
import { Switch as Primitive } from 'radix-ui'

/** An on-off setting that takes effect at once: its name, what it does, the switch on the right. */
export function SwitchRow({ title, description, checked, disabled, onChange }: { title: ReactNode; description?: ReactNode; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className={`flex min-w-0 items-start justify-between gap-4 py-1 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm text-ink">{title}</span>
        {description && <span className="text-xs leading-snug text-ink-soft">{description}</span>}
      </span>
      <Primitive.Root checked={checked} disabled={disabled} onCheckedChange={onChange} className="relative mt-0.5 h-5 w-9 flex-none rounded-full bg-input outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=checked]:bg-ink">
        <Primitive.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
      </Primitive.Root>
    </label>
  )
}
