// A copy of the archive, and what a file from elsewhere must not get away with.
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import Database from 'better-sqlite3'
import { beforeAll, describe, expect, it } from 'vitest'
import yazl from 'yazl'
import { DATA_DIR, getDb, MEDIA_DIR } from '../lib/db'
import { applyPendingRestore, PENDING } from '../lib/db/restore'
import { archiveStream, stageRestore, sweepArchiveLeftovers } from '../lib/ops/archive'
import type { Actor } from '../lib/ops/core'
import * as people from '../lib/ops/people'

const owner: Actor = { userId: 'u-owner', name: 'Ольга', role: 'owner', personId: null }
const editor: Actor = { userId: 'u-e', name: 'Егор', role: 'editor', personId: null }
const work = path.join(tmpdir(), `archive-test-${process.pid}`)
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

async function saved(name = 'copy.zip') {
  const file = path.join(work, name)
  const { stream } = await archiveStream(owner)
  await pipeline(stream, createWriteStream(file))
  return file
}

/** A zip built by hand, to say anything a real copy would not. */
async function forged(name: string, files: Record<string, Buffer>, manifest?: unknown) {
  const zip = new yazl.ZipFile()
  for (const [n, b] of Object.entries(files)) zip.addBuffer(b, n, { compress: false })
  const list = Object.entries(files).map(([p, b]) => ({ path: p, size: b.length, sha256: sha(b) }))
  if (manifest !== null) zip.addBuffer(Buffer.from(JSON.stringify(manifest ?? { format: 1, createdAt: '', schema: 0, files: list })), 'manifest.json', { compress: false })
  zip.end()
  const file = path.join(work, name)
  await pipeline(zip.outputStream, createWriteStream(file))
  return file
}

/** The database from a real copy, changed by `change`. */
async function databaseFrom(change?: (db: Database.Database) => void) {
  const f = path.join(work, 'source.db')
  rmSync(f, { force: true })
  await getDb().$client.backup(f)
  if (change) {
    const db = new Database(f)
    change(db)
    db.close()
  }
  return readFileSync(f)
}

beforeAll(() => {
  mkdirSync(work, { recursive: true })
  people.createPerson(owner, { givenName: 'Копия', surname: 'Проверкина', living: false } as never)
  writeFileSync(path.join(MEDIA_DIR, 'abc123.orig.jpg'), 'photo bytes')
  writeFileSync(path.join(MEDIA_DIR, 'abc123.avatar.1_2_3_4.webp'), 'cut again on demand')
  writeFileSync(path.join(MEDIA_DIR, 'abc123.x.part'), 'unfinished')
  getDb().$client.prepare("insert into user (id, name, email, email_verified, role, created_at, updated_at) values ('u-owner', 'Ольга', 'o@example.org', 0, 'owner', 0, 0)").run()
  getDb().$client.prepare("insert into session (id, token, expires_at, user_id, created_at, updated_at) values ('s1', 'SECRET-SESSION-TOKEN', 9999999999999, 'u-owner', 0, 0)").run()
})

describe('making a copy', () => {
  it('is for the owner only', async () => {
    await expect(archiveStream(editor)).rejects.toThrow()
  })

  it('holds no session, not even in leftover pages of the file', async () => {
    const zip = readFileSync(await saved())
    expect(zip.includes('SECRET-SESSION-TOKEN')).toBe(false)
    expect(zip.includes('Проверкина')).toBe(true)
  })

  it('skips what can be made again and what was never finished', async () => {
    const zip = readFileSync(await saved()).toString('latin1')
    expect(zip).toContain('media/abc123.orig.jpg')
    expect(zip).not.toContain('.avatar.')
    expect(zip).not.toContain('.part')
  })

  it('leaves nothing behind', async () => {
    await saved()
    await new Promise((r) => setTimeout(r, 50))
    await sweepArchiveLeftovers()
    expect(existsSync(path.join(DATA_DIR, PENDING))).toBe(false)
  })
})

describe('restoring', () => {
  const pendingDb = () => path.join(DATA_DIR, PENDING, 'family.db')
  const clear = () => rmSync(path.join(DATA_DIR, PENDING), { recursive: true, force: true })

  it('accepts its own copy and offers the owner a way in', async () => {
    const report = await stageRestore(await saved())
    expect(report.people).toBeGreaterThan(0)
    expect(report.login).toMatch(/\/invite\//)
    expect(existsSync(pendingDb())).toBe(true)
    clear()
  })

  it('does not touch the archive while checking', async () => {
    const before = getDb().$client.prepare('select count(*) from persons').pluck().get()
    await stageRestore(await saved())
    expect(getDb().$client.prepare('select count(*) from persons').pluck().get()).toBe(before)
    clear()
  })

  const bad: [string, () => Promise<string>, RegExp][] = [
    ['something that is not a zip', async () => { const f = path.join(work, 'x.zip'); writeFileSync(f, 'not a zip at all'); return f }, /не файл/],
    ['a zip without a manifest', () => forged('a.zip', { 'family.db': Buffer.from('x') }, null), /не файл/],
    ['extra files', async () => forged('b.zip', { 'family.db': await databaseFrom(), 'evil.sh': Buffer.from('x') }), /лишние/],
    ['a path out of the folder', async () => forged('c.zip', { 'family.db': await databaseFrom(), 'media/a..b/c': Buffer.from('x') }), /лишние/],
    ['a damaged file', async () => {
      const db = await databaseFrom()
      return forged('d.zip', { 'family.db': db }, { format: 1, createdAt: '', schema: 0, files: [{ path: 'family.db', size: db.length, sha256: '0'.repeat(64) }] })
    }, /контрольная сумма/],
    ['a file bigger than promised', async () => {
      const db = await databaseFrom()
      return forged('e.zip', { 'family.db': db }, { format: 1, createdAt: '', schema: 0, files: [{ path: 'family.db', size: 10, sha256: sha(db) }] })
    }, /повреждён/],
    ['a manifest that leaves files out', async () => forged('f.zip', { 'family.db': await databaseFrom(), 'media/a.jpg': Buffer.from('x') }, { format: 1, createdAt: '', schema: 0, files: [] }), /не хватает/],
    ['another kind of database', async () => {
      const f = path.join(work, 'other.db'); rmSync(f, { force: true })
      const db = new Database(f); db.exec('create table t (a)'); db.close()
      return forged('g.zip', { 'family.db': readFileSync(f) })
    }, /не копия/],
    ['a trigger planted in the database', async () => forged('h.zip', { 'family.db': await databaseFrom((db) => db.exec('create trigger evil after insert on persons begin delete from persons; end')) }), /не бывает/],
    ['a copy from a newer version', async () => forged('i.zip', { 'family.db': await databaseFrom((db) => db.exec("update __drizzle_migrations set created_at = 99999999999999")) }), /более новой/],
    ['a declared newer format', async () => {
      const db = await databaseFrom()
      return forged('j.zip', { 'family.db': db }, { format: 2, createdAt: '', schema: 0, files: [{ path: 'family.db', size: db.length, sha256: sha(db) }] })
    }, /повреждён/],
  ]
  it.each(bad)('refuses %s and leaves nothing waiting', async (_, make, message) => {
    await expect(stageRestore(await make())).rejects.toThrow(message)
    expect(existsSync(path.join(DATA_DIR, PENDING))).toBe(false)
  })
})

describe('the swap at startup', () => {
  const dir = path.join(work, 'swap')
  const write = (p: string, text: string) => { mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); writeFileSync(path.join(dir, p), text) }
  const read = (p: string) => readFileSync(path.join(dir, p), 'utf8')

  it('does nothing when no copy waits', () => {
    expect(applyPendingRestore(path.join(work, 'nothing-here'))).toBe(false)
  })

  it('puts the copy in place and keeps the old archive', () => {
    rmSync(dir, { recursive: true, force: true })
    write('family.db', 'old'); write('family.db-wal', 'old wal'); write('media/a.jpg', 'old photo')
    write(`${PENDING}/family.db`, 'new'); write(`${PENDING}/media/b.jpg`, 'new photo')
    expect(applyPendingRestore(dir)).toBe(true)
    expect(read('family.db')).toBe('new')
    expect(read('media/b.jpg')).toBe('new photo')
    expect(existsSync(path.join(dir, 'media/a.jpg'))).toBe(false)
    expect(existsSync(path.join(dir, 'family.db-wal'))).toBe(false)
    expect(read('backups/before-restore/family.db')).toBe('old')
    expect(read('backups/before-restore/media/a.jpg')).toBe('old photo')
    expect(existsSync(path.join(dir, PENDING))).toBe(false)
  })

  it('finishes after a crash halfway', () => {
    rmSync(dir, { recursive: true, force: true })
    // The new database is already in place, only the waiting folder is left.
    write('family.db', 'new'); write(`${PENDING}/leftover`, 'x')
    applyPendingRestore(dir)
    expect(read('family.db')).toBe('new')
    expect(existsSync(path.join(dir, PENDING))).toBe(false)
  })
})

describe('someone on a photo without a card', () => {
  it('stays on the photo through cleanup, and only people who see everything read the caption', async () => {
    const media = await import('../lib/ops/media')
    const core = await import('../lib/ops/core')
    const { schema } = await import('../lib/db')
    const db = getDb()
    db.insert(schema.media).values({ id: 'photo1', filename: 'x', mime: 'image/jpeg' }).run()
    const tag = media.addTag(owner, 'photo1', { label: 'Сосед Пётр' }, { x: 0, y: 0, w: 0.1, h: 0.1 }) as unknown as { id: string; personId: string | null }
    expect(tag.personId).toBeNull()
    core.mutate(owner, { summary: 'test' }, (c) => core.purgeOrphans(c))
    expect(media.getMedia(owner, 'photo1').tags[0].label).toBe('Сосед Пётр')
    const reader: Actor = { userId: 'r', name: 'Р', role: 'reader', personId: null }
    expect(media.getMedia(reader, 'photo1').tags[0].label).toBe('')
    expect(() => media.addTag(owner, 'photo1', {}, null)).toThrow()
    media.removeTag(owner, tag.id)
    expect(media.getMedia(owner, 'photo1').tags).toEqual([])
  })
})
