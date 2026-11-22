// An entry's words as the chronicle prints them: paragraphs split by a blank line, **bold**, *italic*, links to
// https addresses and mentions of relatives. Built as React nodes from the text, never as HTML: what an agent wrote
// can only ever be words, a link the reader chooses to follow, or a button to a person.
import type { ReactNode } from 'react'

/**
 * A mention, a link, bold, italic: the first that matches at a place wins. An address may hold one level of brackets,
 * as encyclopedia addresses do: `…/Great_Fire_(1856)`.
 */
const INLINE = /\[@([^\]]*)\]\(person:([^)\s]*)\)|\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*/g
/** The only addresses a link may go to: another site, opened in its own tab. */
const SAFE = /^https:\/\/[^\s]+$/i

function inline(s: string, onPerson: ((id: string) => void) | undefined, at: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0, n = 0
  for (const m of s.matchAll(INLINE)) {
    if (m.index > last) out.push(s.slice(last, m.index))
    last = m.index + m[0].length
    const key = `${at}.${n++}`
    if (m[2] !== undefined) {
      out.push(onPerson
        ? <button key={key} type="button" className="chronicle-mention" onClick={() => onPerson(m[2])}>{m[1]}</button>
        : <span key={key} className="chronicle-mention">{m[1]}</span>)
    } else if (m[4] !== undefined) {
      // Any other address (javascript:, data:, a page of this site) is not a link: its words stay, as words.
      out.push(SAFE.test(m[4]) ? <a key={key} href={m[4]} target="_blank" rel="noreferrer noopener">{m[3]}</a> : m[3])
    } else if (m[5] !== undefined) out.push(<strong key={key}>{m[5]}</strong>)
    else out.push(<em key={key}>{m[6]}</em>)
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}

/** The paragraphs of a text, blank lines between them. */
export const paragraphs = (value: string) => value.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)

/** `first`: only the first paragraph, for an article shown short. */
export function ChronicleText({ value, onPerson, first = false }: { value: string; onPerson?: (id: string) => void; first?: boolean }) {
  const list = paragraphs(value)
  return <>{(first ? list.slice(0, 1) : list).map((p, i) => <p key={i}>{inline(p, onPerson, String(i))}</p>)}</>
}
