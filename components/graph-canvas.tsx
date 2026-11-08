'use client'
import { useEffect, forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { ArrowUpDown, Baby, FileUp, Maximize2, Search, Trash2, UserPlus, UserRound, Users, Heart } from 'lucide-react'
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

/**
 * A press on the empty chart closes every menu and list that is open over it. The chart takes the press for panning,
 * and the menus' own way of noticing a press outside does not reach them from here.
 */
function closeOpenMenus() {
  const open = document.querySelectorAll('[data-slot=popover-content][data-state=open]').length
  // Each Escape closes the topmost one; a short gap lets it finish before the next.
  for (let i = 0; i < open; i++) setTimeout(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), i * 40)
}

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
    const { kin, near: hoverKin, wave, fromMe, active, hotPairs, lightMode, childNote, hoverSoon, setHoverFamily } = light
    const { draft, startLink, startFromPerson } = useLinkDrawing(layout, view.toChart, () => light.setHoverId(null))
    const [menu, setMenu] = useState<{ x: number; y: number; id?: string } | null>(null)
    useEffect(() => {
      if (!menu) return
      const close = (e: Event) => { if (!(e.target as HTMLElement | null)?.closest?.('[data-canvas-menu]')) setMenu(null) }
      const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
      window.addEventListener('pointerdown', close, true)
      window.addEventListener('wheel', close, { passive: true })
      window.addEventListener('resize', close)
      window.addEventListener('keydown', key)
      return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('wheel', close); window.removeEventListener('resize', close); window.removeEventListener('keydown', key) }
    }, [menu])
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
      <div ref={canvas} className="canvas" onPointerDownCapture={(e) => { if (e.button === 0 && (e.target === canvas.current || e.target === world.current || (e.target as HTMLElement).closest?.('.pcard,svg.links'))) closeOpenMenus() }} onContextMenu={(e) => {
        const card = (e.target as HTMLElement).closest?.('.pcard') as HTMLElement | null
        const id = card?.dataset.person
        if (!id && e.target !== canvas.current && e.target !== world.current) return
        if (id && byId.get(id)?.hidden) return
        e.preventDefault(); setTip(null)
        setMenu({ x: Math.min(e.clientX, window.innerWidth - 250), y: Math.min(e.clientY, window.innerHeight - (id ? 320 : 260)), id })
      }} onClick={(e) => { if (e.target === canvas.current || e.target === world.current) { app.focus(null); setSel(null) } }}>
        <div ref={world} className={cn('world', active && 'focused')}>
          <svg className="links" width="1" height="1">
            <Lines families={shown.families} unions={shown.unions} active={active} hotPairs={hotPairs} lightMode={lightMode} selIds={selIds} hoverIds={hoverIds} wave={wave} />
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
                wait={wave?.depth.get(p.id)}
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
        {menu && (
          <div data-canvas-menu role="menu" className="float fixed z-[60] min-w-56 p-1 text-sm" style={{ left: menu.x, top: menu.y }} onContextMenu={(e) => e.preventDefault()}>
            {menu.id ? (
              <>
                <div className="px-2.5 py-1.5 text-xs text-ink-soft truncate max-w-64">{personName(byId.get(menu.id)!) || t('Без названия')}</div>
                <button role="menuitem" className="menu-item" onClick={() => { const id = menu.id!; setMenu(null); app.focus(id, { center: true }) }}><UserRound size={15} /> {t('Открыть карточку')}</button>
                {app.canEdit && (
                  <>
                    <button role="menuitem" className="menu-item" onClick={() => { const id = menu.id!; setMenu(null); acts.current.add('parent', id) }}><Users size={15} /> {t('Добавить родителя')}</button>
                    <button role="menuitem" className="menu-item" onClick={() => { const id = menu.id!; setMenu(null); acts.current.add('spouse', id) }}><Heart size={15} /> {t('Добавить супруга')}</button>
                    <button role="menuitem" className="menu-item" onClick={() => { const id = menu.id!; setMenu(null); acts.current.add('child', id) }}><Baby size={15} /> {t('Добавить ребёнка')}</button>
                    <div className="my-1 h-px bg-border" />
                    <button role="menuitem" className="menu-item !text-destructive" onClick={() => { const id = menu.id!; setMenu(null); app.commands.deletePerson(id) }}><Trash2 size={15} /> {t('Удалить человека')}</button>
                  </>
                )}
              </>
            ) : (
              <>
                {app.canEdit && <button role="menuitem" className="menu-item" onClick={() => { setMenu(null); app.commands.addPerson() }}><UserPlus size={15} /> {t('Добавить человека без родства')}</button>}
                {app.canEdit && <button role="menuitem" className="menu-item" onClick={() => { setMenu(null); app.commands.importFile() }}><FileUp size={15} /> {t('Добавить людей из файла')}</button>}
                <button role="menuitem" className="menu-item" onClick={() => { setMenu(null); app.commands.search() }}><Search size={15} /> {t('Найти человека')}</button>
                <button role="menuitem" className="menu-item" onClick={() => { setMenu(null); view.refit() }}><Maximize2 size={15} /> {t('Показать всех')}</button>
                <button role="menuitem" className="menu-item" onClick={() => { setMenu(null); app.commands.flip() }}><ArrowUpDown size={15} /> {t('Перевернуть схему')}</button>
                {me.role === 'owner' && graph.persons.length > 0 && (
                  <>
                    <div className="my-1 h-px bg-border" />
                    <button role="menuitem" className="menu-item !text-destructive" onClick={() => { setMenu(null); app.commands.clearAll() }}><Trash2 size={15} /> {t('Удалить всю схему')}</button>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
    )
  },
)
