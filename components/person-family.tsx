'use client'
import { Plus, X } from 'lucide-react'
import { api, useApp, useWrite } from '@/lib/client'
import { personName, type Certainty, type Person, type Union } from '@/lib/types'
import { Mini } from './person-pickers'
import { Field, CERTAINTY, DateField, Segmented } from './person-fields'

export function FamilyTab({ person }: { person: Person }) {
  const app = useApp()
  const { t, family, byId, graph, canEdit, quickAdd, focus, lang } = app
  const remove = useWrite(({ type, id }: { type: string; id: string }) => api(`relations/${type}/${id}`, { method: 'DELETE' }))
  const setCertainty = useWrite(({ type, id, certainty, kind }: { type: string; id: string; certainty?: string; kind?: string }) => api(`relations/${type}/${id}`, { method: 'PATCH', json: { certainty, kind } }))
  const parents = graph.parentChild.filter((l) => l.childId === person.id)
  const children = graph.parentChild.filter((l) => l.parentId === person.id)
  const unions = graph.unions.filter((u) => u.aId === person.id || u.bId === person.id)
  const siblings = [...new Set((family.parents.get(person.id) ?? []).flatMap((p) => family.children.get(p) ?? []))].filter((s) => s !== person.id)

  const chip = (id: string, onRemove?: () => void, extra?: React.ReactNode) => {
    const p = byId.get(id)
    if (!p) return null
    return (
      <div key={id} className="group flex items-center gap-1.5 rounded-full bg-muted pl-1 pr-2 h-7 max-w-full [&:has(select)]:w-full [&:has(select)]:h-auto [&:has(select)]:flex-wrap [&:has(select)]:rounded-2xl [&:has(select)]:py-1 [&_select]:w-full [&_select]:max-w-full max-sm:flex-wrap max-sm:h-auto max-sm:rounded-2xl max-sm:py-1">
        <button className="flex items-center gap-1.5 shrink-0" onClick={() => focus(id, { center: true })}>
          <Mini person={p} size={22} />
          <span className="whitespace-nowrap">{p.hidden ? t('Живой родственник') : personName(p) || t('Без названия')}</span>
          <span className="text-xs text-ink-faint whitespace-nowrap">{family.relation(person.id, id, lang)?.label}</span>
        </button>
        {extra}
        {canEdit && onRemove && <button className="max-sm:p-2 max-sm:-m-1 max-sm:ml-auto text-ink-faint hover:text-destructive opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity" title={t('Удалить связь')} onClick={onRemove}><X size={12} /></button>}
      </div>
    )
  }
  const kindToggle = (l: { id: string; kind: string; certainty: string }, female: boolean, stepWord = 'отчим или мачеха') => canEdit && (
    <select title={t('Родство')} aria-label={t('Родство')} value={`${l.kind}:${l.certainty}`} className="pick bg-transparent text-xs max-sm:text-sm text-ink-soft min-w-0 max-w-full rounded hover:bg-background" onChange={(e) => {
      const [kind, certainty] = e.target.value.split(':')
      setCertainty.mutate({ type: 'parent', id: l.id, kind, certainty })
    }}>
      {(['birth', 'adopted', 'step'] as const).flatMap((k) => (Object.keys(CERTAINTY) as Certainty[]).map((c) => (
        <option key={`${k}:${c}`} value={`${k}:${c}`}>{t(k === 'birth' ? (female ? 'родная' : 'родной') : k === 'adopted' ? (female ? 'приёмная' : 'приёмный') : stepWord)} · {t(CERTAINTY[c])}</option>
      )))}
    </select>
  )
  const group = (title: string, items: React.ReactNode, add?: [string, string]) => (
    <section className="mb-4">
      <h4 className="text-base font-medium mb-1.5">{t(title)}</h4>
      <div className="flex flex-wrap gap-1.5 items-center">
        {items}
        {canEdit && add && (
          <button className="h-9 px-3 rounded-full border border-dashed border-ink-faint text-ink-soft hover:text-ink hover:border-ink flex items-center gap-1" onClick={() => quickAdd(add[0] as never, person.id)}><Plus size={14} /> {t(add[1])}</button>
        )}
      </div>
    </section>
  )
  return (
    <div className="px-6 py-4 text-sm">
      <datalist id="known-places">{[...new Set(graph.persons.flatMap((p) => [p.birthPlace, p.deathPlace]).concat(graph.unions.map((u) => u.place)).filter(Boolean))].sort().slice(0, 300).map((p) => <option key={p} value={p} />)}</datalist>
      {group('Родители', parents.map((l) => chip(l.parentId, () => remove.mutate({ type: 'parent', id: l.id }), kindToggle(l, byId.get(l.parentId)?.sex === 'F'))), parents.length < 2 ? ['parent', 'Добавить родителя'] : undefined)}
      {group('Супруги', unions.map((u) => (
        <div key={u.id} className="w-full flex flex-col gap-1.5 items-start">
          {chip(u.aId === person.id ? u.bId : u.aId, () => remove.mutate({ type: 'union', id: u.id }))}
          <UnionDetails union={u} />
        </div>
      )), ['spouse', 'Добавить супруга'])}
      {group('Дети', children.map((l) => chip(l.childId, () => remove.mutate({ type: 'parent', id: l.id }), kindToggle(l, byId.get(l.childId)?.sex === 'F', 'пасынок или падчерица'))), ['child', 'Добавить ребёнка'])}
      {siblings.length > 0 && group('Братья и сёстры', siblings.map((s) => chip(s)))}
    </div>
  )
}

/** The marriage itself: which kind, when it began and ended, where. */
function UnionDetails({ union: u }: { union: Union }) {
  const { t, canEdit } = useApp()
  const edit = useWrite((json: Partial<Union>) => api(`relations/union/${u.id}`, { method: 'PATCH', json }))
  const ro = !canEdit
  // "?" keeps an ended union whose date nobody knows.
  const ended = !!u.endDate
  if (ro && !u.startDate && !u.endDate && !u.place) return null
  return (
    <div className="pl-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 items-center justify-items-start w-full">
      <span className="text-ink-soft">{t('Отношения')}</span>
      <Segmented label={t('Отношения')} disabled={ro} value={u.kind} onChange={(kind) => edit.mutate({ kind })} options={[['marriage', t('Брак')], ['civil', t('Без регистрации брака')]]} />
      <span className="text-ink-soft">{t('Начало')}</span>
      <DateField readOnly={ro} value={u.startDate} placeholder={t('например, 1945')} onSave={(startDate) => edit.mutate({ startDate })} />
      <span className="text-ink-soft">{t('Место')}</span>
      <Field list="known-places" className="!w-full" readOnly={ro} value={u.place} placeholder={t('например, Пермь')} onSave={(place) => edit.mutate({ place })} />
      {!ro && (
        <label className="col-span-2 flex items-center gap-2 cursor-pointer min-h-7">
          <input type="checkbox" className="accent-[var(--ink)] size-4" checked={ended} onChange={(e) => edit.mutate({ endDate: e.target.checked ? '?' : '' })} />
          {t('Расстались')}
        </label>
      )}
      {ended && (
        <>
          <span className="text-ink-soft">{t('Конец')}</span>
          <DateField readOnly={ro} value={u.endDate === '?' ? '' : u.endDate} placeholder={ro ? t('дата неизвестна') : t('например, 1960')} onSave={(endDate) => edit.mutate({ endDate: endDate || '?' })} />
        </>
      )}
    </div>
  )
}
