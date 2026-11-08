'use client'
import { createContext, useContext, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Proposal } from '@/lib/ops/proposals'
import type { Family } from './kinship'
import type { Graph, HistoryEntry, Lang, Me, Person } from './types'
import { translate } from './i18n'
import { drawnAvatar } from './avatar'

export async function api<T = any>(path: string, init?: { method?: string; json?: unknown; body?: BodyInit }): Promise<T> {
  const res = await fetch(`/api/v1/${path}`, {
    method: init?.method ?? (init?.json !== undefined || init?.body ? 'POST' : 'GET'),
    headers: init?.json !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  })
  if (!res.ok) throw Object.assign(new Error((await res.json().catch(() => null))?.error ?? res.statusText), { status: res.status })
  return res.json()
}

export interface AppCtx {
  me: Me
  lang: Lang
  familyName: string
  canEdit: boolean
  /** Elders at the bottom of the chart, the youngest at the top. */
  rootsBelow: boolean
  graph: Graph
  byId: Map<string, Person>
  family: Family
  t: (key: string) => string
  focusId: string | null
  focus: (id: string | null, opts?: { center?: boolean }) => void
  openPhoto: (mediaId: string, list?: string[]) => void
  confirm: (text: string, action: string, note?: string) => Promise<boolean>
  quickAdd: (type: QuickType, to: string, otherParent?: string) => void
  /** What the chart's own menu can start. */
  commands: { addPerson: () => void; importFile: () => void; search: () => void; flip: () => void; deletePerson: (id: string) => void; clearAll: () => void }
  notify: (text: string, actions?: { label: string; run: () => void }[], stay?: boolean) => void
  /** Rolls back the most recent change that is not already undone. */
  undoLast: () => Promise<void>
}

export type QuickType = 'parent' | 'father' | 'mother' | 'child' | 'son' | 'daughter' | 'spouse'

export const App = createContext<AppCtx>(null as never)
export const useApp = () => useContext(App)

/** Who else has the archive open. Apart from App, so someone arriving does not redraw the chart. */
export const Presence = createContext<{ id: string; name: string; focusId: string | null }[]>([])

export const useTr = (lang: Lang) => (key: string) => translate(lang, key)

/** Any write refreshes everything derived from it: the graph and history at least. */
/** The change just made, to offer taking it back. */
export const lastChangeId = async () => (await api<HistoryEntry[]>('history?limit=1'))[0]?.id

/** The live channel refreshes these, so there is nothing to poll. */
export const useProposals = (enabled: boolean) => useQuery({ queryKey: ['proposals'], queryFn: () => api<Proposal[]>('proposals'), enabled })

export function useWrite<V = void, R = unknown>(fn: (v: V) => Promise<R>, also: unknown[][] = [], onError?: (e: Error) => void) {
  const qc = useQueryClient()
  const app = useContext(App)
  return useMutation({
    mutationFn: fn,
    // Nothing fails in silence: a person who sees no message believes it worked.
    onError: onError ?? (() => app?.notify(app.t('Не получилось. Проверьте интернет и попробуйте ещё раз.'), [], true)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['graph'] })
      qc.invalidateQueries({ queryKey: ['history'] })
      also.forEach((queryKey) => qc.invalidateQueries({ queryKey }))
    },
  })
}

/**
 * Saves a person's fields and says what each one held when this editor last saw it. Then the server
 * can merge lists and refuse to overwrite a value somebody changed meanwhile.
 */
export function usePersonSave(person: Person, onError: (e: Error) => void) {
  const latest = useRef(person)
  const wrote = useRef<Record<string, unknown>>({})
  if (latest.current !== person) {
    latest.current = person
    wrote.current = {}
  }
  return useWrite(async (patch: Partial<Person>) => {
    const seen = Object.fromEntries(Object.keys(patch).map((k) => [k, k in wrote.current ? wrote.current[k] : latest.current[k as keyof Person]]))
    const result = await api(`persons/${person.id}`, { method: 'PATCH', json: { ...patch, seen } })
    Object.assign(wrote.current, patch)
    return result
  }, [], onError)
}

/** Why an undo was refused, in words a person can act on. */
export const undoFailure = (e: unknown, t: (key: string) => string) =>
  (e as { status?: number }).status === 409 ? t('Это уже изменили позже. Сначала отмените более новую правку') : `${t('Не удалось сохранить')}: ${(e as Error).message}`

/** The person's photo, or a drawn portrait when there is none. */
export const avatarUrl = (p: Person) => (p.avatarMediaId ? `/api/v1/persons/${p.id}/avatar?v=${p.updatedAt}` : drawnAvatar(p))
export const mediaUrl = (id: string, size: 'thumb' | 'medium' | 'orig' = 'medium') => `/api/v1/media/${id}/file?size=${size}`

/** Where a link made now should lead: the outside address while ./folkbranch share is on, or this page's own. */
export function useLinkOrigin() {
  const { data } = useQuery({ queryKey: ['link-address'], queryFn: () => api<{ address: string | null }>('link-address') })
  return data?.address ?? (typeof location === 'undefined' ? '' : location.origin)
}
