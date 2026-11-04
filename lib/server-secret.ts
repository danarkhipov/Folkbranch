import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './db'

export function serverSecret() {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET
  // Zero-config install: the secret lives next to the data it protects.
  const file = path.join(DATA_DIR, 'auth-secret')
  if (!fs.existsSync(file)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 })
  }
  return fs.readFileSync(file, 'utf8')
}
