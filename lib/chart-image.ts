// The chart as one picture, made in the browser: a relative can open it on a phone or print it without the app.
// Drawn from the same layout as the PDF, at a scale where the smallest text, the years, is still crisp when zoomed.
import { AVATAR_CY, type Layout } from './graph/layout'
import { lifeYears, personName, type Person } from './types'
import { FIRST, SECOND } from './brand'
import { AVATAR, COLORS, NAME_PX, RINGS, squarePortrait, TEXT_MAX, wrapText, YEARS_PX } from './chart-style'

const { ink: INK, soft: SOFT, line: LINE, paper: PAPER, accent: ACCENT } = COLORS
const MARGIN = 40, HEADER = 72, FOOTER = 28

// Browsers refuse canvases past these: Chrome near 268 Mpx, Safari on phones near 16.7 Mpx, every one past 16 384 px a side.
const MAX_SIDE = 16_384
const MAX_AREA = 16_000_000

/** How much the layout is enlarged: 3× when it fits, less for a very large family, never under 1×. */
export function imageScale(width: number, height: number, wanted = 3) {
  const { w, h } = imageBox(width, height)
  return Math.max(1, Math.min(wanted, MAX_SIDE / w, MAX_SIDE / h, Math.sqrt(MAX_AREA / (w * h))))
}

/** The picture before scaling: the chart, a header with the family's name, a footer and margins. */
export const imageBox = (width: number, height: number) => ({ w: Math.max(width, 420) + 2 * MARGIN, h: height + 2 * MARGIN + HEADER + FOOTER })

/** The picture's size in pixels, as the browser will make it. */
export const imagePixels = (width: number, height: number) => {
  const { w, h } = imageBox(width, height), s = imageScale(width, height)
  return { w: Math.round(w * s), h: Math.round(h * s), scale: s }
}

async function loadFonts() {
  const faces = [new FontFace('FB Serif', 'url(/fonts/Literata-SemiBold.ttf)'), new FontFace('FB Sans', 'url(/fonts/GolosText-Regular.ttf)')]
  await Promise.all(faces.map(async (f) => { document.fonts.add(await f.load()) }))
}

export interface ImageInput { layout: Layout; persons: Person[]; title: string; subtitle: string; hiddenLabel: string; madeWith: string; onProgress?: (done: number, total: number) => void }

export async function chartToPng({ layout, persons, title, subtitle, hiddenLabel, madeWith, onProgress }: ImageInput): Promise<Blob> {
  await loadFonts()
  const { x: bx, y: by, w: bw, h: bh } = layout.bounds
  const s = imageScale(bw, bh)
  const canvas = document.createElement('canvas')
  const { w: W, h: H } = imageBox(bw, bh)
  canvas.width = Math.ceil(W * s)
  canvas.height = Math.ceil(H * s)
  const x = canvas.getContext('2d')
  if (!x) throw new Error('too-large')
  x.fillStyle = PAPER
  x.fillRect(0, 0, canvas.width, canvas.height)
  x.scale(s, s)

  // Whose family this is, so it still says so when forwarded: the mark, the name, what part and when.
  x.save()
  x.translate(MARGIN, MARGIN - 6)
  x.scale(44 / 64, 44 / 64)
  x.fillStyle = INK; x.fill(new Path2D(FIRST))
  x.fillStyle = ACCENT; x.fill(new Path2D(SECOND))
  x.restore()
  x.fillStyle = INK
  x.font = '600 26px "FB Serif"'
  x.fillText(title, MARGIN + 58, MARGIN + 16, W - 2 * MARGIN - 58)
  x.fillStyle = SOFT
  x.font = '13px "FB Sans"'
  x.fillText(subtitle, MARGIN + 58, MARGIN + 36, W - 2 * MARGIN - 58)
  x.strokeStyle = '#e3dccd'
  x.lineWidth = 1
  x.beginPath(); x.moveTo(MARGIN, MARGIN + HEADER - 14); x.lineTo(W - MARGIN, MARGIN + HEADER - 14); x.stroke()
  x.fillStyle = SOFT
  x.font = '11px "FB Sans"'
  x.textAlign = 'right'
  x.fillText(madeWith, W - MARGIN, H - MARGIN / 2)
  x.textAlign = 'start'
  x.translate(MARGIN - bx + (Math.max(bw, 420) - bw) / 2, MARGIN + HEADER - by)

  x.strokeStyle = LINE
  x.lineCap = 'round'
  for (const e of layout.edges) {
    x.lineWidth = 1.3
    x.setLineDash(e.style === 'solid' ? [] : [4, 3])
    x.stroke(new Path2D(e.path))
  }
  x.setLineDash([])
  for (const u of layout.unions) {
    x.lineWidth = 1.8
    x.stroke(new Path2D(u.path))
    x.fillStyle = INK
    x.beginPath(); x.arc(u.x, u.y, 4, 0, 2 * Math.PI); x.fill()
  }

  const byId = new Map(persons.map((p) => [p.id, p]))
  const cards = [...layout.cards.values()]
  for (const [i, c] of cards.entries()) {
    const p = byId.get(c.id)
    if (!p) continue
    const cy = c.y + AVATAR_CY
    x.fillStyle = '#fff'
    x.strokeStyle = RINGS[p.sex] ?? RINGS.U
    x.lineWidth = 2.2
    x.beginPath(); x.arc(c.x, cy, AVATAR + 3, 0, 2 * Math.PI); x.fill(); x.stroke()
    try {
      const img = await squarePortrait(p, Math.ceil(2 * AVATAR * s))
      x.save()
      x.beginPath(); x.arc(c.x, cy, AVATAR, 0, 2 * Math.PI); x.clip()
      x.drawImage(img, c.x - AVATAR, cy - AVATAR, 2 * AVATAR, 2 * AVATAR)
      x.restore()
    } catch {
      // A photo that will not load leaves the plain circle.
    }
    // Paper under each line of text, so a line to a parent does not cross a name.
    let y = cy + AVATAR + 13
    const lines: { text: string; y: number; px: number; font: string; color: string }[] = []
    const add = (value: string, font: string, px: number, leading: number, color: string) => {
      x.font = font
      for (const text of wrapText(value, TEXT_MAX, (t) => x.measureText(t).width)) { y += px * leading; lines.push({ text, y, px, font, color }) }
    }
    add(p.hidden ? hiddenLabel : personName(p), `600 ${NAME_PX}px "FB Serif"`, NAME_PX, 1.2, INK)
    if (!p.hidden) add(lifeYears(p), `${YEARS_PX}px "FB Sans"`, YEARS_PX, 1.3, SOFT)
    x.textAlign = 'center'
    for (const l of lines) {
      x.font = l.font
      const w = x.measureText(l.text).width + 4
      x.fillStyle = PAPER
      x.fillRect(c.x - w / 2, l.y - l.px, w, l.px * 1.3)
    }
    for (const l of lines) { x.font = l.font; x.fillStyle = l.color; x.fillText(l.text, c.x, l.y) }
    x.textAlign = 'start'
    if (i % 20 === 0) { onProgress?.(i, cards.length); await new Promise((r) => setTimeout(r)) }
  }
  onProgress?.(cards.length, cards.length)
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
  if (!blob) throw new Error('too-large')
  return blob
}
