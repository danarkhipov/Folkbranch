// The MediaPipe files are served by the app itself, so face detection needs no outside service.
import fs from 'node:fs'
const from = 'node_modules/@mediapipe/tasks-vision/wasm'
if (fs.existsSync(from)) fs.cpSync(from, 'public/mediapipe', { recursive: true })
