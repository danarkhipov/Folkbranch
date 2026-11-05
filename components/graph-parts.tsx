'use client'
import { memo, useState, type RefObject } from 'react'
import { Plus } from 'lucide-react'
import { type EdgePos, type Layout } from '@/lib/graph/layout'
import { avatarUrl, useApp, type QuickType } from '@/lib/client'
import { cn } from '@/lib/utils'
import { translate } from '@/lib/i18n'
import { lifeYears, personName, type Lang, type Person } from '@/lib/types'

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

export type LightMode = 'pairs' | 'both-ends' | 'none'

type UnionItem = Layout['unions'][number]

export interface ChartActions {
  open: (id: string) => void
  center: (id: string) => void
  hover: (id: string | null) => void
  drag: (e: React.PointerEvent, id: string) => void
  add: (type: QuickType, id: string) => void
  enterLine: (familyKey: string | null, ids: string[]) => void
  leaveLine: () => void
  tipEdge: (ev: React.MouseEvent, e: EdgePos) => void
  tipUnion: (ev: React.MouseEvent, u: UnionItem) => void
  tipDot: (ev: React.MouseEvent) => void
  hideTip: () => void
  pick: (ev: React.MouseEvent, kind: 'edge' | 'union', ids: string[], ax: number, ay: number) => void
  startDot: (e: React.PointerEvent, u: UnionItem) => void
  addChild: (u: UnionItem) => void
}

type Acts = RefObject<ChartActions>

export const Lines = memo(function Lines({ families, unions, active, hotPairs, lightMode, selIds, hoverIds }: { families: [string, EdgePos[]][]; unions: UnionItem[]; active: Set<string> | null; hotPairs: Set<string>; lightMode: LightMode; selIds: Set<string>; hoverIds: string[] }) {
  /** A line is lit when both ends are in the highlighted set; a path is lit pair by pair. */
  const hotEdge = (e: EdgePos) =>
    lightMode === 'pairs' ? e.parentIds.some((p) => hotPairs.has(pairKey(p, e.childId)))
      : lightMode === 'both-ends' && !!active && active.has(e.childId) && e.parentIds.some((p) => active.has(p))
  return (
    <>
      {/* Each family is drawn over a paper-coloured halo, so crossings read as one line passing over another. */}
      {families.map(([key, edges]) => (
        <g key={key}>
          <path d={edges.map((e) => e.path).join('')} className="line-halo" />
          {edges.map((e) => <path key={e.id} d={e.path} className={cn('line', e.style !== 'solid' && e.style, hotEdge(e) && 'hot', selIds.has(e.id) && 'selected', hoverIds.includes(e.id) && 'hover')} />)}
        </g>
      ))}
      {unions.map((u) => {
        const hot = hotPairs.has(pairKey(u.union.aId, u.union.bId)) || (!!active && active.has(u.union.aId) && active.has(u.union.bId))
        return <path key={u.id} d={u.path} className={cn('union', u.union.certainty === 'assumed' && 'assumed', hot && 'hot', selIds.has(u.id) && 'selected', hoverIds.includes(u.id) && 'hover')} />
      })}
    </>
  )
})

export const PersonCard = memo(function PersonCard({ p, left, top, className, selected, label, mine, canEdit, rootsBelow, lang, acts }: { p: Person; left: number; top: number; className: string; selected: boolean; label?: string; mine?: string; canEdit: boolean; rootsBelow: boolean; lang: Lang; acts: Acts }) {
  const t = (key: string) => translate(lang, key)
  const open = () => acts.current.open(p.id)
  // The plus buttons exist only on the card in use: on every card they would be most of the page.
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  return (
    <div
      data-person={p.id}
      role="button"
      tabIndex={0}
      aria-label={p.hidden ? t('Живой родственник') : `${personName(p)} ${lifeYears(p)}`}
      className={className}
      style={{ left, top }}
      onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) open() }}
      onMouseEnter={() => acts.current.hover(p.id)}
      onMouseLeave={() => acts.current.hover(null)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={(e) => {
        setFocused(true)
        // Tabbing walks along the chart, bringing the next people into view.
        if (e.target === e.currentTarget && e.target.matches(':focus-visible')) acts.current.center(p.id)
      }}
      onBlur={() => setFocused(false)}
    >
      <div className={cn('ava', canEdit && !p.hidden && 'link-start')} onPointerDown={canEdit && !p.hidden ? (e) => acts.current.drag(e, p.id) : undefined}><img src={avatarUrl(p)} alt="" decoding="async" draggable={false} /></div>
      {/* Opaque, so a line coming from below stops at the text however tall it wraps. */}
      <div className="cap">
        <div className="nm">{p.hidden ? t('Живой родственник') : personName(p) || t('Без названия')}</div>
        {!p.hidden && <div className="yr">{lifeYears(p)}</div>}
        {label && <div className="rel kin">{label}</div>}
        {mine && <div className="rel me">{mine}</div>}
      </div>
      {canEdit && !p.hidden && (hovered || focused || selected) && <CardTools id={p.id} rootsBelow={rootsBelow} lang={lang} acts={acts} />}
    </div>
  )
})

/** Wide invisible strokes on top make thin lines easy to hover. */
export const HitAreas = memo(function HitAreas({ layout, edges, unions, groupHeads, acts }: { layout: Layout; edges: EdgePos[]; unions: UnionItem[]; groupHeads: EdgePos[]; acts: Acts }) {
  return (
    <>
      {groupHeads.map((e) => {
        const ids = () => layout.edges.filter((x) => x.group === e.group).map((x) => x.id)
        return (
          <path
            key={`g${e.group}`}
            d={e.shared}
            className="line-hit"
            onMouseEnter={() => acts.current.enterLine(e.familyKey, ids())}
            onMouseMove={(ev) => acts.current.tipEdge(ev, e)}
            onMouseLeave={() => acts.current.leaveLine()}
            onClick={(ev) => acts.current.pick(ev, 'edge', ids(), e.groupAt[0], e.groupAt[1] - 14)}
          />
        )
      })}
      {edges.map((e) => (
        <path
          key={`o${e.id}`}
          d={e.own}
          className="line-hit"
          onMouseEnter={() => acts.current.enterLine(e.familyKey, [e.id])}
          onMouseMove={(ev) => acts.current.tipEdge(ev, e)}
          onMouseLeave={() => acts.current.leaveLine()}
          onClick={(ev) => acts.current.pick(ev, 'edge', [e.id], e.barAt[0], e.barAt[1] - 14)}
        />
      ))}
      {unions.map((u) => (
        <path
          key={u.id}
          d={u.path}
          onClick={(ev) => acts.current.pick(ev, 'union', [u.id], u.x, u.y - 14)}
          onMouseEnter={() => acts.current.enterLine(null, [u.id])}
          className="line-hit"
          onMouseMove={(ev) => acts.current.tipUnion(ev, u)}
          onMouseLeave={() => acts.current.leaveLine()}
        />
      ))}
    </>
  )
})

export const FamilyDots = memo(function FamilyDots({ unions, active, canEdit, acts }: { unions: UnionItem[]; active: Set<string> | null; canEdit: boolean; acts: Acts }) {
  return unions.map((u) => {
    const hot = !!active && active.has(u.union.aId) && active.has(u.union.bId)
    return (
      <g key={u.id} className={cn('dot-group link-start', canEdit && 'can-add')} onPointerDown={(e) => acts.current.startDot(e, u)} onClick={canEdit ? (e) => { e.stopPropagation(); acts.current.addChild(u) } : undefined} onMouseEnter={(ev) => acts.current.tipDot(ev)} onMouseLeave={() => acts.current.hideTip()}>
        <circle cx={u.x} cy={u.y} r={13} className="dot-hit" />
        <circle cx={u.x} cy={u.y} r={5} className={cn('dot', u.union.kind === 'civil' && 'open', hot && 'hot')} />
        {canEdit && <path d={`M${u.x - 4} ${u.y}H${u.x + 4}M${u.x} ${u.y - 4}V${u.y + 4}`} className="dot-plus" />}
      </g>
    )
  })
})

/** A plus on every side, placed where the relative will stand. A click on the portrait opens the editor. */
function CardTools({ id, rootsBelow, lang, acts }: { id: string; rootsBelow: boolean; lang: Lang; acts: Acts }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  const add = (type: QuickType, label: string, side: string, key = side) => (
    <button key={key} tabIndex={-1} className={`tool add ${side}`} title={`${translate(lang, label)}. ${translate(lang, 'Протяните к человеку, чтобы связать')}`} aria-label={translate(lang, label)} onPointerDown={(e) => acts.current.drag(e, id)} onClick={() => acts.current.add(type, id)}><Plus strokeWidth={2.5} /></button>
  )
  return (
    <div className="tools" onClick={stop} onPointerDown={stop} onMouseDown={stop} onDoubleClick={stop} onKeyDown={stop}>
      {add('parent', 'Добавить родителя', rootsBelow ? 'bottom' : 'top')}
      {add('spouse', 'Добавить супруга', 'left')}
      {add('spouse', 'Добавить супруга', 'right')}
      {add('child', 'Добавить ребёнка', rootsBelow ? 'top' : 'bottom')}
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
  const fine = typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches
  return (
    <div>
      <h3 className="text-base font-medium mb-1">{t('Как читать схему')}</h3>
      {row(ring('sex-M'), 'Мужчина')}
      {row(ring('sex-F'), 'Женщина')}
      {row(<svg width="40" height="12" className="legend-svg"><path d="M2 6H38" className="union" /><circle cx="20" cy="6" r="5" className="dot" /></svg>, 'Брак. От точки идут линии к детям')}
      {row(<svg width="40" height="12" className="legend-svg"><path d="M2 6H38" className="union" /><circle cx="20" cy="6" r="5" className="dot open" /></svg>, 'Без регистрации брака')}
      {row(line('line'), 'Родной ребёнок')}
      {row(line('line adopted'), 'Приёмный ребёнок, отчим или мачеха')}
      {row(line('line assumed'), 'Связь под вопросом')}
      {row(ring('assumed'), 'Человек под вопросом')}
      <ul className="mt-2 pt-2 border-t border-border text-sm flex flex-col gap-2">
        <li>{t('Нажмите на человека, чтобы открыть карточку.')}</li>
        <li>{t('Кнопка + рядом с человеком добавляет родственника.')}</li>
        <li>{t('Перетащите + на другого человека, чтобы связать их.')}</li>
        {fine && <li>{t('Чтобы удалить связь, нажмите на линию и клавишу Delete.')}</li>}
        {fine && <li>{(/Mac/.test(navigator.platform) ? (k: string) => k : (k: string) => k.replaceAll('⌘', 'Ctrl+'))(t('Клавиши: ⌘K поиск, ⌘J ассистент, ⌘Z отмена.'))}</li>}
      </ul>
    </div>
  )
}
