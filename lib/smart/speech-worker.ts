// Whisper. Without the limits on repeating it can say one word over and over: measured, that doubled its errors.
// Reads speech away from the page, so the app stays usable however slow the device is.
import { env, pipeline } from '@huggingface/transformers'
import { RATE, splitAtQuiet } from './audio'

interface Job { samples: Float32Array | null; language: 'russian' | 'english'; model: string; threads: number; ort: { mjs: string; wasm: string } }

const send = (m: unknown) => (self as unknown as Worker).postMessage(m)

self.onmessage = async ({ data: job }: MessageEvent<Job>) => {
  try {
    env.allowLocalModels = false
    env.useWasmCache = false
    const wasm = env.backends.onnx.wasm!
    wasm.wasmPaths = job.ort
    wasm.numThreads = job.threads
    const files = new Map<string, [number, number]>()
    const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== 'progress' || !p.file) return
      files.set(p.file, [p.loaded ?? 0, p.total ?? 0])
      const all = [...files.values()]
      send({ type: 'download', loaded: all.reduce((n, f) => n + f[0], 0), total: all.reduce((n, f) => n + f[1], 0) })
    }
    // On the processor, always. Measured against WebGPU on a recent laptop it was faster here, with a far smaller model, and it runs anywhere.
    const read = await pipeline('automatic-speech-recognition', job.model, { device: 'wasm', dtype: 'q8', progress_callback })
    if (!job.samples) return send({ type: 'done', text: '' })
    const samples = job.samples
    const pieces = splitAtQuiet(samples)
    let text = ''
    for (let i = 0; i < pieces.length; i++) {
      send({ type: 'reading', done: i, total: pieces.length })
      const out = await read(samples.subarray(pieces[i][0], pieces[i][1]), { language: job.language, task: 'transcribe', sampling_rate: RATE, no_repeat_ngram_size: 3, repetition_penalty: 1.1, max_new_tokens: 200 } as never)
      text = `${text} ${(Array.isArray(out) ? out[0] : out).text.trim()}`.trim()
      send({ type: 'text', text })
    }
    send({ type: 'done', text })
  } catch (e) {
    send({ type: 'error', message: String((e as Error).message ?? e) })
  }
}
