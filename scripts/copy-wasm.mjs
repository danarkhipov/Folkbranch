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

// The face recognition library, served as it is and loaded only when someone turns it on. Its models come from a CDN.
const faces = 'node_modules/@vladmandic/human/dist/human.esm.js'
if (fs.existsSync(faces)) {
  fs.mkdirSync('public/human', { recursive: true })
  fs.copyFileSync(faces, 'public/human/human.esm.js')
}
