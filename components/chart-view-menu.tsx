'use client'
import dynamic from 'next/dynamic'
import { useState } from 'react'
import { ArrowDownFromLine, ArrowUpFromLine, Check, CircleDot, ChevronsDownUp, ChevronsUpDown, Filter, GitFork, Network, Trash2, UserRound, UsersRound, X, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useApp } from '@/lib/client'
import type { Scope } from '@/lib/graph/select'
import { personName } from '@/lib/types'
import type { ChartScope } from './chart-scope'
import { Mini } from './person-mini'

const PersonPopover = dynamic(() => import('./person-pickers').then((m) => m.PersonPopover), { ssr: false })
const FanChart = dynamic(() => import('./fan-chart').then((m) => m.FanChart), { ssr: false })

const SCOPES: [Exclude<Scope, 'all'>, string, string, LucideIcon][] = [
  ['ancestors', 'Предки', 'родители, бабушки и дедушки и старше', ArrowUpFromLine],
  ['descendants', 'Потомки', 'дети, внуки и младше', ArrowDownFromLine],
  ['near', 'Ближайшая семья', 'родители, супруги, дети, братья и сёстры', UsersRound],
]

/** Which part of the family the chart shows. The person is chosen right here, or comes from the open card. */
export function ViewMenu({ scope }: { scope: ChartScope }) {
  const { t, focusId, me, byId, family, canEdit, notify } = useApp()
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [fan, setFan] = useState<string | null>(null)
  const known = (id: string | null | undefined) => (id && byId.has(id) ? id : null)
  const root = known(picked) ?? known(focusId) ?? known(scope.rootId) ?? known(me.personId)
  const person = root ? byId.get(root)! : null
  const rootName = person ? personName(person) || t('Без названия') : ''
  const narrowed = scope.scope !== 'all' || scope.collapsed.length > 0
  const shownName = scope.rootId && byId.has(scope.rootId) ? personName(byId.get(scope.rootId)!) || t('Без названия') : ''
  const fail = (e: Error) => notify(`${t('Не удалось сохранить')}: ${e.message}`)
  const canFold = !!root && (family.children.get(root)?.length ?? 0) > 0
  const row = 'flex items-center gap-2.5 min-h-10 px-2 py-1 rounded-lg hover:bg-muted text-left w-full disabled:opacity-50 disabled:hover:bg-transparent aria-pressed:bg-muted'
  const pick = (id: string) => {
    setPicked(id)
    // Changing the person keeps the choice of who to show around them.
    if (scope.scope !== 'all') scope.show({ scope: scope.scope, rootId: id })
  }
  const label = (title: string, line: string) => <span className="min-w-0 flex-1"><span className="block">{t(title)}</span><span className="block text-xs leading-snug text-ink-soft">{t(line)}</span></span>
  return (
    <>
      <Popover>
        <PopoverTrigger asChild><button className={narrowed ? 'bar-btn on' : 'bar-btn'} title={t('Кого показать')} data-hint={t('Вся семья или только предки, потомки и близкие одного человека.')} aria-label={t('Кого показать')}><Filter size={15} /></button></PopoverTrigger>
        <PopoverContent side="top" align="start" className="w-80 max-w-[calc(100vw-24px)] text-sm flex flex-col gap-0.5 p-2 max-h-[80vh] overflow-auto">
          <h3 className="text-base font-medium px-2 pb-1">{t('Кого показать')}</h3>
          <button className={row} aria-pressed={!narrowed} onClick={scope.showAll}><Network size={16} className="flex-none text-ink-soft" />{label('Всю семью', 'все люди архива')}{!narrowed && <Check size={15} className="flex-none" />}</button>
          <div className="mt-2 flex flex-col gap-1 px-2 pb-1 text-xs text-ink-soft">
            {t('Только часть семьи вокруг человека')}
            <PersonPopover onPick={pick}>
              <button className="flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-white px-2.5 text-left text-sm text-ink">
                {person ? <Mini person={person} /> : <UserRound size={15} className="flex-none text-ink-soft" />}
                <span className={person ? 'min-w-0 flex-1 truncate' : 'min-w-0 flex-1 truncate text-ink-faint'}>{person ? rootName : t('Выбрать человека')}</span>
                <ChevronsUpDown size={14} className="flex-none text-ink-soft" />
              </button>
            </PersonPopover>
          </div>
          {SCOPES.map(([s, title, line, Icon]) => {
            const on = scope.scope === s && scope.rootId === root
            return <button key={s} className={row} disabled={!root} aria-pressed={on} title={root ? undefined : t('Сначала выберите человека')} onClick={() => scope.show({ scope: s, rootId: root })}><Icon size={16} className="flex-none text-ink-soft" />{label(title, line)}{on && <Check size={15} className="flex-none" />}</button>
          })}
          {root && <button className={row} onClick={() => setFan(root)}><CircleDot size={16} className="flex-none text-ink-soft" />{label('Веер предков', 'все предки на одной картинке')}</button>}
          {canFold && <button className={row} onClick={() => scope.toggleCollapse(root!)}><ChevronsDownUp size={16} className="flex-none text-ink-soft" />{label(scope.collapsed.includes(root!) ? 'Показать потомков' : 'Свернуть потомков', 'только на схеме, данные не меняются')}</button>}
          {scope.views.length > 0 && <h3 className="text-xs text-ink-soft px-2 mt-3">{t('Сохранённые виды')}</h3>}
          {scope.views.map((v) => (
            <div key={v.id} className="flex items-center gap-1">
              <button className={row} aria-pressed={scope.activeId === v.id} onClick={() => scope.open(v)}><GitFork size={16} className="flex-none text-ink-soft" /><span className="truncate">{v.name}</span></button>
              {canEdit && <button className="bar-btn !h-8 !min-w-8 !p-0" title={`${t('Удалить вид')}: ${v.name}`} aria-label={`${t('Удалить вид')}: ${v.name}`} onClick={() => scope.remove(v.id).catch(fail)}><Trash2 size={14} /></button>}
            </div>
          ))}
          {canEdit && narrowed && (
            <form className="flex flex-col gap-1 mt-3 px-2 text-xs text-ink-soft" onSubmit={(e) => { e.preventDefault(); if (name.trim()) scope.saveAs(name.trim()).then(() => setName('')).catch(fail) }}>
              <label htmlFor="view-name">{t('Сохранить этот вид, чтобы вернуться к нему или поделиться')}</label>
              <div className="flex gap-1.5"><Input id="view-name" placeholder={t('Мамина ветка')} value={name} onChange={(e) => setName(e.target.value)} /><Button variant="outline" disabled={!name.trim()}>{t('Сохранить')}</Button></div>
            </form>
          )}
          {canEdit && Object.keys(scope.pins).length > 0 && <button className={`${row} mt-2`} onClick={() => scope.clearPins().catch(fail)}>{t('Вернуть карточки на их места')}</button>}
        </PopoverContent>
      </Popover>
      {fan && <FanChart rootId={fan} onClose={() => setFan(null)} />}
      {narrowed && (
        <span className="flex items-center gap-1 pl-1.5 text-sm">
          <span className="max-w-48 truncate">{scope.scope === 'all' ? t('Часть ветвей свёрнута') : `${t(SCOPES.find(([s]) => s === scope.scope)![1])}${shownName ? `: ${shownName}` : ''}`}</span>
          <button className="bar-btn !h-7 !min-w-7 !p-0" title={t('Показать всю семью')} aria-label={t('Показать всю семью')} onClick={scope.showAll}><X size={13} /></button>
        </span>
      )}
    </>
  )
}
