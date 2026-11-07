'use client'
import { useCallback, useSyncExternalStore } from 'react'

// One device at a time: a laptop may take what a phone cannot, so none of this lives on the server.
export type SmartFeature = 'faces' | 'recognize' | 'speech'

const KEY = 'smart-features'
/** A feature needs its model first. Once that is here, it can still be switched off without removing it. */
const DEFAULTS: Record<SmartFeature, boolean> = { faces: true, recognize: true, speech: true }
const listeners = new Set<() => void>()
let cached: string | null | undefined

function raw() {
  if (cached === undefined) {
    try { cached = localStorage.getItem(KEY) } catch { cached = null }
  }
  return cached
}

export function smartEnabled(feature: SmartFeature) {
  try { return { ...DEFAULTS, ...JSON.parse(raw() ?? '{}') }[feature] === true } catch { return DEFAULTS[feature] }
}

function setSmart(feature: SmartFeature, on: boolean) {
  const next = JSON.stringify({ ...JSON.parse(raw() ?? '{}'), [feature]: on })
  cached = next
  try { localStorage.setItem(KEY, next) } catch {}
  listeners.forEach((l) => l())
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

export function useSmart(feature: SmartFeature): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, () => smartEnabled(feature), () => DEFAULTS[feature])
  return [on, useCallback((v: boolean) => setSmart(feature, v), [feature])]
}
