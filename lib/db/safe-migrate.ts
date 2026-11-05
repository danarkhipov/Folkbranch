// Migrations run by themselves at start, so nobody is there to make a copy first. This does.
import fs from 'node:fs'
import path from 'node:path'
import type { Database } from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'

const COPIES = 'backups'
const PREFIX = 'before-migration-'
/** Enough to step back through several updates, without one small volume filling up with old copies. */
const KEEP = 5

/** Whichever migrations this database has not had, by the rule the migrator itself goes by. */
function pendingMigrations(sqlite: Database, folder: string) {
  const all = readMigrationFiles({ migrationsFolder: folder })
  const has = (name: string) => !!sqlite.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(name)
  if (!has('__drizzle_migrations')) {
    // Tables without a record of migrations are not ours to guess about: they get a copy too.
    const empty = !sqlite.prepare("select 1 from sqlite_master where type = 'table' and name not like 'sqlite_%' limit 1").get()
    return empty ? [] : all
  }
  const last = sqlite.prepare('select max(created_at) as at from __drizzle_migrations').get() as { at: number | null }
  return all.filter((m) => !last.at || m.folderMillis > last.at)
}

function dropOldCopies(dataDir: string) {
  const dir = path.join(/*turbopackIgnore: true*/ dataDir, COPIES)
  const names = fs.readdirSync(dir).filter((n) => n.startsWith(PREFIX)).sort()
  for (const n of names.slice(0, -KEEP)) fs.rmSync(path.join(/*turbopackIgnore: true*/ dir, n), { recursive: true, force: true })
}

/** A consistent copy, checked before it counts. Photos are left out: migrations change only the database. */
function copyDatabase(sqlite: Database, dataDir: string, stamp: number) {
  const dir = path.join(/*turbopackIgnore: true*/ dataDir, COPIES, `${PREFIX}${stamp}`)
  const file = path.join(/*turbopackIgnore: true*/ dir, 'family.db')
  // A migration that failed last time and is being tried again keeps the copy made before the first try.
  if (fs.existsSync(file)) return dir
  fs.mkdirSync(dir, { recursive: true })
  const part = `${file}.part`
  fs.rmSync(part, { force: true })
  sqlite.prepare('vacuum into ?').run(part)
  fs.renameSync(part, file)
  return dir
}

/** Refuses to change a database it could not copy: an archive that does not start can be fixed, a lost one cannot. */
export function migrateWithCopy(sqlite: Database, db: BetterSQLite3Database<any>, dataDir: string, folder: string) {
  const pending = pendingMigrations(sqlite, folder)
  if (!pending.length) return migrate(db, { migrationsFolder: folder })
  let copy: string
  try {
    copy = copyDatabase(sqlite, dataDir, pending[0].folderMillis)
  } catch (e) {
    throw new Error(`The database needs ${pending.length} migration(s), and no copy could be made first, so it was left as it is. Free some disk space and start again. ${e instanceof Error ? e.message : e}`)
  }
  try {
    migrate(db, { migrationsFolder: folder })
  } catch (e) {
    console.error(`A migration failed. The database as it was before is in ${copy}.`)
    throw e
  }
  console.log(`Applied ${pending.length} migration(s). The database as it was before is in ${copy}.`)
  dropOldCopies(dataDir)
}
