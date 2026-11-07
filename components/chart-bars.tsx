'use client'
import { useEffect, useState, type RefObject } from 'react'
import { ArrowUpDown, CircleHelp, ClipboardCheck, EyeOff, Clock, Minus, Plus, Printer, Search, Settings, Tags } from 'lucide-react'
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

export type Side = 'history' | 'review' | 'assistant' | null

export function MainBar({ folded, onHide, guest, familyName, present, mode, navRef, side, draftOps, onSearch, onSide, onAssistant, onSettings }: { folded: boolean; onHide: () => void;  guest: boolean; familyName: string; present: Present[]; mode: 'full' | 'no-name' | 'compact'; navRef: RefObject<HTMLElement | null>; side: Side; draftOps: number; onSearch: () => void; onSide: (next: Side) => void; onAssistant: () => void; onSettings: () => void }) {
  const { t, canEdit } = useApp()
  return (
      <nav aria-label={t('Главное меню')} ref={navRef} inert={folded} className={cn('float main-bar fixed left-3 top-3 z-10 flex items-center gap-0.5 p-1', mode !== 'full' && mode, folded && 'folded')}>
        <Logo size={22} className="bar-logo ml-1.5 flex-none" />
        <span className="family-name font-serif font-medium text-base px-2.5 max-w-[220px] truncate">{familyName}</span>
        {present.length > 0 && <span className="presence" title={`${t('Сейчас в архиве')}: ${present.map((o) => o.name).join(', ')}`} aria-label={`${t('Сейчас в архиве')}: ${present.map((o) => o.name).join(', ')}`} role="img">{present.slice(0, 3).map((o) => <span key={o.id}>{o.name.slice(0, 1).toUpperCase()}</span>)}{present.length > 3 && <span>+{present.length - 3}</span>}</span>}
        <span className="sep w-px h-5 bg-border mx-0.5" />
        {!guest && <button className={side === 'assistant' ? 'bar-btn on' : 'bar-btn'} title={t('ИИ-ассистент')} data-hint={t('Спросите о семье или попросите внести правки. Откроется чат.')} aria-label={t('ИИ-ассистент')} onClick={onAssistant}><AssistantIcon /> <span className="nav-label"><span className="max-sm:hidden">{t('ИИ-ассистент')}</span><span className="sm:hidden">{t('ИИ')}</span></span></button>}
        <button className="bar-btn" title={t('Поиск людей')} data-hint={t('Найти человека по имени и показать на схеме.')} aria-label={t('Поиск людей')} onClick={onSearch}><Search size={16} /> <span className="nav-label">{t('Поиск')}</span></button>
        {!guest && canEdit && <button className={side === 'review' ? 'bar-btn on relative' : 'bar-btn relative'} title={t('Проверка')} data-hint={t('Правки на подтверждение, незаполненные карточки и похожие люди.')} aria-label={t('Проверка')} onClick={() => onSide(side === 'review' ? null : 'review')}><ClipboardCheck size={16} /> <span className="nav-label">{t('Проверка')}</span>{draftOps > 0 && <span className="absolute right-1 top-1 min-w-4 rounded-full bg-rust px-1 text-center text-xs leading-4 text-white">{draftOps}</span>}</button>}
        {!guest && <button className={side === 'history' ? 'bar-btn on' : 'bar-btn'} title={t('История')} data-hint={t('Кто и что менял. Любое изменение можно откатить.')} aria-label={t('История')} onClick={() => onSide(side === 'history' ? null : 'history')}><Clock size={16} /> <span className="nav-label">{t('История')}</span></button>}
        {!guest && <button className="bar-btn" title={t('Настройки')} data-hint={t('Аккаунт, люди и доступ, файлы, подключения.')} aria-label={t('Настройки')} onClick={onSettings}><Settings size={16} /> <span className="nav-label">{t('Настройки')}</span></button>}
        <button className="bar-btn hide-bars" title={t('Скрыть панели')} data-hint={t('Останется одна кнопка, а схема займёт весь экран.')} aria-label={t('Скрыть панели')} onClick={onHide}><EyeOff size={16} /></button>
        {guest && <span className="nav-label px-2 text-xs text-ink-soft whitespace-nowrap">{t('Просмотр по ссылке')}</span>}
      </nav>
  )
}

/** All that is left when the panels are hidden. */
export function ShowBars({ folded, onShow }: { folded: boolean; onShow: () => void }) {
  const { t } = useApp()
  return <button inert={!folded} className={cn('show-bars fixed left-3 top-3 z-10', folded && 'folded')} title={t('Показать панели')} data-hint={t('Вернуть панели управления.')} aria-label={t('Показать панели')} onClick={onShow}><span className="float show-bars-face"><Logo size={22} className="flex-none" /></span></button>
}

/** Only about how the chart looks; it steps aside for a panel on the left. */
export function ViewBar({ folded, onPrint, scope, canvas, rootsBelow, onFlip, groups, onGroups, allGroups, left, crowded }: { folded: boolean; onPrint: () => void; scope: ChartScope; canvas: RefObject<CanvasHandle | null>; rootsBelow: boolean; onFlip: () => void; groups: string[]; onGroups: (next: string[]) => void; allGroups: [string, number][]; left: number; crowded: boolean }) {
  const { t } = useApp()
  return (
      <div aria-label={t('Вид схемы')} role="toolbar" inert={folded} className={cn('float view-bar fixed bottom-3 z-10 flex items-center gap-0.5 p-1', crowded && 'crowded', folded && 'folded')} style={{ left }}>
        <button className="bar-btn" title={t('Отдалить')} data-hint={t('Показать больше людей на экране.')} aria-label={t('Отдалить')} onClick={() => canvas.current?.zoomBy(0.75)}><Minus size={15} /></button>
        <button className="bar-btn" title={t('Приблизить')} data-hint={t('Показать людей крупнее.')} aria-label={t('Приблизить')} onClick={() => canvas.current?.zoomBy(1.33)}><Plus size={15} /></button>
        <button className="bar-btn" title={t(rootsBelow ? 'Сейчас старшие снизу. Показать старших сверху' : 'Сейчас старшие сверху. Показать старших снизу')} aria-label={t('Перевернуть схему')} onClick={onFlip}><ArrowUpDown size={15} /></button>
        <ViewMenu scope={scope} />
        {allGroups.length > 0 && (
          <Popover>
            <PopoverTrigger asChild><button className={groups.length ? 'bar-btn on' : 'bar-btn'} title={t('Группы')} data-hint={t('Выделить на схеме людей с выбранными метками.')} aria-label={t('Группы')}><Tags size={15} />{groups.length > 0 && ` ${groups.length}`}</button></PopoverTrigger>
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
        <button className="bar-btn" title={t('Печать схемы')} data-hint={t('На одном листе или склеить из нескольких.')} aria-label={t('Печать схемы')} onClick={onPrint}><Printer size={15} /></button>
        <Popover>
          <PopoverTrigger asChild><button className="bar-btn" title={t('Как читать схему')} data-hint={t('Что значат линии, рамки и цвета.')} aria-label={t('Как читать схему')}><CircleHelp size={15} /></button></PopoverTrigger>
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
