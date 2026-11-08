'use client'
import dynamic from 'next/dynamic'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useApp } from '@/lib/client'
import { accept, addVersion, editValue, hasConflict, NAME_FIELDS, reject, RELIABILITY, restore, setSource, sourceOf, summary, versions, type ClaimPatch } from '@/lib/claims'
import { lifeEvents } from '@/lib/family-dates'
import { listWriter } from '@/lib/list-writes'
import { SwitchRow } from '@/components/ui/switch'
import { ageWords } from '@/lib/names'
import { cn } from '@/lib/utils'
import { personName, shownTags, yearOf, type Fact, type FactPerson, type ClaimField, type Person, type Reliability, type Source } from '@/lib/types'
import { fieldsFor, firstRole, ROLES } from '@/lib/fact-kinds'
import { PersonPopover } from './person-pickers'
import { ContactsBlock, PlaceHint } from './person-extras'
import { useRepositories } from './places-tab'
import { AddMenu, Field, GrowText, Hints, OpenAddress, ReadText, TagInput, DateField, Segmented } from './person-fields'
import { Select } from '@/components/ui/select'
import { inputClass } from '@/components/ui/input'

const MergeDialog = dynamic(() => import('./merge-dialog').then((m) => m.MergeDialog), { ssr: false })

/** One dated fact: what happened, when, where, a note and where it is known from. Saved when the field loses focus. */
function FactRow({ fact, readOnly, fresh, kinds, places, onChange, onRemove }: { fact: Fact; readOnly: boolean; fresh: boolean; kinds: string[]; places: string[]; onChange: (f: Fact) => void; onRemove: () => void }) {
  const { t } = useApp()
  const [f, setF] = useState(fact)
  const [editing, setEditing] = useState<TextKey | null>(null)
  useEffect(() => setF(fact), [fact])
  const extra = fieldsFor(f.kind, t)
  const commit = (next = f) => { if (JSON.stringify(next) !== JSON.stringify(fact)) onChange(next) }
  const field = (key: TextKey, placeholder: string, cls: string, known?: string[], auto?: boolean) => {
    const value = f[key] ?? ''
    if (readOnly) return <ReadText value={value} className={cls} />
    const typed = value.trim().toLowerCase()
    const hints = editing === key && typed && known ? known.filter((x) => x.toLowerCase().includes(typed) && x.toLowerCase() !== typed).slice(0, 5) : []
    return (
      <span className="relative flex items-start gap-1 min-w-0">
        <GrowText value={value} autoFocus={auto} placeholder={t(placeholder)} aria-label={t(placeholder)} className={cls} onChange={(e) => setF({ ...f, [key]: e.target.value })} onFocus={() => setEditing(key)} onBlur={() => { setEditing(null); commit() }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }} />
        <OpenAddress value={value} />
        {hints.length > 0 && <Hints items={hints} onPick={(x) => { const next = { ...f, [key]: x }; setF(next); commit(next) }} />}
      </span>
    )
  }
  if (readOnly) {
    return (
      <div className="min-w-0 border-l-2 border-border pl-2.5 py-0.5 flex flex-col gap-0.5">
        <span className="break-anywhere font-medium">{[f.date, f.kind].filter(Boolean).join(' · ')}</span>
        {f.place && <ReadText value={f.place} className="text-ink-soft" />}
        {f.note && <ReadText value={f.note} />}
        {Object.entries(f.fields ?? {}).filter(([, v]) => v).map(([k, v]) => <span key={k} className="break-anywhere"><span className="text-ink-soft">{t(k)}:</span> {v}</span>)}
        {(f.people ?? []).filter((x) => x.name).map((x, i) => <Participant key={i} person={x} />)}
        {f.source && <span className="text-xs text-ink-soft break-anywhere">{t('Источник')}: <ReadText value={f.source} /></span>}
      </div>
    )
  }
  const row = (label: string, key: TextKey, placeholder: string, known?: string[], auto?: boolean) => (!readOnly || f[key]) && (
    <>
      <span className="text-xs text-ink-faint">{t(label)}</span>
      {field(key, placeholder, 'text-ink', known, auto)}
    </>
  )
  return (
    <div className="group relative rounded-md border border-border px-2.5 py-1.5 flex flex-col gap-1 min-w-0">
      <div className="pr-6 max-sm:pr-9">{field('kind', 'Что произошло', 'font-medium', kinds, fresh && !fact.kind)}</div>
      <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-2 gap-y-0.5 items-baseline">
        {row('Когда', 'date', 'например, 1912', undefined, fresh && !!fact.kind)}
        {row('Где', 'place', 'например, Пермь', places)}
        {extra.map((k) => (
          <Fragment key={k}>
            <span className="text-xs text-ink-faint">{t(k)}</span>
            <GrowText value={f.fields?.[k] ?? ''} placeholder={t(k)} aria-label={t(k)} className="text-ink" onChange={(e) => setF({ ...f, fields: { ...f.fields, [k]: e.target.value } })} onBlur={() => commit()} />
          </Fragment>
        ))}
        {row('Заметка', 'note', 'подробности')}
        {row('Источник', 'source', 'документ, архив, чей рассказ')}
      </div>
      <People fact={f} onChange={(people) => { const next = { ...f, people }; setF(next); commit(next) }} />
      {!readOnly && <RowRemove onRemove={onRemove} />}
    </div>
  )
}

type TextKey = 'kind' | 'date' | 'place' | 'note' | 'source'

/** Someone at the event: a card to open when there is one, otherwise the name as the record gives it. */
function Participant({ person }: { person: FactPerson }) {
  const { t, byId, focus } = useApp()
  const card = person.personId ? byId.get(person.personId) : null
  const name = (card && !card.hidden && personName(card)) || person.name
  return (
    <span className="break-anywhere">
      <span className="text-ink-soft">{t(person.role)}:</span>{' '}
      {card ? <button className="pick underline underline-offset-2 hover:text-ink" onClick={() => focus(card.id, { center: true })}>{name}</button> : name}
    </span>
  )
}

/** Godparents, witnesses, the priest: each with a role, a card if they have one, or only a name. */
function People({ fact, onChange }: { fact: Fact; onChange: (people: FactPerson[]) => void }) {
  const { t, byId } = useApp()
  const list = fact.people ?? []
  const set = (i: number, patch: Partial<FactPerson>) => onChange(list.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const roles = [...new Set([...ROLES.map((r) => t(r)), ...list.map((x) => x.role)])].map((r) => ({ value: r, label: r }))
  return (
    <div className="flex flex-col gap-1">
      {list.map((x, i) => {
        const card = x.personId ? byId.get(x.personId) : null
        return (
          <div key={i} className="flex flex-wrap items-center gap-1.5 min-w-0 text-sm">
            <Select look="small" className="!w-auto" aria-label={t('Роль')} value={x.role} onChange={(role) => set(i, { role })} options={roles} />
            {card
              ? <span className="min-w-0 break-anywhere">{personName(card) || t('Без названия')}</span>
              : <GrowText value={x.name} placeholder={t('Имя, как в записи')} aria-label={t('Имя, как в записи')} className="min-w-[8rem] flex-1" onChange={(e) => set(i, { name: e.target.value })} />}
            <PersonPopover onPick={(id) => { const p = byId.get(id); set(i, { personId: id, name: p ? personName(p) : x.name }) }}>
              <button type="button" className="text-xs text-ink-soft underline underline-offset-2 hover:text-ink">{t(card ? 'Другая карточка' : 'Выбрать карточку')}</button>
            </PersonPopover>
            <button type="button" aria-label={t('Убрать участника')} title={t('Убрать участника')} className="ml-auto grid size-6 place-items-center text-ink-faint hover:text-destructive" onClick={() => onChange(list.filter((_, j) => j !== i))}><X size={13} /></button>
          </div>
        )
      })}
      <button type="button" className="self-start text-xs text-ink-soft underline underline-offset-2 hover:text-ink" onClick={() => onChange([...list, { personId: null, name: '', role: firstRole(fact.kind, t) }])}>+ {t('участник')}</button>
    </div>
  )
}

/** Only on hover where there is hover; a finger always sees it. */
function RowRemove({ onRemove }: { onRemove: () => void }) {
  const { t } = useApp()
  return <button aria-label={t('Удалить')} title={t('Удалить')} className="absolute right-0.5 top-0.5 grid place-items-center size-6 opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100 text-ink-faint hover:text-destructive" onClick={onRemove}><X size={13} /></button>
}

/** Common kinds of fact, one click each, so the same wording is reused and GEDCOM gets its tags. */
const FACT_KINDS = ['Профессия', 'Место жительства', 'Образование', 'Крещение', 'Воинская служба', 'Служба', 'Награда', 'Ранение', 'Плен', 'Переезд', 'Сословие', 'Титул', 'Членство', 'Языки', 'Внешность', 'Вероисповедание', 'Национальность', 'Погребение', 'Причина смерти']

/** Where genealogical records usually come from; the kind fills the title in one click. */
const SOURCE_RELIABILITY: Record<string, Reliability> = { 'Метрическая книга': 'original', 'Перепись': 'original', 'Архив ЗАГС': 'original', 'Военный архив': 'original', 'Семейный документ': 'original', 'Рассказ родных': 'witness' }

const SOURCE_KINDS = ['Метрическая книга', 'Перепись', 'Архив ЗАГС', 'Военный архив', 'Семейный документ', 'Рассказ родных', '']

/** One source: where it is, its reference, the sheet and a link. Saved when a field loses focus. */
function SourceRow({ source, readOnly, fresh, onChange, onRemove }: { source: Source; readOnly: boolean; fresh: boolean; onChange: (s: Source) => void; onRemove: () => void }) {
  const { t } = useApp()
  const [s, setS] = useState(source)
  // A family account has no archive reference to ask for.
  const personal = [t('Рассказ родных'), t('Семейный документ')].includes(s.title)
  const { data: repos = [] } = useRepositories()
  const repoName = repos.find((r) => r.id === s.repositoryId)?.name ?? ''
  useEffect(() => setS(source), [source])
  const commit = () => { if (JSON.stringify(s) !== JSON.stringify(source)) onChange(s) }
  const field = (key: keyof Source, placeholder: string, cls: string, auto?: boolean) => (readOnly
    ? <ReadText value={String(s[key] ?? '')} className={cls} />
    : (
      <span className="flex items-start gap-1 min-w-0">
        <GrowText value={String(s[key] ?? '')} autoFocus={auto} placeholder={t(placeholder)} aria-label={t(placeholder)} className={cls} onChange={(e) => setS({ ...s, [key]: e.target.value })} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }} />
        <OpenAddress value={String(s[key] ?? '')} />
      </span>
    ))
  const row = (label: string, key: keyof Source, placeholder: string, auto?: boolean) => (!readOnly || s[key]) && (
    <>
      <span className="text-xs text-ink-faint">{t(label)}</span>
      {field(key, placeholder, 'text-ink', auto)}
    </>
  )
  return (
    <div className="group relative rounded-md border border-border px-2.5 py-1.5 flex flex-col gap-1 min-w-0">
      <div className="pr-6 max-sm:pr-9">{field('title', 'Название источника', 'font-medium', fresh && !source.title)}</div>
      <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-2 gap-y-0.5 items-baseline">
        <span className="text-xs text-ink-faint">{t('Что это')}</span>
        {readOnly
          ? <span className="text-ink-soft">{t(RELIABILITY[s.reliability ?? 'copy'])}</span>
          : <Select look="quiet" aria-label={t('Что это')} value={s.reliability ?? 'copy'} onChange={(v) => { const next = { ...s, reliability: v as Reliability }; setS(next); onChange(next) }} options={Object.entries(RELIABILITY).map(([k, v]) => ({ value: k, label: t(v) }))} />}
        {row(personal ? 'Подробнее' : 'Шифр', 'ref', personal ? 'кто рассказал или где хранится' : 'фонд, опись, дело', fresh && !!source.title)}
        {!personal && row('Лист', 'page', 'например, 12')}
        {row('Ссылка', 'url', 'https://…')}
        {!personal && row('Запись', 'record', 'номер записи, строка')}
        {row('Дата документа', 'date', 'когда составлен')}
        {!personal && (repoName || !readOnly) && (
          <>
            <span className="text-xs text-ink-faint">{t('Архив')}</span>
            {readOnly
              ? <span className="text-ink-soft break-anywhere">{repoName}</span>
              : <Select look="quiet" aria-label={t('Архив')} value={s.repositoryId ?? ''} onChange={(v) => { const next = { ...s, repositoryId: v || undefined }; setS(next); onChange(next) }} options={[{ value: '', label: repos.length ? t('Не выбран') : t('Архивы добавляются в «Даты, места и архивы»') }, ...repos.map((r) => ({ value: r.id, label: r.name }))]} />}
          </>
        )}
      </div>
      {(s.transcription || !readOnly) && (
        <details className="text-sm" open={!!s.transcription && readOnly}>
          <summary className="cursor-pointer text-xs text-ink-faint">{t('Расшифровка записи')}{s.transcription ? '' : ` (${t('пусто')})`}</summary>
          {readOnly
            ? <p className="mt-1 whitespace-pre-wrap break-anywhere">{s.transcription}</p>
            : <GrowText value={s.transcription ?? ''} placeholder={t('Текст записи, как читается')} aria-label={t('Расшифровка записи')} className="mt-1 w-full text-ink" onChange={(e) => setS({ ...s, transcription: e.target.value })} onBlur={commit} />}
        </details>
      )}
      {!readOnly && <RowRemove onRemove={onRemove} />}
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
  // A reader can do nothing about a missing source: no question without an answer.
  if (!canEdit && !list.some((c) => c.status !== 'rejected' && sourceOf(person, c)) && list.filter((c) => c.status === 'possible').length === 0) return <span />
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
    <Select look="quiet" aria-label={t('Источник')} value={selected ?? ''} onChange={(v) => pick(v, onPick)} options={[{ value: '', label: t('Указать источник') }, ...known.map((s) => ({ value: s.id ?? '', label: s.title || t('Без названия') }))]} />
  )
  const unclaimedName = NAME_FIELDS.includes(field) && !person.claims.some((c) => c.field === field)
  const sourceWord = '+ источник'
  const otherWord = '+ другой вариант'
  // Nothing written yet means nothing to source: four empty links in a row said nothing.
  if (!main && !list.length) return null
  const label = conflict ? `⚠ +${others} ${mainSource?.title ?? t('Указать источник')}` : mainSource ? `${others ? `+${others} ` : ''}${mainSource.title}` : unclaimedName || main ? t(sourceWord) : t(otherWord)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button title={mainSource ? label : undefined} className={cn('text-left text-xs -mt-1 min-w-0 break-anywhere line-clamp-2 rounded underline underline-offset-2 hover:text-ink', conflict ? 'text-destructive' : mainSource ? 'text-ink-soft' : 'text-ink-faint no-underline')}>{label}</button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(320px,calc(100vw-32px))] p-2.5 text-sm flex flex-col gap-2">
        {list.map((c) => {
          const source = sourceOf(person, c)
          const off = c.status === 'rejected'
          return (
            <div key={c.id} className={cn('rounded-md border border-border px-2 py-1.5 flex flex-col gap-1', off && 'opacity-60')}>
              <label className="flex items-center gap-2 min-w-0">
                {!off && canEdit && <input type="radio" name={`main-${field}`} className="accent-[var(--ink)] size-4 flex-none" checked={c.status === 'accepted'} aria-label={t('Основное значение')} onChange={() => change(accept(current(), field, c.id))} />}
                <span className={cn('break-anywhere min-w-0', off ? 'line-through' : 'font-medium')}>{c.value}</span>
                <span className="ml-auto flex-none text-xs text-ink-faint">{t(off ? 'отвергнуто' : c.status === 'accepted' ? 'основное' : 'возможно')}</span>
              </label>
              {off && c.reason && <span className="text-xs text-ink-soft">{t('Причина')}: {c.reason}</span>}
              <div className="flex flex-wrap items-center gap-x-2 min-w-0 text-xs text-ink-soft">
                {canEdit && !off ? sourceSelect(c.sourceId, (id) => change(setSource(current(), field, c.id, id))) : source && <span className="break-anywhere min-w-0">{source.title}</span>}
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
            <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={t('Другая версия значения')} aria-label={t('Другая версия значения')} className={inputClass} />
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

/** A life in order, read from the card and the family, so nothing has to be written twice. */
function LifeLine({ person }: { person: Person }) {
  const { t, graph, focus } = useApp()
  const events = useMemo(() => lifeEvents(person, graph), [person, graph])
  if (events.length < 2) return null
  return (
    <details className="group">
      <summary className="cursor-pointer text-base font-medium">{t('Хронология жизни')}</summary>
      <ol className="mt-1.5 flex flex-col gap-1.5 border-l border-border pl-3 text-sm">
        {events.map((e, i) => (
          <li key={i} className="min-w-0">
            <span className="font-medium">{e.date}</span>{e.age !== null && <span className="text-ink-soft"> · {t('возраст')} {e.age}</span>}
            <span className="block break-anywhere">{t(e.title)}{e.note && ': '}{e.otherId ? <button className="pick underline underline-offset-2 hover:text-ink" onClick={() => focus(e.otherId, { center: true })}>{e.note}</button> : e.note}</span>
          </li>
        ))}
      </ol>
    </details>
  )
}

export function Details({ person, patch: send }: { person: Person; patch: (p: Partial<Person>) => Promise<unknown> }) {
  const { t, canEdit, graph, lang, me } = useApp()
  const ro = !canEdit
  // The card itself says when a save fails, with a way to try again.
  const writer = useRef(listWriter({ facts: person.facts, sources: person.sources, tags: person.tags, claims: person.claims }, send, () => {})).current
  useEffect(() => writer.sync({ facts: person.facts, sources: person.sources, tags: person.tags, claims: person.claims }), [writer, person.facts, person.sources, person.tags, person.claims])
  /** The person as the next change must see it: lists as last written. */
  const current = (): Person => ({ ...person, claims: writer.get('claims'), sources: writer.get('sources') })
  const change = (patch: ClaimPatch) => writer.merge(patch)
  const saveClaimField = (field: ClaimField) => (v: string) => change(editValue(current(), field, v))
  const patch = writer.write as (p: Partial<Person>) => void
  const edit = writer.edit
  const save = (key: keyof Person) => (v: string) => patch({ [key]: v })
  const [fresh, setFresh] = useState(-1)
  const [sameAs, setSameAs] = useState<string | null>(null)
  const [freshSource, setFreshSource] = useState(-1)
  const places = useMemo(() => [...new Set(graph.persons.flatMap((p) => [p.birthPlace, p.deathPlace, ...p.facts.map((f) => f.place)]).concat(graph.unions.map((u) => u.place)).filter(Boolean))].sort().slice(0, 300), [graph])
  const kinds = FACT_KINDS.map((k) => t(k))
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
    <div className="@container px-4 pb-5 flex flex-col gap-4 text-sm">
      {(card.documented + card.told + card.conflict > 0) && (
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
          {card.conflict > 0 && <span className="text-destructive">⚠ {t('расхождений')}: {card.conflict}</span>}
          {card.documented > 0 && <span className="text-ink-soft">{t('по документу')}: {card.documented}</span>}
          {card.told > 0 && <span className="text-ink-soft">{t('со слов')}: {card.told}</span>}
        </p>
      )}

      <div className="grid grid-cols-[104px_minmax(0,1fr)_minmax(0,1fr)] @max-[440px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 @max-[440px]:gap-x-2 gap-y-2 items-baseline">
        <div className="text-ink-soft @max-[440px]:col-span-2 @max-[440px]:-mb-1">{t('Жив или нет')}</div>
        <div className="col-span-2 @max-[440px]:col-span-2 flex flex-wrap items-center gap-2">
          <Segmented label={t('Жив или нет')} disabled={ro} value={alive ? 'alive' : 'dead'} onChange={(v) => { patch({ living: v === 'alive' }); if (v === 'dead') setTimeout(() => document.getElementById('f-death-date')?.focus(), 80) }} options={[['alive', t(u ? 'Жив(а)' : f ? 'Жива' : 'Жив')], ['dead', t(u ? 'Умер(ла)' : f ? 'Умерла' : 'Умер')]]} />
          {years !== null && years >= 0 && <span className="text-ink-soft">{alive ? ageWords(years, lang) : `${t('Возраст при смерти')}: ${ageWords(years, lang)}`}</span>}
        </div>

        <span className="@max-[440px]:hidden" />
        <span className="text-xs text-ink-soft @max-[440px]:hidden">{t('Дата')}</span>
        <span className="text-xs text-ink-soft @max-[440px]:hidden">{t('Место')}</span>

        <div className="text-ink-soft @max-[440px]:col-span-2 @max-[440px]:-mb-1">{t('Рождение')}</div>
        <span className="text-xs text-ink-soft @min-[441px]:hidden -mb-1.5">{t('Дата')}</span>
        <span className="text-xs text-ink-soft @min-[441px]:hidden -mb-1.5">{t('Место')}</span>
        <DateField id="f-birth-date" readOnly={ro} value={person.birthDate} placeholder={t('например, 1890')} onSave={saveClaimField('birthDate')} />
        <span className="flex min-w-0 flex-col"><Field id="f-birth-place" suggestions={places} readOnly={ro} value={person.birthPlace} placeholder={t('например, Пермь')} onSave={saveClaimField('birthPlace')} /><PlaceHint text={person.birthPlace} /></span>
        <span className="@max-[440px]:hidden" />
        <Versions person={person} field="birthDate" current={current} change={change} attach={attachSource} />
        <Versions person={person} field="birthPlace" current={current} change={change} attach={attachSource} />

        {!alive && (
          <>
            <div className="text-ink-soft @max-[440px]:col-span-2 @max-[440px]:-mb-1">{t('Смерть')}</div>
        <span className="text-xs text-ink-soft @min-[441px]:hidden -mb-1.5">{t('Дата')}</span>
        <span className="text-xs text-ink-soft @min-[441px]:hidden -mb-1.5">{t('Место')}</span>
            <DateField id="f-death-date" readOnly={ro} value={person.deathDate} placeholder={t('например, 1950')} onSave={saveClaimField('deathDate')} />
            <span className="flex min-w-0 flex-col"><Field id="f-death-place" suggestions={places} readOnly={ro} value={person.deathPlace} placeholder={t('например, Пермь')} onSave={saveClaimField('deathPlace')} /><PlaceHint text={person.deathPlace} /></span>
            <span className="@max-[440px]:hidden" />
            <Versions person={person} field="deathDate" current={current} change={change} attach={attachSource} />
            <Versions person={person} field="deathPlace" current={current} change={change} attach={attachSource} />
          </>
        )}

        {(person.otherNames || !ro) && (
          <>
            <div className="text-ink-soft @max-[440px]:col-span-2 @max-[440px]:-mb-1">{t('Другие имена')}</div>
            <div className="col-span-2 @max-[440px]:col-span-2"><Field readOnly={ro} value={person.otherNames} placeholder={t('прозвище, имя в крещении')} onSave={save('otherNames')} /></div>
          </>
        )}

        <div className="text-ink-soft @max-[440px]:col-span-2 @max-[440px]:-mb-1">{t('Пол')}</div>
        <div className="col-span-2 @max-[440px]:col-span-2"><Segmented id="f-sex" label={t('Пол')} disabled={ro} value={person.sex} onChange={(sex) => patch({ sex })} options={[['M', t('Мужской')], ['F', t('Женский')], ['U', t('Неизвестно')]]} /></div>
      </div>

      {(canEdit || person.claims.some((c) => NAME_LABELS[c.field])) && (
        <details open={NAME_FIELDS.some((f) => hasConflict(person, f))} className="text-sm">
          <summary className="cursor-pointer text-base font-medium min-h-6">{t('Откуда известно имя')}</summary>
          <div className="grid grid-cols-[104px_minmax(0,1fr)_minmax(0,1fr)] @max-[440px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-1 items-center mt-1">
            {NAME_FIELDS.filter((f) => person[f as keyof Person]).map((f) => (
              <Fragment key={f}>
                <span className="text-ink-soft">{t(NAME_LABELS[f]!)}</span>
                <span className="break-anywhere min-w-0">{String(person[f as keyof Person])}</span>
                <Versions person={person} field={f} current={current} change={change} attach={attachSource} />
              </Fragment>
            ))}
          </div>
        </details>
      )}

      {badOrder && <p role="alert" className="text-xs text-destructive">{t('Дата смерти раньше даты рождения: проверьте годы')}</p>}
      {tooOld && canEdit && <p className="text-xs text-ink-soft">{t('Больше 110 лет.')} <button className="underline hover:text-ink" onClick={() => patch({ living: false })}>{t('Отметить как умершего')}</button></p>}

      <LifeLine person={person} />

      {(person.facts.length > 0 || !ro) && (
        <section className="flex flex-col gap-1.5">
          <h4 className="text-base font-medium">{t('Факты')}</h4>
          {(ro ? [...person.facts].sort((a, b) => (yearOf(a.date) ?? 9999) - (yearOf(b.date) ?? 9999)) : person.facts).map((fact, i) => (
            <FactRow
              key={i}
              fact={fact}
              readOnly={ro}
              fresh={fresh === i}
              kinds={kinds}
              places={places}
              onChange={(next) => edit('facts', (list) => list.map((x, j) => (j === i ? next : x)))}
              onRemove={() => edit('facts', (list) => list.filter((_, j) => j !== i))}
            />
          ))}
          {!ro && <AddMenu label={t('Добавить факт')} items={[...FACT_KINDS.map((k): [string, string] => [k, t(k)]), ['', t('Другое')]]} onPick={(k) => { setFresh(writer.get('facts').length); edit('facts', (list) => [...list, { id: Math.random().toString(36).slice(2, 10), kind: k && t(k), date: '', place: '', note: '', source: '' }]) }} />}
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
          {!ro && <AddMenu label={t('Добавить источник')} items={SOURCE_KINDS.map((k): [string, string] => [k, k ? t(k) : t('Другой источник')])} onPick={(k) => { setFreshSource(writer.get('sources').length); edit('sources', (list) => [...list, { id: Math.random().toString(36).slice(2, 10), title: k && t(k), ref: '', page: '', url: '', reliability: SOURCE_RELIABILITY[k] ?? 'copy' }]) }} />}
        </section>
      )}

      {!ro && alive && !me.guest && <ContactsBlock personId={person.id} />}
      {/* Who may see it, after what it says. */}

      {!ro && !alive && <SwitchRow title={t('Скрыть от читателей')} description={t('Карточку, страницы и рассказы увидят только редакторы, как у живых.')} checked={!!person.keepPrivate} onChange={(on) => patch({ keepPrivate: on })} />}

      {ro && person.keepPrivate && <p className="text-xs text-ink-soft">{t('Скрыт от читателей')}</p>}


      {(shownTags(person.tags).length > 0 || !ro) && (
        <section className="flex flex-col gap-1.5">
          <h4 className="text-base font-medium">{t('Группы')}</h4>
          {!ro && <p className="text-xs text-ink-soft">{t('Например: родня по отцу. Помогает показывать людей вместе.')}</p>}
          <div className="flex flex-wrap gap-1.5 items-center">
            {shownTags(person.tags).map((tag) => (
              <span key={tag} className="flex items-center gap-0.5 rounded-2xl bg-muted pl-2.5 pr-0.5 min-h-6 text-xs break-anywhere min-w-0">
                {tag}
                {!ro && <button aria-label={`${t('Удалить')}: ${tag}`} className="grid place-items-center size-6 flex-none text-ink-faint hover:text-destructive" onClick={() => edit('tags', (list) => list.filter((x) => x !== tag))}><X size={11} /></button>}
              </span>
            ))}
            {!ro && <TagInput existing={person.tags} onAdd={(tag) => edit('tags', (list) => [...list, tag])} />}
          </div>
        </section>
      )}

      {!ro && (
        <PersonPopover onPick={setSameAs} exclude={[person.id]}>
          <button className="self-start text-xs text-ink-soft underline underline-offset-2 hover:text-ink">{t('Объединить с другой карточкой…')}</button>
        </PersonPopover>
      )}
      {sameAs && <MergeDialog a={person.id} b={sameAs} onClose={() => setSameAs(null)} />}
    </div>
  )
}
