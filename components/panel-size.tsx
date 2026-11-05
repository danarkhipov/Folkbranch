'use client'
import { useEffect, useRef, useState } from 'react'
import { useApp } from '@/lib/client'

/** A size the person dragged to, remembered in this browser. */
export function useStoredSize(key: string, initial: number, clamp: (n: number) => number) {
  const [size, setSize] = useState(initial)
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(key))
      if (saved) setSize(clamp(saved))
    } catch {}
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const change = (n: number) => {
    const next = clamp(n)
    setSize(next)
    try { localStorage.setItem(key, String(next)) } catch {}
  }
  return [size, change] as const
}

export const useAssistantWidth = () => useStoredSize('assistant-width', 420, (w) => Math.round(Math.max(340, Math.min(w, Math.min(900, window.innerWidth - 80)))))

/** The handle on a panel's edge: drag it, or use the arrow keys when it has focus. A double click goes back to `home`. */
export function PanelEdge({ width, onWidth, home = 420, edge = 'right', label = 'Ширина чата', className }: { width: number; onWidth: (w: number) => void; home?: number; edge?: 'right' | 'left' | 'top'; label?: string; className?: string }) {
  const { t } = useApp()
  const start = useRef<{ at: number; width: number } | null>(null)
  const place = (e: { clientX: number; clientY: number }) => (edge === 'top' ? e.clientY : e.clientX)
  const sign = edge === 'right' ? 1 : -1
  return (
    <div
      role="separator" aria-orientation={edge === 'top' ? 'horizontal' : 'vertical'} aria-label={t(label)} aria-valuenow={width} tabIndex={0}
      className={`panel-edge panel-edge-${edge} ${className ?? 'max-sm:hidden'}`}
      onPointerDown={(e) => { start.current = { at: place(e), width }; e.currentTarget.setPointerCapture(e.pointerId); document.body.style.userSelect = 'none' }}
      onPointerMove={(e) => { if (start.current) onWidth(start.current.width + sign * (place(e) - start.current.at)) }}
      onPointerUp={() => { start.current = null; document.body.style.userSelect = '' }}
      onDoubleClick={() => onWidth(home)}
      onKeyDown={(e) => {
        const grow = edge === 'top' ? 'ArrowUp' : edge === 'left' ? 'ArrowLeft' : 'ArrowRight'
        const shrink = edge === 'top' ? 'ArrowDown' : edge === 'left' ? 'ArrowRight' : 'ArrowLeft'
        if (e.key === grow) onWidth(width + 24)
        if (e.key === shrink) onWidth(width - 24)
      }}
    />
  )
}
