'use client'
import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { useApp } from '@/lib/client'
import { cn } from '@/lib/utils'
import { Button } from './button'

/** The clipboard exists only on https and localhost; a home network address gets the old way. */
async function write(text: string) {
  if (navigator.clipboard) return navigator.clipboard.writeText(text)
  const area = document.createElement('textarea')
  area.value = text
  area.style.position = 'fixed'
  document.body.append(area)
  area.select()
  document.execCommand('copy')
  area.remove()
}

export function CopyButton({ value, primary }: { value: string; primary?: boolean }) {
  const { t } = useApp()
  const [done, setDone] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <Button type="button" size="sm" variant={primary ? 'default' : 'outline'} onClick={async () => {
      await write(value)
      setDone(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setDone(false), 2000)
    }}>{done ? <Check /> : <Copy />}{t(done ? 'Скопировано' : 'Скопировать')}</Button>
  )
}

/** A value to take elsewhere: an address, a link, a command. Never cut short, since it gets copied whole. */
export function CopyField({ value, label, primary, multiline, className }: { value: string; label?: string; primary?: boolean; multiline?: boolean; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      {label && <span className="text-xs text-ink-soft">{label}</span>}
      <div className={cn('flex min-w-0 gap-2 rounded-lg bg-muted p-1.5 pl-3', multiline ? 'flex-col items-start pr-3 pb-2.5 pt-2.5' : 'items-center')}>
        <code className={cn('min-w-0 flex-1 text-xs break-all', multiline && 'w-full whitespace-pre-wrap')}>{value}</code>
        <CopyButton value={value} primary={primary} />
      </div>
    </div>
  )
}
