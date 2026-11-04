import { describe, expect, it } from 'vitest'
import { drawnAvatar } from '../lib/avatar'

const svg = (id: string, sex: 'M' | 'F' | 'U') => decodeURIComponent(drawnAvatar({ id, sex }).split(',')[1])
const ids = Array.from({ length: 300 }, (_, i) => `person-${i}`)

describe('drawn portraits', () => {
  it('keeps the same portrait for the same person', () => {
    expect(svg('abc', 'F')).toBe(svg('abc', 'F'))
  })
  it('differ between people, even with similar ids', () => {
    expect(new Set(ids.map((id) => svg(id, 'M'))).size).toBeGreaterThan(150)
    expect(new Set(ids.map((id) => svg(id, 'F'))).size).toBeGreaterThan(150)
  })
  it('change when the sex is corrected', () => {
    expect(svg('abc', 'M')).not.toBe(svg('abc', 'F'))
  })
  it('are valid svg with no outside references', () => {
    for (const sex of ['M', 'F', 'U'] as const) {
      expect(svg('abc', sex)).toMatch(/^<svg .*<\/svg>$/)
      expect(svg('abc', sex).replace('http://www.w3.org/2000/svg', '')).not.toMatch(/https?:/)
    }
  })
})
