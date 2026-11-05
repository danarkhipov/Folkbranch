// The chart as a PDF, made in the browser: vector lines, real text and embedded fonts, so nothing goes to the
// server and nothing on the server has to hold the pictures in memory. Loaded only when someone prints.
import fontkit from '@pdf-lib/fontkit'
import { clip, closePath, type Color, endPath, lineTo, moveTo, PDFDocument, type PDFFont, type PDFImage, popGraphicsState, pushGraphicsState, rgb } from 'pdf-lib'
import { avatarUrl } from './client'
import { AVATAR_CY } from './graph/layout'
import type { Layout } from './graph/layout'
import type { PrintPlan } from './graph/print-plan'
import { lifeYears, personName, type Person } from './types'

const INK = rgb(0.165, 0.149, 0.125)
const SOFT = rgb(0.361, 0.337, 0.29)
const LINE = rgb(0.45, 0.42, 0.36)
const RINGS: Record<string, ReturnType<typeof rgb>> = { M: rgb(0.361, 0.478, 0.51), F: rgb(0.706, 0.412, 0.31), U: rgb(0.541, 0.51, 0.447) }
const AVATAR = 30
const NAME_PX = 15
const YEARS_PX = 13
const TEXT_MAX = 120
const DPI = 200
const MAX_PX = 320

const fetchBytes = async (url: string) => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}: ${r.status}`)
  return new Uint8Array(await r.arrayBuffer())
}

function wrap(text: string, font: PDFFont, size: number, max: number) {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (line && font.widthOfTextAtSize(next, size) > max) {
      lines.push(line)
      line = word
    } else line = next
    // A word wider than a card is cut with a hyphen.
    while (font.widthOfTextAtSize(line, size) > max) {
      let n = line.length - 1
      while (n > 1 && font.widthOfTextAtSize(`${line.slice(0, n)}-`, size) > max) n--
      lines.push(`${line.slice(0, n)}-`)
      line = line.slice(n)
    }
  }
  if (line) lines.push(line)
  return lines
}

/** A square portrait at the size paper needs: more would only make the file heavy. */
async function portrait(p: Person, px: number) {
  const img = new Image()
  img.src = avatarUrl(p)
  await img.decode()
  const c = document.createElement('canvas')
  c.width = c.height = px
  const x = c.getContext('2d')!
  const side = Math.min(img.naturalWidth || px, img.naturalHeight || px)
  x.fillStyle = '#e7dfcd'
  x.fillRect(0, 0, px, px)
  x.drawImage(img, ((img.naturalWidth || px) - side) / 2, ((img.naturalHeight || px) - side) / 2, side, side, 0, 0, px, px)
  return c.toDataURL('image/jpeg', 0.86)
}

/** Text in a font's own letters: anything it lacks is left out rather than stopping the whole print. */
const printable = (font: PDFFont, text: string) => {
  const known = new Set(font.getCharacterSet())
  return [...text].filter((ch) => known.has(ch.codePointAt(0)!)).join('')
}

export interface PrintInput {
  layout: Layout
  persons: Person[]
  plan: PrintPlan
  title: string
  sheetLabel: (sheet: number, of: number, row: number, col: number) => string
  hiddenLabel: string
  onProgress?: (done: number, total: number) => void
}

export async function chartToPdf({ layout, persons, plan, title, sheetLabel, hiddenLabel, onProgress }: PrintInput) {
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  pdf.setTitle(title)
  pdf.setCreator('Folkbranch')
  const [serifBytes, sansBytes] = await Promise.all([fetchBytes('/fonts/Literata-SemiBold.ttf'), fetchBytes('/fonts/GolosText-Regular.ttf')])
  const serif = await pdf.embedFont(serifBytes, { subset: true })
  const sans = await pdf.embedFont(sansBytes, { subset: true })

  const px = Math.min(MAX_PX, Math.max(48, Math.ceil(((2 * AVATAR * plan.scale) / 72) * DPI)))
  const pictures = new Map<string, PDFImage>()
  for (const [i, p] of persons.entries()) {
    if (!layout.cards.has(p.id)) continue
    try {
      pictures.set(p.id, await pdf.embedJpg(await portrait(p, px)))
    } catch {
      // A missing photo leaves a plain circle.
    }
    if (i % 20 === 0) {
      onProgress?.(i, persons.length)
      await new Promise((r) => setTimeout(r))
    }
  }

  const byId = new Map(persons.map((p) => [p.id, p]))
  const total = plan.sheets.length
  plan.sheets.forEach((sheet, index) => {
    const page = pdf.addPage([plan.widthPt, plan.heightPt])
    const s = plan.scale
    const ox = plan.marginPt - sheet.x0 * s
    const oy = plan.heightPt - plan.marginPt + sheet.y0 * s
    const X = (x: number) => ox + x * s
    const Y = (y: number) => oy - y * s
    const seen = (b: [number, number, number, number]) => b[2] >= sheet.x0 - 4 && b[0] <= sheet.x1 + 4 && b[3] >= sheet.y0 - 4 && b[1] <= sheet.y1 + 4

    // Lines end at the sheet's own cut, not at the edge of the paper.
    const left = X(sheet.x0), right = X(sheet.x1), top = Y(sheet.y0), bottom = Y(sheet.y1)
    page.pushOperators(pushGraphicsState(), moveTo(left, bottom), lineTo(right, bottom), lineTo(right, top), lineTo(left, top), closePath(), clip(), endPath())
    for (const e of layout.edges) {
      if (seen(e.box)) page.drawSvgPath(e.path, { x: ox, y: oy, scale: s, borderColor: LINE, borderWidth: Math.max(0.35, 1.3 * s), ...(e.style === 'solid' ? {} : { borderDashArray: [4 * s, 3 * s] }) })
    }
    for (const u of layout.unions) {
      if (!seen(u.box)) continue
      page.drawSvgPath(u.path, { x: ox, y: oy, scale: s, borderColor: LINE, borderWidth: Math.max(0.4, 1.8 * s) })
      page.drawCircle({ x: X(u.x), y: Y(u.y), size: 4 * s, color: INK })
    }
    for (const c of layout.cards.values()) {
      if (c.x < sheet.x0 || c.x >= sheet.x1 || c.y < sheet.y0 - 1 || c.y >= sheet.y1) continue
      const p = byId.get(c.id)
      if (!p) continue
      const cy = Y(c.y + AVATAR_CY)
      page.drawCircle({ x: X(c.x), y: cy, size: (AVATAR + 3) * s, color: rgb(1, 1, 1), borderColor: RINGS[p.sex] ?? RINGS.U, borderWidth: 2.2 * s })
      const pic = pictures.get(c.id)
      if (pic) {
        // A round portrait: a polygon close enough to a circle at any size this prints.
        const r = AVATAR * s, steps = 48
        page.pushOperators(pushGraphicsState(), moveTo(X(c.x) + r, cy), ...Array.from({ length: steps }, (_, i) => lineTo(X(c.x) + r * Math.cos(((i + 1) / steps) * 2 * Math.PI), cy + r * Math.sin(((i + 1) / steps) * 2 * Math.PI))), closePath(), clip(), endPath())
        page.drawImage(pic, { x: X(c.x) - r, y: cy - r, width: 2 * r, height: 2 * r })
        page.pushOperators(popGraphicsState())
      }
      // A line going to a parent runs behind the name: paper under each line of text, as on the screen.
      let y = c.y + AVATAR_CY + AVATAR + 13
      const text: { line: string; y: number; size: number; font: PDFFont; color: Color }[] = []
      const add = (value: string, font: PDFFont, px: number, leading: number, color: Color) => {
        for (const line of wrap(value, font, px, TEXT_MAX)) {
          y += px * leading
          text.push({ line, y, size: px * s, font, color })
        }
      }
      add(printable(serif, p.hidden ? hiddenLabel : personName(p)), serif, NAME_PX, 1.2, INK)
      if (!p.hidden) add(printable(sans, lifeYears(p)), sans, YEARS_PX, 1.3, SOFT)
      for (const t of text) {
        const w = t.font.widthOfTextAtSize(t.line, t.size) + 3 * s
        page.drawRectangle({ x: X(c.x) - w / 2, y: Y(t.y) - t.size * 0.3, width: w, height: t.size * 1.3, color: rgb(1, 1, 1) })
      }
      for (const t of text) page.drawText(t.line, { x: X(c.x) - t.font.widthOfTextAtSize(t.line, t.size) / 2, y: Y(t.y), size: t.size, font: t.font, color: t.color })
    }
    page.pushOperators(popGraphicsState())

    // What this sheet is, and where to glue it.
    const label = printable(sans, total > 1 ? sheetLabel(index + 1, total, sheet.row + 1, sheet.col + 1) : title)
    page.drawText(label, { x: plan.marginPt, y: plan.marginPt / 3, size: 7, font: sans, color: SOFT })
    if (total > 1) {
      const tick = 8
      for (const [cx, cy] of [[left, top], [right, top], [left, bottom], [right, bottom]] as const) {
        page.drawLine({ start: { x: cx - tick, y: cy }, end: { x: cx + tick, y: cy }, thickness: 0.3, color: SOFT })
        page.drawLine({ start: { x: cx, y: cy - tick }, end: { x: cx, y: cy + tick }, thickness: 0.3, color: SOFT })
      }
    }
  })
  onProgress?.(persons.length, persons.length)
  return pdf.save()
}
