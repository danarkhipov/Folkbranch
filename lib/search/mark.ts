import { normal } from './words'

/** Splits text around the found words. The search returns them as written, so they are looked for as they are. */
export function markParts(text: string, terms: string[]) {
  const wanted = [...new Set(terms.map(normal).filter(Boolean))].sort((a, b) => b.length - a.length)
  if (!wanted.length || !text) return [{ text, mark: false }]
  const low = normal(text)
  const parts: { text: string; mark: boolean }[] = []
  let at = 0
  while (at < text.length) {
    let next = -1, size = 0
    for (const w of wanted) {
      const i = low.indexOf(w, at)
      if (i >= 0 && (next < 0 || i < next)) { next = i; size = w.length }
    }
    if (next < 0) break
    if (next > at) parts.push({ text: text.slice(at, next), mark: false })
    parts.push({ text: text.slice(next, next + size), mark: true })
    at = next + size
  }
  if (at < text.length) parts.push({ text: text.slice(at), mark: false })
  return parts
}
