// The small loaders of the runtime for the on-device models. They must come from this address; their large files are fetched when someone asks for a model.
import fs from 'node:fs'
import path from 'node:path'
const speech = 'node_modules/@huggingface/transformers'
if (fs.existsSync(speech)) {
  const dist = path.join(fs.realpathSync(speech), '../../onnxruntime-web/dist')
  fs.mkdirSync('public/ort', { recursive: true })
  for (const file of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.asyncify.mjs']) fs.copyFileSync(path.join(dist, file), path.join('public/ort', file))
}
