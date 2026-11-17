// The chart as a PDF, made in the browser: vector lines, real text and embedded fonts, so nothing goes to the
// server and nothing on the server has to hold the pictures in memory. Loaded only when someone prints.
import fontkit from '@pdf-lib/fontkit'
import { clip, closePath, type Color, endPath, lineTo, moveTo, PDFDocument, type PDFFont, type PDFImage, popGraphicsState, pushGraphicsState, rgb } from 'pdf-lib'
import { AVATAR_CY } from './graph/layout'
import type { Layout } from './graph/layout'
import { FIRST, SECOND } from './brand'
import { AVATAR, COLORS, NAME_PX, RINGS as SHARED_RINGS, squarePortrait, TEXT_MAX, wrapText, YEARS_PX } from './chart-style'
import type { PrintPlan } from './graph/print-plan'
import { lifeYears, personName, type Person } from './types'

// The same colours as the picture, in pdf-lib's terms.
const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255)
const INK = hex(COLORS.ink), SOFT = hex(COLORS.soft), LINE = hex(COLORS.line), ACCENT = hex(COLORS.accent)
const RINGS = Object.fromEntries(Object.entries(SHARED_RINGS).map(([k, v]) => [k, hex(v)])) as Record<string, ReturnType<typeof rgb>>
const DPI = 200
const MAX_PX = 320

const fetchBytes = async (url: string) => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}: ${r.status}`)
  return new Uint8Array(await r.arrayBuffer())
}

/** A square portrait at the size paper needs: more would only make the file heavy. */
const portrait = async (p: Person, px: number) => (await squarePortrait(p, px)).toDataURL('image/jpeg', 0.86)

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
        for (const line of wrapText(value, TEXT_MAX, (t) => font.widthOfTextAtSize(t, px))) {
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
    // The app's mark before the family's name, so a sheet on the wall says whose it is and where it came from.
    const label = printable(sans, total > 1 ? sheetLabel(index + 1, total, sheet.row + 1, sheet.col + 1) : title)
    // One sheet carries the name large, in the serif; a sheet of many only needs to say where it goes.
    const one = total === 1, mark = one ? 16 : 10, size = one ? 12 : 7, at = plan.marginPt / 3
    page.drawSvgPath(FIRST, { x: plan.marginPt, y: at + mark * 0.8, scale: mark / 64, color: INK })
    page.drawSvgPath(SECOND, { x: plan.marginPt, y: at + mark * 0.8, scale: mark / 64, color: ACCENT })
    page.drawText(one ? printable(serif, label) : label, { x: plan.marginPt + mark + 5, y: at, size, font: one ? serif : sans, color: one ? INK : SOFT })
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
