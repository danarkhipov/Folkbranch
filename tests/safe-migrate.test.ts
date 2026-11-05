// The copy made before a migration, tried on a database of its own: real migrations, cut off at an old version.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateWithCopy } from '../lib/db/safe-migrate'

const temps: string[] = []
const temp = () => { const d = mkdtempSync(path.join(tmpdir(), 'family-migrate-')); temps.push(d); return d }
afterEach(() => { for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true }) })

/** The real migrations, as they stood after the first `count`. */
function migrationsUpTo(count: number) {
  const dir = temp()
  cpSync('drizzle', dir, { recursive: true })
  const file = path.join(dir, 'meta/_journal.json')
  const j = JSON.parse(readFileSync(file, 'utf8'))
  j.entries = j.entries.slice(0, count)
  writeFileSync(file, JSON.stringify(j))
  return dir
}
function run(dataDir: string, folder: string) {
  const sqlite = new Database(path.join(dataDir, 'family.db'))
  sqlite.pragma('journal_mode = WAL')
  try { migrateWithCopy(sqlite, drizzle(sqlite), dataDir, folder) } finally { sqlite.close() }
}
const tables = (file: string) => { const d = new Database(file, { readonly: true }); const out = d.prepare("select name from sqlite_master where type = 'table'").all().map((r) => (r as { name: string }).name); d.close(); return out }
const copies = (dataDir: string) => (existsSync(path.join(dataDir, 'backups')) ? readdirSync(path.join(dataDir, 'backups')) : [])

/** An archive on an old version with one person in it, written last and so still in the write-ahead file. */
function oldArchive(count = 8) {
  const data = temp()
  run(data, migrationsUpTo(count))
  const sqlite = new Database(path.join(data, 'family.db'))
  sqlite.pragma('wal_autocheckpoint = 0')
  sqlite.prepare("insert into persons (id, given_name) values ('p1', 'Дед')").run()
  sqlite.close()
  return data
}

describe('a migration on an archive that holds data', () => {
  it('leaves a copy as it was before, then moves on', () => {
    const data = oldArchive()
    run(data, 'drizzle')
    const [name] = copies(data)
    const copy = path.join(data, 'backups', name, 'family.db')
    expect(tables(copy)).not.toContain('stories')
    expect(tables(path.join(data, 'family.db'))).toContain('stories')
    const d = new Database(copy, { readonly: true })
    expect(d.prepare("select given_name as n from persons where id = 'p1'").get()).toEqual({ n: 'Дед' })
    expect(d.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }])
    d.close()
    expect(readdirSync(path.dirname(copy))).toEqual(['family.db'])
  })

  it('makes no copy when there is nothing to do', () => {
    const data = oldArchive()
    run(data, 'drizzle')
    run(data, 'drizzle')
    expect(copies(data)).toHaveLength(1)
  })

  it('makes no copy of a database with nothing in it yet', () => {
    const data = temp()
    run(data, 'drizzle')
    expect(copies(data)).toHaveLength(0)
    expect(tables(path.join(data, 'family.db'))).toContain('stories')
  })

  it('refuses to migrate if it cannot make the copy, and says why', () => {
    const data = oldArchive()
    writeFileSync(path.join(data, 'backups'), 'in the way')
    expect(() => run(data, 'drizzle')).toThrow('no copy could be made')
    expect(tables(path.join(data, 'family.db'))).not.toContain('stories')
  })

  it('when a migration fails, the database stays as it was, and the retry keeps the first copy', () => {
    const data = oldArchive()
    const broken = migrationsUpTo(99)
    const j = JSON.parse(readFileSync(path.join(broken, 'meta/_journal.json'), 'utf8'))
    writeFileSync(path.join(broken, `${j.entries.at(-1).tag}.sql`), 'this is not sql;')
    expect(() => run(data, broken)).toThrow()
    expect(tables(path.join(data, 'family.db'))).not.toContain('stories')
    expect(copies(data)).toHaveLength(1)
    run(data, 'drizzle')
    expect(copies(data)).toHaveLength(1)
    expect(tables(path.join(data, 'family.db'))).toContain('stories')
    const d = new Database(path.join(data, 'family.db'), { readonly: true })
    expect(d.prepare("select given_name as n from persons where id = 'p1'").get()).toEqual({ n: 'Дед' })
    d.close()
  })

  it('keeps the last five, and only its own are removed', () => {
    const data = oldArchive(5)
    mkdirSync(path.join(data, 'backups', 'before-restore'), { recursive: true })
    for (let n = 6; n <= 12; n++) run(data, migrationsUpTo(n))
    const left = copies(data)
    expect(left.filter((n) => n.startsWith('before-migration-'))).toHaveLength(5)
    expect(left).toContain('before-restore')
    // The oldest copies went, the newest stayed.
    const newest = left.filter((n) => n.startsWith('before-migration-')).sort().at(-1)!
    expect(tables(path.join(data, 'backups', newest, 'family.db'))).not.toContain('stories')
  })
})
