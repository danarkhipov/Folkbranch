'use client'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { select } from 'd3-selection'
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { AVATAR_CY, layoutFamily, CARD_H, CARD_W } from '@/lib/graph/layout'
import { api, avatarUrl, useApp, type QuickType } from '@/lib/client'
import { yourTerm } from '@/lib/kinship'
import { cn } from '@/lib/utils'
import { lifeYears, personName, type HistoryEntry, type Person } from '@/lib/types'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

export interface CanvasHandle {
  fit: () => void
  zoomBy: (k: number) => void
  center: (id: string) => void
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

export const GraphCanvas = forwardRef<CanvasHandle, { pathIds: string[] | null; groupIds: Set<string> | null; panelOpen: boolean; onDelete: (id: string) => void; onRemoveRelation: (type: 'parent' | 'union', id: string) => void }>(
  function GraphCanvas({ pathIds, groupIds, panelOpen, onDelete, onRemoveRelation }, ref) {
    const app = useApp()
    const { graph, family, focusId, me, lang, t, byId } = app
    const layout = useMemo(() => layoutFamily(graph, { rootsBelow: app.rootsBelow }), [graph, app.rootsBelow])
    const canvas = useRef<HTMLDivElement>(null)
    const world = useRef<HTMLDivElement>(null)
    const zoomRef = useRef<ZoomBehavior<HTMLDivElement, unknown>>(null)
    /** Set once the person has panned or zoomed; from then on the view is theirs. */
    const moved = useRef(false)
    const [clipped, setClipped] = useState(false)
    const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)

    const apply = (x: number, y: number, k: number) => {
      world.current!.style.transform = `translate(${x}px,${y}px) scale(${k})`
      const s = canvas.current!.style
      s.setProperty('--tx', `${x}px`)
      s.setProperty('--ty', `${y}px`)
      s.setProperty('--k', String(k))
    }

    useEffect(() => {
      const z = d3zoom<HTMLDivElement, unknown>()
        .scaleExtent([0.12, 2.4])
        .clickDistance(4)
        .filter((e) => e.type === 'wheel' || (!e.button && !e.target.closest?.('.tools, .link-start, .linkbar')))
        .on('zoom', (e) => {
          if (e.sourceEvent) {
            world.current?.classList.remove('animate')
            moved.current = true
            setClipped(false)
          }
          apply(e.transform.x, e.transform.y, e.transform.k)
        })
      zoomRef.current = z
      select(canvas.current!).call(z).on('dblclick.zoom', null)
      return () => { select(canvas.current!).on('.zoom', null) }
    }, [])

    const go = (x: number, y: number, k: number, animate = true) => {
      world.current!.classList.toggle('animate', animate)
      select(canvas.current!).call(zoomRef.current!.transform, zoomIdentity.translate(x, y).scale(k))
    }

    const viewport = () => {
      const el = canvas.current!
      if (!panelOpen) return { w: el.clientWidth, h: el.clientHeight }
      // The editor is a sheet at the bottom on narrow windows, and a side panel on wide ones.
      return window.innerWidth <= 1200 ? { w: el.clientWidth, h: el.clientHeight * 0.38 } : { w: el.clientWidth - 492, h: el.clientHeight }
    }

    const fit = (animate = true) => {
      const b = layout.bounds
      if (!b.w) return go(viewport().w / 2, 160, 1, false)
      const { w, h } = viewport()
      const fitK = Math.min((w - 120) / b.w, (h - 170) / b.h, 1.1)
      // Below half size the names stop being readable: keep 50% and let the chart scroll under the hand.
      const fits = fitK >= 0.5
      setClipped(!fits)
      const k = fits ? fitK : 0.5
      if (fits) go((w - b.w * k) / 2 - b.x * k, (h - b.h * k) / 2 - b.y * k + 20, k, animate)
      else go(60 - b.x * k, 80 - b.y * k, k, animate)
    }

    /** Moves the canvas only if the person is out of sight, so cards don't run away from the cursor. */
    const center = (id: string) => {
      const c = layout.cards.get(id)
      if (!c) return
      const { w, h } = viewport()
      const k = Number(canvas.current!.style.getPropertyValue('--k')) || 1
      const tx = parseFloat(canvas.current!.style.getPropertyValue('--tx')) || 0
      const ty = parseFloat(canvas.current!.style.getPropertyValue('--ty')) || 0
      const sx = tx + c.x * k, sy = ty + (c.y + CARD_H / 2) * k
      const m = 90 * k
      if (sx > m && sx < w - m && sy > 70 + m && sy < h - m) return
      const zoom = Math.max(k, 0.6)
      go(w / 2 - c.x * zoom, h / 2 - (c.y + CARD_H / 2) * zoom, zoom)
    }

    useImperativeHandle(ref, () => ({
      fit: () => {
        moved.current = false
        fit()
      },
      center,
      zoomBy: (f) => {
        moved.current = true
        world.current!.classList.add('animate')
        select(canvas.current!).call(zoomRef.current!.scaleBy, f)
      },
    }))

    const fitted = useRef(false)
    useEffect(() => {
      if (!fitted.current && layout.cards.size) {
        fitted.current = true
        fit(false)
      }
    }, [layout]) // eslint-disable-line react-hooks/exhaustive-deps

    // Only a change of the window's size refits, and only until someone pans or zooms. Editing the
    // chart never moves the view.
    const fitNow = useRef(fit)
    fitNow.current = fit
    useEffect(() => {
      const ro = new ResizeObserver(() => { if (!moved.current) fitNow.current(false) })
      ro.observe(canvas.current!)
      return () => ro.disconnect()
    }, [])

    const kin = useMemo(() => (focusId ? family.relatives(focusId, lang) : null), [focusId, family, lang])
    // Hovering lights the closest family and names each relative, without any click.
    const [hoverId, setHoverId] = useState<string | null>(null)
    // A short wait, so the chart does not flash while the cursor crosses it.
    const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
    const hoverSoon = (id: string | null) => {
      clearTimeout(hoverTimer.current)
      hoverTimer.current = setTimeout(() => setHoverId(id), id ? 180 : 60)
    }
    const hoverKin = useMemo(() => {
      if (!hoverId || focusId || pathIds || !byId.has(hoverId)) return null
      const parents = family.parents.get(hoverId) ?? []
      const siblings = parents.flatMap((p) => family.children.get(p) ?? []).filter((c) => c !== hoverId)
      const grand = parents.flatMap((p) => family.parents.get(p) ?? [])
      const near = [...new Set([...parents, ...(family.spouses.get(hoverId) ?? []), ...(family.children.get(hoverId) ?? []), ...siblings, ...grand])]
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
    /** A line is lit when both ends are in the highlighted set; a path is lit pair by pair. */
    const hotEdge = (e: { childId: string; parentIds: string[] }) =>
      pathIds || kin ? e.parentIds.some((p) => hotPairs.has(pairKey(p, e.childId)))
        : !!(hoverKin || familyActive || groupIds) && !!active && active.has(e.childId) && e.parentIds.some((p) => active.has(p))
    const active = pathIds ? new Set(pathIds) : kin ? new Set([focusId!, ...kin.keys()]) : hoverKin ? new Set([hoverId!, ...hoverKin.keys()]) : familyActive ?? groupIds
    /** With several marriages, say which one a child comes from. */
    const childNote = (parent: string, child: string) => {
      if ((family.spouses.get(parent) ?? []).length < 2) return ''
      const other = (family.parents.get(child) ?? []).find((p) => p !== parent)
      const name = other && byId.get(other)?.givenName
      return name ? (lang === 'en' ? ` · by ${name}` : ` · от: ${name}`) : ''
    }
    const fromMe = useMemo(() => (me.personId && byId.has(me.personId) && !focusId && !pathIds ? family.relatives(me.personId, lang) : null), [me.personId, focusId, pathIds, family, lang, byId])

    const families = useMemo(() => {
      const out = new Map<string, typeof layout.edges>()
      for (const e of layout.edges) out.set(e.familyKey, [...(out.get(e.familyKey) ?? []), e])
      return [...out]
    }, [layout])

    const qc = useQueryClient()
    const rowOf = (id: string) => layout.cards.get(id)?.y ?? 0
    const nameOf = (id: string) => personName(byId.get(id)!) || t('Скрыто')

    // ---- Drawing a link: drag from an avatar, a plus or a family dot.
    type Source = { person: string } | { parents: [string, string] }
    const [draft, setDraft] = useState<{ x1: number; y1: number; x2: number; y2: number; target: string | null; label: string; cx: number; cy: number } | null>(null)

    /** What the target becomes for the source, judged by where it stands on the chart. */
    const relationFor = (source: Source, target: string): { type: QuickType; to: string; other: string; otherParentId: string | null; label: string } | null => {
      const sex = byId.get(target)?.sex
      const childType: QuickType = sex === 'F' ? 'daughter' : 'son'
      const childLabel = sex === 'F' ? 'дочь' : sex === 'M' ? 'сын' : 'ребёнок'
      if ('parents' in source) {
        if (source.parents.includes(target) || (family.parents.get(target) ?? []).length) return null
        return { type: childType, to: source.parents[0], other: target, otherParentId: source.parents[1], label: childLabel }
      }
      const s = source.person
      if (s === target) return null
      const related = (family.parents.get(s) ?? []).includes(target) || (family.parents.get(target) ?? []).includes(s) || (family.spouses.get(s) ?? []).includes(target)
      if (related) return null
      // Positive means the target stands on a younger row.
      const dy = (rowOf(target) - rowOf(s)) * (app.rootsBelow ? -1 : 1)
      if (dy < 0) return { type: sex === 'F' ? 'mother' : 'father', to: s, other: target, otherParentId: null, label: sex === 'F' ? 'мать' : sex === 'M' ? 'отец' : 'родитель' }
      if (dy > 0) {
        // A child with no parents yet belongs to the couple, if there is exactly one.
        const spouses = family.spouses.get(s) ?? []
        const other = spouses.length === 1 && !(family.parents.get(target) ?? []).length ? spouses[0] : null
        return { type: childType, to: s, other: target, otherParentId: other, label: childLabel }
      }
      return { type: 'spouse', to: s, other: target, otherParentId: null, label: 'супруг' }
    }

    const lastHistory = async () => (await api<HistoryEntry[]>('history?limit=1'))[0]?.id

    /** Runs a link change and offers to take it back; `extra` are other ways to read the same drag. */
    const linkAndTell = async (rel: { type: string; to: string; other: string; otherParentId?: string | null }, text: string, extra: { label: string; rel: typeof rel; text: string }[]) => {
      try {
        await api('relations', { json: rel })
      } catch (e) {
        app.notify(`${t('Не удалось сохранить')}: ${(e as Error).message}`)
        return
      }
      await qc.invalidateQueries({ queryKey: ['graph'] })
      qc.invalidateQueries({ queryKey: ['history'] })
      const id = await lastHistory()
      const back = async () => {
        await api(`history/${id}/undo`, { json: {} })
        await qc.invalidateQueries()
      }
      app.notify(text, [
        ...extra.map((x) => ({ label: x.label, run: async () => { await back(); linkAndTell(x.rel, x.text, extra.filter((y) => y !== x)) } })),
        { label: t('Отменить'), run: back },
      ])
    }

    const finishLink = (source: Source, target: string) => {
      const rel = relationFor(source, target)
      if (!rel) return app.notify(t('Эти люди уже связаны'))
      const a = 'person' in source ? source.person : source.parents[0]
      const sex = byId.get(target)?.sex
      const say = (label: string) => `${nameOf(target)} — ${t(label)}: ${'person' in source ? nameOf(a) : `${nameOf(source.parents[0])}, ${nameOf(source.parents[1])}`}`
      const others: { label: string; rel: { type: string; to: string; other: string; otherParentId?: string | null }; text: string }[] = 'person' in source ? [
        { label: t('Родитель'), rel: { type: sex === 'F' ? 'mother' : 'father', to: a, other: target }, text: say(sex === 'F' ? 'мать' : sex === 'M' ? 'отец' : 'родитель') },
        { label: t('Ребёнок'), rel: { type: sex === 'F' ? 'daughter' : 'son', to: a, other: target }, text: say(sex === 'F' ? 'дочь' : sex === 'M' ? 'сын' : 'ребёнок') },
        { label: t('Супруг'), rel: { type: 'spouse', to: a, other: target }, text: say('супруг') },
      ].filter((x) => x.rel.type !== rel.type) : []
      linkAndTell(rel, say(rel.label), others)
    }

    /** A press becomes a drag only after a few pixels, so plain clicks keep working. */
    const startLink = (e: React.PointerEvent, source: Source, fromX: number, fromY: number, onEmpty: (dir: 'up' | 'down' | 'side') => void) => {
      if (!app.canEdit || e.button) return
      const startX = e.clientX, startY = e.clientY
      let active = false
      const world = (cx: number, cy: number) => {
        const el = canvas.current!, r = el.getBoundingClientRect()
        const k = Number(el.style.getPropertyValue('--k')) || 1
        return { x: (cx - r.left - (parseFloat(el.style.getPropertyValue('--tx')) || 0)) / k, y: (cy - r.top - (parseFloat(el.style.getPropertyValue('--ty')) || 0)) / k }
      }
      const targetAt = (cx: number, cy: number) => {
        const hit = document.elementsFromPoint(cx, cy).find((el) => el.closest('[data-person]'))
        const id = hit?.closest<HTMLElement>('[data-person]')?.dataset.person
        return id && !byId.get(id)?.hidden ? id : null
      }
      const move = (ev: PointerEvent) => {
        if (!active && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return
        active = true
        setHoverId(null)
        const p = world(ev.clientX, ev.clientY)
        const target = targetAt(ev.clientX, ev.clientY)
        const sameAsSource = target && 'person' in source && target === source.person
        const rel = target && !sameAsSource ? relationFor(source, target) : null
        setDraft({
          x1: fromX, y1: fromY, x2: p.x, y2: p.y, target: sameAsSource ? null : target, cx: ev.clientX, cy: ev.clientY,
          label: target && !sameAsSource ? (rel ? t(rel.label) : t('Эти люди уже связаны')) : t('Отпустите, чтобы добавить нового'),
        })
      }
      const up = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        if (!active) return
        setDraft(null)
        // The click that follows this release must not open the panel or a window.
        const swallow = (c: Event) => { c.stopPropagation(); c.preventDefault() }
        window.addEventListener('click', swallow, { capture: true, once: true })
        setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 200)
        if (ev.type === 'pointercancel') return
        const target = targetAt(ev.clientX, ev.clientY)
        if (target && !('person' in source && target === source.person)) finishLink(source, target)
        else if (!target) {
          const dx = ev.clientX - startX, dy = ev.clientY - startY
          onEmpty(Math.abs(dy) > Math.abs(dx) ? (dy < 0 ? 'up' : 'down') : 'side')
        }
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    }
    const startFromPerson = (e: React.PointerEvent, id: string) => {
      const c = layout.cards.get(id)
      if (!c) return
      startLink(e, { person: id }, c.x, c.y + AVATAR_CY, (dir) => {
        const type = dir === 'side' ? 'spouse' : (dir === 'up') === app.rootsBelow ? 'child' : 'parent'
        if (type === 'parent' && (family.parents.get(id) ?? []).length >= 2) return app.notify(t('У этого человека уже двое родителей'))
        app.quickAdd(type, id)
      })
    }

    // ---- Selecting a line: click it, press Delete. A shared bar selects all siblings from it.
    type Sel = { kind: 'edge' | 'union'; ids: string[]; ax: number; ay: number }
    const [sel, setSel] = useState<Sel | null>(null)
    const [hoverIds, setHoverIds] = useState<string[]>([])
    const selIds = new Set(sel?.ids ?? [])
    const selEdges = sel?.kind === 'edge' ? layout.edges.filter((e) => selIds.has(e.id)) : []
    const selUnion = sel?.kind === 'union' ? layout.unions.find((u) => u.id === sel.ids[0]) : undefined
    /** One edge per bar, for hit areas: siblings share the same shared stretch. */
    const groupHeads = useMemo(() => [...new Map(layout.edges.map((e) => [e.group, e] as const)).values()], [layout])
    const pick = (ev: React.MouseEvent, kind: 'edge' | 'union', ids: string[], ax: number, ay: number) => {
      if (!app.canEdit) return
      ev.stopPropagation()
      setTip(null)
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
      const id = await lastHistory()
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

    const edgeText = (parentIds: string[], childId: string) => {
      const child = byId.get(childId)
      const first = family.relation(childId, parentIds[0], lang)?.label
      const second = parentIds[1] ? family.relation(childId, parentIds[1], lang)?.label : null
      const down = family.relation(parentIds[0], childId, lang)?.label
      return `${[first, second].filter(Boolean).join(', ')} → ${down ?? ''}${child ? ` · ${personName(child) || t('Скрыто')}` : ''}`
    }

    const tipAt = (e: React.MouseEvent, text: string) => setTip({ x: e.clientX, y: e.clientY, text })

    return (
      <div ref={canvas} className="canvas" onClick={(e) => { if (e.target === canvas.current || e.target === world.current) { app.focus(null); setSel(null) } }}>
        <div ref={world} className={cn('world', active && 'focused')}>
          <svg className="links" width="1" height="1">
            {/* Each family is drawn over a paper-coloured halo, so crossings read as one line passing over another. */}
            {families.map(([key, edges]) => (
              <g key={key}>
                <path d={edges.map((e) => e.path).join('')} className="line-halo" />
                {edges.map((e) => {
                  const hot = hotEdge(e)
                  return <path key={e.id} d={e.path} className={cn('line', e.style !== 'solid' && e.style, hot && 'hot', selIds.has(e.id) && 'selected', hoverIds.includes(e.id) && 'hover')} />
                })}
              </g>
            ))}
            {layout.unions.map((u) => {
              const hot = hotPairs.has(pairKey(u.union.aId, u.union.bId)) || (!!active && active.has(u.union.aId) && active.has(u.union.bId))
              return <path key={u.id} d={u.path} className={cn('union', u.union.certainty === 'assumed' && 'assumed', hot && 'hot', selIds.has(u.id) && 'selected', hoverIds.includes(u.id) && 'hover')} />
            })}
          </svg>
          {graph.persons.map((p) => {
            const c = layout.cards.get(p.id)
            if (!c) return null
            const k = kin?.get(p.id)
            const isActive = active?.has(p.id)
            const mine = fromMe?.get(p.id)
            const near = hoverKin?.get(p.id)
            const label = k && !pathIds ? k.label + (focusId && family.children.get(focusId)?.includes(p.id) ? childNote(focusId, p.id) : '') : near
            const open = () => app.focus(p.id)
            return (
              <div
                key={p.id}
                data-person={p.id}
                role="button"
                tabIndex={0}
                aria-label={p.hidden ? t('Живой родственник') : `${personName(p)} ${lifeYears(p)}`}
                className={cn('pcard', `sex-${p.sex}`, !p.living && 'dead', p.certainty === 'assumed' && 'assumed', p.hidden && 'hidden-p', p.id === focusId && 'focus', p.id === me.personId && 'isme', active && !isActive && 'dim', draft?.target === p.id && 'drop-target')}
                style={{ left: c.x - CARD_W / 2, top: c.y }}
                onClick={open}
                onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) open() }}
                onMouseEnter={() => hoverSoon(p.id)}
                onMouseLeave={() => hoverSoon(null)}
              >
                <div className={cn('ava', app.canEdit && !p.hidden && 'link-start')} onPointerDown={app.canEdit && !p.hidden ? (e) => startFromPerson(e, p.id) : undefined}><img src={avatarUrl(p)} alt="" draggable={false} /></div>
                {/* Opaque, so a line coming from below stops at the text however tall it wraps. */}
                <div className="cap">
                  <div className="nm">{p.hidden ? t('Живой родственник') : personName(p) || t('Без названия')}</div>
                  {!p.hidden && <div className="yr">{lifeYears(p)}</div>}
                  {label && <div className="rel kin">{label}</div>}
                  {!label && mine && <div className="rel me">{yourTerm(mine.label, p.sex, lang)}</div>}
                </div>
                {app.canEdit && !p.hidden && <CardTools person={p} onDrag={startFromPerson} />}
              </div>
            )
          })}
          {/* Above the cards, or a card's box would take the click meant for a line passing through it. */}
          <svg className="hits" width="1" height="1">
            {/* Wide invisible strokes on top make thin lines easy to hover. */}
            {groupHeads.map((e) => (
              <path
                key={`g${e.group}`}
                d={e.shared}
                className="line-hit"
                onMouseEnter={() => { setHoverFamily(e.familyKey); setHoverIds(layout.edges.filter((x) => x.group === e.group).map((x) => x.id)) }}
                onMouseMove={(ev) => { if (!sel) tipAt(ev, edgeText(e.parentIds, e.childId)) }}
                onMouseLeave={() => { setTip(null); setHoverFamily(null); setHoverIds([]) }}
                onClick={(ev) => pick(ev, 'edge', layout.edges.filter((x) => x.group === e.group).map((x) => x.id), e.groupAt[0], e.groupAt[1] - 14)}
              />
            ))}
            {layout.edges.map((e) => (
              <path
                key={`o${e.id}`}
                d={e.own}
                className="line-hit"
                onMouseEnter={() => { setHoverFamily(e.familyKey); setHoverIds([e.id]) }}
                onMouseMove={(ev) => { if (!sel) tipAt(ev, edgeText(e.parentIds, e.childId)) }}
                onMouseLeave={() => { setTip(null); setHoverFamily(null); setHoverIds([]) }}
                onClick={(ev) => pick(ev, 'edge', [e.id], e.barAt[0], e.barAt[1] - 14)}
              />
            ))}
            {layout.unions.map((u) => (
              <path
                key={u.id}
                d={u.path}
                onClick={(ev) => pick(ev, 'union', [u.id], u.x, u.y - 14)}
                onMouseEnter={() => setHoverIds([u.id])}
                className="line-hit"
                onMouseMove={(ev) => tipAt(ev, `${family.relation(u.union.bId, u.union.aId, lang)?.label ?? ''}, ${family.relation(u.union.aId, u.union.bId, lang)?.label ?? ''}${u.union.startDate ? ` · ${u.union.startDate}` : ''}`)}
                onMouseLeave={() => { setTip(null); setHoverIds([]) }}
              />
            ))}
            {layout.unions.map((u) => {
              const hot = !!active && active.has(u.union.aId) && active.has(u.union.bId)
              const open = u.union.kind === 'civil'
              return (
                <g key={u.id} className={cn('dot-group link-start', app.canEdit && 'can-add')} onPointerDown={(e) => startLink(e, { parents: [u.union.aId, u.union.bId] }, u.x, u.y, () => app.quickAdd('child', u.union.aId, u.union.bId))} onClick={app.canEdit ? (e) => { e.stopPropagation(); app.quickAdd('child', u.union.aId, u.union.bId) } : undefined} onMouseEnter={(ev) => app.canEdit && tipAt(ev, t('Добавить ребёнка этой пары'))} onMouseLeave={() => setTip(null)}>
                  <circle cx={u.x} cy={u.y} r={13} className="dot-hit" />
                  <circle cx={u.x} cy={u.y} r={5} className={cn('dot', open && 'open', hot && 'hot')} />
                  {app.canEdit && <path d={`M${u.x - 4} ${u.y}H${u.x + 4}M${u.x} ${u.y - 4}V${u.y + 4}`} className="dot-plus" />}
                </g>
              )
            })}
            {draft && <path d={`M${draft.x1} ${draft.y1}L${draft.x2} ${draft.y2}`} className="link-draft" />}
          </svg>
          {sel && (selEdges.length > 0 || selUnion) && (
            <div className="float linkbar" style={{ left: sel.ax, top: sel.ay }} onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
              {selEdges.length > 0 && (
                <>
                  <select aria-label={t('Вид связи')} value={selEdges[0].links[0]?.kind} onChange={(e) => patchSelected({ kind: e.target.value })}>
                    <option value="birth">{t('родной')}</option>
                    <option value="adopted">{t('приёмный')}</option>
                    <option value="step">{t('отчим или мачеха')}</option>
                  </select>
                  {selEdges.length > 1 && <span className="linkbar-count">{selEdges.length}</span>}
                </>
              )}
              {selUnion && (
                <>
                  <select aria-label={t('Вид связи')} value={selUnion.union.kind} onChange={(e) => patchSelected({ kind: e.target.value })}>
                    <option value="marriage">{t('брак')}</option>
                    <option value="civil">{t('гражданский')}</option>
                  </select>
                </>
              )}
              <button className="linkbar-del" title={`${t('Удалить связь')} (Delete)`} aria-label={t('Удалить связь')} onClick={removeSelected}><Trash2 size={14} /></button>
            </div>
          )}
        </div>
        {draft && <div className="fixed z-50 pointer-events-none float px-2 py-1 text-xs" style={{ left: draft.cx + 14, top: draft.cy + 14 }}>{draft.label}</div>}
        {clipped && !panelOpen && <div className="float fixed left-1/2 -translate-x-1/2 bottom-[68px] z-10 px-3 py-1.5 text-xs text-ink-soft pointer-events-none whitespace-nowrap">{t('Схема шире экрана: тяните, чтобы сдвинуть')}</div>}
        {tip && <div className="fixed z-50 pointer-events-none float px-2 py-1 text-xs" style={{ left: tip.x + 12, top: tip.y + 12 }}>{tip.text}</div>}
      </div>
    )
  },
)

function Add({ type, label, person, side, onDrag }: { type: QuickType; label: string; person: Person; side: string; onDrag: (e: React.PointerEvent, id: string) => void }) {
  const { t, quickAdd, family, notify } = useApp()
  const add = () => {
    if (type === 'parent' && (family.parents.get(person.id) ?? []).length >= 2) return notify(t('У этого человека уже двое родителей'))
    quickAdd(type, person.id)
  }
  return (
    <button tabIndex={-1} className={`tool add ${side}`} title={`${t(label)}. ${t('Протяните к человеку, чтобы связать')}`} aria-label={t(label)} onPointerDown={(e) => onDrag(e, person.id)} onClick={add}><Plus strokeWidth={2.5} /></button>
  )
}

/** A plus on every side, placed where the relative will stand. A click on the portrait opens the editor. */
function CardTools({ person, onDrag }: { person: Person; onDrag: (e: React.PointerEvent, id: string) => void }) {
  const { rootsBelow } = useApp()
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  return (
    <div className="tools" onClick={stop} onPointerDown={stop} onMouseDown={stop} onDoubleClick={stop} onKeyDown={stop}>
      <Add type="parent" label="Добавить родителя" person={person} side={rootsBelow ? 'bottom' : 'top'} onDrag={onDrag} />
      <Add type="spouse" label="Добавить супруга" person={person} side="left" onDrag={onDrag} />
      <Add type="spouse" label="Добавить супруга" person={person} side="right" onDrag={onDrag} />
      <Add type="child" label="Добавить ребёнка" person={person} side={rootsBelow ? 'top' : 'bottom'} onDrag={onDrag} />
    </div>
  )
}

/** What the marks on the chart mean. */
export function Legend() {
  const { t } = useApp()
  const row = (mark: React.ReactNode, label: string) => (
    <div className="flex items-center gap-3 py-1"><span className="w-10 flex-none flex justify-center">{mark}</span><span>{t(label)}</span></div>
  )
  const line = (cls: string) => <svg width="40" height="12" className="legend-svg"><path d="M2 6H38" className={cls} /></svg>
  const ring = (cls: string) => <span className={`legend-ring ${cls}`} />
  return (
    <div>
      {row(ring('sex-M'), 'Мужчина')}
      {row(ring('sex-F'), 'Женщина')}
      {row(<svg width="40" height="12" className="legend-svg"><path d="M2 6H38" className="union" /><circle cx="20" cy="6" r="5" className="dot" /></svg>, 'Брак, от точки идут дети')}
      {row(<svg width="40" height="12" className="legend-svg"><path d="M2 6H38" className="union" /><circle cx="20" cy="6" r="5" className="dot open" /></svg>, 'Гражданский союз')}
      {row(line('line'), 'Родной ребёнок')}
      {row(line('line adopted'), 'Приёмный или отчим и мачеха')}
      {row(line('line assumed'), 'Предположение')}
      <p className="mt-2 pt-2 border-t border-border text-xs text-ink-soft leading-relaxed">{t('Протяните линию от аватарки к человеку, чтобы связать, или на пустое место, чтобы добавить нового. Клик по линии и Delete удаляют связь. ⌘Z отменяет.')}</p>
    </div>
  )
}
