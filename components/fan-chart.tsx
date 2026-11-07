'use client'
import { useMemo } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useApp } from '@/lib/client'
import { fanSlots } from '@/lib/family-dates'
import { lifeYears, personName, type Person } from '@/lib/types'

const CENTER = 74
const RING = 92
const RINGS = 5
const SIZE = CENTER + RING * RINGS + 8
// The fan opens upward: three quarters of a circle, so the two sides of the family read left and right.
const FROM = -225
const SWEEP = 270
const point = (r: number, deg: number) => { const a = (deg * Math.PI) / 180; return `${(SIZE + r * Math.cos(a)).toFixed(1)} ${(SIZE + r * Math.sin(a)).toFixed(1)}` }
const sector = (r0: number, r1: number, a0: number, a1: number) => `M${point(r0, a0)}A${r0} ${r0} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${point(r0, a1)}L${point(r1, a1)}A${r1} ${r1} 0 ${a1 - a0 > 180 ? 1 : 0} 0 ${point(r1, a0)}Z`
const FILL = { M: '#e4ecec', F: '#f5e7df', U: '#efe9dc' }

/** A person's ancestors in one picture: everyone readable, and each one opens their card. */
export function FanChart({ rootId, onClose }: { rootId: string; onClose: () => void }) {
  const { t, graph, focus } = useApp()
  const levels = useMemo(() => fanSlots(rootId, graph, RINGS), [rootId, graph])
  const root = levels[0][0]
  const open = (p: Person) => { onClose(); focus(p.id, { center: true }) }
  const known = levels.slice(1).flat().filter(Boolean).length
  const label = (p: Person) => (p.hidden ? t('Скрыт') : personName(p) || t('Без названия'))
  const cell = (p: Person | null, g: number, i: number) => {
    const span = SWEEP / 2 ** g
    const a0 = FROM + i * span, a1 = a0 + span
    const r0 = CENTER + RING * (g - 1), r1 = r0 + RING
    const mid = (a0 + a1) / 2, r = (r0 + r1) / 2
    // Words run along the radius in the narrow outer rings, and turn so that nothing reads upside down.
    const flip = mid > -90 && mid < 90 ? 0 : 180
    const words = p ? label(p).split(/\s+/) : []
    const first = words.slice(0, g >= 4 ? words.length : 1).join(' ')
    const rest = g >= 4 ? '' : words.slice(1).join(' ')
    const size = g >= 5 ? 8.5 : g === 4 ? 9.5 : 11
    return (
      <g key={`${g}-${i}`} {...(p ? { role: 'button', tabIndex: 0, 'aria-label': `${label(p)} ${lifeYears(p)}`, className: 'cursor-pointer outline-none [&:focus-visible>path]:stroke-[var(--ink)] [&:hover>path]:stroke-[var(--ink)]', onClick: () => open(p), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(p) } } } : {})}>
        <path d={sector(r0, r1, a0, a1)} fill={p ? FILL[p.sex] : 'transparent'} stroke="var(--border)" strokeDasharray={p ? undefined : '3 3'} />
        {p && (
          <text transform={`rotate(${mid} ${SIZE} ${SIZE}) translate(${r} 0) rotate(${flip} ${SIZE} ${SIZE})`} x={SIZE} y={SIZE} textAnchor="middle" fontSize={size} fill="var(--ink)">
            <tspan x={SIZE} dy={rest ? -size * 0.5 : size * 0.1} fontWeight={500}>{first.slice(0, 22)}</tspan>
            {rest && <tspan x={SIZE} dy={size * 1.15} fontWeight={500}>{rest.slice(0, 16)}</tspan>}
            {g < 4 && !p.hidden && <tspan x={SIZE} dy={size * 1.15} fontSize={size - 1.5} fill="var(--ink-soft)">{lifeYears(p)}</tspan>}
          </text>
        )}
      </g>
    )
  }
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="flex max-h-[calc(100dvh-32px)] max-w-[min(860px,calc(100vw-16px))] flex-col gap-3 overflow-hidden sm:max-w-[min(860px,calc(100vw-32px))]">
        <div>
          <DialogTitle className="font-serif text-lg font-medium">{t('Веер предков')}{root ? `: ${label(root)}` : ''}</DialogTitle>
          <DialogDescription className="text-sm text-ink-soft">{known ? t('Слева сторона отца, справа сторона матери. Нажмите на человека, чтобы открыть его карточку.') : t('Предки этого человека пока не указаны.')}</DialogDescription>
        </div>
        {/* A phone scrolls a picture of readable size, rather than shrinking the names away. */}
        <div className="min-h-0 flex-1 overflow-auto">
          <svg viewBox={`0 ${SIZE - (CENTER + RING * RINGS) - 6} ${SIZE * 2} ${(CENTER + RING * RINGS) * 1.72 + 12}`} className="mx-auto block h-auto w-full min-w-[720px]" role="group" aria-label={t('Веер предков')}>
            {levels.slice(1).map((level, k) => level.map((p, i) => cell(p, k + 1, i)))}
            {root && (
              <g role="button" tabIndex={0} aria-label={label(root)} className="cursor-pointer outline-none" onClick={() => open(root)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(root) } }}>
                <circle cx={SIZE} cy={SIZE} r={CENTER} fill={FILL[root.sex]} stroke="var(--ink)" />
                <text x={SIZE} y={SIZE} textAnchor="middle" fontSize={12} fill="var(--ink)">
                  {label(root).split(/\s+/).slice(0, 3).map((w, i) => <tspan key={i} x={SIZE} dy={i ? 15 : -8} fontWeight={600}>{w.slice(0, 16)}</tspan>)}
                  <tspan x={SIZE} dy={15} fontSize={10.5} fill="var(--ink-soft)">{lifeYears(root)}</tspan>
                </text>
              </g>
            )}
          </svg>
        </div>
      </DialogContent>
    </Dialog>
  )
}
