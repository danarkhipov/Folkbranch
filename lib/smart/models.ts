'use client'
import { useEffect, useSyncExternalStore } from 'react'
import { readDevice } from './device'

// Nothing downloads until someone presses the button. Files stay in this browser and can be removed again.
const CACHE = 'folkbranch-models'
export const ORT_VERSION = '1.31.0-dev.20260914-8d85527a0'
const ort = (file: string) => [`https://unpkg.com/onnxruntime-web@${ORT_VERSION}/dist/${file}`, `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/${file}`]
const opencv = (repo: string, file: string, revision: string) => [`https://huggingface.co/opencv/${repo}/resolve/${revision}/${file}`]

interface ModelFile { name: string; urls: string[]; bytes: number; sha256: string }
const RUNTIME: ModelFile = { name: 'ort.wasm', urls: ort('ort-wasm-simd-threaded.wasm'), bytes: 14264838, sha256: '06ba057753da3847e4c24f02d91ab133455b0817c69a44993a9a53a2146df9e3' }
const DETECTOR: ModelFile = { name: 'yunet.onnx', urls: opencv('face_detection_yunet', 'face_detection_yunet_2023mar.onnx', 'main'), bytes: 232589, sha256: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4' }
const COMPARER: ModelFile = { name: 'sface.onnx', urls: opencv('face_recognition_sface', 'face_recognition_sface_2021dec_int8.onnx', 'main'), bytes: 9896933, sha256: '2b0e941e6f16cc048c20aee0c8e31f569118f65d702914540f7bfdc14048d78a' }

export type Pack = 'faces' | 'recognize' | 'speech'
const FILES: Record<'faces' | 'recognize', ModelFile[]> = { faces: [RUNTIME, DETECTOR], recognize: [RUNTIME, DETECTOR, COMPARER] }

export const SPEECH_MODELS = { small: { id: 'onnx-community/whisper-tiny', mb: 50 }, large: { id: 'onnx-community/whisper-base', mb: 85 } }
export const speechModel = () => SPEECH_MODELS[readDevice().tier === 'strong' ? 'large' : 'small']

/** About how much a pack adds to this browser, for saying so before it is fetched. */
export function packSize(pack: Pack) {
  if (pack === 'speech') return speechModel().mb
  const files = pack === 'recognize' && states.faces.status === 'ready' ? [COMPARER] : FILES[pack]
  return Math.max(1, Math.round(files.reduce((n, f) => n + f.bytes, 0) / 1024 / 1024))
}

export interface PackState { status: 'unknown' | 'none' | 'busy' | 'ready' | 'unavailable'; loaded: number; total: number; failed: boolean }
const blank: PackState = { status: 'unknown', loaded: 0, total: 0, failed: false }
const states: Record<Pack, PackState> = { faces: blank, recognize: blank, speech: blank }
const running: Partial<Record<Pack, AbortController>> = {}
const listeners = new Set<() => void>()
const set = (pack: Pack, next: Partial<PackState>) => { states[pack] = { ...states[pack], ...next }; listeners.forEach((l) => l()) }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

// The same address from the page and from the worker, which live at different paths.
const key = (name: string) => `/smart-models/${name}`

const SPEECH_FLAG = 'speech-model'
const speechHere = async () => {
  let id: string | null = null
  try { id = localStorage.getItem(SPEECH_FLAG) } catch {}
  if (!id) return false
  const names = await caches.keys()
  for (const n of names.filter((x) => x.includes('transformers'))) if ((await (await caches.open(n)).keys()).some((r) => r.url.includes(id!))) return true
  return false
}

async function refresh(pack: Pack) {
  if (running[pack]) return
  if (typeof caches === 'undefined') return set(pack, { status: 'unavailable' })
  const here = pack === 'speech' ? await speechHere() : (await Promise.all(FILES[pack].map(async (f) => !!(await (await caches.open(CACHE)).match(key(f.name)))))).every(Boolean)
  set(pack, { status: here ? 'ready' : 'none' })
}
const refreshAll = () => Promise.all((['faces', 'recognize', 'speech'] as Pack[]).map(refresh))

async function fetchFile(file: ModelFile, signal: AbortSignal, onBytes: (n: number) => void) {
  let lastError: unknown
  for (const url of file.urls) {
    try {
      const r = await fetch(url, { signal })
      if (!r.ok || !r.body) throw new Error(`${r.status}`)
      const reader = r.body.getReader()
      const parts: Uint8Array<ArrayBuffer>[] = []
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        parts.push(value)
        onBytes(value.length)
      }
      const blob = new Blob(parts)
      // A file that is not exactly the one checked is never run. Plain http has no way to check, and no cache either.
      if (crypto.subtle) {
        const sum = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), (b) => b.toString(16).padStart(2, '0')).join('')
        if (sum !== file.sha256) throw new Error(`${file.name} is not the expected file`)
      }
      return blob
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e
      lastError = e
    }
  }
  throw lastError
}

/** Fetches what is missing. Safe to press twice: a pack already on its way just keeps going. */
export async function downloadPack(pack: Pack) {
  if (running[pack]) return
  const stop = (running[pack] = new AbortController())
  set(pack, { status: 'busy', loaded: 0, total: 0, failed: false })
  try {
    if (pack === 'speech') {
      const { prepareSpeech } = await import('./speech')
      const { id } = speechModel()
      await prepareSpeech(id, (loaded, total) => set(pack, { loaded, total }), stop.signal)
      try { localStorage.setItem(SPEECH_FLAG, id) } catch {}
    } else {
      navigator.storage?.persist?.().catch(() => {})
      const store = await caches.open(CACHE)
      const missing: ModelFile[] = []
      for (const f of FILES[pack]) if (!(await store.match(key(f.name)))) missing.push(f)
      const total = missing.reduce((n, f) => n + f.bytes, 0)
      let loaded = 0
      set(pack, { total })
      for (const f of missing) {
        const blob = await fetchFile(f, stop.signal, (n) => { loaded += n; set(pack, { loaded }) })
        await store.put(key(f.name), new Response(blob))
      }
    }
    delete running[pack]
    await refreshAll()
  } catch (e) {
    delete running[pack]
    const stopped = (e as Error).name === 'AbortError'
    if (!stopped) console.error(e)
    await refreshAll()
    if (!stopped) set(pack, { failed: true })
  }
}

export const cancelPack = (pack: Pack) => running[pack]?.abort()

/** Removes a pack, and what cannot work without it. What another pack still needs stays. */
export async function removePack(pack: Pack) {
  if (pack === 'speech') {
    const names = await caches.keys()
    await Promise.all(names.filter((n) => n.includes('transformers')).map((n) => caches.delete(n)))
    try { localStorage.removeItem(SPEECH_FLAG) } catch {}
  } else {
    const store = await caches.open(CACHE)
    const keep = pack === 'recognize' ? states.faces.status === 'ready' ? FILES.faces : [] : []
    for (const f of [...FILES.faces, ...FILES.recognize]) if (!keep.includes(f) && (pack === 'faces' || f === COMPARER || !FILES.faces.includes(f))) await store.delete(key(f.name))
    await new Promise((r) => { const q = indexedDB.deleteDatabase('folkbranch-face-prints'); q.onsuccess = q.onerror = q.onblocked = r })
  }
  await refreshAll()
}

export function useModel(pack: Pack) {
  const state = useSyncExternalStore(subscribe, () => states[pack], () => blank)
  useEffect(() => { if (state.status === 'unknown') refresh(pack) }, [pack, state.status])
  return state
}
