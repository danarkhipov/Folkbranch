// How a chart goes onto paper: one sheet at a readable size, or many sheets glued together with no card cut in two.
// Pure, so the numbers shown before printing are the ones the printer gets.
import { cardHeight, PRINT_PITCH } from './metrics'
import type { Layout } from './layout'
import type { Person } from '../types'

export type Paper = 'A4' | 'A3' | 'A2' | 'A1' | 'A0'
const MM = 72 / 25.4
export const PAPERS: Record<Paper, [number, number]> = { A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841], A0: [841, 1189] }
const MARGIN_MM = 10
/** Under this a name on paper cannot be read comfortably, and under the second, hardly at all. */
export const COMFORT_PT = 7
export const MIN_PT = 5
/** A name at chart scale 1. */
const NAME_PX = 15
/** A little room for the plus-free portrait ring and a caption's edge. */
const CARD_HALF = PRINT_PITCH / 2 - 2

export interface Sheet { x0: number; y0: number; x1: number; y1: number; row: number; col: number }
export interface PrintPlan { widthPt: number; heightPt: number; scale: number; namePt: number; sheets: Sheet[]; cutsCard: boolean; marginPt: number }

/** A paper's size in points, turned the way that suits the content. */
function sheetSize(paper: Paper, wide: boolean): [number, number] {
  const [a, b] = PAPERS[paper]
  return wide ? [b * MM, a * MM] : [a * MM, b * MM]
}

/** Everything on one sheet, as large as it fits. */
export function planOneSheet(layout: Layout, paper: Paper): PrintPlan {
  const { x, y, w, h } = layout.bounds
  const wide = w >= h
  const [W, H] = sheetSize(paper, wide)
  const marginPt = MARGIN_MM * MM
  const scale = w && h ? Math.min((W - 2 * marginPt) / w, (H - 2 * marginPt) / h, 1) : 1
  const pad = (W - 2 * marginPt) / scale - w
  const padY = (H - 2 * marginPt) / scale - h
  return { widthPt: W, heightPt: H, scale, namePt: NAME_PX * scale, marginPt, cutsCard: false, sheets: [{ x0: x - pad / 2, y0: y - padY / 2, x1: x + w + pad / 2, y1: y + h + padY / 2, row: 0, col: 0 }] }
}

/** Under this share of a sheet, a cut wastes too much paper: better to take fewer generations on one strip. */
const WORTH_FILLING = 0.45

interface Box { x0: number; x1: number; y0: number; y1: number }

/**
 * Names at this size on small sheets. A vertical cut must pass between people in every generation on the strip, and
 * those gaps rarely line up, so a strip takes as many generations as can still be cut well. With one generation there
 * is always a gap. The plan says so if a card still has to be cut, when a sheet is smaller than a card.
 */
export function planSheets(layout: Layout, persons: Map<string, Person>, paper: Paper, namePt: number): PrintPlan {
  const [W, H] = sheetSize(paper, layout.bounds.w >= layout.bounds.h)
  const marginPt = MARGIN_MM * MM
  const scale = namePt / NAME_PX
  const winW = (W - 2 * marginPt) / scale, winH = (H - 2 * marginPt) / scale
  const cards: (Box & { y: number })[] = [...layout.cards.values()].map((c) => ({ y: c.y, x0: c.x - CARD_HALF, x1: c.x + CARD_HALF, y0: c.y - 8, y1: c.y + cardHeight(persons.get(c.id), true) }))
  const rows = [...new Set(cards.map((c) => c.y))].sort((p, q) => p - q).map((y) => cards.filter((c) => c.y === y))
  const { x, w } = layout.bounds
  const right = x + w + 4

  /** The cuts across one strip: the furthest place on each sheet that goes through nobody. */
  const cutsFor = (strip: Box[]) => {
    const spans = strip.map((c) => [c.x0, c.x1] as const).sort((p, q) => p[0] - q[0])
    const out: { from: number; to: number; forced: boolean; thin: boolean }[] = []
    let from = x - 4
    while (from < right) {
      if (from + winW >= right) {
        out.push({ from, to: right, forced: false, thin: false })
        break
      }
      let at = from + winW
      for (;;) {
        const hit = spans.find(([a, b]) => a < at && at < b)
        if (!hit) break
        at = hit[0]
      }
      const forced = at <= from + 1
      if (forced) at = from + winW
      out.push({ from, to: at, forced, thin: at - from < winW * WORTH_FILLING })
      from = at
    }
    return out
  }

  const sheets: Sheet[] = []
  let cutsCard = false
  let r = 0
  let row = 0
  while (r < rows.length) {
    const top = Math.min(...rows[r].map((c) => c.y0))
    // As many generations as fit the sheet's height...
    let fit = 1
    while (r + fit < rows.length && Math.max(...rows[r + fit].map((c) => c.y1)) - top <= winH) fit++
    // ...and then as many of those as can be cut well.
    let take = fit
    let cuts = cutsFor(rows.slice(r, r + take).flat())
    while (take > 1 && cuts.some((c) => c.forced || c.thin)) {
      take--
      cuts = cutsFor(rows.slice(r, r + take).flat())
    }
    const strip = rows.slice(r, r + take).flat()
    const stripBottom = r + take < rows.length ? Math.min(...rows[r + take].map((c) => c.y0)) : Math.max(...strip.map((c) => c.y1)) + 1
    const bottom = Math.min(top + winH, stripBottom)
    if (Math.max(...strip.map((c) => c.y1)) - top > winH || cuts.some((c) => c.forced)) cutsCard = true
    cuts.forEach((c, col) => sheets.push({ x0: c.from, x1: c.to, y0: top, y1: bottom, row, col }))
    r += take
    row++
  }
  // A sheet with nobody and no line on it would only waste paper.
  const overlaps = (b: readonly [number, number, number, number], s: Sheet) => b[2] > s.x0 && b[0] < s.x1 && b[3] > s.y0 && b[1] < s.y1
  const used = sheets.filter((s) => cards.some((c) => c.x1 > s.x0 && c.x0 < s.x1 && c.y1 > s.y0 && c.y0 < s.y1) || layout.edges.some((e) => overlaps(e.box, s)) || layout.unions.some((u) => overlaps(u.box, s)))
  return { widthPt: W, heightPt: H, scale, namePt, marginPt, cutsCard, sheets: used }
}

export const readability = (namePt: number) => (namePt < MIN_PT ? 'tiny' : namePt < COMFORT_PT ? 'small' : 'good')
