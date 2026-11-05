import { OpError } from './core'

const LISTS = new Set(['tags', 'facts', 'sources', 'claims'])
const text = (v: unknown) => String(v ?? '')
function parsed(v: unknown): unknown[] {
  if (v === null || v === undefined || v === '') return []
  if (Array.isArray(v)) return v
  try {
    const list = typeof v === 'string' ? JSON.parse(v) : null
    if (Array.isArray(list)) return list
  } catch {
    // Reported below, like any other value that is not a list.
  }
  throw new OpError(400, 'not a list')
}
const key = (item: unknown) => (item && typeof item === 'object' && 'id' in item ? `id:${(item as { id: unknown }).id}` : `v:${JSON.stringify(item)}`)

/**
 * Two people editing one list both keep their changes: what I added stays added, what I removed stays
 * removed, and everything the other person did since I looked is left alone. On the same item, the later edit wins.
 */
export function mergeList(base: unknown[], mine: unknown[], theirs: unknown[]) {
  const had = new Map(base.map((x) => [key(x), JSON.stringify(x)]))
  const kept = new Map(mine.map((x) => [key(x), x]))
  const result = theirs.filter((x) => !had.has(key(x)) || kept.has(key(x))).map((x) => {
    const m = kept.get(key(x))
    return m !== undefined && JSON.stringify(m) !== had.get(key(x)) ? m : x
  })
  const present = new Set(result.map(key))
  return [...result, ...mine.filter((x) => !had.has(key(x)) && !present.has(key(x)))]
}

/**
 * Compares what the editor saw with what stands now. Lists merge; a single value changed by someone
 * else to something different is refused, so nobody silently overwrites a relative's edit.
 */
export function reconcile<P extends Record<string, unknown>>(current: Record<string, unknown>, patch: P, seen: Record<string, unknown>): P {
  const out: Record<string, unknown> = { ...patch }
  for (const k of Object.keys(patch)) {
    if (!(k in seen)) continue
    if (LISTS.has(k)) {
      const theirs = parsed(current[k])
      if (JSON.stringify(theirs) !== JSON.stringify(parsed(seen[k]))) out[k] = mergeList(parsed(seen[k]), parsed(patch[k]), theirs)
    } else if (text(current[k]) !== text(seen[k]) && text(current[k]) !== text(patch[k])) {
      throw new OpError(409, `changed by someone else meanwhile: ${k}`)
    }
  }
  return out as P
}
