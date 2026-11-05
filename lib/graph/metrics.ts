// How big things are on the chart. The fonts themselves are in globals.css (.pcard); printing will measure text with
// its own fonts and pass the numbers in, so the sizes live apart from the layout that uses them.
import { lifeYears, type Person } from '../types'

export const CARD_W = 156
export const CARD_H = 118
export const AVATAR_CY = 34
export const AVATAR_R = 30
/** Partners stand further apart than a caption is wide, so the line down from their dot is never under a name. */
export const PITCH = 178

/** Lines end here, behind the caption's opaque background, which cuts them off at the text. */
export const UNDER_CAPTION = AVATAR_CY + AVATAR_R + 12
const NAME_CHARS = 14
const YEAR_CHARS = 17
// All at the largest size captions reach when the chart is zoomed out.
const TEXT_LINE = 24
const YEAR_LINE = 24
const LABEL_LINE = 30

/** How many lines a text takes when it wraps by words. */
function wrappedLines(text: string, width: number) {
  let lines = 1, used = 0
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (used && used + 1 + word.length > width) { lines++; used = word.length }
    else used += (used ? 1 : 0) + word.length
    // A word wider than the caption is broken across lines.
    while (used > width) { lines++; used -= width }
  }
  return lines
}
/** How tall a card's caption gets: names and long dates wrap, and a relation label may sit under the years. */
export function cardHeight(p: Person | undefined) {
  const years = p ? lifeYears(p) : ''
  return AVATAR_CY + AVATAR_R + 13 + wrappedLines(p ? `${p.givenName ?? ''} ${p.surname ?? ''}` : '', NAME_CHARS) * TEXT_LINE + wrappedLines(years, YEAR_CHARS) * YEAR_LINE + LABEL_LINE
}
