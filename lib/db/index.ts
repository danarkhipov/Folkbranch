import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data')
export const MEDIA_DIR = path.join(DATA_DIR, 'media')

function open() {
  // Tests write freely, so they must never reach the real archive.
  if (process.env.VITEST && DATA_DIR === path.resolve('./data')) throw new Error('tests must not open ./data')
  fs.mkdirSync(MEDIA_DIR, { recursive: true })
  const sqlite = new Database(path.join(DATA_DIR, 'family.db'))
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.resolve('drizzle') })
  return db
}

export type DB = ReturnType<typeof open>

const g = globalThis as unknown as { __familyDb?: DB }

export function getDb(): DB {
  return (g.__familyDb ??= open())
}

export { schema }
