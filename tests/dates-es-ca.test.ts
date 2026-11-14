// Spanish and Catalan dates as people type them, and as the browser writes them in those languages.
import { describe, expect, it } from 'vitest'
import { datesIn, monthOf, takeDates } from '../lib/search/dates'
import { toGedDate } from '../lib/gedcom'

const one = (text: string) => datesIn(text).map(({ year, month, day }) => ({ year, month, day }))

describe('dates written in Spanish', () => {
  it('reads "12 de marzo de 1890" and its short forms', () => {
    expect(one('12 de marzo de 1890')).toEqual([{ year: 1890, month: 3, day: 12 }])
    expect(one('Nació el 1 de enero de 1901 en Reus')).toEqual([{ year: 1901, month: 1, day: 1 }])
    expect(one('3 de setiembre del 1920')).toEqual([{ year: 1920, month: 9, day: 3 }])
    expect(one('25 dic 1899')).toEqual([{ year: 1899, month: 12, day: 25 }])
    expect(one('mayo de 1950')).toEqual([{ year: 1950, month: 5, day: undefined }])
  })

  it('knows every month', () => {
    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
    expect(months.map(monthOf)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(months.map((m) => one(`2 de ${m} de 1900`)[0]?.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('finds them in a query, with "antes de" and "después de"', () => {
    expect(takeDates('12 de marzo de 1890').terms).toEqual([{ from: 1890, to: 1890, month: 3, day: 12 }])
    expect(takeDates('antes de 1900').terms).toEqual([{ from: 1000, to: 1899 }])
    expect(takeDates('después de 1900').terms).toEqual([{ from: 1901, to: 2100 }])
    expect(takeDates('siglo xix').terms).toEqual([{ from: 1800, to: 1899 }])
    expect(takeDates('de 1900 a 1910').terms).toEqual([{ from: 1900, to: 1910 }])
  })
})

describe('dates written in Catalan', () => {
  it('reads "12 de març de 1890", "d\'abril" and the browser\'s "del 1890"', () => {
    expect(one('12 de març de 1890')).toEqual([{ year: 1890, month: 3, day: 12 }])
    expect(one("5 d'abril de 1931")).toEqual([{ year: 1931, month: 4, day: 5 }])
    expect(one('5 d’octubre de 1931')).toEqual([{ year: 1931, month: 10, day: 5 }])
    expect(one(new Intl.DateTimeFormat('ca', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(1890, 2, 12)))).toEqual([{ year: 1890, month: 3, day: 12 }])
    expect(one('juliol de 1936')).toEqual([{ year: 1936, month: 7, day: undefined }])
  })

  it('knows every month', () => {
    const months = ['gener', 'febrer', 'març', 'abril', 'maig', 'juny', 'juliol', 'agost', 'setembre', 'octubre', 'novembre', 'desembre']
    expect(months.map(monthOf)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(months.map((m) => one(`2 de ${m} de 1900`)[0]?.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('finds them in a query, with "abans de" and "després de"', () => {
    expect(takeDates("5 d'abril de 1931").terms).toEqual([{ from: 1931, to: 1931, month: 4, day: 5 }])
    expect(takeDates('abans de 1900').terms).toEqual([{ from: 1000, to: 1899 }])
    expect(takeDates('després de 1900').terms).toEqual([{ from: 1901, to: 2100 }])
    expect(takeDates('segle xix').terms).toEqual([{ from: 1800, to: 1899 }])
  })
})

describe('the dates already read', () => {
  it('still read the same', () => {
    expect(one('20 марта 1960')).toEqual([{ year: 1960, month: 3, day: 20 }])
    expect(one('12 March 1890')).toEqual([{ year: 1890, month: 3, day: 12 }])
    expect(one('12.03.1890')).toEqual([{ year: 1890, month: 3, day: 12 }])
    // Words that only start like a month are not one.
    expect(one('general 1900')).toEqual([{ year: 1900, month: undefined, day: undefined }])
    // "Sept" was never an English month here, and Spanish does not need it beside "sep".
    expect(one('12 Sept 1890')).toEqual([{ year: 1890, month: undefined, day: undefined }])
  })
})

describe('a GEDCOM file', () => {
  it('gets a written-out date as a GEDCOM date in a Spanish or Catalan archive', () => {
    expect(toGedDate('12 de marzo de 1890', 'es')).toBe('12 MAR 1890')
    expect(toGedDate("5 d'abril de 1931", 'ca')).toBe('5 APR 1931')
    expect(toGedDate('juliol de 1936', 'ca')).toBe('JUL 1936')
    expect(toGedDate('~12 de marzo de 1890', 'es')).toBe('ABT 12 MAR 1890')
    expect(toGedDate('1883 или 1886', 'es')).toBe('(1883 или 1886)')
    expect(toGedDate('hacia 12 de marzo de 1890', 'es')).toBe('(hacia 12 de marzo de 1890)')
  })

  it('writes a Russian or English archive\'s dates as it always has', () => {
    for (const lang of ['ru', 'en'] as const) {
      expect(toGedDate('20 марта 1960', lang)).toBe('(20 марта 1960)')
      expect(toGedDate('12 March 1890', lang)).toBe('(12 March 1890)')
      expect(toGedDate('12 de marzo de 1890', lang)).toBe('(12 de marzo de 1890)')
    }
    expect(toGedDate('20 марта 1960')).toBe('(20 марта 1960)')
  })
})
