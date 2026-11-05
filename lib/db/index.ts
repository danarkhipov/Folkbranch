import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { applyPendingRestore } from './restore'
import { migrateWithCopy } from './safe-migrate'
import * as schema from './schema'

// Never traced into the build: that would copy the archive into the build output.
export const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || './data')
export const MEDIA_DIR = path.join(/*turbopackIgnore: true*/ DATA_DIR, 'media')

function open() {
  // Tests write freely, so they must never reach the real archive.
  if (process.env.VITEST && DATA_DIR === path.resolve(/*turbopackIgnore: true*/ './data')) throw new Error('tests must not open ./data')
  // A container's own disk is wiped on every deploy: without a volume the archive would vanish with the next update.
  if (process.env.RAILWAY_PROJECT_ID && !process.env.RAILWAY_VOLUME_MOUNT_PATH) throw new Error('No volume is attached, so nothing would survive a deploy. In Railway, add a volume to this service with the mount path /data.')
  applyPendingRestore(DATA_DIR)
  fs.mkdirSync(MEDIA_DIR, { recursive: true })
  const sqlite = new Database(path.join(/*turbopackIgnore: true*/ DATA_DIR, 'family.db'))
  sqlite.pragma('journal_mode = WAL')
  // Each answered save survives a power cut, not only a crash. Writes here are few, so the cost is small.
  sqlite.pragma('synchronous = FULL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  // The write-ahead file shrinks back after a big import instead of staying at its largest.
  sqlite.pragma('journal_size_limit = 4194304')
  const db = drizzle(sqlite, { schema })
  migrateWithCopy(sqlite, db, DATA_DIR, path.resolve(/*turbopackIgnore: true*/ 'drizzle'))
  return db
}

export type DB = ReturnType<typeof open>

const g = globalThis as unknown as { __familyDb?: DB }

export function getDb(): DB {
  return (g.__familyDb ??= open())
}

/** Moves with every write by anyone, so what was read at one stamp is still true at the same stamp. Null inside a transaction, which can still be rolled back. */
export function dataStamp() {
  const sqlite = getDb().$client
  if (sqlite.inTransaction) return null
  return `${sqlite.pragma('data_version', { simple: true })}.${sqlite.prepare('select total_changes()').pluck().get()}`
}

/** Clears what has expired and lets SQLite refresh its plans. Cheap, and rare enough not to matter. */
export function tidyDatabase() {
  const sqlite = getDb().$client
  const now = Date.now()
  sqlite.prepare('delete from session where expires_at < ?').run(now)
  sqlite.prepare('delete from verification where expires_at < ?').run(now)
  sqlite.pragma('optimize')
}

export { schema }
