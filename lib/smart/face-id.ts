'use client'
import type { Box, MediaTag } from '../types'
import { bestMatch, type Guess } from './face-match'

// Everything here stays in this browser: the likeness of a face is not written to the server or sent anywhere.
const MODELS = 'https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/models/'
/** Several photos of a person are enough, and a device should not be asked to read the whole archive. */
const PER_PERSON = 5
const MAX_FACES = 150

type Human = import('@vladmandic/human').Human
let human: Promise<Human> | null = null

function getHuman() {
  return (human ??= (async () => {
    // Served as it is, so a library this large stays out of the app's own bundles.
    const { Human } = await import(/* turbopackIgnore: true */ /* webpackIgnore: true */ '/human/human.esm.js' as string) as typeof import('@vladmandic/human')
    const h = new Human({
      modelBasePath: MODELS, backend: 'webgl', debug: false, cacheSensitivity: 0, filter: { enabled: false },
      face: { enabled: true, detector: { rotation: true, maxDetected: 1, return: false }, mesh: { enabled: true }, iris: { enabled: false }, description: { enabled: true }, emotion: { enabled: false }, antispoof: { enabled: false }, liveness: { enabled: false } },
      body: { enabled: false }, hand: { enabled: false }, object: { enabled: false }, gesture: { enabled: false }, segmentation: { enabled: false },
    })
    // A device that cannot run this says so rather than leaving someone waiting.
    await Promise.race([h.load(), new Promise((_, reject) => setTimeout(() => reject(new Error('the model did not load in time')), 90_000))])
    return h
  })())
}

function store(mode: IDBTransactionMode) {
  return new Promise<IDBObjectStore>((resolve, reject) => {
    const q = indexedDB.open('folkbranch-faces', 1)
    q.onupgradeneeded = () => q.result.createObjectStore('faces')
    q.onerror = () => reject(q.error)
    q.onsuccess = () => resolve(q.result.transaction('faces', mode).objectStore('faces'))
  })
}
const remembered = async (key: string) => { const s = await store('readonly'); return new Promise<number[] | undefined>((r) => { const q = s.get(key); q.onsuccess = () => r(q.result); q.onerror = () => r(undefined) }) }
const remember = async (key: string, value: number[]) => { (await store('readwrite')).put(value, key) }

function crop(img: HTMLImageElement | ImageBitmap, box: Box, W: number, H: number) {
  // The model finds the face itself, so it needs some of what is around it.
  const air = 0.35
  const x = Math.max(0, (box.x - box.w * air) * W), y = Math.max(0, (box.y - box.h * air) * H)
  const w = Math.min(W - x, box.w * (1 + 2 * air) * W), h = Math.min(H - y, box.h * (1 + 2 * air) * H)
  const scale = Math.min(1, 640 / Math.max(w, h))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * scale))
  c.height = Math.max(1, Math.round(h * scale))
  c.getContext('2d')!.drawImage(img, x, y, w, h, 0, 0, c.width, c.height)
  return c
}

async function likeness(h: Human, img: HTMLImageElement | ImageBitmap, box: Box, W: number, H: number) {
  const { face } = await h.detect(crop(img, box, W, H))
  return face[0]?.embedding?.length ? face[0].embedding : null
}

const breathe = () => new Promise((r) => setTimeout(r, 30))

export type { Guess } from './face-match'
export type FaceProgress = { stage: 'model' } | { stage: 'learning'; done: number; total: number }

/** Tagged faces, at most a few of each person, the likeness of each kept so it is worked out only once. */
export async function learnFaces(tags: { tag: MediaTag; mediaId: string; url: string }[], onProgress: (p: FaceProgress) => void, signal: AbortSignal) {
  onProgress({ stage: 'model' })
  const h = await getHuman()
  const taken = new Map<string, number>()
  const chosen = tags.filter(({ tag }) => {
    if (!tag.personId || tag.x === null) return false
    const n = taken.get(tag.personId) ?? 0
    taken.set(tag.personId, n + 1)
    return n < PER_PERSON
  }).slice(0, MAX_FACES)
  const known: { personId: string; face: number[] }[] = []
  let done = 0
  for (const { tag, url } of chosen) {
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError')
    onProgress({ stage: 'learning', done: done++, total: chosen.length })
    let face: number[] | undefined = await remembered(tag.id)
    if (!face) {
      const bitmap = await fetch(url).then((r) => r.blob()).then(createImageBitmap).catch(() => null)
      if (!bitmap) continue
      const found: number[] = (await likeness(h, bitmap, tag as Box, bitmap.width, bitmap.height)) ?? []
      face = found
      bitmap.close()
      await remember(tag.id, found)
      await breathe()
    }
    if (face.length) known.push({ personId: tag.personId!, face })
  }
  return known
}

/** The best match for each face, among people not already on this photo. */
export async function guessFaces(img: HTMLImageElement, boxes: Box[], known: { personId: string; face: number[] }[], signal: AbortSignal) {
  const h = await getHuman()
  const out: (Guess | null)[] = []
  for (const box of boxes) {
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError')
    const face = await likeness(h, img, box, img.naturalWidth, img.naturalHeight)
    out.push(face ? bestMatch(known.map((k) => ({ personId: k.personId, score: h.match.similarity(face, k.face) }))) : null)
    await breathe()
  }
  return out
}
