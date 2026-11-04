// Файлы MediaPipe отдаём сами: распознавание лиц работает без внешних сервисов.
import fs from 'node:fs'
const from = 'node_modules/@mediapipe/tasks-vision/wasm'
if (fs.existsSync(from)) fs.cpSync(from, 'public/mediapipe', { recursive: true })
