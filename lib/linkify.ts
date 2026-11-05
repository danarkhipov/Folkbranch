// Addresses and file references inside plain text: an address becomes something to press, a file name stops shouting.

const URL = /https?:\/\/[^\s<>"«»]+/g
const REFERENCE = /(?:[\w.@-]+\/)*[\w.@-]+\.(?:json|jpe?g|png|webp|gif|tiff?|pdf|docx?|xlsx?|txt|csv|ged)(?:#[\w=&-]+)?|\b[A-Z]{1,5}-\d{2,}\b/g
const TRAILING = /[.,;:!?)\]]+$/

export const isUrl = (s: string) => /^https?:\/\/\S+$/.test(s.trim())

/** What a person needs to know about an address: the site and the start of the path. */
export function shortUrl(url: string) {
  try {
    const u = new globalThis.URL(url)
    const path = decodeURI(u.pathname).replace(/\/$/, '')
    const host = u.hostname.replace(/^www\./, '')
    return host + (path.length > 30 ? `${path.slice(0, 30)}…` : path)
  } catch {
    return url
  }
}

export type TextPart = { text: string; href?: string; reference?: boolean }

/** Splits text around its addresses; with `references`, around file names and record numbers too. */
export function splitText(text: string, references = false): TextPart[] {
  const hits: { at: number; end: number; part: TextPart }[] = []
  for (const m of text.matchAll(URL)) {
    const url = m[0].replace(TRAILING, '')
    hits.push({ at: m.index, end: m.index + url.length, part: { text: shortUrl(url), href: url } })
  }
  if (references) for (const m of text.matchAll(REFERENCE)) {
    if (!hits.some((h) => m.index < h.end && m.index + m[0].length > h.at)) hits.push({ at: m.index, end: m.index + m[0].length, part: { text: m[0], reference: true } })
  }
  if (!hits.length) return [{ text }]
  const out: TextPart[] = []
  let from = 0
  for (const h of hits.sort((a, b) => a.at - b.at)) {
    if (h.at > from) out.push({ text: text.slice(from, h.at) })
    out.push(h.part)
    from = h.end
  }
  if (from < text.length) out.push({ text: text.slice(from) })
  return out
}

type Inline = { type: string; text?: string; styles?: Record<string, unknown>; href?: string; content?: Inline[] }

function decorateInline(list: Inline[]): Inline[] {
  return list.flatMap((n): Inline[] => {
    if (n.type === 'link' && n.content?.length === 1 && n.content[0].text === n.href && n.href) return [{ ...n, content: [{ ...n.content[0], text: shortUrl(n.href) }] }]
    if (n.type !== 'text' || !n.text) return [n]
    const styles = n.styles ?? {}
    // A piece someone marked as code is theirs already.
    if (styles.code) return [n]
    return splitText(n.text, true).map((p) => (p.href
      ? { type: 'link', href: p.href, content: [{ type: 'text', text: p.text, styles }] }
      : { type: 'text', text: p.text, styles: p.reference ? { ...styles, code: true } : styles }))
  })
}

/** For showing a page: nothing is written until someone edits it. */
export function decorateBlocks<T>(blocks: T[]): T[] {
  return blocks.map((block) => {
    const b = block as Record<string, any>
    const next = { ...b }
    if (Array.isArray(b.content)) next.content = decorateInline(b.content)
    else if (b.content?.type === 'tableContent') next.content = { ...b.content, rows: b.content.rows.map((r: { cells: any[] }) => ({ ...r, cells: r.cells.map((c) => (Array.isArray(c) ? decorateInline(c) : { ...c, content: decorateInline(c.content ?? []) })) })) }
    if (Array.isArray(b.children)) next.children = decorateBlocks(b.children)
    return next as T
  })
}
