// Every answer spends the owner's key, whoever asked, so nobody can run it down unnoticed.
import { getSetting, setSetting } from '../ops/settings'

const PER_MINUTE = 30
const dayKey = () => `agentTokens:${new Date().toISOString().slice(0, 10)}`
const dailyLimit = () => Number(process.env.AGENT_DAILY_TOKENS) || 5_000_000
const recent = new Map<string, number[]>()

/** What stops this request, in words, or null. */
export function overLimit(userId: string, now = Date.now()) {
  const kept = (recent.get(userId) ?? []).filter((t) => now - t < 60_000)
  if (kept.length >= PER_MINUTE) return 'Слишком много запросов подряд. Подождите минуту.'
  recent.set(userId, [...kept, now])
  if (Number(getSetting(dayKey()) ?? 0) >= dailyLimit()) return 'Дневной лимит ассистента исчерпан. Он заработает завтра, либо владелец может поднять AGENT_DAILY_TOKENS.'
  return null
}

export function countTokens(used: number) {
  if (used > 0) setSetting(dayKey(), String(Number(getSetting(dayKey()) ?? 0) + used))
}
