// The MediaPipe files are served by the app itself, so face detection needs no outside service.
import fs from 'node:fs'
import path from 'node:path'
const from = 'node_modules/@mediapipe/tasks-vision/wasm'
if (fs.existsSync(from)) fs.cpSync(from, 'public/mediapipe', { recursive: true })

// Only the small loader of the speech runtime: it must come from this address. Its large file is fetched when someone turns speech on.
const speech = 'node_modules/@huggingface/transformers'
if (fs.existsSync(speech)) {
  const loader = path.join(fs.realpathSync(speech), '../../onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs')
  fs.mkdirSync('public/ort', { recursive: true })
  fs.copyFileSync(loader, 'public/ort/ort-wasm-simd-threaded.asyncify.mjs')
}

// The face recognition library and its three models, served by the app: a CDN can be far too slow, and this is only about 10 MB.
const faces = 'node_modules/@vladmandic/human'
if (fs.existsSync(faces)) {
  fs.mkdirSync('public/human/models', { recursive: true })
  fs.copyFileSync(path.join(faces, 'dist/human.esm.js'), 'public/human/human.esm.js')
  for (const model of ['blazeface', 'facemesh', 'faceres']) for (const ext of ['json', 'bin']) fs.copyFileSync(path.join(faces, 'models', `${model}.${ext}`), `public/human/models/${model}.${ext}`)
}
