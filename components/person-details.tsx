'use client'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useApp } from '@/lib/client'
import { accept, addVersion, editValue, hasConflict, NAME_FIELDS, reject, RELIABILITY, restore, setSource, sourceOf, summary, versions, type ClaimPatch } from '@/lib/claims'
import { listWriter } from '@/lib/list-writes'
import { ageWords } from '@/lib/names'
import { cn } from '@/lib/utils'
import { type Fact, type ClaimField, type Person, type Reliability, type Source } from '@/lib/types'
import { Field, TagInput, DateField, Segmented } from './person-fields'

/** One dated fact: what happened, when, where, a note and where it is known from. Saved when the field loses focus. */
function FactRow({ fact, readOnly, fresh, onChange, onRemove }: { fact: Fact; readOnly: boolean; fresh: boolean; onChange: (f: Fact) => void; onRemove: () => void }) {
  const { t } = useApp()
  const [f, setF] = useState(fact)
  useEffect(() => setF(fact), [fact])
  const commit = () => { if (JSON.stringify(f) !== JSON.stringify(fact)) onChange(f) }
  const field = (key: keyof Fact, placeholder: string, cls: string, list?: string, auto?: boolean) => (
    <input value={f[key] ?? ''} readOnly={readOnly} autoFocus={auto} list={list} placeholder={readOnly ? '' : t(placeholder)} aria-label={t(placeholder)} onChange={(e) => setF({ ...f, [key]: e.target.value })} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} className={cn('inline-input min-w-0', cls)} />
  )
  const row = (label: string, key: keyof Fact, placeholder: string, list?: string, auto?: boolean) => (!readOnly || f[key]) && (
    <>
      <span className="text-xs text-ink-faint">{t(label)}</span>
      {field(key, placeholder, 'text-ink', list, auto)}
    </>
  )
  return (
    <div className="group relative rounded-md border border-border px-2.5 py-1.5 flex flex-col gap-1">
      <div className="pr-5">{field('kind', 'Что произошло', 'font-medium', 'fact-kinds', fresh && !fact.kind)}</div>
      <div className="grid grid-cols-[64px_1fr] gap-x-2 gap-y-0.5 items-baseline">
        {row('Когда', 'date', 'например, 1912', undefined, fresh && !!fact.kind)}
        {row('Где', 'place', 'например, Пермь', 'known-places')}
        {row('Заметка', 'note', 'подробности')}
        {row('Источник', 'source', 'документ, архив, чей рассказ')}
      </div>
      {!readOnly && <button aria-label={t('Удалить')} title={t('Удалить')} className="absolute right-1.5 top-1.5 p-0.5 max-sm:p-2 max-sm:right-0 max-sm:top-0 opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100 text-ink-faint hover:text-destructive" onClick={onRemove}><X size={13} /></button>}
    </div>
  )
}

/** Common kinds of fact, one click each, so the same wording is reused and GEDCOM gets its tags. */
const FACT_KINDS = ['Профессия', 'Место жительства', 'Образование', 'Служба', 'Награда', 'Переезд', 'Крещение', 'Погребение', 'Причина смерти', 'Вероисповедание', 'Национальность']

/** Where genealogical records usually come from; the kind fills the title in one click. */
const SOURCE_RELIABILITY: Record<string, Reliability> = { 'Метрическая книга': 'original', 'Перепись': 'original', 'Архив ЗАГС': 'original', 'Военный архив': 'original', 'Семейный документ': 'original', 'Рассказ родных': 'witness' }

const SOURCE_KINDS = ['Метрическая книга', 'Перепись', 'Архив ЗАГС', 'Военный архив', 'Семейный документ', 'Рассказ родных', '']

/** One source: where it is, its reference, the sheet and a link. Saved when a field loses focus. */
function SourceRow({ source, readOnly, fresh, onChange, onRemove }: { source: Source; readOnly: boolean; fresh: boolean; onChange: (s: Source) => void; onRemove: () => void }) {
  const { t } = useApp()
  const [s, setS] = useState(source)
  // A family account has no archive reference to ask for.
  const personal = [t('Рассказ родных'), t('Семейный документ')].includes(s.title)
  useEffect(() => setS(source), [source])
  const commit = () => { if (JSON.stringify(s) !== JSON.stringify(source)) onChange(s) }
  const field = (key: keyof Source, placeholder: string, cls: string, auto?: boolean) => (
    <input value={s[key]} readOnly={readOnly} autoFocus={auto} placeholder={readOnly ? '' : t(placeholder)} aria-label={t(placeholder)} onChange={(e) => setS({ ...s, [key]: e.target.value })} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} className={cn('inline-input min-w-0', cls)} />
  )
  const row = (label: string, key: keyof Source, placeholder: string, auto?: boolean) => (!readOnly || s[key]) && (
    <>
      <span className="text-xs text-ink-faint">{t(label)}</span>
      {readOnly && key === 'url' && /^https?:\/\//.test(s.url) ? <a href={s.url} target="_blank" rel="noreferrer noopener" className="underline truncate">{s.url}</a> : field(key, placeholder, 'text-ink', auto)}
    </>
  )
  return (
    <div className="group relative rounded-md border border-border px-2.5 py-1.5 flex flex-col gap-1">
      <div className="pr-5">{field('title', 'Название источника', 'font-medium', fresh && !source.title)}</div>
      <div className="grid grid-cols-[64px_1fr] gap-x-2 gap-y-0.5 items-baseline">
        <span className="text-xs text-ink-faint">{t('Что это')}</span>
        {readOnly
          ? <span className="text-ink-soft">{t(RELIABILITY[s.reliability ?? 'copy'])}</span>
          : <select aria-label={t('Что это')} value={s.reliability ?? 'copy'} onChange={(e) => { const next = { ...s, reliability: e.target.value as Reliability }; setS(next); onChange(next) }} className="pick bg-transparent text-ink rounded hover:bg-muted max-w-full">{(Object.keys(RELIABILITY) as Reliability[]).map((r) => <option key={r} value={r}>{t(RELIABILITY[r])}</option>)}</select>}
        {row(personal ? 'Подробнее' : 'Шифр', 'ref', personal ? 'кто рассказал или где хранится' : 'фонд, опись, дело', fresh && !!source.title)}
        {!personal && row('Лист', 'page', 'например, 12')}
        {row('Ссылка', 'url', 'https://…')}
      </div>
      {!readOnly && <button aria-label={t('Удалить')} title={t('Удалить')} className="absolute right-1.5 top-1.5 p-0.5 max-sm:p-2 max-sm:right-0 max-sm:top-0 opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100 text-ink-faint hover:text-destructive" onClick={onRemove}><X size={13} /></button>}
    </div>
  )
}

const NAME_LABELS: Partial<Record<ClaimField, string>> = { givenName: 'Имя', patronymic: 'Отчество', surname: 'Фамилия', maidenName: 'Девичья фамилия' }

const REJECT_REASONS = ['опечатка', 'другой человек', 'опровергнуто документом']

/** Under a value: where it comes from and whether others disagree. A click opens all its versions. */
function Versions({ person, field, current, change, attach }: { person: Person; field: ClaimField; current: () => Person; change: (p: ClaimPatch) => void; attach: (s: Source) => void }) {
  const { t, canEdit, graph } = useApp()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const list = versions(person, field)
  if (!list.length && (!canEdit || !(person as unknown as Record<string, unknown>)[field])) return <span />
  const main = list.find((c) => c.status === 'accepted')
  const mainSource = main && sourceOf(person, main)
  const conflict = hasConflict(person, field)
  const others = list.filter((c) => c.status === 'possible').length
  // Sources from every card, so one document serves everyone it names.
  const known = [...new Map([...person.sources, ...graph.persons.flatMap((p) => p.sources)].filter((s) => s.id).map((s) => [s.id!, s])).values()]
  const pick = (id: string, then: (sourceId: string | null) => void) => {
    const s = known.find((x) => x.id === id)
    if (s) attach(s)
    then(id || null)
  }
  const sourceSelect = (selected: string | null, onPick: (id: string | null) => void) => (
    <select aria-label={t('Источник')} value={selected ?? ''} onChange={(e) => pick(e.target.value, onPick)} className="pick bg-transparent text-xs text-ink-soft rounded hover:bg-muted min-w-0 max-w-full truncate">
      <option value="">{t('Указать источник')}</option>
      {known.map((s) => <option key={s.id} value={s.id}>{s.title || t('Без названия')}</option>)}
    </select>
  )
  const unclaimedName = NAME_FIELDS.includes(field) && !person.claims.some((c) => c.field === field)
  const sourceWord = field.endsWith('Date') ? 'Откуда известна дата' : field.endsWith('Place') ? 'Откуда известно место' : 'Указать источник'
  const otherWord = field.endsWith('Date') ? 'Другая дата' : field.endsWith('Place') ? 'Другое место' : 'Добавить другой вариант'
  const label = conflict ? `⚠ ${mainSource?.title ?? t('Указать источник')} +${others}` : mainSource ? `${mainSource.title}${others ? ` +${others}` : ''}` : unclaimedName || main ? t(sourceWord) : t(otherWord)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={cn('text-left text-xs -mt-1.5 max-sm:mt-0 min-w-0 rounded underline underline-offset-2 hover:text-ink', conflict ? 'text-destructive' : main && !mainSource ? 'text-ink-faint' : 'text-ink-soft')}>{label}</button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(320px,calc(100vw-32px))] p-2.5 text-sm flex flex-col gap-2">
        {list.map((c) => {
          const source = sourceOf(person, c)
          const off = c.status === 'rejected'
          return (
            <div key={c.id} className={cn('rounded-md border border-border px-2 py-1.5 flex flex-col gap-1', off && 'opacity-60')}>
              <label className="flex items-center gap-2 min-w-0">
                {!off && canEdit && <input type="radio" name={`main-${field}`} className="accent-[var(--ink)] size-4 flex-none" checked={c.status === 'accepted'} aria-label={t('Основное значение')} onChange={() => change(accept(current(), field, c.id))} />}
                <span className={cn('truncate', off ? 'line-through' : 'font-medium')}>{c.value}</span>
                <span className="ml-auto flex-none text-xs text-ink-faint">{t(off ? 'отвергнуто' : c.status === 'accepted' ? 'основное' : 'возможно')}</span>
              </label>
              {off && c.reason && <span className="text-xs text-ink-soft">{t('Причина')}: {c.reason}</span>}
              <div className="flex flex-wrap items-center gap-x-2 min-w-0 text-xs text-ink-soft">
                {canEdit && !off ? sourceSelect(c.sourceId, (id) => change(setSource(current(), field, c.id, id))) : <span className="truncate">{source?.title ?? t('Указать источник')}</span>}
                {source && <span className="flex-none text-ink-faint">{t(RELIABILITY[source.reliability ?? 'copy'])}</span>}
                {canEdit && (off
                  ? <button className="pick ml-auto flex-none hover:text-ink" onClick={() => change(restore(current(), field, c.id))}>{t('Вернуть')}</button>
                  : <button className="pick ml-auto flex-none hover:text-destructive" onClick={() => setRejecting(rejecting === c.id ? null : c.id)}>{t('Отвергнуть')}</button>)}
              </div>
              {rejecting === c.id && (
                <div className="flex flex-wrap gap-1">
                  {REJECT_REASONS.map((r) => <button key={r} className="pick rounded-full bg-muted px-2 h-6 text-xs hover:text-ink" onClick={() => { change(reject(current(), field, c.id, t(r))); setRejecting(null) }}>{t(r)}</button>)}
                </div>
              )}
            </div>
          )
        })}
        {canEdit && (
          <form className="flex flex-col gap-1.5" onSubmit={(e) => { e.preventDefault(); const v = value.trim(); if (!v) return; change(addVersion(current(), field, v, pending)); setValue(''); setPending(null) }}>
            <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={t('Другая версия значения')} aria-label={t('Другая версия значения')} className="h-9 rounded-md border border-input bg-white px-2" />
            <div className="flex items-center gap-2 min-w-0">
              {sourceSelect(pending, setPending)}
              <button className="bar-btn border border-border ml-auto flex-none" disabled={!value.trim()}>{t('Добавить')}</button>
            </div>
            {!known.length && <p className="text-xs text-ink-faint">{t('Источники добавляются ниже, в разделе «Источники»')}</p>}
          </form>
        )}
      </PopoverContent>
    </Popover>
  )
}

export function Details({ person, patch: send }: { person: Person; patch: (p: Partial<Person>) => Promise<unknown> }) {
  const { t, canEdit, graph, lang, notify } = useApp()
  const ro = !canEdit
  const writer = useRef(listWriter({ facts: person.facts, sources: person.sources, tags: person.tags, claims: person.claims }, send, (e) => { if (![404, 409].includes((e as { status?: number }).status ?? 0)) notify(`${t('Не удалось сохранить')}: ${(e as Error).message}`) })).current
  useEffect(() => writer.sync({ facts: person.facts, sources: person.sources, tags: person.tags, claims: person.claims }), [writer, person.facts, person.sources, person.tags, person.claims])
  /** The person as the next change must see it: lists as last written. */
  const current = (): Person => ({ ...person, claims: writer.get('claims'), sources: writer.get('sources') })
  const change = (patch: ClaimPatch) => writer.merge(patch)
  const saveClaimField = (field: ClaimField) => (v: string) => change(editValue(current(), field, v))
  const patch = writer.write as (p: Partial<Person>) => void
  const edit = writer.edit
  const save = (key: keyof Person) => (v: string) => patch({ [key]: v })
  const [fresh, setFresh] = useState(-1)
  const [freshSource, setFreshSource] = useState(-1)
  const places = useMemo(() => [...new Set(graph.persons.flatMap((p) => [p.birthPlace, p.deathPlace, ...p.facts.map((f) => f.place)]).concat(graph.unions.map((u) => u.place)).filter(Boolean))].sort().slice(0, 300), [graph])
  const alive = person.living
  const now = new Date().getFullYear()
  const age = person.birthYear ? (alive ? now : person.deathYear) : null
  const years = person.birthYear && age ? age - person.birthYear : null
  const badOrder = !!(person.birthYear && person.deathYear && person.deathYear < person.birthYear)
  const tooOld = alive && !!person.birthYear && now - person.birthYear > 110
  const f = person.sex === 'F', u = person.sex === 'U'
  const card = summary(person)
  /** A source found on another person's card is the same document: it joins this card too. */
  const attachSource = (source: Source) => {
    if (!writer.get('sources').some((x) => x.id === source.id)) writer.merge({ sources: [...writer.get('sources'), source] })
  }

  return (
    <div className="px-4 pb-5 flex flex-col gap-4 text-sm">
      <datalist id="fact-kinds">{FACT_KINDS.map((k) => <option key={k} value={t(k)} />)}</datalist>
      <datalist id="known-places">{places.map((p) => <option key={p} value={p} />)}</datalist>

      {(card.documented + card.told + card.conflict > 0) && (
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
          {card.conflict > 0 && <span className="text-destructive">⚠ {t('расхождений')}: {card.conflict}</span>}
          {card.documented > 0 && <span className="text-ink-soft">{t('по документу')}: {card.documented}</span>}
          {card.told > 0 && <span className="text-ink-soft">{t('со слов')}: {card.told}</span>}
        </p>
      )}

      <dl className="grid grid-cols-[104px_1fr_1fr] max-sm:grid-cols-2 gap-x-3 max-sm:gap-x-2 gap-y-2 items-center">
        <dt className="text-ink-soft max-sm:col-span-2 max-sm:-mb-1">{t('Пол')}</dt>
        <dd className="col-span-2 max-sm:col-span-2"><Segmented id="f-sex" label={t('Пол')} disabled={ro} value={person.sex} onChange={(sex) => patch({ sex })} options={[['M', t('Мужской')], ['F', t('Женский')], ['U', t('Неизвестно')]]} /></dd>

        <dt className="text-ink-soft max-sm:col-span-2 max-sm:-mb-1">{t('Жив или нет')}</dt>
        <dd className="col-span-2 max-sm:col-span-2 flex flex-wrap items-center gap-2">
          <Segmented label={t('Жив или нет')} disabled={ro} value={alive ? 'alive' : 'dead'} onChange={(v) => { patch({ living: v === 'alive' }); if (v === 'dead') setTimeout(() => document.getElementById('f-death-date')?.focus(), 80) }} options={[['alive', t(u ? 'Жив(а)' : f ? 'Жива' : 'Жив')], ['dead', t(u ? 'Умер(ла)' : f ? 'Умерла' : 'Умер')]]} />
          {years !== null && years >= 0 && <span className="text-ink-soft">{alive ? ageWords(years, lang) : `${t('Возраст при смерти')}: ${ageWords(years, lang)}`}</span>}
        </dd>

        <span className="max-sm:hidden" />
        <span className="text-xs text-ink-soft max-sm:hidden">{t('Дата')}</span>
        <span className="text-xs text-ink-soft max-sm:hidden">{t('Место')}</span>

        <dt className="text-ink-soft max-sm:col-span-2 max-sm:-mb-1">{t('Рождение')}</dt>
        <span className="text-xs text-ink-soft sm:hidden -mb-1.5">{t('Дата')}</span>
        <span className="text-xs text-ink-soft sm:hidden -mb-1.5">{t('Место')}</span>
        <DateField id="f-birth-date" readOnly={ro} value={person.birthDate} placeholder={t('например, 1890')} onSave={saveClaimField('birthDate')} />
        <Field id="f-birth-place" list="known-places" readOnly={ro} value={person.birthPlace} placeholder={t('например, Пермь')} onSave={saveClaimField('birthPlace')} />
        <span className="max-sm:hidden" />
        <Versions person={person} field="birthDate" current={current} change={change} attach={attachSource} />
        <Versions person={person} field="birthPlace" current={current} change={change} attach={attachSource} />

        {!alive && (
          <>
            <dt className="text-ink-soft max-sm:col-span-2 max-sm:-mb-1">{t('Смерть')}</dt>
        <span className="text-xs text-ink-soft sm:hidden -mb-1.5">{t('Дата')}</span>
        <span className="text-xs text-ink-soft sm:hidden -mb-1.5">{t('Место')}</span>
            <DateField id="f-death-date" readOnly={ro} value={person.deathDate} placeholder={t('например, 1950')} onSave={saveClaimField('deathDate')} />
            <Field id="f-death-place" list="known-places" readOnly={ro} value={person.deathPlace} placeholder={t('например, Пермь')} onSave={saveClaimField('deathPlace')} />
            <span className="max-sm:hidden" />
            <Versions person={person} field="deathDate" current={current} change={change} attach={attachSource} />
            <Versions person={person} field="deathPlace" current={current} change={change} attach={attachSource} />
          </>
        )}

        {(person.otherNames || !ro) && (
          <>
            <dt className="text-ink-soft max-sm:col-span-2 max-sm:-mb-1">{t('Другие имена')}</dt>
            <dd className="col-span-2 max-sm:col-span-2"><Field readOnly={ro} value={person.otherNames} placeholder={t('прозвище, имя в крещении')} onSave={save('otherNames')} /></dd>
          </>
        )}

      </dl>

      {(canEdit || person.claims.some((c) => NAME_LABELS[c.field])) && (
        <details open={NAME_FIELDS.some((f) => hasConflict(person, f))} className="text-sm">
          <summary className="cursor-pointer text-base font-medium min-h-6">{t('Откуда известно имя')}</summary>
          <div className="grid grid-cols-[104px_1fr_1fr] max-sm:grid-cols-2 gap-x-3 gap-y-1 items-center mt-1">
            {NAME_FIELDS.filter((f) => person[f as keyof Person]).map((f) => (
              <Fragment key={f}>
                <span className="text-ink-soft">{t(NAME_LABELS[f]!)}</span>
                <span className="truncate">{String(person[f as keyof Person])}</span>
                <Versions person={person} field={f} current={current} change={change} attach={attachSource} />
              </Fragment>
            ))}
          </div>
        </details>
      )}

      {badOrder && <p role="alert" className="text-xs text-destructive">{t('Дата смерти раньше даты рождения: проверьте годы')}</p>}
      {tooOld && canEdit && <p className="text-xs text-ink-soft">{t('Больше 110 лет.')} <button className="underline hover:text-ink" onClick={() => patch({ living: false })}>{t('Отметить как умершего')}</button></p>}

      {(person.facts.length > 0 || !ro) && (
        <section className="flex flex-col gap-1.5">
          <h4 className="text-base font-medium">{t('Факты')}</h4>
          {person.facts.map((fact, i) => (
            <FactRow
              key={i}
              fact={fact}
              readOnly={ro}
              fresh={fresh === i}
              onChange={(next) => edit('facts', (list) => list.map((x, j) => (j === i ? next : x)))}
              onRemove={() => edit('facts', (list) => list.filter((_, j) => j !== i))}
            />
          ))}
          {!ro && (
            <select aria-label={t('Добавить факт')} value="" className="h-9 max-w-64 rounded-full border border-dashed border-ink-faint bg-transparent px-3 text-sm text-ink-soft" onChange={(e) => { if (!e.target.value) return; const k = e.target.value === '__other' ? '' : e.target.value; setFresh(writer.get('facts').length); edit('facts', (list) => [...list, { kind: k && t(k), date: '', place: '', note: '', source: '' }]) }}>
              <option value="">+ {t('Добавить факт')}</option>
              {FACT_KINDS.map((k) => <option key={k} value={k}>{t(k)}</option>)}
              <option value="__other">{t('Другое')}</option>
            </select>
          )}
        </section>
      )}

      {(person.sources.length > 0 || !ro) && (
        <section className="flex flex-col gap-1.5">
          <h4 id="f-sources" tabIndex={-1} className="text-base font-medium">{t('Источники')}</h4>
          {person.sources.map((source, i) => (
            <SourceRow
              key={i}
              source={source}
              readOnly={ro}
              fresh={freshSource === i}
              onChange={(next) => edit('sources', (list) => list.map((x, j) => (j === i ? next : x)))}
              onRemove={() => edit('sources', (list) => list.filter((_, j) => j !== i))}
            />
          ))}
          {!ro && (
            <select aria-label={t('Добавить источник')} value="" className="h-9 max-w-64 rounded-full border border-dashed border-ink-faint bg-transparent px-3 text-sm text-ink-soft" onChange={(e) => { const k = e.target.value === '__blank' ? '' : e.target.value; if (!e.target.value) return;  setFreshSource(writer.get('sources').length); edit('sources', (list) => [...list, { id: Math.random().toString(36).slice(2, 10), title: k && t(k), ref: '', page: '', url: '', reliability: SOURCE_RELIABILITY[k] ?? 'copy' }])  }}>
              <option value="">+ {t('Добавить источник')}</option>
              {SOURCE_KINDS.map((k) => <option key={k} value={k || '__blank'}>{k ? t(k) : t('Другой источник')}</option>)}
            </select>
          )}
        </section>
      )}

      {(person.tags.length > 0 || !ro) && (
        <section className="flex flex-col gap-1.5">
          <h4 className="text-base font-medium">{t('Группы')}</h4>
          {!ro && <p className="text-xs text-ink-soft">{t('Например: родня по отцу. Помогает показывать людей вместе.')}</p>}
          <div className="flex flex-wrap gap-1.5 items-center">
            {person.tags.map((tag) => (
              <span key={tag} className="flex items-center gap-1 rounded-full bg-muted pl-2.5 pr-1.5 h-6 text-xs">
                {tag}
                {!ro && <button aria-label={t('Удалить')} className="text-ink-faint hover:text-destructive" onClick={() => edit('tags', (list) => list.filter((x) => x !== tag))}><X size={11} /></button>}
              </span>
            ))}
            {!ro && <TagInput existing={person.tags} onAdd={(tag) => edit('tags', (list) => [...list, tag])} />}
          </div>
        </section>
      )}
    </div>
  )
}
