// What the printed chart and its picture share, so the two never drift apart: colours, sizes, how a name wraps,
// and a person's portrait as a square.
import { avatarUrl } from './client'
import type { Person } from './types'

export const COLORS = { ink: '#2a2620', soft: '#5c564a', line: '#736b5c', paper: '#fbf8f1', accent: '#a4502e', avatarBack: '#e7dfcd' }
export const RINGS: Record<string, string> = { M: '#5c7a82', F: '#b4694f', U: '#8a8272' }
export const AVATAR = 30, NAME_PX = 15, YEARS_PX = 13, TEXT_MAX = 120

/** Lines of at most `max` wide; a word wider than that is cut with a hyphen. `width` measures in the caller's font. */
export function wrapText(text: string, max: number, width: (s: string) => number) {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (line && width(next) > max) { lines.push(line); line = word } else line = next
    while (width(line) > max) {
      let n = line.length - 1
      while (n > 1 && width(`${line.slice(0, n)}-`) > max) n--
      lines.push(`${line.slice(0, n)}-`)
      line = line.slice(n)
    }
  }
  if (line) lines.push(line)
  return lines
}

/** A person's portrait cut to a square of `px`. A drawn avatar is a square SVG whose reported size is not its own: drawn whole. */
export async function squarePortrait(p: Person, px: number) {
  const img = new Image()
  img.src = avatarUrl(p)
  await img.decode()
  const c = document.createElement('canvas')
  c.width = c.height = px
  const x = c.getContext('2d')!
  x.fillStyle = COLORS.avatarBack
  x.fillRect(0, 0, px, px)
  if (img.src.startsWith('data:image/svg') || !img.naturalWidth || !img.naturalHeight) x.drawImage(img, 0, 0, px, px)
  else {
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    x.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, px, px)
  }
  return c
}
