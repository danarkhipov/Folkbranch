'use client'
import { overlap } from '../faces'
import type { Box, MediaTag } from '../types'
import { facePrint, findFaces } from './face-client'
import { bestMatch, similarity, type Guess } from './face-match'

// Everything here stays in this browser: a face print is not written to the server or sent anywhere.
export type { Guess } from './face-match'
/** Several photos of a person are enough, and a device should not be asked to read the whole archive. */
const PER_PERSON = 5
const MAX_FACES = 150

type Shelf = 'prints' | 'seen' | 'refused'

function store(mode: IDBTransactionMode, shelf: Shelf = 'prints') {
  return new Promise<IDBObjectStore>((resolve, reject) => {
    const q = indexedDB.open('folkbranch-face-prints', 1)
    q.onupgradeneeded = () => { for (const s of ['prints', 'seen', 'refused']) q.result.createObjectStore(s) }
    q.onerror = () => reject(q.error)
    q.onsuccess = () => resolve(q.result.transaction(shelf, mode).objectStore(shelf))
  })
}
const remembered = async (key: string) => { const s = await store('readonly'); return new Promise<number[] | undefined>((r) => { const q = s.get(key); q.onsuccess = () => r(q.result); q.onerror = () => r(undefined) }) }
const remember = async (key: string, value: unknown, shelf: Shelf = 'prints') => { (await store('readwrite', shelf)).put(value, key) }
const keysOf = async (shelf: Shelf) => { const s = await store('readonly', shelf); return new Promise<Set<string>>((r) => { const q = s.getAllKeys(); q.onsuccess = () => r(new Set(q.result as string[])); q.onerror = () => r(new Set()) }) }

export type FaceProgress = { stage: 'model' } | { stage: 'learning'; done: number; total: number }

/** Tagged faces, at most a few of each person, the print of each kept so it is worked out only once. */
export async function learnFaces(tags: { tag: MediaTag; mediaId: string; url: string }[], onProgress: (p: FaceProgress) => void, signal: AbortSignal) {
  onProgress({ stage: 'model' })
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
    let face = await remembered(tag.id)
    if (!face) {
      const blob = await fetch(url).then((r) => r.blob()).catch(() => null)
      if (!blob) continue
      face = (await facePrint(blob, tag as Box)) ?? []
      await remember(tag.id, face)
    }
    if (face.length) known.push({ personId: tag.personId!, face })
  }
  return known
}

/** The best match for each face, among the people given. */
export async function guessFaces(img: ImageBitmapSource, boxes: Box[], known: { personId: string; face: number[] }[], signal: AbortSignal) {
  const out: (Guess | null)[] = []
  for (const box of boxes) {
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError')
    const face = await facePrint(img, box)
    out.push(face ? bestMatch(known.map((k) => ({ personId: k.personId, score: similarity(face, k.face) }))) : null)
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
  const W = img.naturalWidth, H = img.naturalHeight
  const side = Math.max(box.w * W, box.h * H)
  const small = document.createElement('canvas')
  small.width = small.height = 96
  small.getContext('2d')!.drawImage(img, (box.x + box.w / 2) * W - side / 2, (box.y + box.h / 2) * H - side / 2, side, side, 0, 0, 96, 96)
  return small.toDataURL('image/jpeg', 0.8)
}

/** Goes through photos not yet looked at, a limited number at a time, and reports each face it can put a name to. */
export async function scanPhotos(
  photos: { id: string; url: string; tags: MediaTag[] }[],
  known: { personId: string; face: number[] }[],
  { limit, onProgress, onFound, signal }: { limit: number; onProgress: (done: number, total: number) => void; onFound: (s: FaceSuggestion) => void; signal: AbortSignal },
) {
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
  }
  return { left: waiting.length - now.length }
}
