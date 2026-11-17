'use client'
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { ArrowUpDown, CalendarDays, ChevronRight, GitFork, Map as MapIcon, CircleHelp, ClipboardCheck, EyeOff, Clock, Minus, Plus, Printer, Search, Settings, Tags } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useApp } from '@/lib/client'
import { useLiveConnected, type Present } from '@/lib/use-live'
import { cn } from '@/lib/utils'
import { AssistantIcon } from './assistant-icon'
import { useUpdate } from './settings/update-notice'
import type { CanvasHandle } from './graph-canvas'
import type { ChartScope } from './chart-scope'
import { ViewMenu } from './chart-view-menu'
import { Legend } from './graph-parts'
import { Logo } from './logo'

/** The folded bar holds its logo and a chevron, so it stays a small pill rather than a bare square. */
const FOLDED_WIDTH = 58

export type Side = 'history' | 'review' | 'assistant' | null

/**
 * One and the same bar narrows to a small control around its logo and opens again, so nothing is swapped and nothing jumps.
 * A width can only be animated between numbers, so it is measured first.
 */
function useFoldWidth(navRef: RefObject<HTMLElement | null>, folded: boolean) {
  const first = useRef(true)
  useLayoutEffect(() => {
    const bar = navRef.current
    if (!bar) return
    const instant = first.current
    first.current = false
    if (instant) { if (folded) bar.style.width = `${FOLDED_WIDTH}px`; return }
    if (folded) {
      bar.style.width = `${bar.offsetWidth}px`
      void bar.offsetWidth
      bar.style.width = `${FOLDED_WIDTH}px`
      return
    }
    bar.style.width = ''
    const open = bar.offsetWidth
    bar.style.width = `${FOLDED_WIDTH}px`
    void bar.offsetWidth
    bar.style.width = `${open}px`
    const done = (e: TransitionEvent) => {
      if (e.target !== bar || e.propertyName !== 'width') return
      bar.style.width = ''
      bar.removeEventListener('transitionend', done)
    }
    bar.addEventListener('transitionend', done)
    return () => bar.removeEventListener('transitionend', done)
  }, [navRef, folded])
}

export function MainBar({ folded, onHide, onShow, guest, familyName, present, mode, navRef, side, draftOps, onSearch, onSide, onAssistant, onSettings }: { folded: boolean; onHide: () => void; onShow: () => void;  guest: boolean; familyName: string; present: Present[]; mode: 'full' | 'no-name' | 'compact'; navRef: RefObject<HTMLElement | null>; side: Side; draftOps: number; onSearch: () => void; onSide: (next: Side) => void; onAssistant: () => void; onSettings: () => void }) {
  const { t, canEdit, me } = useApp()
  // The owner sees a dot on Settings when a newer release is out; nobody else is asked about it.
  const newer = useUpdate(me.role === 'owner').data?.newer
  useFoldWidth(navRef, folded)
  return (
    <>
      <nav aria-label={t('Главное меню')} ref={navRef} className={cn('float main-bar fixed left-3 top-3 z-10 flex items-center p-1', mode !== 'full' && mode, folded && 'folded')}>
        <Logo size={22} className="bar-logo flex-none" />
        <ChevronRight size={14} className="bar-open" aria-hidden="true" />
        <button className="show-bars" inert={!folded} title={t('Показать панели')} data-hint={t('Вернуть панели управления.')} aria-label={t('Показать панели')} onClick={onShow} />
        <div className="bar-rest flex items-center gap-0.5" inert={folded}>
        <span className="family-name font-serif font-medium text-base px-2.5 max-w-[220px] truncate">{familyName}</span>
        {present.length > 0 && <span className="presence" title={`${t('Сейчас в архиве')}: ${present.map((o) => o.name).join(', ')}`} aria-label={`${t('Сейчас в архиве')}: ${present.map((o) => o.name).join(', ')}`} role="img">{present.slice(0, 3).map((o) => <span key={o.id}>{o.name.slice(0, 1).toUpperCase()}</span>)}{present.length > 3 && <span>+{present.length - 3}</span>}</span>}
        <span className="sep w-px h-5 bg-border mx-0.5" />
        {!guest && <button className={side === 'assistant' ? 'bar-btn on' : 'bar-btn'} title={t('ИИ-ассистент')} data-hint={t('Спросите о семье или попросите внести правки. Откроется чат.')} aria-label={t('ИИ-ассистент')} onClick={onAssistant}><AssistantIcon /> <span className="nav-label"><span className="max-sm:hidden">{t('ИИ-ассистент')}</span><span className="sm:hidden">{t('ИИ')}</span></span></button>}
        <button className="bar-btn" title={t('Поиск людей')} data-hint={t('Найти человека по имени и показать на схеме.')} aria-label={t('Поиск людей')} onClick={onSearch}><Search size={16} /> <span className="nav-label">{t('Поиск')}</span></button>
        {!guest && canEdit && <button className={side === 'review' ? 'bar-btn on relative' : 'bar-btn relative'} title={t('Правки на подтверждение, незаполненные карточки и похожие люди.')} data-hint={t('Правки на подтверждение, незаполненные карточки и похожие люди.')} aria-label={t('Проверка')} onClick={() => onSide(side === 'review' ? null : 'review')}><ClipboardCheck size={16} /> <span className="nav-label">{t('Проверка')}</span>{draftOps > 0 && <span className="absolute right-1 top-1 min-w-4 rounded-full bg-rust px-1 text-center text-xs leading-4 text-white">{draftOps}</span>}</button>}
        {!guest && <button className={side === 'history' ? 'bar-btn on' : 'bar-btn'} title={t('Кто и что менял. Любое изменение можно откатить.')} data-hint={t('Кто и что менял. Любое изменение можно откатить.')} aria-label={t('История')} onClick={() => onSide(side === 'history' ? null : 'history')}><Clock size={16} /> <span className="nav-label">{t('История')}</span></button>}
        {!guest && <button className="bar-btn relative" title={t('Аккаунт, люди и доступ, файлы, подключения.')} data-hint={t('Аккаунт, люди и доступ, файлы, подключения.')} aria-label={newer ? `${t('Настройки')}. ${t('Вышла новая версия')}` : t('Настройки')} onClick={onSettings}><Settings size={16} /> <span className="nav-label">{t('Настройки')}</span>{newer && <span aria-hidden className="absolute right-1 top-1 size-2 rounded-full bg-[var(--accent)]" />}</button>}
        <button className="bar-btn hide-bars" title={t('Скрыть панели')} data-hint={t('Останется одна кнопка, а схема займёт весь экран.')} aria-label={t('Скрыть панели')} onClick={onHide}><EyeOff size={16} /></button>
        {guest && <span className="nav-label px-2 text-xs text-ink-soft whitespace-nowrap">{t('Просмотр по ссылке')}</span>}
        </div>
      </nav>
    </>
  )
}

/** Only about how the chart looks; it steps aside for a panel on the left. */
export function ViewBar({ folded, onHide, onOverview, onPrint, scope, canvas, rootsBelow, onFlip, groups, onGroups, allGroups, crowded }: { folded: boolean; onHide: () => void; onOverview: () => void; onPrint: () => void; scope: ChartScope; canvas: RefObject<CanvasHandle | null>; rootsBelow: boolean; onFlip: () => void; groups: string[]; onGroups: (next: string[]) => void; allGroups: [string, number][]; crowded: boolean }) {
  const { t } = useApp()
  return (
      <div aria-label={t('Вид схемы')} role="toolbar" inert={folded} className={cn('float view-bar flex items-center gap-0.5 p-1', crowded && 'crowded', folded && 'folded')}>
        <button className="bar-btn zoom-btn" title={t('Отдалить')} data-hint={t('Показать больше людей на экране.')} aria-label={t('Отдалить')} onClick={() => canvas.current?.zoomBy(0.75)}><Minus size={15} /></button>
        <button className="bar-btn zoom-btn" title={t('Приблизить')} data-hint={t('Показать людей крупнее.')} aria-label={t('Приблизить')} onClick={() => canvas.current?.zoomBy(1.33)}><Plus size={15} /></button>
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
        <button className="bar-btn" title={t('Даты, места и архивы')} data-hint={t('Ближайшие памятные дни, семья в цифрах, места и архивы.')} aria-label={t('Даты, места и архивы')} onClick={onOverview}><CalendarDays size={15} /></button>
        <button className="bar-btn" title={t('Печать и картинка')} data-hint={t('На одном листе, из нескольких листов или картинкой, чтобы отправить.')} aria-label={t('Печать и картинка')} onClick={onPrint}><Printer size={15} /></button>
        <Popover>
          <PopoverTrigger asChild><button className="bar-btn" title={t('Как читать схему')} data-hint={t('Что значат линии, рамки и цвета.')} aria-label={t('Как читать схему')}><CircleHelp size={15} /></button></PopoverTrigger>
          <PopoverContent side="top" align="start" collisionPadding={8} className="w-80 max-w-[calc(100vw-16px)] max-h-[min(70dvh,560px)] overflow-y-auto text-sm"><Legend /></PopoverContent>
        </Popover>
        <button className="bar-btn hide-here" title={t('Скрыть панели')} aria-label={t('Скрыть панели')} onClick={onHide}><EyeOff size={15} /></button>
      </div>
  )
}

/**
 * The bottom left row: tree or map first, then the view's own tools beside it (the tree's bar; the map's timeline
 * keeps its own place and steps aside from the switch).
 */
export function BottomRow({ left, children }: { left: number; children: React.ReactNode }) {
  return <div className="bottom-row fixed bottom-3 z-10 flex items-end gap-2" style={{ left }}>{children}</div>
}

/**
 * Tree or map: how the whole family is shown, not one more panel, so it lives apart from the top bar, at the bottom
 * left of both views in the same place. Both choices show at once and the current one stays marked, as on a map
 * app's list and map toggle; arrows move between them and one Tab reaches the pair.
 */
export function ViewSwitch({ map, onChange, folded }: { map: boolean; onChange: (map: boolean) => void; folded: boolean }) {
  const { t } = useApp()
  const box = useRef<HTMLDivElement>(null)
  // The map's timeline starts where it ends, so its width is published once it is laid out and whenever words change.
  useLayoutEffect(() => {
    const el = box.current!
    const root = document.documentElement
    const set = () => { root.style.setProperty('--view-switch-w', `${el.offsetWidth}px`); root.style.setProperty('--view-switch-h', `${el.offsetHeight}px`) }
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => { ro.disconnect(); root.style.removeProperty('--view-switch-w'); root.style.removeProperty('--view-switch-h') }
  }, [])
  const options = [[false, t('Схема'), t('Вернуться к схеме семьи.')], [true, t('Карта'), t('Кто где жил, год за годом.')]] as const
  const keys = (e: React.KeyboardEvent) => {
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? true : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? false : null
    if (next === null) return
    e.preventDefault()
    if (next !== map) onChange(next)
    box.current?.querySelectorAll<HTMLButtonElement>('[role=radio]')[next ? 1 : 0]?.focus()
  }
  return (
    <div ref={box} role="radiogroup" aria-label={t('Как показать')} inert={folded} onKeyDown={keys} className={cn('float view-switch flex flex-none gap-0.5 p-1', folded && 'folded')}>
      {options.map(([on, label, hint]) => (
        <button key={label} type="button" role="radio" aria-checked={map === on} tabIndex={map === on ? 0 : -1} title={hint} data-hint={hint} onClick={() => { if (map !== on) onChange(on) }} className={cn('bar-btn gap-1.5', map === on && 'on')}>
          {on ? <MapIcon size={15} /> : <GitFork size={15} className="rotate-180" />}{label}
        </button>
      ))}
    </div>
  )
}

/** Says so when the server cannot be reached, so nobody types into a chart that will not save. */
export function ConnectionNotice({ t }: { t: (key: string) => string }) {
  const [down, setDown] = useState(false)
  const live = useLiveConnected()
  useEffect(() => {
    const check = () => document.hidden ? undefined : fetch('/api/health', { cache: 'no-store' }).then((r) => setDown(!r.ok)).catch(() => setDown(true))
    // An open live line already proves the server is there, so it is asked only while that line is down.
    const timer = live ? undefined : setInterval(check, 15_000)
    window.addEventListener('online', check)
    window.addEventListener('offline', check)
    return () => {
      clearInterval(timer)
      window.removeEventListener('online', check)
      window.removeEventListener('offline', check)
    }
  }, [live])
  if (!down || live) return null
  return <div role="alert" className="float fixed left-1/2 -translate-x-1/2 top-3 z-50 px-3 py-1.5 text-xs text-destructive">{t('Нет связи с сервером. Схема показана как при последней загрузке, новые правки могут не сохраниться')}</div>
}
