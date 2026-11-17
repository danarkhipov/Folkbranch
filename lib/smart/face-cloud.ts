'use client'
import { useCallback, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../client'
import { squareCrop } from '../faces'
import type { Box } from '../types'

export interface FaceCloudInfo {
  enabled: boolean
  provider: string | null
  label: string | null
  where: string | null
  keeps: string | null
  threshold: number | null
}

/** Whether the owner connected a face service, and which: asked once a minute at most. */
export function useFaceCloudInfo() {
  return useQuery({ queryKey: ['face-cloud-info'], queryFn: () => api<FaceCloudInfo>('faces/info'), staleTime: 60_000, retry: false })
}

// A photo leaves the device only on this device's own say-so. Unlike speech, cloud faces are the
// default once the owner connects them; a device can still choose the models it downloads itself.
const KEY = 'faces-cloud'
const listeners = new Set<() => void>()
const read = () => { try { return localStorage.getItem(KEY) !== 'off' } catch { return true } }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

export function useFaceCloud() {
  const info = useFaceCloudInfo().data
  const chosen = useSyncExternalStore(subscribe, read, () => true)
  const set = useCallback((on: boolean) => { try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch {} listeners.forEach((l) => l()) }, [])
  const enabled = !!info?.enabled
  return { enabled, info, chosen, use: enabled && chosen, set }
}

export class FaceCloudError extends Error {}

export interface PreparedFaceImage { image: string; width: number; height: number }
export interface CloudMatch { personId: string; score: number; box: Box | null }

const MAX_SIDE = 1024
const dataUrl = (canvas: HTMLCanvasElement) => canvas.toDataURL('image/jpeg', 0.86)

/** Photos are made smaller before they leave the device: enough for a face, less to send and to pay for. */
export async function prepareImage(source: ImageBitmapSource): Promise<PreparedFaceImage> {
  const bitmap = await createImageBitmap(source)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  return { image: dataUrl(canvas), width, height }
}

/** One tagged face, square and small: the service compares this with the faces on the new photo. */
export function prepareCrop(img: HTMLImageElement, box: Box): PreparedFaceImage {
  const W = img.naturalWidth
  const H = img.naturalHeight
  const crop = squareCrop(box, W, H)
  const x = crop.x * W
  const y = crop.y * H
  const side = Math.max(1, Math.round(crop.w * W))
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 192
  canvas.getContext('2d')!.drawImage(img, x, y, side, side, 0, 0, 192, 192)
  return { image: dataUrl(canvas), width: 192, height: 192 }
}

/** The photo and the tagged faces go to this archive's server, which forwards them to the owner's service. */
export async function scanFacesCloud(
  photo: PreparedFaceImage,
  references: { personId: string; photo: PreparedFaceImage }[],
  signal: AbortSignal,
): Promise<{ faces: Box[]; matches: CloudMatch[]; threshold: number }> {
  const res = await fetch('/api/v1/faces/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo, references }),
    signal,
  })
  if (!res.ok) throw new FaceCloudError((await res.json().catch(() => null))?.error ?? res.statusText)
  return res.json()
}
