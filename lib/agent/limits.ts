// Every answer spends the owner's key, whoever asked, so nobody can run it down unnoticed.
import { getSetting, say, setSetting } from '../ops/settings'

// A fast model answers in rounds, a conversation can need many; the benchmark raises this, a family archive never needs to.
const PER_MINUTE = Number(process.env.AGENT_PER_MINUTE) || 30
const dayKey = () => `agentTokens:${new Date().toISOString().slice(0, 10)}`
const dailyLimit = () => Number(process.env.AGENT_DAILY_TOKENS) || 5_000_000
const recent = new Map<string, number[]>()

/** What stops this request, in words, or null. */
export function overLimit(userId: string, now = Date.now()) {
  const kept = (recent.get(userId) ?? []).filter((t) => now - t < 60_000)
  if (kept.length >= PER_MINUTE) return say('Слишком много запросов подряд. Подождите минуту.')
  recent.set(userId, [...kept, now])
  if (Number(getSetting(dayKey()) ?? 0) >= dailyLimit()) return say('Дневной лимит ассистента исчерпан. Он заработает завтра, либо владелец может поднять AGENT_DAILY_TOKENS.')
  return null
}

export function countTokens(used: number) {
  if (used > 0) setSetting(dayKey(), String(Number(getSetting(dayKey()) ?? 0) + used))
}

const MAX_RUNS = 4
const running = new Set<string>()

/** Answers run one per person and a few at a time, whatever else the server is doing. Returns how to give the place back, or null. */
export function takeRun(userId: string) {
  if (running.has(userId) || running.size >= MAX_RUNS) return null
  running.add(userId)
  return () => { running.delete(userId) }
}
