'use client'
import { useMemo, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { api, useApp, useWrite, type QuickType } from '@/lib/client'
import { lifeYears, personName, type Person } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Mini } from './person-pickers'

/** "1920 – 1985", "1920-", "~1876": birth and death as typed. */
function parseYears(s: string) {
  const [b, d] = s.split(/\s*[–—-]\s*/)
  return { birthDate: (b ?? '').trim(), deathDate: (d ?? '').trim() }
}

function parseName(s: string) {
  const parts = s.trim().split(/\s+/)
  if (parts.length < 2) return { givenName: parts[0] ?? '', surname: '' }
  return { givenName: parts.slice(0, -1).join(' '), surname: parts.at(-1)! }
}

type Concrete = 'father' | 'mother' | 'son' | 'daughter' | 'spouse'
const CHOICES: Partial<Record<QuickType, [Concrete, string][]>> = {
  parent: [['father', 'Отец'], ['mother', 'Мать']],
  father: [['father', 'Отец'], ['mother', 'Мать']],
  mother: [['mother', 'Мать'], ['father', 'Отец']],
  child: [['son', 'Сын'], ['daughter', 'Дочь']],
  son: [['son', 'Сын'], ['daughter', 'Дочь']],
  daughter: [['daughter', 'Дочь'], ['son', 'Сын']],
}
const TITLE: Record<Concrete, string> = { father: 'Добавить отца', mother: 'Добавить мать', son: 'Добавить сына', daughter: 'Добавить дочь', spouse: 'Добавить супруга' }

type State = { type: QuickType; to: string; otherParent?: string } | { type: null; to: null } | null

/** One window for adding a relative: type a name, pick an existing person or press Enter. */
export function QuickAdd({ state, onClose }: { state: State; onClose: (createdId?: string) => void }) {
  const { t, byId, family, graph } = useApp()
  // The closing animation still draws the window, so it keeps showing the last request.
  const held = useRef<State>(state)
  if (state) held.current = state
  const shown = state ?? held.current
  const target = shown?.to ? byId.get(shown.to) : undefined
  const choices = shown?.type ? CHOICES[shown.type] : undefined
  const [picked, setPicked] = useState<Concrete | null>(null)
  // Offer first the parent who is still missing.
  const missingMother = shown?.type === 'parent' && target && (family.parents.get(target.id) ?? []).some((p) => byId.get(p)?.sex === 'M')
  const type: Concrete | null = picked ?? (shown?.type === 'parent' && missingMother ? 'mother' : choices ? choices[0][0] : shown?.type === 'spouse' ? 'spouse' : null)
  const isChild = type === 'son' || type === 'daughter'
  const spouses = target ? family.spouses.get(target.id) ?? [] : []
  const [name, setName] = useState('')
  const [years, setYears] = useState('')
  const [other, setOther] = useState<string | null | undefined>(undefined)
  const given = shown && 'otherParent' in shown ? shown.otherParent : undefined
  const otherParent = other === undefined ? given ?? spouses[0] ?? null : other

  const reset = (id?: string) => { setName(''); setYears(''); setOther(undefined); setPicked(null); onClose(id) }

  const create = useWrite(async () => {
    const parsed = parseName(name)
    // Children inherit the surname unless one was typed.
    const surname = parsed.surname || (isChild && target ? target.surname : '')
    const person = {
      ...parsed, surname, ...parseYears(years),
      // A spouse is assumed to be of the other sex; the panel can change it.
      ...(type === 'spouse' && target?.sex === 'M' ? { sex: 'F' } : type === 'spouse' && target?.sex === 'F' ? { sex: 'M' } : {}),
    }
    const body = type ? { person, relation: { type, to: shown!.to!, otherParentId: isChild ? otherParent : null } } : { person }
    return api<Person>('persons', { json: body })
  })
  const linkExisting = useWrite((id: string) => api('relations', { json: { type, to: shown!.to, other: id, otherParentId: isChild ? otherParent : null } }))

  const matches = useMemo(() => {
    const q = name.trim().toLowerCase().replace(/ё/g, 'е')
    if (q.length < 2 || !shown?.to) return []
    return graph.persons.filter((p) => !p.hidden && p.id !== shown.to && personName(p).toLowerCase().replace(/ё/g, 'е').includes(q)).slice(0, 4)
  }, [name, graph, shown])

  const submit = async () => {
    if (!name.trim()) return
    const p = await create.mutateAsync()
    reset(p.id)
  }

  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && reset()}>
      <DialogContent className="max-w-sm gap-3" showCloseButton={false} onInteractOutside={(e) => { if (name.trim()) e.preventDefault() }}>
        <DialogTitle className="font-serif font-medium text-[17px]">
          {type ? t(TITLE[type]) : t('Первый человек в архиве')}
          {target && <span className="block font-sans font-normal text-xs text-ink-soft mt-0.5">{personName(target)}</span>}
        </DialogTitle>
        {choices && (
          <div className="flex gap-1 rounded-lg bg-muted p-1" role="radiogroup">
            {choices.map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={type === value} className={cn('flex-1 h-8 rounded-md text-[13px]', type === value ? 'bg-background shadow-sm font-medium' : 'text-ink-soft')} onClick={() => setPicked(value)}>{t(label)}</button>
            ))}
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); submit() }} className="flex flex-col gap-2">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Имя и фамилия')} className="h-10 rounded-lg border border-input bg-white px-3 text-[15px] font-serif outline-none focus:ring-2 focus:ring-ring/40" />
          {matches.length > 0 && (
            <div className="flex flex-col rounded-lg border border-border overflow-hidden">
              <span className="px-2 pt-1 text-[11px] text-ink-soft">{t('Уже есть в архиве')}</span>
              {matches.map((m) => (
                <button type="button" key={m.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted text-left" onClick={async () => { await linkExisting.mutateAsync(m.id); reset(m.id) }}>
                  <Mini person={m} size={22} /> <span className="truncate">{personName(m)}</span> <span className="ml-auto text-xs text-ink-faint">{lifeYears(m)}</span>
                </button>
              ))}
            </div>
          )}
          <input value={years} onChange={(e) => setYears(e.target.value)} placeholder={t('например 1920 – 1985')} className="h-9 rounded-lg border border-input bg-white px-3 outline-none focus:ring-2 focus:ring-ring/40" />
          {isChild && spouses.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-ink-soft">{t('Второй родитель')}
              <select value={otherParent ?? ''} onChange={(e) => setOther(e.target.value || null)} className="h-9 flex-1 min-w-0 rounded-lg border border-input bg-white px-2 text-[13px] text-ink">
                {spouses.map((s) => <option key={s} value={s}>{personName(byId.get(s)!) || t('Скрыто')}</option>)}
                <option value="">—</option>
              </select>
            </label>
          )}
          {(create.error || linkExisting.error) && <p className="text-xs text-destructive">{t('Не удалось сохранить')}: {String((create.error ?? linkExisting.error)?.message)}</p>}
          <button className="h-10 rounded-lg bg-ink text-white disabled:opacity-40 mt-1" disabled={!name.trim() || create.isPending}>
            {t('Добавить')} <kbd className="ml-1 border-white/30 text-white/70">↵</kbd>
          </button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
