// Who changed on the chart since it was last drawn: a person added, a card edited, a link to them made or removed,
// whether by the person, a relative or the assistant. Their cards glow for a moment, so an edit is seen where it lands.
import { useEffect, useRef, useState } from 'react'
import type { Graph } from '@/lib/types'

/** How long a changed card glows, in ms (the CSS animation runs as long). */
export const CHANGED_MS = 2400

/** One string per person standing for everything the chart shows of them and their links. */
function marks(g: Graph) {
  const out = new Map<string, string>()
  const links = new Map<string, string[]>()
  const add = (id: string, s: string) => { const l = links.get(id); if (l) l.push(s); else links.set(id, [s]) }
  for (const l of g.parentChild) { add(l.childId, `p${l.parentId}${l.kind}${l.certainty}`); add(l.parentId, `c${l.childId}${l.kind}`) }
  for (const u of g.unions) { add(u.aId, `u${u.bId}${u.kind}`); add(u.bId, `u${u.aId}${u.kind}`) }
  for (const p of g.persons) out.set(p.id, JSON.stringify(p) + (links.get(p.id) ?? []).sort().join())
  return out
}

/** Ids whose cards should glow now; empty on the first drawing and when nothing changed. */
export function useChangedCards(graph: Graph) {
  const before = useRef<Map<string, string> | null>(null)
  const [changed, setChanged] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    const now = marks(graph)
    const was = before.current
    before.current = now
    if (!was) return
    const ids = new Set<string>()
    for (const [id, m] of now) if (was.get(id) !== m) ids.add(id)
    // A whole import or a fresh archive is not one edit to point at.
    if (!ids.size || ids.size > 40) return
    // A frame later, so the card is drawn before it glows.
    const raf = requestAnimationFrame(() => setChanged(ids))
    const timer = setTimeout(() => setChanged(new Set()), CHANGED_MS)
    return () => { cancelAnimationFrame(raf); clearTimeout(timer) }
  }, [graph])
  return changed
}
