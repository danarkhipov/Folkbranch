import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** A control with its name above and, if needed, one line below saying what it does. */
export function Field({ label, hint, className, children }: { label: ReactNode; hint?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1 text-xs text-ink-soft', className)}>
      {label}
      {children}
      {hint && <span className="leading-snug">{hint}</span>}
    </label>
  )
}
