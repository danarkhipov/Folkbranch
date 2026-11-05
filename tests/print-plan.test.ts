import { describe, expect, it } from 'vitest'
import { layoutFamily } from '../lib/graph/layout'
import { PRINT_PITCH } from '../lib/graph/metrics'
import { PAPERS, planOneSheet, planSheets, readability } from '../lib/graph/print-plan'
import type { Person } from '../lib/types'
import { quality, randomFamily, TANGLE } from './layout-quality'

const big = randomFamily(4, 150)
const people = new Map<string, Person>(big.persons.map((p) => [p.id, p]))
const layout = layoutFamily(big, { print: true })

describe('the tight chart for paper', () => {
  it('takes noticeably less width than on screen', () => {
    expect(layout.bounds.w).toBeLessThan(layoutFamily(big).bounds.w * 0.8)
  })

  it('keeps its lines as tidy as the chart on screen', () => {
    const q = quality(layoutFamily(TANGLE, { print: true }), TANGLE)
    expect(q.crossings).toBe(0)
    expect(q.overlaps).toBe(0)
  })

  it('stands nobody on top of another, though a name is narrower', () => {
    const cards = [...layout.cards.values()]
    for (const a of cards) for (const b of cards) if (a !== b && a.y === b.y) expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(PRINT_PITCH - 0.01)
  })

  it('does not disturb the chart on screen', () => {
    const first = layoutFamily(big)
    layoutFamily(big, { print: true })
    expect([...layoutFamily(big).cards.values()]).toEqual([...first.cards.values()])
  })
})

describe('one sheet', () => {
  it('fits everything inside the margins, turned the way that suits it', () => {
    const p = planOneSheet(layout, 'A1')
    expect(p.widthPt).toBeGreaterThan(p.heightPt)
    expect(layout.bounds.w * p.scale).toBeLessThanOrEqual(p.widthPt - 2 * p.marginPt + 0.01)
    expect(layout.bounds.h * p.scale).toBeLessThanOrEqual(p.heightPt - 2 * p.marginPt + 0.01)
    expect(p.sheets).toHaveLength(1)
  })

  it('never enlarges past natural size, and larger paper means larger names', () => {
    expect(planOneSheet(layoutFamily(TANGLE, { print: true }), 'A0').scale).toBeLessThanOrEqual(1)
    expect(planOneSheet(layout, 'A0').namePt).toBeGreaterThan(planOneSheet(layout, 'A3').namePt)
  })

  it('says when the text will be too small', () => {
    expect(readability(3)).toBe('tiny')
    expect(readability(6)).toBe('small')
    expect(readability(9)).toBe('good')
  })

  it('an empty chart is not a division by zero', () => {
    const empty = layoutFamily({ persons: [], parentChild: [], unions: [] })
    expect(planOneSheet(empty, 'A4').scale).toBe(1)
  })
})

describe('many sheets', () => {
  it.each([['A4', 7], ['A4', 10], ['A3', 8], ['A4', 12]] as const)('%s at %i pt: every card is on exactly one sheet, whole', (paper, pt) => {
    const plan = planSheets(layout, people, paper, pt)
    expect(plan.cutsCard).toBe(false)
    for (const c of layout.cards.values()) {
      const holders = plan.sheets.filter((s) => c.x >= s.x0 && c.x < s.x1 && c.y >= s.y0 - 1 && c.y < s.y1)
      expect(holders, c.id).toHaveLength(1)
      const s = holders[0]
      expect(c.x - PRINT_PITCH / 2 + 2).toBeGreaterThanOrEqual(s.x0 - 0.01)
      expect(c.x + PRINT_PITCH / 2 - 2).toBeLessThanOrEqual(s.x1 + 0.01)
    }
  })

  it('stays inside the printable part of the paper', () => {
    const plan = planSheets(layout, people, 'A4', 9)
    const short = Math.min(...PAPERS.A4) * (72 / 25.4)
    expect(Math.min(plan.widthPt, plan.heightPt)).toBeCloseTo(short, 3)
    for (const s of plan.sheets) {
      expect((s.x1 - s.x0) * plan.scale).toBeLessThanOrEqual(plan.widthPt - 2 * plan.marginPt + 0.01)
      expect((s.y1 - s.y0) * plan.scale).toBeLessThanOrEqual(plan.heightPt - 2 * plan.marginPt + 0.01)
    }
  })

  it('says so when a card has to be cut', () => {
    const tiny = planSheets(layout, people, 'A4', 200)
    expect(tiny.cutsCard).toBe(true)
  })

  it('wastes no paper on empty sheets', () => {
    const plan = planSheets(layout, people, 'A4', 9)
    expect(plan.sheets.length).toBeGreaterThan(1)
    for (const s of plan.sheets) {
      const anything = [...layout.cards.values()].some((c) => c.x + 60 > s.x0 && c.x - 60 < s.x1 && c.y + 100 > s.y0 && c.y < s.y1) || layout.edges.some((e) => e.box[2] > s.x0 && e.box[0] < s.x1 && e.box[3] > s.y0 && e.box[1] < s.y1) || layout.unions.some((u) => u.box[2] > s.x0 && u.box[0] < s.x1 && u.box[3] > s.y0 && u.box[1] < s.y1)
      expect(anything).toBe(true)
    }
  })
})
