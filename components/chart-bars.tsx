'use client'
import { useEffect, useState, type RefObject } from 'react'
import { ArrowUpDown, CircleHelp, Clock, Minus, Plus, Printer, Search, Settings, Tags, Users } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useApp } from '@/lib/client'
import type { Present } from '@/lib/use-live'
import { cn } from '@/lib/utils'
import { AssistantIcon } from './assistant-icon'
import type { CanvasHandle } from './graph-canvas'
import type { ChartScope } from './chart-scope'
import { ViewMenu } from './chart-view-menu'
import { Legend } from './graph-parts'
import { Logo } from './logo'

export type Side = 'related' | 'history' | 'review' | 'assistant' | null

export function MainBar({ guest, familyName, present, mode, navRef, side, draftOps, onSearch, onSide, onAssistant, onSettings }: { guest: boolean; familyName: string; present: Present[]; mode: 'full' | 'no-name' | 'compact'; navRef: RefObject<HTMLElement | null>; side: Side; draftOps: number; onSearch: () => void; onSide: (next: Side) => void; onAssistant: () => void; onSettings: () => void }) {
  const { t } = useApp()
  /** Only where the label itself is hidden: a compact bar with room for hovering. */
  const hint = (text: string) => (mode === 'compact' && window.innerWidth > 640 ? text : undefined)
  return (
      <nav aria-label={t('Главное меню')} ref={navRef} className={cn('float main-bar fixed left-3 top-3 z-10 flex items-center gap-0.5 p-1', mode !== 'full' && mode)}>
        <Logo size={22} className="bar-logo ml-1.5 flex-none" />
        <span className="family-name font-serif font-medium text-base px-2.5 max-w-[220px] truncate">{familyName}</span>
        {present.length > 0 && <span className="presence" title={`${t('Сейчас в архиве')}: ${present.map((o) => o.name).join(', ')}`} aria-label={`${t('Сейчас в архиве')}: ${present.map((o) => o.name).join(', ')}`} role="img">{present.slice(0, 3).map((o) => <span key={o.id}>{o.name.slice(0, 1).toUpperCase()}</span>)}{present.length > 3 && <span>+{present.length - 3}</span>}</span>}
        <span className="sep w-px h-5 bg-border mx-0.5" />
        <button className="bar-btn" title={t('Поиск людей')} aria-label={t('Поиск людей')} onClick={onSearch}><Search size={16} /> <span className="nav-label">{t('Поиск')}</span></button>
        <button className={side === 'related' ? 'bar-btn on' : 'bar-btn'} title={hint(t('Родство'))} aria-label={t('Кем приходится?')} onClick={() => onSide(side === 'related' ? null : 'related')}><Users size={16} /> <span className="nav-label">{t('Родство')}</span></button>
        {!guest && <button className={side === 'assistant' ? 'bar-btn on' : 'bar-btn'} title={hint(t('Ассистент'))} aria-label={t('Ассистент')} onClick={onAssistant}><AssistantIcon /> <span className="nav-label">{t('Ассистент')}</span></button>}
        {!guest && <button className={side === 'history' || side === 'review' ? 'bar-btn on relative' : 'bar-btn relative'} title={draftOps > 0 ? `${t('История')}: ${t('Правки на проверку')} ${draftOps}` : hint(t('История'))} aria-label={t('История')} onClick={() => onSide(side === 'review' ? 'history' : side === 'history' ? null : draftOps > 0 ? 'review' : 'history')}><Clock size={16} /> <span className="nav-label">{t('История')}</span>{draftOps > 0 && <span className="absolute right-1 top-1 min-w-4 rounded-full bg-rust px-1 text-center text-xs leading-4 text-white">{draftOps}</span>}</button>}
        {!guest && <button className="bar-btn" title={hint(t('Настройки'))} aria-label={t('Настройки')} onClick={onSettings}><Settings size={16} /> <span className="nav-label">{t('Настройки')}</span></button>}
        {guest && <span className="nav-label px-2 text-xs text-ink-soft whitespace-nowrap">{t('Просмотр по ссылке')}</span>}
      </nav>
  )
}

/** Only about how the chart looks; it steps aside for a panel on the left. */
export function ViewBar({ onPrint, scope, canvas, rootsBelow, onFlip, groups, onGroups, allGroups, left, crowded }: { onPrint: () => void; scope: ChartScope; canvas: RefObject<CanvasHandle | null>; rootsBelow: boolean; onFlip: () => void; groups: string[]; onGroups: (next: string[]) => void; allGroups: [string, number][]; left: number; crowded: boolean }) {
  const { t } = useApp()
  return (
      <div aria-label={t('Вид схемы')} role="group" className={cn('float view-bar fixed bottom-3 z-10 flex items-center gap-0.5 p-1', crowded && 'crowded')} style={{ left }}>
        <button className="bar-btn" title={t('Отдалить')} aria-label={t('Отдалить')} onClick={() => canvas.current?.zoomBy(0.75)}><Minus size={15} /></button>
        <button className="bar-btn" title={t('Приблизить')} aria-label={t('Приблизить')} onClick={() => canvas.current?.zoomBy(1.33)}><Plus size={15} /></button>
        <button className="bar-btn" title={t(rootsBelow ? 'Сейчас старшие снизу. Показать старших сверху' : 'Сейчас старшие сверху. Показать старших снизу')} aria-label={t('Перевернуть схему')} onClick={onFlip}><ArrowUpDown size={15} /></button>
        <ViewMenu scope={scope} />
        {allGroups.length > 0 && (
          <Popover>
            <PopoverTrigger asChild><button className={groups.length ? 'bar-btn on' : 'bar-btn'} title={t('Группы')} aria-label={t('Группы')}><Tags size={15} />{groups.length > 0 && ` ${groups.length}`}</button></PopoverTrigger>
            <PopoverContent side="top" align="start" className="w-56 text-sm flex flex-col gap-0.5 p-2 max-h-72 overflow-auto">
              {allGroups.map(([name, count]) => (
                <label key={name} className="flex items-center gap-2 min-h-7 px-1 rounded hover:bg-muted cursor-pointer">
                  <input type="checkbox" className="accent-[var(--ink)] size-4" checked={groups.includes(name)} onChange={(e) => onGroups(e.target.checked ? [...groups, name] : groups.filter((g) => g !== name))} />
                  <span className="truncate flex-1">{name}</span>
                  <span className="text-ink-faint">{count}</span>
                </label>
              ))}
              {groups.length > 0 && <button className="bar-btn self-start mt-1" onClick={() => onGroups([])}>{t('Показать всех')}</button>}
            </PopoverContent>
          </Popover>
        )}
        <button className="bar-btn" title={t('Печать схемы')} aria-label={t('Печать схемы')} onClick={onPrint}><Printer size={15} /></button>
        <Popover>
          <PopoverTrigger asChild><button className="bar-btn" title={t('Как читать схему')} aria-label={t('Как читать схему')}><CircleHelp size={15} /></button></PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-80 text-sm"><Legend /></PopoverContent>
        </Popover>
      </div>
  )
}

/** Says so when the server cannot be reached, so nobody types into a chart that will not save. */
export function ConnectionNotice({ t }: { t: (key: string) => string }) {
  const [down, setDown] = useState(false)
  useEffect(() => {
    const check = () => document.hidden ? undefined : fetch('/api/health', { cache: 'no-store' }).then((r) => setDown(!r.ok)).catch(() => setDown(true))
    const timer = setInterval(check, 15_000)
    window.addEventListener('online', check)
    window.addEventListener('offline', check)
    return () => {
      clearInterval(timer)
      window.removeEventListener('online', check)
      window.removeEventListener('offline', check)
    }
  }, [])
  if (!down) return null
  return <div role="alert" className="float fixed left-1/2 -translate-x-1/2 top-3 z-50 px-3 py-1.5 text-xs text-destructive">{t('Нет связи с сервером. Схема показана как при последней загрузке, новые правки могут не сохраниться')}</div>
}
