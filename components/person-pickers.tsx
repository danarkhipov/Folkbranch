'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { avatarUrl, useApp } from '@/lib/client'
import { lifeYears, personName, type Person } from '@/lib/types'

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

/** Cmd+K: jump to a person. */
export function SearchDialog({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (v: boolean) => void; onPick: (id: string) => void }) {
  const { t } = useApp()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 overflow-hidden gap-0 max-w-md" showCloseButton={false}>
        <DialogTitle className="sr-only">{t('Поиск людей')}</DialogTitle>
        <PeopleList onPick={(id) => { onOpenChange(false); onPick(id) }} />
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
