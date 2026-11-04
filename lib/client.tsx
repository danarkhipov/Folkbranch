'use client'
import { createContext, useContext } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Family } from './kinship'
import type { Graph, Lang, Me, Person } from './types'
import { translate } from './i18n'
import { drawnAvatar } from './avatar'

export async function api<T = any>(path: string, init?: { method?: string; json?: unknown; body?: BodyInit }): Promise<T> {
  const res = await fetch(`/api/v1/${path}`, {
    method: init?.method ?? (init?.json !== undefined || init?.body ? 'POST' : 'GET'),
    headers: init?.json !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText)
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
  confirm: (text: string, action: string) => Promise<boolean>
  quickAdd: (type: QuickType, to: string, otherParent?: string) => void
  notify: (text: string, actions?: { label: string; run: () => void }[]) => void
  /** Rolls back the most recent change that is not already undone. */
  undoLast: () => Promise<void>
}

export type QuickType = 'parent' | 'father' | 'mother' | 'child' | 'son' | 'daughter' | 'spouse'

export const App = createContext<AppCtx>(null as never)
export const useApp = () => useContext(App)

export const useTr = (lang: Lang) => (key: string) => translate(lang, key)

/** Any write refreshes everything derived from it: the graph and history at least. */
export function useWrite<V = void, R = unknown>(fn: (v: V) => Promise<R>, also: unknown[][] = []) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['graph'] })
      qc.invalidateQueries({ queryKey: ['history'] })
      also.forEach((queryKey) => qc.invalidateQueries({ queryKey }))
    },
  })
}

/** The person's photo, or a drawn portrait when there is none. */
export const avatarUrl = (p: Person) => (p.avatarMediaId ? `/api/v1/persons/${p.id}/avatar?v=${p.updatedAt}` : drawnAvatar(p))
export const mediaUrl = (id: string, size: 'thumb' | 'medium' | 'orig' = 'medium') => `/api/v1/media/${id}/file?size=${size}`
