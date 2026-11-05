'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { hiddenByCollapse, descendantsOf, peopleInScope, subgraph, type Scope } from '@/lib/graph/select'
import type { Family } from '@/lib/kinship'
import type { ChartView } from '@/lib/ops/views'
import type { Graph } from '@/lib/types'
import { api } from '@/lib/client'

const MAIN = 'main'

/** Which part of the family is on the chart, and which cards stand where they were put by hand. */
export function useChartScope(graph: Graph | undefined, family: Family | undefined, focusId: string | null, onChanged: () => void) {
  const qc = useQueryClient()
  const { data: views = [] } = useQuery({ queryKey: ['views'], queryFn: () => api<ChartView[]>('views') })
  const [activeId, setActiveId] = useState<string>(MAIN)
  const [scope, setScope] = useState<Scope>('all')
  const [rootId, setRootId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<string[]>([])
  const active = views.find((v) => v.id === activeId)
  const pins = useMemo(() => active?.pins ?? {}, [active])
  const changed = useRef(onChanged)
  changed.current = onChanged

  const show = useCallback((next: { scope: Scope; rootId: string | null; collapsed?: string[]; viewId?: string }) => {
    setScope(next.scope)
    setRootId(next.rootId)
    setCollapsed(next.collapsed ?? [])
    setActiveId(next.viewId ?? MAIN)
    changed.current()
  }, [])

  const showAll = useCallback(() => show({ scope: 'all', rootId: null }), [show])

  const shown = useMemo(() => {
    if (!graph || !family) return graph
    const inScope = scope !== 'all' && rootId && family.parents.has(rootId) ? peopleInScope(family, scope, rootId) : null
    const gone = hiddenByCollapse(family, collapsed)
    if (!inScope && !gone.size) return graph
    return subgraph(graph, (id) => (!inScope || inScope.has(id)) && !gone.has(id))
  }, [graph, family, scope, rootId, collapsed])

  /** How many people each collapsed card hides, for the button that brings them back. */
  const folded = useMemo(() => new Map(family ? collapsed.map((id) => [id, descendantsOf(family, id).size] as const) : []), [family, collapsed])

  // Someone found by search, or a link to a card, must not lead to a card that is not on the chart.
  useEffect(() => {
    if (focusId && shown && graph?.persons.some((p) => p.id === focusId) && !shown.persons.some((p) => p.id === focusId)) showAll()
  }, [focusId]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))
    changed.current()
  }, [])

  const refresh = () => qc.invalidateQueries({ queryKey: ['views'] })

  /** Shown at once and saved behind the scenes, so the card does not jump back while the reply is on its way. */
  const pin = useCallback(async (personId: string, x: number | null) => {
    qc.setQueryData<ChartView[]>(['views'], (list = []) => {
      const rest = list.filter((v) => v.id !== activeId)
      const row = list.find((v) => v.id === activeId) ?? { id: MAIN, name: '', scope: 'all' as Scope, focusId: null, collapsed: [], pins: {}, updatedAt: 0 }
      const next = { ...row.pins }
      if (x === null) delete next[personId]
      else next[personId] = x
      return [...rest, { ...row, pins: next }]
    })
    await api(`views/${activeId}/pin`, { method: 'PUT', json: { personId, x } })
    refresh()
  }, [activeId]) // eslint-disable-line react-hooks/exhaustive-deps

  const clearPins = async () => {
    await api(`views/${activeId}/pins`, { method: 'DELETE' })
    await refresh()
  }
  const saveAs = async (name: string) => {
    const { id } = await api<{ id: string }>('views', { json: { name, scope, focusId: rootId, collapsed, pins } })
    await refresh()
    setActiveId(id)
  }
  const remove = async (id: string) => {
    await api(`views/${id}`, { method: 'DELETE' })
    await refresh()
    if (id === activeId) showAll()
  }
  const open = (v: ChartView) => show({ scope: v.scope, rootId: v.focusId, collapsed: v.collapsed, viewId: v.id })

  return { shown, pins, scope, rootId, collapsed, folded, views: views.filter((v) => v.id !== MAIN), activeId, show, showAll, open, toggleCollapse, pin, clearPins, saveAs, remove }
}

export type ChartScope = ReturnType<typeof useChartScope>
