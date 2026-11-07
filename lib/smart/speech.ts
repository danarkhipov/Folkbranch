'use client'
import type { Lang } from '../types'
import { decodeSpeech } from './audio'
import { readDevice, type Tier } from './device'

// Kept with the package version: the file is fetched once and the page never runs anything else from there.
const ORT = '1.31.0-dev.20260914-8d85527a0'
export const SPEECH_MODELS: Record<'small' | 'large', { id: string; mb: number }> = {
  small: { id: 'onnx-community/whisper-tiny', mb: 50 },
  large: { id: 'onnx-community/whisper-base', mb: 85 },
}
const modelFor = (tier: Tier) => SPEECH_MODELS[tier === 'strong' ? 'large' : 'small']

export type SpeechProgress =
  | { stage: 'preparing' }
  | { stage: 'download'; loaded: number; total: number }
  | { stage: 'reading'; share: number; text: string }

interface Recognition extends EventTarget { lang: string; continuous: boolean; interimResults: boolean; processLocally: boolean; start: (track?: MediaStreamTrack) => void; stop: () => void; abort: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null }
interface RecognitionClass { new (): Recognition; available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string>; install?: (o: { langs: string[]; processLocally: boolean }) => Promise<boolean> }
const recognitionClass = () => (window as unknown as { SpeechRecognition?: RecognitionClass }).SpeechRecognition
const tag = (lang: Lang) => (lang === 'ru' ? 'ru-RU' : 'en-US')

/** Whether Chrome can read speech by itself on this device, without sending it to Google. */
export async function chromeSpeech(lang: Lang): Promise<'ready' | 'download' | 'no'> {
  const state = await recognitionClass()?.available?.({ langs: [tag(lang)], processLocally: true }).catch(() => 'unavailable')
  return state === 'available' ? 'ready' : state === 'downloadable' || state === 'downloading' ? 'download' : 'no'
}

/** Which way this device reads speech: the browser's own language pack is the lightest when there is one. */
export async function speechPlan(lang: Lang) {
  const device = readDevice()
  const chrome = await chromeSpeech(lang)
  const useChrome = chrome !== 'no' && device.tier !== 'strong'
  return { device, chrome, engine: useChrome ? 'chrome' as const : 'model' as const, model: modelFor(device.tier) }
}

function withModel(samples: Float32Array, lang: Lang, onProgress: (p: SpeechProgress) => void, signal: AbortSignal, tier: Tier) {
  return new Promise<string>((resolve, reject) => {
    const worker = new Worker(new URL('./speech-worker.ts', import.meta.url), { type: 'module' })
    const end = () => worker.terminate()
    let text = ''
    signal.addEventListener('abort', () => { end(); reject(new DOMException('Stopped', 'AbortError')) })
    worker.onerror = (e) => { end(); reject(new Error(e.message)) }
    worker.onmessage = ({ data: m }) => {
      if (m.type === 'download') onProgress({ stage: 'download', loaded: m.loaded, total: m.total })
      else if (m.type === 'reading') onProgress({ stage: 'reading', share: m.done / m.total, text })
      else if (m.type === 'text') { text = m.text; onProgress({ stage: 'reading', share: 1, text }) }
      else if (m.type === 'done') { end(); resolve(m.text) }
      else if (m.type === 'error') { end(); reject(new Error(m.message)) }
    }
    // Half the cores at most: the person is still using this computer.
    const threads = crossOriginIsolated ? Math.max(1, Math.min(4, Math.ceil((navigator.hardwareConcurrency || 2) / 2))) : 1
    const dist = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT}/dist/ort-wasm-simd-threaded.asyncify`
    worker.postMessage({ samples, language: lang === 'ru' ? 'russian' : 'english', model: modelFor(tier).id, threads, ort: { mjs: `${location.origin}/ort/ort-wasm-simd-threaded.asyncify.mjs`, wasm: `${dist}.wasm` } }, [samples.buffer])
  })
}

/** Plays the recording, silently, to the browser's own recogniser: it takes as long as the recording does. */
async function withChrome(blob: Blob, lang: Lang, onProgress: (p: SpeechProgress) => void, signal: AbortSignal) {
  const Class = recognitionClass()!
  // A language pack that never arrives must not leave someone waiting: the model takes over.
  const installed = await Promise.race([Class.install?.({ langs: [tag(lang)], processLocally: true }) ?? true, new Promise<boolean>((r) => setTimeout(() => r(false), 120_000))])
  if (!installed) throw new Error('the language pack did not install')
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  const context = new AudioContext()
  const out = context.createMediaStreamDestination()
  context.createMediaElementSource(audio).connect(out)
  const r = new Class()
  r.lang = tag(lang)
  r.continuous = true
  r.interimResults = false
  r.processLocally = true
  const finish = () => { audio.pause(); URL.revokeObjectURL(url); context.close().catch(() => {}) }
  return new Promise<string>((resolve, reject) => {
    let text = ''
    r.onresult = (e) => {
      text = Array.from(e.results as ArrayLike<ArrayLike<{ transcript: string }>>, (x) => x[0].transcript.trim()).join(' ')
      onProgress({ stage: 'reading', share: audio.duration ? audio.currentTime / audio.duration : 0, text })
    }
    r.onerror = (e) => { finish(); reject(new Error(e.error)) }
    r.onend = () => { finish(); resolve(text) }
    audio.onended = () => r.stop()
    signal.addEventListener('abort', () => { r.abort(); finish(); reject(new DOMException('Stopped', 'AbortError')) })
    r.start(out.stream.getAudioTracks()[0])
    audio.play().catch((e) => { finish(); reject(e) })
  })
}

/** Nothing here leaves the device: only the model comes in, once. */
export async function transcribe(blob: Blob, lang: Lang, onProgress: (p: SpeechProgress) => void, signal: AbortSignal) {
  onProgress({ stage: 'preparing' })
  const { device, engine } = await speechPlan(lang)
  if (engine === 'chrome') {
    try {
      const text = await withChrome(blob, lang, onProgress, signal)
      if (text.trim()) return text
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e
      console.warn('The browser could not read this recording, using the model.', e)
    }
  }
  return withModel(await decodeSpeech(blob), lang, onProgress, signal, device.tier)
}

/** Everything downloaded for these features on this device. The settings stay as they are. */
export async function forgetModels() {
  const names = await caches.keys().catch(() => [] as string[])
  await Promise.all(names.filter((n) => n.includes('transformers')).map((n) => caches.delete(n)))
  for (const db of ['folkbranch-faces', 'tensorflowjs']) await new Promise((r) => { const q = indexedDB.deleteDatabase(db); q.onsuccess = q.onerror = q.onblocked = r })
}
