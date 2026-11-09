'use client'
import { useEffect, useSyncExternalStore } from 'react'
import { readDevice } from './device'
import { ORT_VERSION } from './ort-version'

// Nothing downloads until someone presses the button. Files stay in this browser and can be removed again.
const CACHE = 'folkbranch-models'
const ort = (file: string) => [`https://unpkg.com/onnxruntime-web@${ORT_VERSION}/dist/${file}`, `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/${file}`]
const hf = (repo: string, file: string) => [`https://huggingface.co/${repo}/resolve/main/${file}`, `https://hf-mirror.com/${repo}/resolve/main/${file}`]

interface ModelFile { name: string; urls: string[]; bytes: number; sha256: string }
const RUNTIME: ModelFile = { name: 'ort.wasm', urls: ort('ort-wasm-simd-threaded.wasm'), bytes: 14264838, sha256: '06ba057753da3847e4c24f02d91ab133455b0817c69a44993a9a53a2146df9e3' }
const YUNET: ModelFile = { name: 'yunet.onnx', urls: hf('opencv/face_detection_yunet', 'face_detection_yunet_2023mar.onnx'), bytes: 232589, sha256: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4' }
const YOLO_N: ModelFile = { name: 'yolov8n-face.onnx', urls: hf('deepghs/yolo-face', 'yolov8n-face/model.onnx'), bytes: 12139175, sha256: 'fd27189bfe5750a017648445700473459a6d02e7c3b0a3bfd8a54af77dd3b046' }
const YOLO_M: ModelFile = { name: 'yolov11m-face.onnx', urls: hf('deepghs/yolo-face', 'yolov11m-face/model.onnx'), bytes: 80307967, sha256: '0136c7938193241ebde248abc0678455c01120976dacea425af53d72fc4a70a3' }
const SFACE: ModelFile = { name: 'sface.onnx', urls: hf('opencv/face_recognition_sface', 'face_recognition_sface_2021dec_int8.onnx'), bytes: 9896933, sha256: '2b0e941e6f16cc048c20aee0c8e31f569118f65d702914540f7bfdc14048d78a' }
const GIGAAM: ModelFile = { name: 'gigaam.onnx', urls: hf('istupakov/gigaam-v3-onnx', 'v3_e2e_ctc.int8.onnx'), bytes: 224893347, sha256: '2e3fcb7a7b66030336fd10c2fcfb033bd1dc7e1bf238fe5cfd83b1d0cfc9d28e' }
const GIGAAM_WORDS: ModelFile = { name: 'gigaam-vocab.txt', urls: hf('istupakov/gigaam-v3-onnx', 'v3_e2e_ctc_vocab.txt'), bytes: 2007, sha256: '142de7570b3de5b3035ce111a89c228e80e6085273731d944093ddf24fa539cd' }

export type Pack = 'faces' | 'recognize' | 'speech'
export interface Variant {
  id: string
  feature: Pack
  name: string
  /** What the choice gives, in numbers from our own measurements. */
  facts: string
  files: ModelFile[]
  /** Fetched through the speech library into its own cache, with an approximate size. */
  whisper?: { repo: string; mb: number }
  languages?: string[]
  /** Which kinds of device this suits by default. */
  suits: ('weak' | 'normal' | 'strong')[]
}

export const VARIANTS: Variant[] = [
  { id: 'yolo8n', feature: 'faces', name: 'Точная', facts: 'Находит 97% лиц, около 0,7 секунды на снимок', files: [RUNTIME, YOLO_N], suits: ['normal', 'strong'] },
  { id: 'yunet', feature: 'faces', name: 'Лёгкая', facts: 'Находит 91% лиц, около 0,15 секунды на снимок', files: [RUNTIME, YUNET], suits: ['weak'] },
  { id: 'yolo11m', feature: 'faces', name: 'Максимальная', facts: 'Находит 99% лиц, около 4 секунд на снимок', files: [RUNTIME, YOLO_M], suits: [] },
  { id: 'sface', feature: 'recognize', name: 'SFace', facts: 'Точность 97%, на снимках одного человека в разном возрасте 92%. Более крупные модели в наших замерах не оказались лучше.', files: [RUNTIME, YUNET, SFACE], suits: ['weak', 'normal', 'strong'] },
  { id: 'gigaam', feature: 'speech', name: 'GigaAM, для русского', facts: 'Ошибается в 12% слов, расшифровывает в 10 раз быстрее записи, сама ставит знаки препинания', files: [RUNTIME, GIGAAM, GIGAAM_WORDS], languages: ['ru'], suits: ['normal', 'strong'] },
  { id: 'whisper-small-en', feature: 'speech', name: 'Whisper, средняя, для английского', facts: 'Ошибается в 5% английских слов, лёгкая в 16%. Примерно втрое медленнее лёгкой. Только английский', files: [], whisper: { repo: 'onnx-community/whisper-small.en', mb: 250 }, languages: ['en'], suits: ['normal', 'strong'] },
  { id: 'whisper-base', feature: 'speech', name: 'Whisper, лёгкая', facts: 'На английском ошибается в 16% слов, на русском в 39%, в 5 раз быстрее записи. Подойдёт для слабого устройства и для других языков', files: [], whisper: { repo: 'onnx-community/whisper-base', mb: 85 }, suits: ['weak'] },
  { id: 'whisper-small', feature: 'speech', name: 'Whisper, средняя', facts: 'На английском ошибается в 6% слов, на русском в 24%. Любые языки. Примерно втрое медленнее лёгкой', files: [], whisper: { repo: 'onnx-community/whisper-small', mb: 250 }, suits: [] },
  { id: 'whisper-turbo', feature: 'speech', name: 'Whisper, максимальная', facts: 'На английском ошибается в 5% слов, на русском в 15%, лучше других справляется с акцентом и шумом. Скачивать около 1,1 ГБ, в 5 раз медленнее лёгкой: нужен сильный компьютер', files: [], whisper: { repo: 'onnx-community/whisper-large-v3-turbo', mb: 1090 }, suits: [] },
]
const byId = (id: string) => VARIANTS.find((v) => v.id === id)!
const language = () => (typeof document === 'undefined' ? 'en' : document.documentElement.lang)

export const variantsFor = (feature: Pack) => VARIANTS.filter((v) => v.feature === feature && (!v.languages || v.languages.includes(language())))

const CHOICE = 'smart-model-choice'
function readChoice(): Partial<Record<Pack, string>> {
  try { return JSON.parse(localStorage.getItem(CHOICE) ?? '{}') } catch { return {} }
}
/** The one this device uses: the person's choice, or what suits it. */
export function chosen(feature: Pack) {
  const list = variantsFor(feature)
  const mine = list.find((v) => v.id === readChoice()[feature])
  if (mine) return mine
  const tier = readDevice().tier
  return list.find((v) => v.suits.includes(tier)) ?? list[0]
}
export const recommended = (v: Variant) => v.suits.includes(readDevice().tier)
export function choose(id: string) {
  const v = byId(id)
  try { localStorage.setItem(CHOICE, JSON.stringify({ ...readChoice(), [v.feature]: id })) } catch {}
  version++
  listeners.forEach((l) => l())
}

/** About how many megabytes this would add to the browser now, counting only what is not here yet. */
export function variantSize(id: string) {
  const v = byId(id)
  if (v.whisper) return v.whisper.mb
  const here = new Set(VARIANTS.filter((o) => o.id !== id && states[o.id]?.status === 'ready').flatMap((o) => o.files))
  const ready = states[id]?.status === 'ready'
  return Math.max(1, Math.round(v.files.filter((f) => ready || !here.has(f)).reduce((n, f) => n + f.bytes, 0) / 1024 / 1024))
}
export const packSize = (pack: Pack) => variantSize(chosen(pack).id)

export interface PackState { status: 'unknown' | 'none' | 'busy' | 'ready' | 'unavailable'; loaded: number; total: number; failed: boolean }
const blank: PackState = { status: 'unknown', loaded: 0, total: 0, failed: false }
const states: Record<string, PackState> = {}
const running: Record<string, AbortController> = {}
const listeners = new Set<() => void>()
let version = 0
const set = (id: string, next: Partial<PackState>) => { states[id] = { ...(states[id] ?? blank), ...next }; version++; listeners.forEach((l) => l()) }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

// The same address from the page and from a worker, which live at different paths.
const key = (name: string) => `/smart-models/${name}`
const whisperFlag = (repo: string) => `speech-model:${repo}`

async function whisperHere(repo: string) {
  try { if (!localStorage.getItem(whisperFlag(repo))) return false } catch { return false }
  for (const n of (await caches.keys()).filter((x) => x.includes('transformers'))) if ((await (await caches.open(n)).keys()).some((r) => r.url.includes(repo))) return true
  return false
}

async function refresh(id: string) {
  if (running[id]) return
  if (typeof caches === 'undefined') return set(id, { status: 'unavailable' })
  const v = byId(id)
  const store = await caches.open(CACHE)
  const here = v.whisper ? await whisperHere(v.whisper.repo) : (await Promise.all(v.files.map(async (f) => !!(await store.match(key(f.name)))))).every(Boolean)
  set(id, { status: here ? 'ready' : 'none' })
}
const refreshAll = () => Promise.all(VARIANTS.map((v) => refresh(v.id)))

async function fetchFile(file: ModelFile, signal: AbortSignal, onBytes: (n: number) => void) {
  let lastError: unknown
  for (const url of file.urls) {
    let counted = 0
    try {
      const r = await fetch(url, { signal })
      if (!r.ok || !r.body) throw new Error(`${r.status}`)
      const reader = r.body.getReader()
      const parts: Uint8Array<ArrayBuffer>[] = []
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        parts.push(value)
        counted += value.length
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
      onBytes(-counted)
      lastError = e
    }
  }
  throw lastError
}

/** Fetches what is missing and makes it the one in use. Safe to press twice. */
export async function downloadVariant(id: string) {
  if (running[id]) return
  const stop = (running[id] = new AbortController())
  const v = byId(id)
  set(id, { status: 'busy', loaded: 0, total: 0, failed: false })
  try {
    if (v.whisper) {
      const { prepareWhisper } = await import('./speech-run')
      await prepareWhisper(v.whisper.repo, (loaded, total) => set(id, { loaded, total }), stop.signal)
      try { localStorage.setItem(whisperFlag(v.whisper.repo), '1') } catch {}
    } else {
      navigator.storage?.persist?.().catch(() => {})
      const store = await caches.open(CACHE)
      const missing: ModelFile[] = []
      for (const f of v.files) if (!(await store.match(key(f.name)))) missing.push(f)
      let loaded = 0
      set(id, { total: missing.reduce((n, f) => n + f.bytes, 0) })
      for (const f of missing) {
        const blob = await fetchFile(f, stop.signal, (n) => { loaded += n; set(id, { loaded }) })
        await store.put(key(f.name), new Response(blob))
      }
    }
    delete running[id]
    choose(id)
    await refreshAll()
  } catch (e) {
    delete running[id]
    const stopped = (e as Error).name === 'AbortError'
    if (!stopped) console.error(e)
    await refreshAll()
    if (!stopped) set(id, { failed: true })
  }
}
export const cancelVariant = (id: string) => running[id]?.abort()
export const downloadPack = (pack: Pack) => downloadVariant(chosen(pack).id)
export const cancelPack = (pack: Pack) => cancelVariant(chosen(pack).id)

/** Removes one model. What another downloaded model still needs stays. */
export async function removeVariant(id: string) {
  const v = byId(id)
  if (v.whisper) {
    for (const n of (await caches.keys()).filter((x) => x.includes('transformers'))) {
      const c = await caches.open(n)
      for (const r of await c.keys()) if (r.url.includes(v.whisper.repo)) await c.delete(r)
    }
    try { localStorage.removeItem(whisperFlag(v.whisper.repo)) } catch {}
  } else {
    const store = await caches.open(CACHE)
    const needed = new Set(VARIANTS.filter((o) => o.id !== id && states[o.id]?.status === 'ready').flatMap((o) => o.files))
    for (const f of v.files) if (!needed.has(f)) await store.delete(key(f.name))
  }
  if (v.feature === 'recognize') await new Promise((r) => { const q = indexedDB.deleteDatabase('folkbranch-face-prints'); q.onsuccess = q.onerror = q.onblocked = r })
  await refreshAll()
}

export function useVariant(id: string) {
  const state = useSyncExternalStore(subscribe, () => states[id] ?? blank, () => blank)
  // All of them: the size offered depends on what the other models already brought.
  useEffect(() => { if (state.status === 'unknown') refreshAll() }, [state.status])
  return state
}
/** The state of the model this device uses for a feature. */
export function useModel(pack: Pack) {
  useSyncExternalStore(subscribe, () => version, () => 0)
  return useVariant(typeof window === 'undefined' ? '' : chosen(pack).id)
}
export function useChosen(pack: Pack) {
  useSyncExternalStore(subscribe, () => version, () => 0)
  return chosen(pack)
}
