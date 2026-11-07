import type { Box } from './types'

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
