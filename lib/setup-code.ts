import fs from 'node:fs'
import path from 'node:path'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { DATA_DIR } from './db'

/**
 * The code that protects an empty instance, so a stranger who finds it first cannot claim it.
 * SETUP_TOKEN wins; otherwise production makes one and keeps it next to the data. Local development
 * needs none.
 */
export function setupCode(): string | null {
  if (process.env.SETUP_TOKEN) return process.env.SETUP_TOKEN
  if (process.env.NODE_ENV !== 'production') return null
  const file = path.join(/*turbopackIgnore: true*/ DATA_DIR, 'setup-code')
  if (!fs.existsSync(file)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(file, randomBytes(18).toString('base64url'), { mode: 0o600 })
  }
  return fs.readFileSync(file, 'utf8').trim()
}

export function setupCodeMatches(given: string | undefined) {
  const expected = setupCode()
  if (!expected) return true
  const a = Buffer.from(given ?? ''), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
