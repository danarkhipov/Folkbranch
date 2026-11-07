'use client'
import type { Box, MediaTag } from '../types'
import { bestMatch, type Guess } from './face-match'

// Everything here stays in this browser: the likeness of a face is not written to the server or sent anywhere.
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
      modelBasePath: `${location.origin}/human/models/`, backend: 'webgl', debug: false, cacheSensitivity: 0, filter: { enabled: false },
      face: { enabled: true, detector: { rotation: true, maxDetected: 1, return: false }, mesh: { enabled: true }, iris: { enabled: false }, description: { enabled: true }, emotion: { enabled: false }, antispoof: { enabled: false }, liveness: { enabled: false } },
      body: { enabled: false }, hand: { enabled: false }, object: { enabled: false }, gesture: { enabled: false }, segmentation: { enabled: false },
    })
    // A device that cannot run this says so rather than leaving someone waiting.
    await Promise.race([h.init().then(() => h.load()), new Promise((_, reject) => setTimeout(() => reject(new Error('the model did not load in time')), 120_000))])
    return h
  })().catch((e) => { human = null; throw e }))
}

type Shelf = 'faces' | 'seen' | 'refused'

function store(mode: IDBTransactionMode, shelf: Shelf = 'faces') {
  return new Promise<IDBObjectStore>((resolve, reject) => {
    const q = indexedDB.open('folkbranch-faces', 2)
    q.onupgradeneeded = () => { for (const s of ['faces', 'seen', 'refused']) if (!q.result.objectStoreNames.contains(s)) q.result.createObjectStore(s) }
    q.onerror = () => reject(q.error)
    q.onsuccess = () => resolve(q.result.transaction(shelf, mode).objectStore(shelf))
  })
}
const remembered = async <T = number[]>(key: string, shelf: Shelf = 'faces') => { const s = await store('readonly', shelf); return new Promise<T | undefined>((r) => { const q = s.get(key); q.onsuccess = () => r(q.result); q.onerror = () => r(undefined) }) }
const remember = async (key: string, value: unknown, shelf: Shelf = 'faces') => { (await store('readwrite', shelf)).put(value, key) }
const keysOf = async (shelf: Shelf) => { const s = await store('readonly', shelf); return new Promise<Set<string>>((r) => { const q = s.getAllKeys(); q.onsuccess = () => r(new Set(q.result as string[])); q.onerror = () => r(new Set()) }) }

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

export interface FaceSuggestion { key: string; mediaId: string; box: Box; personId: string; score: number; thumb: string; width: number; height: number }

const boxKey = (mediaId: string, personId: string) => `${mediaId}:${personId}`

/** "This is not them" is remembered on this device, so nobody is asked the same thing twice. */
export const refuseFace = (s: FaceSuggestion) => remember(s.key, 1, 'refused')
/** Asks again about every photo, for when more faces have been tagged since. */
export async function forgetScans() {
  (await store('readwrite', 'seen')).clear()
  ;(await store('readwrite', 'refused')).clear()
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('photo did not load'))
    img.src = url
  })
}

function thumbnail(img: HTMLImageElement, box: Box) {
  const c = crop(img, { x: box.x + box.w * 0.1, y: box.y + box.h * 0.1, w: box.w * 0.8, h: box.h * 0.8 }, img.naturalWidth, img.naturalHeight)
  const small = document.createElement('canvas')
  small.width = small.height = 96
  const side = Math.min(c.width, c.height)
  small.getContext('2d')!.drawImage(c, (c.width - side) / 2, (c.height - side) / 2, side, side, 0, 0, 96, 96)
  return small.toDataURL('image/jpeg', 0.8)
}

/** Goes through photos not yet looked at, a limited number at a time, and reports each face it can put a name to. */
export async function scanPhotos(
  photos: { id: string; url: string; tags: MediaTag[] }[],
  known: { personId: string; face: number[] }[],
  { limit, pause, onProgress, onFound, signal }: { limit: number; pause: number; onProgress: (done: number, total: number) => void; onFound: (s: FaceSuggestion) => void; signal: AbortSignal },
) {
  const { findFaces, overlap } = await import('../faces')
  const seen = await keysOf('seen')
  const refused = await keysOf('refused')
  const waiting = photos.filter((p) => !seen.has(p.id))
  const now = waiting.slice(0, limit)
  for (let i = 0; i < now.length; i++) {
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError')
    onProgress(i, now.length)
    const photo = now[i]
    const img = await loadImage(photo.url).catch(() => null)
    if (img) {
      const framed = photo.tags.filter((t) => t.x !== null) as (MediaTag & Box)[]
      const faces = (await findFaces(img)).filter((f) => !framed.some((t) => overlap(f, t) > 0.3))
      const here = new Set(framed.flatMap((t) => t.personId ?? []))
      const guesses = await guessFaces(img, faces, known.filter((k) => !here.has(k.personId)), signal)
      guesses.forEach((g, j) => {
        if (!g || refused.has(boxKey(photo.id, g.personId))) return
        onFound({ key: boxKey(photo.id, g.personId), mediaId: photo.id, box: faces[j], personId: g.personId, score: g.score, thumb: thumbnail(img, faces[j]), width: img.naturalWidth, height: img.naturalHeight })
      })
    }
    await remember(photo.id, 1, 'seen')
    // Rests between photos, longer on a weak device, so the page keeps answering.
    await new Promise((r) => setTimeout(r, pause))
  }
  return { left: waiting.length - now.length }
}
