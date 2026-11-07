'use client'
import type { Lang } from '../types'
import { decodeSpeech } from './audio'
import { chosen, ORT_VERSION } from './models'

export type SpeechProgress =
  | { stage: 'preparing' }
  | { stage: 'download'; loaded: number; total: number }
  | { stage: 'reading'; share: number; text: string }

function run(job: { samples: Float32Array | null; language?: string; model?: string }, onMessage: (m: { type: string; loaded?: number; total?: number; done?: number; text?: string }) => void, signal: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    const worker = job.model ? new Worker(new URL('./speech-worker.ts', import.meta.url), { type: 'module' }) : new Worker(new URL('./gigaam-worker.ts', import.meta.url), { type: 'module' })
    const end = () => worker.terminate()
    signal.addEventListener('abort', () => { end(); reject(new DOMException('Stopped', 'AbortError')) })
    worker.onerror = (e) => { end(); reject(new Error(e.message)) }
    worker.onmessage = ({ data: m }) => {
      if (m.type === 'done') { end(); resolve(m.text) }
      else if (m.type === 'error') { end(); reject(new Error(m.message)) }
      else onMessage(m)
    }
    // Half the cores at most: the person is still using this device.
    const threads = crossOriginIsolated ? Math.max(1, Math.min(4, Math.ceil((navigator.hardwareConcurrency || 2) / 2))) : 1
    const file = 'ort-wasm-simd-threaded.asyncify'
    worker.postMessage({ ...job, threads, ort: { mjs: `${location.origin}/ort/${file}.mjs`, wasm: `https://unpkg.com/onnxruntime-web@${ORT_VERSION}/dist/${file}.wasm` } }, job.samples ? [job.samples.buffer] : [])
  })
}

/** Fetches the model and the engine that runs it, and reads nothing. */
export async function prepareWhisper(model: string, onBytes: (loaded: number, total: number) => void, signal: AbortSignal) {
  await run({ samples: null, language: 'english', model }, (m) => { if (m.type === 'download') onBytes(m.loaded!, m.total!) }, signal)
}

/** Nothing here leaves the device. */
export async function transcribe(blob: Blob, lang: Lang, onProgress: (p: SpeechProgress) => void, signal: AbortSignal) {
  onProgress({ stage: 'preparing' })
  let text = ''
  return run({ samples: await decodeSpeech(blob), language: lang === 'ru' ? 'russian' : 'english', model: chosen('speech').whisper?.repo }, (m) => {
    if (m.type === 'download') onProgress({ stage: 'download', loaded: m.loaded!, total: m.total! })
    else if (m.type === 'reading') onProgress({ stage: 'reading', share: m.done! / m.total!, text })
    else if (m.type === 'text') { text = m.text!; onProgress({ stage: 'reading', share: 1, text }) }
  }, signal)
}
