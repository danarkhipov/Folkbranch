// For workers: opens the runtime and the models from what the person downloaded.
import * as ort from 'onnxruntime-web/wasm'

const opened = new Map<string, Promise<ort.InferenceSession>>()
export const fromCache = async (name: string) => {
  const hit = await (await caches.open('folkbranch-models')).match(`/smart-models/${name}`)
  if (!hit) throw new Error(`${name} is not downloaded`)
  return hit
}
let ready: Promise<void> | null = null
export function prepare(threads: number) {
  return (ready ??= (async () => {
    ort.env.wasm.wasmBinary = await (await fromCache('ort.wasm')).arrayBuffer()
    ort.env.wasm.wasmPaths = { mjs: `${self.location.origin}/ort/ort-wasm-simd-threaded.mjs` }
    ort.env.wasm.numThreads = threads
    ort.env.logLevel = 'error'
  })())
}
export const session = (name: string) => {
  let s = opened.get(name)
  if (!s) { s = fromCache(name).then((r) => r.arrayBuffer()).then((bytes) => ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['wasm'] })); opened.set(name, s) }
  return s
}
export { ort }
