'use client'
import { Filter } from 'lucide-react'
import { useApp } from '@/lib/client'

/** Says that a list covers only the part of the family on the chart, and brings the rest back. */
export function ScopeNote({ onAll }: { onAll?: () => void }) {
  const { t, viewInfo } = useApp()
  if (!viewInfo) return null
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-muted px-2.5 py-1.5 text-xs text-ink-soft" data-testid="scope-note">
      <Filter size={12} className="flex-none" />
      <span className="min-w-0 break-anywhere">{t('Только:')} {viewInfo.label}</span>
      <button className="pick underline hover:text-ink" onClick={onAll ?? viewInfo.reset}>{t('Показать всю семью')}</button>
    </p>
  )
}
