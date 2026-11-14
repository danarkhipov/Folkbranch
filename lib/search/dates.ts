// Dates are written many ways. Both the stored text and the query come down to these.

export interface DateAt { year: number; month?: number; day?: number; start: number; end: number }
export interface DateTerm { from: number; to: number; month?: number; day?: number; before?: boolean }

// Russian, English, Spanish, Catalan.
const MONTHS: [RegExp, number][] = [[/^(янв|jan|ene|gen)/, 1], [/^(фев|feb)/, 2], [/^(мар[тае]|mar)/, 3], [/^(апр|apr|abr)/, 4], [/^(ма[йяею]|may|maig)/, 5], [/^(июн|jun)/, 6], [/^(июл|jul)/, 7], [/^(авг|aug|ago)/, 8], [/^(сен|sep|set)/, 9], [/^(окт|oct)/, 10], [/^(ноя|nov)/, 11], [/^(дек|dec|dic|des)/, 12]]
export const monthOf = (word: string) => MONTHS.find(([re]) => re.test(word))?.[1]
const MONTH = '(январ[ьяею]|феврал[ьяею]|март[ае]?|апрел[ьяею]|ма[йяею]|июн[ьяею]|июл[ьяею]|август[ае]?|сентябр[ьяею]|октябр[ьяею]|ноябр[ьяею]|декабр[ьяею]|янв|фев|мар|апр|июн|июл|авг|сен|окт|ноя|дек|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|apr|jun|jul|aug|sep|oct|nov|dec'
  // Spanish and Catalan. No "des" or "set": in Catalan "des de 1900" is "since 1900", and "set" is seven.
  + '|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|abr|ago|dic'
  + '|gener|febrer|març|maig|juny|juliol|agost|setembre|novembre|desembre|gen|febr)'
/** "12 de marzo de 1890", "5 d'abril de 1931", "12 de març del 1890": the little words between day, month and year. */
const OF = "(?:de\\s+|d['’]\\s*)?", OF_YEAR = '(?:del?\\s+)?'
const NUM = /^\d+$/
const year = (s: string) => { const y = Number(s); return y >= 1000 && y <= 2100 ? y : null }

/** Every date in a text, with where it stands, so that it can be marked. */
export function datesIn(text: string): DateAt[] {
  const low = text.toLowerCase()
  const found: DateAt[] = []
  const taken = (start: number, end: number) => found.some((d) => start < d.end && d.start < end)
  const add = (start: number, end: number, y: string, month?: number, day?: number) => {
    const n = year(y)
    if (n && !taken(start, end)) found.push({ year: n, month, day, start, end })
  }
  for (const m of low.matchAll(/(?<!\d)(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d)/g)) add(m.index, m.index + m[0].length, m[3], +m[2], +m[1])
  for (const m of low.matchAll(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g)) add(m.index, m.index + m[0].length, m[1], +m[2], +m[3])
  for (const m of low.matchAll(new RegExp(`(?<![\\d\\p{L}])(\\d{1,2})\\s+${OF}${MONTH}\\s+${OF_YEAR}(\\d{4})(?!\\d)`, 'gu'))) add(m.index, m.index + m[0].length, m[3], monthOf(m[2]), +m[1])
  for (const m of low.matchAll(new RegExp(`(?<![\\p{L}])${MONTH}\\s+${OF_YEAR}(\\d{4})(?!\\d)`, 'gu'))) add(m.index, m.index + m[0].length, m[2], monthOf(m[1]))
  for (const m of low.matchAll(/(?<!\d)(\d{1,2})\.(\d{4})(?!\d)/g)) add(m.index, m.index + m[0].length, m[2], +m[1])
  for (const m of low.matchAll(/(?<!\d)(\d{4})(?!\d)/g)) add(m.index, m.index + 4, m[1])
  return found.sort((a, b) => a.start - b.start)
}

export const dateMatches = (d: DateAt, t: DateTerm) => d.year >= t.from && d.year <= t.to && (t.month === undefined || d.month === t.month) && (t.day === undefined || d.day === t.day)

const ROMAN: Record<string, number> = { xv: 15, xvi: 16, xvii: 17, xviii: 18, xix: 19, xx: 20, xxi: 21 }

/** Takes the dates out of a query. What is left is words. */
export function takeDates(query: string): { terms: DateTerm[]; rest: string } {
  let rest = query
  const terms: DateTerm[] = []
  const take = (re: RegExp, make: (m: RegExpMatchArray) => DateTerm | null) => {
    rest = rest.replace(re, (...args) => {
      const t = make(args as unknown as RegExpMatchArray)
      if (!t) return args[0]
      terms.push(t)
      return ' '
    })
  }
  const y = (s: string) => year(s) ?? NaN
  const ok = (t: DateTerm) => (Number.isNaN(t.from) || Number.isNaN(t.to) ? null : t)
  take(/(?<!\d)с\s+(\d{4})\s+(?:по|до)\s+(\d{4})(?!\d)/g, (m) => ok({ from: y(m[1]), to: y(m[2]) }))
  take(/(?<![\p{L}\d])(?:de|desde|des\s+de|entre)\s+(\d{4})\s+(?:a|al|y|i|hasta|fins\s+a)\s+(\d{4})(?!\d)/gu, (m) => ok({ from: y(m[1]), to: y(m[2]) }))
  take(/(?<!\d)(\d{4})\s*(?:-|–|—|\.\.)\s*(\d{4})(?!\d)/g, (m) => ok({ from: y(m[1]), to: y(m[2]) }))
  take(/(?<!\d)(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d)/g, (m) => ok({ from: y(m[3]), to: y(m[3]), month: +m[2], day: +m[1] }))
  take(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g, (m) => ok({ from: y(m[1]), to: y(m[1]), month: +m[2], day: +m[3] }))
  take(new RegExp(`(?<![\\d\\p{L}])(\\d{1,2})\\s+${OF}${MONTH}(?:\\s+${OF_YEAR}(\\d{4}))?(?!\\d)(?!\\p{L})`, 'gu'), (m) => (m[3] ? ok({ from: y(m[3]), to: y(m[3]), month: monthOf(m[2]), day: +m[1] }) : { from: 1000, to: 2100, month: monthOf(m[2]), day: +m[1] }))
  take(new RegExp(`(?<![\\p{L}])${MONTH}\\s+${OF_YEAR}(\\d{4})(?!\\d)`, 'gu'), (m) => ok({ from: y(m[2]), to: y(m[2]), month: monthOf(m[1]) }))
  take(/(?<!\d)(\d{1,2})\.(\d{4})(?!\d)/g, (m) => ok({ from: y(m[2]), to: y(m[2]), month: +m[1] }))
  take(/(?<!\d)(\d{3})0\s*-?\s*(?:е|х|ые|ых|s)(?![\p{L}\d])/gu, (m) => { const s = Number(`${m[1]}0`); return { from: s, to: s + 9 } })
  take(/(?<![\p{L}\d])(\d{1,2}|xv|xvi|xvii|xviii|xix|xx|xxi)\s*(?:-?(?:й|го|м))?\s*век[а-я]*/gu, (m) => { const c = NUM.test(m[1]) ? +m[1] : ROMAN[m[1]]; return { from: (c - 1) * 100, to: c * 100 - 1 } })
  take(/(?<![\p{L}\d])(?:siglo|segle)\s+(\d{1,2}|xv|xvi|xvii|xviii|xix|xx|xxi)(?![\p{L}\d])/gu, (m) => { const c = NUM.test(m[1]) ? +m[1] : ROMAN[m[1]]; return { from: (c - 1) * 100, to: c * 100 - 1 } })
  take(/(?<![\p{L}\d])(?:до|раньше|ранее|antes\s+de|abans\s+de)\s+(\d{4})(?!\d)/gu, (m) => ok({ from: 1000, to: y(m[1]) - 1 }))
  take(/(?<![\p{L}\d])(?:после|позже|позднее|despu[eé]s\s+de|despr[eé]s\s+de)\s+(\d{4})(?!\d)/gu, (m) => ok({ from: y(m[1]) + 1, to: 2100 }))
  take(/(?<!\d)(\d{4})(?!\d)(?:\s*(?:г\.?|года?|году)(?![\p{L}]))?/gu, (m) => ok({ from: y(m[1]), to: y(m[1]) }))
  return { terms, rest }
}
