import { describe, expect, it } from 'vitest'
import { axisTicks, bins, caption, eventWords, generationWords, share, stepYear, yearAt } from '../lib/map-scrub'

describe('the map scrubber', () => {
  it('counts events per year, moves apart, and ignores what falls outside the range', () => {
    const b = bins([{ year: 1900 }, { year: 1900, moved: true }, { year: 1902.5 }, { year: 1850 }, { year: 1999 }], 1900, 1903)
    expect(b.all).toEqual([2, 0, 1, 0])
    expect(b.moves).toEqual([1, 0, 0, 0])
    expect(b.peak).toBe(2)
    expect(bins([], 1900, 1901).peak).toBe(1)
  })
  it('labels every 50 years, every 25 on a short range, with decade ticks between', () => {
    expect(axisTicks(1830, 1990).labels).toEqual([1850, 1900, 1950])
    expect(axisTicks(1830, 1990).minor).toContain(1840)
    expect(axisTicks(1830, 1990).minor).not.toContain(1850)
    expect(axisTicks(1880, 1960).labels).toEqual([1900, 1925, 1950])
  })
  it('steps to the nearest event year after or before the moment', () => {
    const ys = [1838, 1889, 1890, 1925]
    expect(stepYear(ys, 1838, 1)).toBe(1889)
    expect(stepYear(ys, 1889, 1)).toBe(1890)
    expect(stepYear(ys, 1888.4, 1)).toBe(1889)
    expect(stepYear(ys, 1925, 1)).toBeNull()
    expect(stepYear(ys, 1889, -1)).toBe(1838)
    expect(stepYear(ys, 1889.5, -1)).toBe(1889)
    expect(stepYear(ys, 1900, -1)).toBe(1890)
    expect(stepYear(ys, 1838, -1)).toBeNull()
  })
  it('puts years on the track and back', () => {
    expect(share(1900, 1900, 1999)).toBe(0)
    expect(share(2000, 1900, 1999)).toBe(1)
    expect(yearAt(share(1950.5, 1900, 1999), 1900, 1999)).toBeCloseTo(1950.5)
    expect(yearAt(2, 1900, 1999)).toBe(1999)
  })
  it('tells a year in one line: the first event and how many more', () => {
    const ev = [{ year: 1889, what: 'Emigration', name: 'Antoni', place: 'Buenos Aires' }, { year: 1889, what: 'Birth', name: 'Rosa', place: 'Reus' }, { year: 1890, what: 'Death', name: 'Joan', place: 'Reus' }]
    expect(caption(ev, 1889)).toBe('1889 · Emigration · Antoni · Buenos Aires +1')
    expect(caption(ev, 1890)).toBe('1890 · Death · Joan · Reus')
    expect(caption(ev, 1891)).toBe('')
    expect(caption(ev, 1890, false)).toBe('Death · Joan · Reus')
  })
  it('counts events in both languages, with the three Russian forms', () => {
    expect([1, 2, 5, 11, 21, 22, 112].map((n) => eventWords(n, 'ru'))).toEqual(['1 событие', '2 события', '5 событий', '11 событий', '21 событие', '22 события', '112 событий'])
    expect([1, 2, 21].map((n) => eventWords(n, 'en'))).toEqual(['1 event', '2 events', '21 events'])
    expect([1, 3, 6, 21].map((n) => generationWords(n, 'ru'))).toEqual(['1 поколение', '3 поколения', '6 поколений', '21 поколение'])
    expect([1, 6].map((n) => generationWords(n, 'en'))).toEqual(['1 generation', '6 generations'])
    expect([1, 3].map((n) => eventWords(n, 'es'))).toEqual(['1 hecho', '3 hechos'])
    expect([1, 3].map((n) => eventWords(n, 'ca'))).toEqual(['1 fet', '3 fets'])
    expect([1, 6].map((n) => generationWords(n, 'es'))).toEqual(['1 generación', '6 generaciones'])
    expect([1, 6].map((n) => generationWords(n, 'ca'))).toEqual(['1 generació', '6 generacions'])
  })
})
