'use client'
import { ORT_VERSION } from './ort-version'

export function runSpeech(job: { samples: Float32Array | null; language?: string; model?: string }, onMessage: (m: { type: string; loaded?: number; total?: number; done?: number; text?: string }) => void, signal: AbortSignal) {
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
  await runSpeech({ samples: null, language: 'english', model }, (m) => { if (m.type === 'download') onBytes(m.loaded!, m.total!) }, signal)
}
