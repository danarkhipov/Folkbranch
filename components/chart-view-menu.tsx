'use client'
import { useState } from 'react'
import { Filter, Trash2, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useApp } from '@/lib/client'
import type { Scope } from '@/lib/graph/select'
import { personName } from '@/lib/types'
import type { ChartScope } from './chart-scope'

const SCOPES: [Exclude<Scope, 'all'>, string][] = [['ancestors', 'Предки'], ['descendants', 'Потомки'], ['near', 'Ближайшая семья']]

/** Which part of the family the chart shows: of the person whose card is open, or of the viewer. */
export function ViewMenu({ scope }: { scope: ChartScope }) {
  const { t, focusId, me, byId, family, canEdit, notify } = useApp()
  const [name, setName] = useState('')
  const root = focusId && byId.has(focusId) ? focusId : me.personId && byId.has(me.personId) ? me.personId : null
  const rootName = root ? personName(byId.get(root)!) || t('Без названия') : ''
  const narrowed = scope.scope !== 'all' || scope.collapsed.length > 0
  const shownName = scope.rootId && byId.has(scope.rootId) ? personName(byId.get(scope.rootId)!) || t('Без названия') : ''
  const fail = (e: Error) => notify(`${t('Не удалось сохранить')}: ${e.message}`)
  const canFold = !!focusId && (family.children.get(focusId)?.length ?? 0) > 0
  const row = 'flex items-center gap-2 min-h-8 px-1.5 rounded hover:bg-muted text-left w-full disabled:opacity-50 disabled:hover:bg-transparent'
  return (
    <>
      <Popover>
        <PopoverTrigger asChild><button className={narrowed ? 'bar-btn on' : 'bar-btn'} title={t('Кого показать')} aria-label={t('Кого показать')}><Filter size={15} /></button></PopoverTrigger>
        <PopoverContent side="top" align="start" className="w-72 text-sm flex flex-col gap-1 p-2 max-h-[70vh] overflow-auto">
          <h3 className="text-base font-medium px-1.5">{t('Кого показать')}</h3>
          <button className={row} aria-pressed={!narrowed} onClick={scope.showAll}>{t('Всю семью')}</button>
          {SCOPES.map(([s, label]) => (
            <button key={s} className={row} disabled={!root} aria-pressed={scope.scope === s && scope.rootId === root} onClick={() => scope.show({ scope: s, rootId: root })}>{t(label)}{root && <span className="text-ink-soft truncate">{rootName}</span>}</button>
          ))}
          {!root && <p className="px-1.5 text-xs text-ink-soft">{t('Откройте карточку человека, чтобы показать его ветвь.')}</p>}
          {canFold && <button className={row} onClick={() => scope.toggleCollapse(focusId!)}>{t(scope.collapsed.includes(focusId!) ? 'Показать потомков' : 'Свернуть потомков')}<span className="text-ink-soft truncate">{rootName}</span></button>}
          {scope.views.length > 0 && <h3 className="text-base font-medium px-1.5 mt-2">{t('Сохранённые виды')}</h3>}
          {scope.views.map((v) => (
            <div key={v.id} className="flex items-center gap-1">
              <button className={row} aria-pressed={scope.activeId === v.id} onClick={() => scope.open(v)}><span className="truncate">{v.name}</span></button>
              {canEdit && <button className="bar-btn !h-8 !min-w-8 !p-0" title={`${t('Удалить вид')}: ${v.name}`} aria-label={`${t('Удалить вид')}: ${v.name}`} onClick={() => scope.remove(v.id).catch(fail)}><Trash2 size={14} /></button>}
            </div>
          ))}
          {canEdit && (
            <form className="flex flex-col gap-1 mt-2 px-1.5" onSubmit={(e) => { e.preventDefault(); if (name.trim()) scope.saveAs(name.trim()).then(() => setName('')).catch(fail) }}>
              <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Сохранить этот вид как')}
                <input className="h-9 rounded-lg border border-input bg-white px-2 text-sm text-ink" placeholder={t('Например, мамина ветка')} value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <button className="bar-btn border border-border self-start" disabled={!name.trim()}>{t('Сохранить')}</button>
            </form>
          )}
          {canEdit && Object.keys(scope.pins).length > 0 && <button className={`${row} mt-2`} onClick={() => scope.clearPins().catch(fail)}>{t('Вернуть карточки на их места')}</button>}
        </PopoverContent>
      </Popover>
      {narrowed && (
        <span className="flex items-center gap-1 pl-1.5 text-sm">
          <span className="max-w-48 truncate">{scope.scope === 'all' ? t('Часть ветвей свёрнута') : `${t(SCOPES.find(([s]) => s === scope.scope)![1])}${shownName ? `: ${shownName}` : ''}`}</span>
          <button className="bar-btn !h-7 !min-w-7 !p-0" title={t('Показать всю семью')} aria-label={t('Показать всю семью')} onClick={scope.showAll}><X size={13} /></button>
        </span>
      )}
    </>
  )
}
