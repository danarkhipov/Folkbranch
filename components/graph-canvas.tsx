'use client'
import { useEffect, forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { layoutFamily, CARD_W } from '@/lib/graph/layout'
import { useApp } from '@/lib/client'
import { yourTerm } from '@/lib/kinship'
import { cn } from '@/lib/utils'
import { personName } from '@/lib/types'
import { useChartLight } from './chart-light'
import { useCardMove } from './chart-move'
import type { ChartScope } from './chart-scope'
import { useLinkDrawing } from './chart-links'
import { useLineSelection } from './chart-selection'
import { useChartView } from './chart-view'
import { type ChartActions, Lines, PersonCard, HitAreas, FamilyDots } from './graph-parts'
import { Select } from '@/components/ui/select'

export interface CanvasHandle {
  fit: () => void
  zoomBy: (k: number) => void
  center: (id: string) => void
}

export const GraphCanvas = forwardRef<CanvasHandle, { pathIds: string[] | null; groupIds: Set<string> | null; panelOpen: boolean; leftInset?: number; scope: ChartScope }>(
  function GraphCanvas({ pathIds, groupIds, panelOpen, leftInset = 0, scope }, ref) {
    const app = useApp()
    const { graph, family, focusId, me, lang, t, byId } = app
    const drawn = scope.shown ?? graph
    const layout = useMemo(() => layoutFamily(drawn, { rootsBelow: app.rootsBelow, pins: scope.pins }), [drawn, app.rootsBelow, scope.pins])
    const view = useChartView(layout, panelOpen, leftInset)
    const { canvas, world, clipped, shown, center } = view
    const light = useChartLight(layout, pathIds, groupIds, view.isFar)
    const { kin, near: hoverKin, fromMe, active, hotPairs, lightMode, childNote, hoverSoon, setHoverFamily } = light
    const { draft, startLink, startFromPerson } = useLinkDrawing(layout, view.toChart, () => light.setHoverId(null))
    const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
    const { sel, setSel, selIds, selEdges, selUnion, hoverIds, setHoverIds, pick, removeSelected, patchSelected } = useLineSelection(layout, () => setTip(null))

    const { moving, startMove } = useCardMove(layout, scope.pins, view.zoom, scope.pin)

    // Said once for a few seconds: it covers people's names, and after that everyone knows.
    const [hintSeen, setHintSeen] = useState(false)
    useEffect(() => { if (!clipped) return; const timer = setTimeout(() => setHintSeen(true), 6000); return () => clearTimeout(timer) }, [clipped])
    useImperativeHandle(ref, () => ({ fit: view.refit, center, zoomBy: view.zoomBy }))

    const edgeText = (parentIds: string[], childId: string) => {
      const child = byId.get(childId)
      const first = family.relation(childId, parentIds[0], lang)?.label
      const second = parentIds[1] ? family.relation(childId, parentIds[1], lang)?.label : null
      const down = family.relation(parentIds[0], childId, lang)?.label
      return `${[first, second].filter(Boolean).join(', ')} → ${down ?? ''}${child ? ` · ${personName(child) || t('Скрыто')}` : ''}`
    }

    const tipAt = (e: React.MouseEvent, text: string) => setTip({ x: e.clientX, y: e.clientY, text })

    // The chart's parts are memoized and read these at the moment of the event, so a hover redraws only what it lights.
    const acts = useRef<ChartActions>(null!)
    acts.current = {
      open: app.focus,
      center,
      hover: hoverSoon,
      drag: startFromPerson,
      move: startMove,
      unfold: scope.toggleCollapse,
      add(type, id) {
        if (type === 'parent' && (family.parents.get(id) ?? []).length >= 2) return app.notify(t('У этого человека уже двое родителей. Чтобы заменить одного, сначала удалите связь с ним'))
        app.quickAdd(type, id)
      },
      enterLine(familyKey, ids) { setHoverFamily(familyKey); setHoverIds(ids) },
      leaveLine() { setTip(null); setHoverFamily(null); setHoverIds([]) },
      tipEdge(ev, e) { if (!sel) tipAt(ev, edgeText(e.parentIds, e.childId)) },
      tipUnion(ev, u) { tipAt(ev, `${family.relation(u.union.bId, u.union.aId, lang)?.label ?? ''}, ${family.relation(u.union.aId, u.union.bId, lang)?.label ?? ''}${u.union.startDate ? ` · ${u.union.startDate}` : ''}`) },
      tipDot(ev) { if (app.canEdit) tipAt(ev, t('Добавить ребёнка этой пары')) },
      hideTip() { setTip(null) },
      pick,
      startDot(e, u) { startLink(e, { parents: [u.union.aId, u.union.bId] }, u.x, u.y, () => app.quickAdd('child', u.union.aId, u.union.bId)) },
      addChild(u) { app.quickAdd('child', u.union.aId, u.union.bId) },
    }

    return (
      <div ref={canvas} className="canvas" onClick={(e) => { if (e.target === canvas.current || e.target === world.current) { app.focus(null); setSel(null) } }}>
        <div ref={world} className={cn('world', active && 'focused')}>
          <svg className="links" width="1" height="1">
            <Lines families={shown.families} unions={shown.unions} active={active} hotPairs={hotPairs} lightMode={lightMode} selIds={selIds} hoverIds={hoverIds} />
          </svg>
          {graph.persons.map((p) => {
            const c = layout.cards.get(p.id)
            if (!c || !shown.cards.has(p.id)) return null
            const k = kin?.get(p.id)
            const isActive = active?.has(p.id)
            const mine = fromMe?.get(p.id)
            const near = hoverKin?.get(p.id)
            const label = k && !pathIds ? k.label + (focusId && family.children.get(focusId)?.includes(p.id) ? childNote(focusId, p.id) : '') : near
            return (
              <PersonCard
                key={p.id}
                p={p}
                left={c.x - CARD_W / 2 + (moving?.id === p.id ? moving.dx : 0)}
                top={c.y}
                selected={p.id === focusId}
                className={cn('pcard', `sex-${p.sex}`, !p.living && 'dead', p.certainty === 'assumed' && 'assumed', p.hidden && 'hidden-p', p.id === focusId && 'focus', p.id === me.personId && 'isme', active && !isActive && 'dim', draft?.target === p.id && 'drop-target', moving?.id === p.id && 'moving')}
                folded={scope.folded.get(p.id)}
                label={label}
                mine={!label && mine ? yourTerm(mine.label, p.sex, lang) : undefined}
                canEdit={app.canEdit}
                rootsBelow={app.rootsBelow}
                lang={lang}
                acts={acts}
              />
            )
          })}
          {/* Above the cards, or a card's box would take the click meant for a line passing through it. */}
          <svg className="hits" width="1" height="1">
            <HitAreas layout={layout} edges={shown.edges} unions={shown.unions} groupHeads={shown.groupHeads} acts={acts} />
            <FamilyDots unions={shown.unions} active={active} canEdit={app.canEdit} acts={acts} />
            {draft && <path d={`M${draft.x1} ${draft.y1}L${draft.x2} ${draft.y2}`} className="link-draft" />}
          </svg>
          {sel && (selEdges.length > 0 || selUnion) && (
            <div className="float linkbar" style={{ left: sel.ax, top: sel.ay }} onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
              {selEdges.length > 0 && (
                <>
                  <Select look="quiet" aria-label={t('Родство')} value={selEdges[0].links[0]?.kind} onChange={(kind) => patchSelected({ kind })} options={[{ value: 'birth', label: t('родной') }, { value: 'adopted', label: t('приёмный') }, { value: 'step', label: t('отчим или мачеха') }]} />
                  {selEdges.length > 1 && <span className="linkbar-count">{t('Выбрано')}: {selEdges.length}</span>}
                </>
              )}
              {selUnion && (
                <>
                  <Select look="quiet" aria-label={t('Родство')} value={selUnion.union.kind} onChange={(kind) => patchSelected({ kind })} options={[{ value: 'marriage', label: t('брак') }, { value: 'civil', label: t('гражданский') }]} />
                </>
              )}
              <button className="linkbar-del" title={`${t('Удалить связь')} (Delete)`} aria-label={t('Удалить связь')} onClick={removeSelected}><Trash2 size={14} /></button>
            </div>
          )}
        </div>
        {draft && <div className="fixed z-50 pointer-events-none float px-2 py-1 text-xs" style={{ left: draft.cx + 14, top: draft.cy + 14 }}>{t(draft.label)}</div>}
        {clipped && !hintSeen && !panelOpen && !leftInset && <div className="float chart-hint fixed left-1/2 -translate-x-1/2 bottom-[68px] z-10 px-3 py-1.5 text-xs text-ink-soft pointer-events-none whitespace-nowrap">{t('Схема шире экрана: тяните, чтобы сдвинуть')}</div>}
        {tip && <div className="fixed z-50 pointer-events-none float px-2 py-1 text-xs" style={{ left: tip.x + 12, top: tip.y + 12 }}>{tip.text}</div>}
      </div>
    )
  },
)
