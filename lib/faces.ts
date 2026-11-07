import type { Box } from './types'

// The model file is fetched by the browser; photos themselves never leave it.
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'

let detector: Promise<import('@mediapipe/tasks-vision').FaceDetector> | null = null

function getDetector() {
  return (detector ??= (async () => {
    const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision')
    const vision = await FilesetResolver.forVisionTasks('/mediapipe')
    return FaceDetector.createFromOptions(vision, { baseOptions: { modelAssetPath: MODEL }, runningMode: 'IMAGE', minDetectionConfidence: 0.45 })
  })())
}

export async function findFaces(img: HTMLImageElement): Promise<Box[]> {
  const d = await getDetector()
  const W = img.naturalWidth, H = img.naturalHeight
  return d.detect(img).detections.flatMap((f) => {
    const b = f.boundingBox
    if (!b) return []
    // A little air around the face reads better as a frame and as an avatar.
    const pad = 0.18
    const x = Math.max(0, (b.originX - b.width * pad) / W), y = Math.max(0, (b.originY - b.height * pad * 1.4) / H)
    return [{ x, y, w: Math.min(1 - x, (b.width * (1 + 2 * pad)) / W), h: Math.min(1 - y, (b.height * (1 + 2.4 * pad)) / H) }]
  })
}

/** The square inside a tag frame, in fractions of the photo: used for one-click avatars. */
export function squareCrop(box: Box, photoW: number, photoH: number): Box {
  const px = { x: box.x * photoW, y: box.y * photoH, w: box.w * photoW, h: box.h * photoH }
  const side = Math.min(Math.max(px.w, px.h), photoW, photoH)
  const x = Math.min(photoW - side, Math.max(0, px.x + px.w / 2 - side / 2))
  const y = Math.min(photoH - side, Math.max(0, px.y + px.h / 2 - side / 2))
  return { x: x / photoW, y: y / photoH, w: side / photoW, h: side / photoH }
}

/** How much of the smaller box lies inside the other: above a third they are taken to be one face. */
export function overlap(a: Box, b: Box) {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  return (w * h) / Math.min(a.w * a.h, b.w * b.h)
}
