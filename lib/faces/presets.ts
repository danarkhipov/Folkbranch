// The face services an owner can connect for cloud face detection and matching.
// Each preset says what the service expects and turns its answer into the same small shape.
// The parsers read only their own service's JSON, so a sample from the service's documentation is enough to check them.
import type { Box } from '../types'

export type FaceId = 'rekognition' | 'facepp' | 'luxand' | 'compreface'

/** A face frame in fractions of the photo, the same shape as a tag. */
export interface FaceBox extends Box {
  /** The service's own confidence that this is a face, 0 to 1 when known. */
  score?: number
  /** Some services return a face vector; kept for matching without another request. */
  embedding?: number[]
}

export interface FaceSize { width: number; height: number }
export interface FaceMatch { score: number; box?: FaceBox }

export interface FacePreset {
  id: FaceId
  label: string
  /** Where the photos go: shown to everyone before the first one is sent. */
  where: string
  base: string
  keysUrl: string
  pitch: string
  docs: string
  /** The service's request/response summary, kept next to the parser it describes. */
  request: {
    detect: string
    compare: string
  }
  style: FaceId
  needsSecret: boolean
  needsBase: boolean
  /** Above this the app shows a suggestion. Services use different scales, so each has its own. */
  threshold: number
  /** What a call costs, in dollars, as the service listed it in November 2026: a guide that changes. */
  perCall: number | null
  /** What the service keeps, when that is not "nothing": said in the interface before scanning. */
  keeps: string | null
  /** Free plan and what it costs in data, from the service's own terms; null when unknown. */
  free?: { data: 'private' | 'trains' | 'mixed' | 'unknown'; note: string }
  tested: string
  parseDetect: (body: unknown, size: FaceSize) => FaceBox[]
  parseCompare: (body: unknown, size: FaceSize) => FaceMatch | null
}

const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const fraction = (v: number, whole: number) => (whole > 0 ? v / whole : 0)
const clamped = (n: number) => Math.min(1, Math.max(0, n))
const unit = (n: number) => clamped(n > 1 ? n / 100 : n)

/** Amazon Rekognition DetectFaces: https://docs.aws.amazon.com/rekognition/latest/APIReference/API_DetectFaces.html */
function rekognitionDetect(body: unknown): FaceBox[] {
  const list = (body as { FaceDetails?: unknown })?.FaceDetails
  if (!Array.isArray(list)) return []
  const out: FaceBox[] = []
  for (const item of list) {
    const b = (item as { BoundingBox?: Record<string, unknown> })?.BoundingBox
    if (!b || !number(b.Left) || !number(b.Top) || !number(b.Width) || !number(b.Height)) continue
    const confidence = (item as { Confidence?: unknown }).Confidence
    out.push({ x: clamped(b.Left), y: clamped(b.Top), w: clamped(b.Width), h: clamped(b.Height), ...(number(confidence) ? { score: unit(confidence) } : {}) })
  }
  return out
}

/** Amazon Rekognition CompareFaces: https://docs.aws.amazon.com/rekognition/latest/APIReference/API_CompareFaces.html */
function rekognitionCompare(body: unknown): FaceMatch | null {
  const matches = (body as { FaceMatches?: unknown })?.FaceMatches
  if (!Array.isArray(matches) || !matches.length) return null
  const first = matches[0] as { Similarity?: unknown; Face?: { BoundingBox?: Record<string, unknown> } }
  if (!number(first.Similarity)) return null
  const b = first.Face?.BoundingBox
  const box = b && number(b.Left) && number(b.Top) && number(b.Width) && number(b.Height)
    ? { x: clamped(b.Left), y: clamped(b.Top), w: clamped(b.Width), h: clamped(b.Height) }
    : undefined
  return { score: unit(first.Similarity), ...(box ? { box } : {}) }
}

/** Face++ Detect: https://console.faceplusplus.com/documents/5679127 */
function faceppDetect(body: unknown, size: FaceSize): FaceBox[] {
  const list = (body as { faces?: unknown })?.faces
  if (!Array.isArray(list)) return []
  const out: FaceBox[] = []
  for (const item of list) {
    const r = (item as { face_rectangle?: Record<string, unknown> })?.face_rectangle
    if (!r || !number(r.left) || !number(r.top) || !number(r.width) || !number(r.height)) continue
    out.push({ x: clamped(fraction(r.left, size.width)), y: clamped(fraction(r.top, size.height)), w: clamped(fraction(r.width, size.width)), h: clamped(fraction(r.height, size.height)) })
  }
  return out
}

/** Face++ Compare: https://console.faceplusplus.com/documents/5679308 */
function faceppCompare(body: unknown, size: FaceSize): FaceMatch | null {
  const confidence = (body as { confidence?: unknown })?.confidence
  if (!number(confidence)) return null
  const faces = (body as { faces2?: unknown })?.faces2
  const r = Array.isArray(faces) ? (faces[0] as { face_rectangle?: Record<string, unknown> })?.face_rectangle : undefined
  const box = r && number(r.left) && number(r.top) && number(r.width) && number(r.height)
    ? { x: clamped(fraction(r.left, size.width)), y: clamped(fraction(r.top, size.height)), w: clamped(fraction(r.width, size.width)), h: clamped(fraction(r.height, size.height)) }
    : undefined
  return { score: unit(confidence), ...(box ? { box } : {}) }
}

/** Luxand.cloud detect: https://luxand.cloud/face-detection-api and the rectangle in https://luxand.cloud/face-recognition-blog/guide-how-to-build-emotion-recognition-application-with-javascript */
function luxandDetect(body: unknown, size: FaceSize): FaceBox[] {
  const parsed = body as { status?: unknown; faces?: unknown }
  if (parsed?.status !== 'success' || !Array.isArray(parsed.faces)) return []
  const out: FaceBox[] = []
  for (const item of parsed.faces) {
    const r = (item as { rectangle?: Record<string, unknown> })?.rectangle
    if (!r || !number(r.left) || !number(r.top) || !number(r.right) || !number(r.bottom)) continue
    const w = r.right - r.left
    const h = r.bottom - r.top
    const score = (item as { score?: unknown }).score
    out.push({ x: clamped(fraction(r.left, size.width)), y: clamped(fraction(r.top, size.height)), w: clamped(fraction(w, size.width)), h: clamped(fraction(h, size.height)), ...(number(score) ? { score: unit(score) } : {}) })
  }
  return out
}

/** Luxand.cloud verify: https://luxand.cloud/face-verification-api; the confidence field is the one documented for recognition at https://luxand.cloud/face-recognition-blog/how-to-build-facial-recognition-application-with-python */
function luxandCompare(body: unknown): FaceMatch | null {
  const parsed = body as { status?: unknown; confidence?: unknown }
  if (parsed?.status !== 'success' || !number(parsed.confidence)) return null
  return { score: unit(parsed.confidence) }
}

/** CompreFace detect: https://github.com/exadel-inc/CompreFace/blob/master/docs/Rest-API-description.md */
function comprefaceDetect(body: unknown, size: FaceSize): FaceBox[] {
  const list = (body as { result?: unknown })?.result
  if (!Array.isArray(list)) return []
  const out: FaceBox[] = []
  for (const item of list) {
    const b = (item as { box?: Record<string, unknown> })?.box
    if (!b || !number(b.x_min) || !number(b.y_min) || !number(b.x_max) || !number(b.y_max)) continue
    const w = b.x_max - b.x_min
    const h = b.y_max - b.y_min
    const probability = b.probability
    const embedding = (item as { embedding?: unknown }).embedding
    out.push({
      x: clamped(fraction(b.x_min, size.width)),
      y: clamped(fraction(b.y_min, size.height)),
      w: clamped(fraction(w, size.width)),
      h: clamped(fraction(h, size.height)),
      ...(number(probability) ? { score: clamped(probability) } : {}),
      ...(Array.isArray(embedding) && embedding.every(number) ? { embedding } : {}),
    })
  }
  return out
}

/** CompreFace recognize: https://github.com/exadel-inc/CompreFace/blob/master/docs/Rest-API-description.md#recognize-faces-from-a-given-image */
function comprefaceCompare(body: unknown, size: FaceSize): FaceMatch | null {
  const list = (body as { result?: unknown })?.result
  const first = Array.isArray(list) ? (list[0] as { subjects?: unknown; box?: Record<string, unknown> }) : undefined
  const subjects = first?.subjects
  const subject = Array.isArray(subjects) ? (subjects[0] as { similarity?: unknown }) : undefined
  if (!subject || !number(subject.similarity)) return null
  const b = first?.box
  const box = b && number(b.x_min) && number(b.y_min) && number(b.x_max) && number(b.y_max)
    ? { x: clamped(fraction(b.x_min, size.width)), y: clamped(fraction(b.y_min, size.height)), w: clamped(fraction(b.x_max - b.x_min, size.width)), h: clamped(fraction(b.y_max - b.y_min, size.height)) }
    : undefined
  return { score: clamped(subject.similarity), ...(box ? { box } : {}) }
}

export const FACE_PRESETS: FacePreset[] = [
  {
    id: 'rekognition', label: 'Amazon Rekognition', where: 'Amazon Web Services (США или выбранный регион)', base: 'https://rekognition.us-east-1.amazonaws.com', keysUrl: 'https://console.aws.amazon.com/iam/home#/security_credentials', docs: 'https://docs.aws.amazon.com/rekognition/latest/APIReference/API_DetectFaces.html',
    pitch: 'Точный сервис Amazon, платить за каждое фото',
    request: {
      detect: 'POST / with x-amz-target: RekognitionService.DetectFaces; JSON {"Image":{"Bytes":"<base64>"}}; answer {"FaceDetails":[{"BoundingBox":{"Left":0.08,"Top":0.15,"Width":0.79,"Height":0.75},"Confidence":99.9}]}',
      compare: 'POST / with x-amz-target: RekognitionService.CompareFaces; JSON {"SourceImage":{"Bytes":"..."},"TargetImage":{"Bytes":"..."},"SimilarityThreshold":0}; answer {"FaceMatches":[{"Face":{"BoundingBox":{...}},"Similarity":98.5}]}',
    },
    style: 'rekognition', needsSecret: true, needsBase: false, threshold: 0.8, perCall: 0.001, keeps: 'Amazon может хранить присланные фото и использовать их для улучшения сервиса, пока в AWS не включён отказ (AI services opt-out policy).',
    free: { data: 'private', note: 'Первый год: 5000 изображений в месяц бесплатно, дальше по цене за фото.' },
    tested: 'Не проверяли на настоящем ключе.',
    parseDetect: rekognitionDetect, parseCompare: rekognitionCompare,
  },
  {
    id: 'facepp', label: 'Face++ (Megvii)', where: 'Face++ (Китай)', base: 'https://api-us.faceplusplus.com', keysUrl: 'https://console.faceplusplus.com/dashboard/project', docs: 'https://console.faceplusplus.com/documents/5679127',
    pitch: 'Дешёвый и точный, серверы в Китае',
    request: {
      detect: 'POST /facepp/v3/detect, form api_key, api_secret, image_base64; answer {"faces":[{"face_rectangle":{"top":89,"left":104,"width":140,"height":141},"face_token":"..."}],"image_id":"...","request_id":"..."}',
      compare: 'POST /facepp/v3/compare, form api_key, api_secret, image_base64_1, image_base64_2; answer {"faces1":[...],"faces2":[...],"confidence":89.485,"thresholds":{"1e-3":62.327}}',
    },
    style: 'facepp', needsSecret: true, needsBase: false, threshold: 0.8, perCall: null, keeps: 'По условиям Face++ может хранить присланные данные для своих исследований; данные лица держит до 72 часов.',
    free: { data: 'unknown', note: 'Бесплатный ключ с ограничением запросов; условия данных неясны.' },
    tested: 'Не проверяли на настоящем ключе.',
    parseDetect: faceppDetect, parseCompare: faceppCompare,
  },
  {
    id: 'luxand', label: 'Luxand.cloud', where: 'Luxand.cloud (США)', base: 'https://api.luxand.cloud', keysUrl: 'https://dashboard.luxand.cloud/', docs: 'https://luxand.cloud/face-detection-api',
    pitch: 'Простой сервис с бесплатным лимитом',
    request: {
      detect: 'POST /photo/detect, header token, form photo; answer {"status":"success","faces":[{"rectangle":{"top":321,"left":329,"bottom":678,"right":686}}]}',
      compare: 'POST /v2/person with name, photos and store=1, then POST /photo/verify/{uuid} with photo, then DELETE /v2/person/{uuid}; answer {"status":"success","confidence":0.98}',
    },
    style: 'luxand', needsSecret: false, needsBase: false, threshold: 0.95, perCall: 0.0039, keeps: 'Luxand хранит шаблон лица-образца, пока идёт сравнение, и удаляет его сразу после ответа.',
    free: { data: 'private', note: '500 запросов в месяц бесплатно.' },
    tested: 'Не проверяли на настоящем ключе.',
    parseDetect: luxandDetect, parseCompare: luxandCompare,
  },
  {
    id: 'compreface', label: 'CompreFace (свой сервер)', where: 'ваш собственный сервер CompreFace', base: '', keysUrl: 'https://github.com/exadel-inc/CompreFace', docs: 'https://github.com/exadel-inc/CompreFace/blob/master/docs/Rest-API-description.md',
    pitch: 'Свой сервер: фото не выходят из вашей сети',
    request: {
      detect: 'POST /api/v1/detection/detect, header x-api-key, form file, query face_plugins=calculator; answer {"result":[{"box":{"probability":0.998,"x_max":376,"y_max":479,"x_min":68,"y_min":77},"embedding":[...]}]}',
      compare: 'POST /api/v1/recognition/recognize, header x-api-key, form file; answer {"result":[{"box":{...},"subjects":[{"similarity":0.99593,"subject":"lisan"}]}]}',
    },
    style: 'compreface', needsSecret: false, needsBase: true, threshold: 0.6, perCall: 0, keeps: 'Фото уходят только на ваш сервер CompreFace и там и остаются.',
    free: { data: 'private', note: 'Открытый исходный код: всё остаётся на вашем сервере.' },
    tested: 'Не проверяли на настоящем сервере.',
    parseDetect: comprefaceDetect, parseCompare: comprefaceCompare,
  },
]

export const facePreset = (id: string) => FACE_PRESETS.find((p) => p.id === id)

/** The presets without their parsers, for sending to the browser. */
export const faceChoices = () => FACE_PRESETS.map((p) => ({
  id: p.id, label: p.label, where: p.where, base: p.base, keysUrl: p.keysUrl, pitch: p.pitch, docs: p.docs,
  request: p.request, style: p.style, needsSecret: p.needsSecret, needsBase: p.needsBase, threshold: p.threshold,
  perCall: p.perCall, keeps: p.keeps, free: p.free, tested: p.tested,
}))
