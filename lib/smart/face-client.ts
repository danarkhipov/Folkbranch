'use client'
import type { Box } from '../types'
import { readDevice } from './device'

let worker: Worker | null = null
let nextId = 1
const waiting = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>()

function call<T>(message: Record<string, unknown>, image: ImageBitmap) {
  if (!worker) {
    worker = new Worker(new URL('./face-worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }) => {
      const w = waiting.get(data.id)
      waiting.delete(data.id)
      if (data.error) w?.reject(new Error(data.error))
      else w?.resolve(data.result as never)
    }
    worker.onerror = (e) => { waiting.forEach((w) => w.reject(new Error(e.message))); waiting.clear(); worker?.terminate(); worker = null }
  }
  const id = nextId++
  // Half the cores at most: the person is still using this device.
  const threads = crossOriginIsolated ? Math.max(1, Math.min(4, Math.ceil((navigator.hardwareConcurrency || 2) / 2))) : 1
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (v: never) => void, reject })
    worker!.postMessage({ ...message, id, threads, image }, [image])
  })
}

/** Faces on a photo, as parts of its width and height. A weak device skips the closer look at small faces. */
export async function findFaces(source: ImageBitmapSource) {
  return call<Box[]>({ type: 'faces', closer: readDevice().tier !== 'weak' }, await createImageBitmap(source))
}

/** A list of numbers that stands for this face, or nothing if no face is there. */
export async function facePrint(source: ImageBitmapSource, box: Box) {
  return call<number[] | null>({ type: 'describe', box }, await createImageBitmap(source))
}
