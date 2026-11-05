'use client'
import { useMemo, useRef, useState } from 'react'
import type { Layout } from '@/lib/graph/layout'
import { useApp } from '@/lib/client'
import { nearFamily } from '@/lib/graph/select'
import { pairKey, type LightMode } from './graph-parts'

/** Who and which lines stand out: the open card's family, a path, a group, or whatever the cursor is on. */
export function useChartLight(layout: Layout, pathIds: string[] | null, groupIds: Set<string> | null, isFar: () => boolean) {
  const { family, focusId, me, lang, byId } = useApp()
  const kin = useMemo(() => (focusId ? family.relatives(focusId, lang) : null), [focusId, family, lang])
  // Hovering lights the closest family and names each relative, without any click.
  const [hoverId, setHoverId] = useState<string | null>(null)
  // A short wait, so the chart does not flash while the cursor crosses it.
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const hoverSoon = (id: string | null) => {
    if (id && isFar()) return
    clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => setHoverId(id), id ? 180 : 60)
  }
  const hoverKin = useMemo(() => {
    if (!hoverId || focusId || pathIds || !byId.has(hoverId)) return null
    const near = nearFamily(family, hoverId)
    return new Map(near.flatMap((id) => {
      const k = family.relation(hoverId, id, lang)
      return k ? [[id, k.label] as const] : []
    }))
  }, [hoverId, focusId, pathIds, family, lang, byId])
  const [hoverFamily, setHoverFamily] = useState<string | null>(null)
  const familyActive = useMemo(() => {
    if (!hoverFamily || focusId || pathIds) return null
    const edge = layout.edges.filter((e) => e.familyKey === hoverFamily)
    return new Set(edge.flatMap((e) => [e.childId, ...e.parentIds]))
  }, [hoverFamily, focusId, pathIds, layout])
  const hotPairs = useMemo(() => {
    const out = new Set<string>()
    const add = (path: string[]) => path.forEach((id, i) => i && out.add(pairKey(id, path[i - 1])))
    if (pathIds) add(pathIds)
    else if (kin) kin.forEach((k) => add(k.path))
    else if (hoverKin) hoverKin.forEach((_, id) => out.add(pairKey(hoverId!, id)))
    else if (familyActive) layout.edges.filter((e) => e.familyKey === hoverFamily).forEach((e) => e.parentIds.forEach((p) => out.add(pairKey(p, e.childId))))
    return out
  }, [kin, pathIds, hoverKin, hoverId, familyActive, hoverFamily, layout])
  const lightMode: LightMode = pathIds || kin ? 'pairs' : hoverKin || familyActive || groupIds ? 'both-ends' : 'none'
  const active = useMemo(() => (pathIds ? new Set(pathIds) : kin ? new Set([focusId!, ...kin.keys()]) : hoverKin ? new Set([hoverId!, ...hoverKin.keys()]) : familyActive ?? groupIds), [pathIds, kin, focusId, hoverKin, hoverId, familyActive, groupIds])
  /** With several marriages, say which one a child comes from. */
  const childNote = (parent: string, child: string) => {
    if ((family.spouses.get(parent) ?? []).length < 2) return ''
    const other = (family.parents.get(child) ?? []).find((p) => p !== parent)
    const name = other && byId.get(other)?.givenName
    return name ? (lang === 'en' ? ` · by ${name}` : ` · от: ${name}`) : ''
  }
  const fromMe = useMemo(() => (me.personId && byId.has(me.personId) && !focusId && !pathIds ? family.relatives(me.personId, lang) : null), [me.personId, focusId, pathIds, family, lang, byId])

  return { kin, near: hoverKin, fromMe, active, hotPairs, lightMode, childNote, hoverSoon, setHoverId, setHoverFamily }
}
