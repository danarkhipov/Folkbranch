// The picture of the chart must stay within what browsers will draw, phones included, and be sharp when it can.
import { describe, expect, it } from 'vitest'
import { imagePixels, imageScale } from '../lib/chart-image'

// The size the app itself computes for the picture, margins, header and footer included.
const pixels = (w: number, h: number) => { const p = imagePixels(w, h); return { s: p.scale, w: p.w, h: p.h } }

describe('the size of the chart picture', () => {
  it('a small branch is drawn three times larger, so the years stay sharp when zoomed', () => {
    expect(imageScale(900, 600)).toBe(3)
  })
  it('a large family is shrunk under the canvas limits of a phone, and never below its own size', () => {
    // The 3000 × 1500 chart is large enough to be scaled down and small enough that a scale above 1
    // still fits: it is the case where the limits have to be enforced.
    for (const [w, h] of [[3000, 1500], [6000, 2500], [20_000, 900], [60_000, 60_000]]) {
      const p = pixels(w, h)
      expect(p.s).toBeGreaterThanOrEqual(1)
      if (p.s === 1) continue
      expect(p.w * p.h).toBeLessThanOrEqual(16_000_001)
      expect(Math.max(p.w, p.h)).toBeLessThanOrEqual(16_384.5)
    }
    expect(pixels(3000, 1500).s).toBeGreaterThan(1)
    // Beyond what any scale can fit is left at its own size, not shrunk below 1×.
    expect(pixels(60_000, 60_000).s).toBe(1)
  })
})
