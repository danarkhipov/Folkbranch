'use client'
import { useState } from 'react'
import { useApp } from '@/lib/client'
import type { Layout } from '@/lib/graph/layout'

/** Moving a card sideways by its caption. A press becomes a move only after a few pixels, so a click still opens the card. */
export function useCardMove(layout: Layout, pins: Record<string, number>, zoom: () => number, pin: (id: string, x: number | null) => Promise<void>) {
  const app = useApp()
  const { t } = app
  const [moving, setMoving] = useState<{ id: string; dx: number } | null>(null)
  const startMove = (e: React.PointerEvent, id: string) => {
    if (!app.canEdit || e.button || e.pointerType === 'touch') return
    const from = e.clientX, fromY = e.clientY
    let active = false
    const move = (ev: PointerEvent) => {
      if (!active && Math.hypot(ev.clientX - from, ev.clientY - fromY) < 6) return
      active = true
      setMoving({ id, dx: (ev.clientX - from) / zoom() })
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      if (!active) return
      setMoving(null)
      // The click that follows this release must not open the card.
      const swallow = (c: Event) => { c.stopPropagation(); c.preventDefault() }
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 200)
      if (ev.type === 'pointercancel') return
      const card = layout.cards.get(id)
      if (!card) return
      const before = pins[id] ?? null
      pin(id, card.x + (ev.clientX - from) / zoom())
        .then(() => app.notify(t('Карточка сдвинута. Родство не изменилось'), [{ label: t('Отменить'), run: () => { void pin(id, before) } }]))
        .catch((err: Error) => app.notify(`${t('Не удалось сохранить')}: ${err.message}`))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  return { moving, startMove }
}
