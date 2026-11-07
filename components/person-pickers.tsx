'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { api, avatarUrl, useApp } from '@/lib/client'
import type { SearchMatch, SearchResult } from '@/lib/search/engine'
import { markParts } from '@/lib/search/mark'
import { lifeYears, personName, type Person } from '@/lib/types'

export interface SearchHit { personId: string; query: string; matches: SearchMatch[]; terms: string[] }

export function Mini({ person, size = 24 }: { person: Person; size?: number }) {
  return (
    <span className="rounded-full overflow-hidden bg-[#e7dfcd] flex-none block" style={{ width: size, height: size }}>
      <img src={avatarUrl(person)} alt="" className="w-full h-full object-cover" />
    </span>
  )
}

const useVisible = (exclude: string[] = []) => {
  const { graph } = useApp()
  return useMemo(
    () => graph.persons.filter((p) => !p.hidden && !exclude.includes(p.id)).sort((a, b) => personName(a).localeCompare(personName(b))),
    [graph, exclude],
  )
}

function PeopleList({ onPick, exclude }: { onPick: (id: string) => void; exclude?: string[] }) {
  const { t } = useApp()
  const people = useVisible(exclude)
  return (
    <Command>
      <CommandInput placeholder={t('Поиск по имени…')} aria-label={t('Поиск по имени…')} />
      <CommandList>
        <CommandEmpty>{t('Никого не нашли. Проверьте написание или введите только фамилию')}</CommandEmpty>
        {people.map((p) => (
          <CommandItem key={p.id} value={`${personName(p)} ${p.maidenName} ${p.birthYear ?? ''} ${p.tags.join(' ')} ${p.id}`} onSelect={() => onPick(p.id)}>
            <Mini person={p} />
            <span className="truncate">{personName(p) || t('Без названия')}</span>
            <span className="ml-auto text-xs text-ink-faint whitespace-nowrap">{lifeYears(p)}</span>
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  )
}

/** The word found, on a coloured ground. */
export function Marked({ text, terms }: { text: string; terms: string[] }) {
  return <>{markParts(text, terms).map((p, i) => (p.mark ? <mark key={i} className="search-mark">{p.text}</mark> : p.text))}</>
}

function Ranged({ text, ranges }: { text: string; ranges: [number, number][] }) {
  const out: React.ReactNode[] = []
  let at = 0
  ranges.forEach(([a, b], i) => {
    if (a > at) out.push(text.slice(at, a))
    out.push(<mark key={i} className="search-mark">{text.slice(a, b)}</mark>)
    at = b
  })
  out.push(text.slice(at))
  return <>{out}</>
}

/** What the card shows at the top after a search: each line leads to its place. */
export function MatchLine({ match }: { match: SearchMatch }) {
  return <span className="min-w-0 break-anywhere"><span className="text-ink-faint">{match.label}: </span><Ranged text={match.text} ranges={match.ranges} /></span>
}

const NAME_KEYS = new Set(['givenName', 'surname'])

function SearchRow({ result, person, onPick }: { result: SearchResult; person: Person; onPick: () => void }) {
  const { t } = useApp()
  const lines = result.matches.filter((m) => !NAME_KEYS.has(m.key)).slice(0, 3)
  return (
    <CommandItem value={person.id} onSelect={onPick} className="items-start">
      <Mini person={person} size={32} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 truncate font-medium"><Marked text={personName(person) || t('Без названия')} terms={result.terms} /></span>
          <span className="ml-auto text-xs text-ink-faint whitespace-nowrap">{lifeYears(person)}</span>
        </span>
        {lines.map((m, i) => <span key={i} className="block text-xs leading-snug text-ink-soft"><MatchLine match={m} /></span>)}
      </span>
    </CommandItem>
  )
}

/** Cmd+K: anything known about a person, with what was found shown right there. */
export function SearchDialog({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (v: boolean) => void; onPick: (id: string, hit?: SearchHit) => void }) {
  const { t, byId } = useApp()
  const people = useVisible()
  const [typed, setTyped] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => { const timer = setTimeout(() => setQuery(typed.trim()), 120); return () => clearTimeout(timer) }, [typed])
  useEffect(() => { if (!open) { setTyped(''); setQuery('') } }, [open])
  const { data, isFetching } = useQuery({ queryKey: ['search', query], queryFn: () => api<SearchResult[]>(`search?q=${encodeURIComponent(query)}`), enabled: !!query, placeholderData: keepPreviousData, staleTime: 0 })
  const results = query ? (data ?? []).filter((r) => byId.has(r.personId)) : []
  const partial = results.some((r) => r.partial)
  // The list changes with each answer, so Enter is pointed at the first line again.
  const [active, setActive] = useState('')
  const firstId = results[0]?.personId ?? ''
  useEffect(() => setActive(firstId), [firstId])
  const pick = (r: SearchResult) => { onOpenChange(false); onPick(r.personId, { personId: r.personId, query, matches: r.matches, terms: r.terms }) }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 overflow-hidden gap-0 max-w-xl sm:max-w-xl" showCloseButton={false}>
        <DialogTitle className="sr-only">{t('Поиск людей')}</DialogTitle>
        <Command shouldFilter={false} value={active} onValueChange={setActive}>
          <CommandInput value={typed} onValueChange={setTyped} placeholder={t('Имя, дата, место, профессия, «жена Ивана»…')} aria-label={t('Поиск людей')} />
          <CommandList className="max-h-[min(460px,60dvh)]">
            {!query && people.map((p) => (
              <CommandItem key={p.id} value={p.id} onSelect={() => { onOpenChange(false); onPick(p.id) }}>
                <Mini person={p} />
                <span className="truncate">{personName(p) || t('Без названия')}</span>
                <span className="ml-auto text-xs text-ink-faint whitespace-nowrap">{lifeYears(p)}</span>
              </CommandItem>
            ))}
            {query && !isFetching && !results.length && <p className="px-3 py-6 text-center text-sm text-ink-soft">{t('Никого не нашли. Попробуйте одно слово: фамилию, год или место')}</p>}
            {partial && <p className="px-3 pt-2 pb-1 text-xs text-ink-soft">{t('Всех слов сразу нет ни у кого. Вот у кого есть часть')}</p>}
            {results.map((r) => <SearchRow key={r.personId} result={r} person={byId.get(r.personId)!} onPick={() => pick(r)} />)}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

export function PersonPopover({ children, onPick, exclude, open, onOpenChange }: { children?: React.ReactNode; onPick: (id: string) => void; exclude?: string[]; open?: boolean; onOpenChange?: (v: boolean) => void }) {
  const [own, setOwn] = useState(false)
  const isOpen = open ?? own
  const set = onOpenChange ?? setOwn
  return (
    <Popover open={isOpen} onOpenChange={set}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="p-0 w-72" align="start">
        <PeopleList exclude={exclude} onPick={(id) => { set(false); onPick(id) }} />
      </PopoverContent>
    </Popover>
  )
}

export function ConfirmDialog({ state, onClose }: { state: { text: string; action: string; note?: string; resolve: (v: boolean) => void } | null; onClose: () => void }) {
  const { t } = useApp()
  const done = (v: boolean) => { state?.resolve(v); onClose() }
  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && done(false)}>
      <DialogContent className="max-w-sm" showCloseButton={false}>
        <DialogTitle className="font-serif font-medium text-lg">{state?.text}</DialogTitle>
        {state?.note && <p className="text-sm text-ink-soft">{state.note}</p>}
        <div className="flex justify-end gap-2 mt-2">
          <button className="bar-btn" onClick={() => done(false)}>{t('Отмена')}</button>
          <button className="bar-btn on !bg-destructive" autoFocus onClick={() => done(true)}>{state?.action}</button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function useEsc(fn: () => void) {
  const saved = useRef(fn)
  saved.current = fn
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('[role=dialog],[role=menu]') && saved.current()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
}
