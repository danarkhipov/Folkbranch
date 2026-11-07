// Finds and compares faces away from the page, so the app stays usable however slow the device is.
import * as ort from 'onnxruntime-web/wasm'
import type { Box } from '../types'

interface Found extends Box { score: number; marks: [number, number][] }

const opened = new Map<string, Promise<ort.InferenceSession>>()
const fromCache = async (name: string) => { const hit = await (await caches.open('folkbranch-models')).match(`/smart-models/${name}`); if (!hit) throw new Error(`${name} is not downloaded`); return new Uint8Array(await hit.arrayBuffer()) }
let ready: Promise<void> | null = null
function prepare(threads: number) {
  return (ready ??= (async () => {
    ort.env.wasm.wasmBinary = (await fromCache('ort.wasm')).buffer as ArrayBuffer
    ort.env.wasm.wasmPaths = { mjs: `${self.location.origin}/ort/ort-wasm-simd-threaded.mjs` }
    ort.env.wasm.numThreads = threads
    ort.env.logLevel = 'error'
  })())
}
const session = (name: string) => {
  let s = opened.get(name)
  if (!s) { s = fromCache(name).then((bytes) => ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] })); opened.set(name, s) }
  return s
}

const SIDE = 640
function suppress(boxes: Found[]) {
  const out: Found[] = []
  for (const b of boxes.sort((x, y) => y.score - x.score)) {
    const clash = out.some((o) => {
      const w = Math.max(0, Math.min(o.x + o.w, b.x + b.w) - Math.max(o.x, b.x)), h = Math.max(0, Math.min(o.y + o.h, b.y + b.h) - Math.max(o.y, b.y))
      return (w * h) / (o.w * o.h + b.w * b.h - w * h) > 0.3
    })
    if (!clash) out.push(b)
  }
  return out
}

/** One look at a picture or a part of it. Coordinates come back in pixels of the part. */
async function look(source: CanvasImageSource, width: number, height: number, threshold: number): Promise<Found[]> {
  const s = await session('yunet.onnx')
  const k = SIDE / Math.max(width, height)
  const canvas = new OffscreenCanvas(SIDE, SIDE)
  const g = canvas.getContext('2d', { willReadFrequently: true })!
  g.fillStyle = '#000'
  g.fillRect(0, 0, SIDE, SIDE)
  g.drawImage(source, 0, 0, Math.round(width * k), Math.round(height * k))
  const d = g.getImageData(0, 0, SIDE, SIDE).data
  const n = SIDE * SIDE
  const input = new Float32Array(3 * n)
  for (let i = 0; i < n; i++) { input[i] = d[i * 4 + 2]; input[i + n] = d[i * 4 + 1]; input[i + 2 * n] = d[i * 4] }
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIDE, SIDE]) })
  const found: Found[] = []
  for (const stride of [8, 16, 32]) {
    const cls = out[`cls_${stride}`].data as Float32Array, obj = out[`obj_${stride}`].data as Float32Array, bbox = out[`bbox_${stride}`].data as Float32Array, kps = out[`kps_${stride}`].data as Float32Array
    const cols = Math.floor(SIDE / stride), rows = cols
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      const score = Math.sqrt(Math.min(1, Math.max(0, cls[i])) * Math.min(1, Math.max(0, obj[i])))
      if (score < threshold) continue
      const cx = (c + bbox[i * 4]) * stride, cy = (r + bbox[i * 4 + 1]) * stride, w = Math.exp(bbox[i * 4 + 2]) * stride, h = Math.exp(bbox[i * 4 + 3]) * stride
      const marks: [number, number][] = []
      for (let m = 0; m < 5; m++) marks.push([(kps[i * 10 + m * 2] + c) * stride / k, (kps[i * 10 + m * 2 + 1] + r) * stride / k])
      found.push({ x: (cx - w / 2) / k, y: (cy - h / 2) / k, w: w / k, h: h / k, score, marks })
    }
  }
  return suppress(found)
}

/** The whole picture, then overlapping parts of it when asked: small faces in a group need a closer look. */
async function faces(image: ImageBitmap, closer: boolean) {
  const W = image.width, H = image.height
  const all = await look(image, W, H, 0.6)
  if (closer && Math.max(W, H) >= 800) {
    const side = Math.round(Math.max(W, H) * 0.55), tw = Math.min(W, side), th = Math.min(H, side), nx = W > side ? 3 : 1, ny = H > side ? 3 : 1
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const ox = nx === 1 ? 0 : Math.round((i * (W - tw)) / (nx - 1)), oy = ny === 1 ? 0 : Math.round((j * (H - th)) / (ny - 1))
      const part = new OffscreenCanvas(tw, th)
      part.getContext('2d')!.drawImage(image, ox, oy, tw, th, 0, 0, tw, th)
      for (const b of await look(part, tw, th, 0.6)) all.push({ ...b, x: b.x + ox, y: b.y + oy, marks: b.marks.map(([x, y]) => [x + ox, y + oy]) })
    }
  }
  return suppress(all)
}

// Where the two eyes, the nose and the mouth corners belong in the picture the comparer expects.
const REFERENCE = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]]
function alignment(src: [number, number][]) {
  let sx = 0, sy = 0, dx = 0, dy = 0
  for (let i = 0; i < 5; i++) { sx += src[i][0]; sy += src[i][1]; dx += REFERENCE[i][0]; dy += REFERENCE[i][1] }
  sx /= 5; sy /= 5; dx /= 5; dy /= 5
  let a = 0, b = 0, n = 0
  for (let i = 0; i < 5; i++) {
    const x = src[i][0] - sx, y = src[i][1] - sy, u = REFERENCE[i][0] - dx, v = REFERENCE[i][1] - dy
    a += x * u + y * v; b += x * v - y * u; n += x * x + y * y
  }
  a /= n; b /= n
  return [a, b, -b, a, dx - a * sx + b * sy, dy - b * sx - a * sy] as const
}

async function print(source: CanvasImageSource, marks: [number, number][]) {
  const s = await session('sface.onnx')
  const canvas = new OffscreenCanvas(112, 112)
  const g = canvas.getContext('2d', { willReadFrequently: true })!
  g.setTransform(...alignment(marks))
  g.drawImage(source, 0, 0)
  const d = g.getImageData(0, 0, 112, 112).data
  const n = 112 * 112
  const input = new Float32Array(3 * n)
  for (let i = 0; i < n; i++) { input[i] = d[i * 4 + 2]; input[i + n] = d[i * 4 + 1]; input[i + 2 * n] = d[i * 4] }
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, 112, 112]) })
  const v = Array.from(out[s.outputNames[0]].data as Float32Array)
  const length = Math.hypot(...v)
  return v.map((x) => x / length)
}

/** The face inside a frame someone drew or the detector found, with some of what is around it. */
async function describe(image: ImageBitmap, box: Box) {
  const W = image.width, H = image.height, air = 0.35
  const x = Math.max(0, (box.x - box.w * air) * W), y = Math.max(0, (box.y - box.h * air) * H)
  const w = Math.min(W - x, box.w * (1 + 2 * air) * W), h = Math.min(H - y, box.h * (1 + 2 * air) * H)
  const part = new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)))
  part.getContext('2d')!.drawImage(image, x, y, w, h, 0, 0, part.width, part.height)
  const [face] = (await look(part, part.width, part.height, 0.5)).sort((a, b) => b.w * b.h - a.w * a.h)
  return face ? print(part, face.marks) : null
}

self.onmessage = async ({ data: m }) => {
  try {
    await prepare(m.threads)
    let result: unknown = null
    if (m.type === 'faces') {
      const W = m.image.width, H = m.image.height
      result = (await faces(m.image, m.closer)).filter((f) => f.w >= 12 && f.h >= 12).map((f) => ({ x: f.x / W, y: f.y / H, w: f.w / W, h: f.h / H }))
    } else if (m.type === 'describe') result = await describe(m.image, m.box)
    m.image?.close?.()
    ;(self as unknown as Worker).postMessage({ id: m.id, result })
  } catch (e) {
    ;(self as unknown as Worker).postMessage({ id: m.id, error: String((e as Error).message ?? e) })
  }
}
