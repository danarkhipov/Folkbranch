import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Checks what Telegram's sign-in button hands the page: it is signed with the bot's token, as Telegram
 * describes at core.telegram.org/widgets/login. Returns the Telegram user's id, or null for anything
 * forged, altered or older than a day.
 */
export function checkTelegram(data: Record<string, unknown>, botToken: string, now = Date.now()): string | null {
  const { hash, ...rest } = data
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash) || rest.id === undefined) return null
  const check = Object.keys(rest).filter((k) => rest[k] !== undefined && rest[k] !== null).sort().map((k) => `${k}=${rest[k]}`).join('\n')
  const key = createHash('sha256').update(botToken).digest()
  const expected = createHmac('sha256', key).update(check).digest()
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return null
  const age = now / 1000 - Number(rest.auth_date)
  if (!Number.isFinite(age) || age > 24 * 3600 || age < -300) return null
  return String(rest.id)
}
