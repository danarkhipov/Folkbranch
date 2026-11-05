'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Layout } from '@/lib/graph/layout'
import { api, lastChangeId, useApp } from '@/lib/client'

/** Selecting a line: click it, press Delete. A shared bar selects all siblings from it. */
export function useLineSelection(layout: Layout, onPick: () => void) {
  const app = useApp()
  const { t } = app
  const qc = useQueryClient()
  type Sel = { kind: 'edge' | 'union'; ids: string[]; ax: number; ay: number }
  const [sel, setSel] = useState<Sel | null>(null)
  const [hoverIds, setHoverIds] = useState<string[]>([])
  const selIds = useMemo(() => new Set(sel?.ids ?? []), [sel])
  const selEdges = sel?.kind === 'edge' ? layout.edges.filter((e) => selIds.has(e.id)) : []
  const selUnion = sel?.kind === 'union' ? layout.unions.find((u) => u.id === sel.ids[0]) : undefined
  const pick = (ev: React.MouseEvent, kind: 'edge' | 'union', ids: string[], ax: number, ay: number) => {
    if (!app.canEdit) return
    ev.stopPropagation()
    onPick()
    setHoverIds([])
    setSel({ kind, ids, ax, ay })
  }
  const removeSelected = async () => {
    if (!sel) return
    const linkIds = selEdges.flatMap((e) => e.links.map((l) => l.id))
    const unionId = selUnion?.id
    setSel(null)
    try {
      if (unionId) await api(`relations/union/${unionId}`, { method: 'DELETE' })
      else await api('relations/remove', { json: { ids: linkIds } })
    } catch (e) {
      return app.notify(`${t('Не удалось сохранить')}: ${(e as Error).message}`)
    }
    await qc.invalidateQueries({ queryKey: ['graph'] })
    qc.invalidateQueries({ queryKey: ['history'] })
    const id = await lastChangeId()
    app.notify(t('Связь удалена'), [{ label: t('Отменить'), run: async () => { await api(`history/${id}/undo`, { json: {} }); await qc.invalidateQueries() } }])
  }
  const patchSelected = async (patch: Record<string, string>) => {
    const calls: Promise<unknown>[] = selEdges.flatMap((e) => e.links.map((l) => api(`relations/parent/${l.id}`, { method: 'PATCH', json: patch })))
    if (selUnion) calls.push(api(`relations/union/${selUnion.id}`, { method: 'PATCH', json: patch }))
    await Promise.all(calls)
    await qc.invalidateQueries({ queryKey: ['graph'] })
  }
  const removeRef = useRef(removeSelected)
  removeRef.current = removeSelected
  useEffect(() => {
    if (!sel) return
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable=true]')) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        removeRef.current()
      }
      if (e.key === 'Escape') setSel(null)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [sel])

  return { sel, setSel, selIds, selEdges, selUnion, hoverIds, setHoverIds, pick, removeSelected, patchSelected }
}
