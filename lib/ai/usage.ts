// Who used what this month, from real figures only: requests counted as they are made, tokens and seconds as the
// provider reports them, and money only where the provider states the cost of that request. Nothing is estimated;
// a request whose cost the provider did not state is counted as such, so the screen can say the sum is partial.
import { inArray } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { type Actor, requireRole } from '../ops/core'
import { getSetting, setSetting } from '../ops/settings'

export type Fn = 'assistant' | 'speech' | 'faces' | 'mcp'
export interface Tally { requests: number; tokens: number; seconds: number; dollars: number; unpriced: number }
type Month = Partial<Record<Fn, Record<string, Tally>>>

const empty = (): Tally => ({ requests: 0, tokens: 0, seconds: 0, dollars: 0, unpriced: 0 })
const monthKey = (at = new Date()) => `aiUsage:${at.toISOString().slice(0, 7)}`
const read = (key: string): Month => {
  const kept = getSetting(key)
  if (kept === null) return fromBefore(key)
  try { return JSON.parse(kept) as Month } catch { return {} }
}

/** Who the counts made before the update belong to: nobody can be named, so they show in totals only. */
export const EARLIER = '~before-update'

/**
 * The month as the previous version counted it, read once when this month has no ledger yet. Its speech dollars mixed
 * stated costs and list-price guesses, so they are not taken: those requests count as having no stated price.
 */
function fromBefore(key: string): Month {
  const m: Month = {}
  try {
    const old = JSON.parse(getSetting(`sttUsage:${key.slice(8)}`) ?? 'null') as { seconds?: number; requests?: number } | null
    if (old?.requests) m.speech = { [EARLIER]: { ...empty(), requests: old.requests, seconds: old.seconds ?? 0, unpriced: old.requests } }
  } catch { /* an unreadable old count is left behind */ }
  setSetting(key, JSON.stringify(m))
  return m
}

/**
 * One use: `who` is the person's account, or the access token for MCP. `dollars` is the provider's stated cost,
 * or null when it stated none; it is never a guess.
 */
export function recordUse(fn: Fn, who: string, add: { requests?: number; tokens?: number; seconds?: number; dollars?: number | null }) {
  const key = monthKey()
  const m = read(key)
  const byWho = (m[fn] ??= {})
  const t = (byWho[who] ??= empty())
  t.requests += add.requests ?? 0
  t.tokens += add.tokens ?? 0
  t.seconds += add.seconds ?? 0
  if (add.dollars === undefined) { /* nothing to price: an MCP call costs the owner nothing */ } else if (add.dollars === null) t.unpriced += add.requests ?? 1
  else t.dollars += add.dollars
  setSetting(key, JSON.stringify(m))
}

const sum = (xs: Tally[]) => xs.reduce((a, t) => ({ requests: a.requests + t.requests, tokens: a.tokens + t.tokens, seconds: a.seconds + t.seconds, dollars: a.dollars + t.dollars, unpriced: a.unpriced + t.unpriced }), empty())

/** This month's total of one function: what limits and the usage tiles read. */
export const monthTotal = (fn: Fn): Tally => sum(Object.values(read(monthKey())[fn] ?? {}))

/** This month for the owner: each function's total, and each person's and each token's part, with their names. */
export function usageReport(actor: Actor) {
  requireRole(actor, 'owner')
  const m = read(monthKey())
  const people = new Set<string>(), tokens = new Set<string>()
  for (const fn of ['assistant', 'speech', 'faces'] as const) for (const id of Object.keys(m[fn] ?? {})) if (id !== EARLIER) people.add(id)
  for (const id of Object.keys(m.mcp ?? {})) tokens.add(id)
  const db = getDb()
  const names = new Map(people.size ? db.select({ id: schema.user.id, name: schema.user.name }).from(schema.user).where(inArray(schema.user.id, [...people])).all().map((u) => [u.id, u.name]) : [])
  const tokenNames = new Map(tokens.size ? db.select({ id: schema.apiTokens.id, name: schema.apiTokens.name }).from(schema.apiTokens).where(inArray(schema.apiTokens.id, [...tokens])).all().map((t) => [t.id, t.name]) : [])
  const fns = ['assistant', 'speech', 'faces'] as const
  return {
    month: monthKey().slice(8),
    totals: Object.fromEntries([...fns, 'mcp' as const].map((fn) => [fn, sum(Object.values(m[fn] ?? {}))])) as Record<Fn, Tally>,
    people: [...people].map((id) => ({ id, name: names.get(id) ?? null, ...Object.fromEntries(fns.map((fn) => [fn, m[fn]?.[id] ?? empty()])) as Record<(typeof fns)[number], Tally> }))
      .sort((a, b) => (b.assistant.dollars + b.speech.dollars) - (a.assistant.dollars + a.speech.dollars) || b.assistant.requests - a.assistant.requests),
    tokens: [...tokens].map((id) => ({ id, name: tokenNames.get(id) ?? null, ...m.mcp![id] })).sort((a, b) => b.requests - a.requests),
  }
}
