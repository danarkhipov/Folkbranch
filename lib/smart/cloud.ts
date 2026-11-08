'use client'
import { useCallback, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../client'
import type { Lang } from '../types'
import { decodeSpeech, RATE } from './audio'

export interface CloudInfo { enabled: boolean; label: string | null; where: string | null }

/** Whether the owner connected a speech service, and which: asked once a minute at most. */
export function useCloudInfo() {
  return useQuery({ queryKey: ['stt-info'], queryFn: () => api<CloudInfo>('transcription/info'), staleTime: 60_000, retry: false })
}

// A recording leaves the device only on this device's own say-so.
const KEY = 'speech-cloud'
const listeners = new Set<() => void>()
const read = () => { try { return localStorage.getItem(KEY) === 'on' } catch { return false } }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const cloudChosen = read

/** This device's choice to turn recordings into text through the owner's service, and whether it can be used now. */
export function useCloud() {
  const info = useCloudInfo().data
  const chosen = useSyncExternalStore(subscribe, read, () => false)
  const set = useCallback((on: boolean) => { try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch {} listeners.forEach((l) => l()) }, [])
  const enabled = !!info?.enabled
  return { enabled, info, chosen, use: enabled && chosen, set }
}

export class CloudError extends Error {}

/** The recording goes to this archive's server, which forwards it to the owner's service. Nothing is kept on the way. */
export async function transcribeCloud(blob: Blob, lang: Lang, signal: AbortSignal) {
  let seconds = 0
  try { seconds = (await decodeSpeech(blob)).length / RATE } catch { seconds = blob.size / 4000 }
  const form = new FormData()
  form.set('file', blob, `recording.${blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : blob.type.includes('wav') ? 'wav' : 'webm'}`)
  form.set('language', lang)
  form.set('seconds', String(Math.ceil(seconds)))
  const res = await fetch('/api/v1/transcribe', { method: 'POST', body: form, signal })
  if (!res.ok) throw new CloudError((await res.json().catch(() => null))?.error ?? res.statusText)
  return ((await res.json()) as { text: string }).text
}
