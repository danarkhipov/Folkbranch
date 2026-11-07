import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export const inputClass = 'h-9 w-full min-w-0 rounded-lg border border-input bg-white px-3 text-sm text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50'

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(inputClass, className)} {...props} />
}
