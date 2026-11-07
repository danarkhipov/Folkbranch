import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** One block of a settings screen: what it is, then what can be done. */
export function Section({ title, description, danger, children }: { title: ReactNode; description?: ReactNode; danger?: boolean; children?: ReactNode }) {
  return (
    <section className={cn('flex min-w-0 flex-col gap-2.5', danger && 'rounded-lg border border-destructive/30 p-3')}>
      <div className="flex flex-col gap-0.5">
        <h3 className={cn('text-base font-medium', danger && 'text-destructive')}>{title}</h3>
        {description && <p className="text-xs leading-snug text-ink-soft">{description}</p>}
      </div>
      {children}
    </section>
  )
}

/** A line of a list: the name is never squeezed by what stands beside it. */
export function ListRow({ title, meta, actions, dim }: { title: ReactNode; meta?: ReactNode; actions?: ReactNode; dim?: boolean }) {
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2', dim && 'opacity-60')}>
      <div className="min-w-40 flex-1 basis-40">
        <div className="text-sm break-anywhere">{title}</div>
        {meta && <div className="text-xs leading-snug text-ink-soft break-anywhere">{meta}</div>}
      </div>
      {actions && <div className="flex flex-none flex-wrap items-center gap-1.5">{actions}</div>}
    </div>
  )
}

export function List({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 flex-col divide-y divide-border">{children}</div>
}
