// The Folkbranch mark: two family lines, hooked together. Its outlines are in lib/brand.ts.
import { FIRST, SECOND } from '@/lib/brand'

export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden="true">
      <path d={FIRST} fill="var(--ink)" />
      <path d={SECOND} fill="var(--accent)" />
    </svg>
  )
}
