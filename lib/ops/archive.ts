// The whole archive as one file, and back. The file is a zip without compression, since photos are already
// compressed, and everything streams through the disk: the server has little memory and archives can be large.
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { PassThrough, Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import Database from 'better-sqlite3'
import { nanoid } from 'nanoid'
import yauzl from 'yauzl'
import yazl from 'yazl'
import { DATA_DIR, getDb, MEDIA_DIR } from '../db'
import { PENDING } from '../db/restore'
import { publicUrl } from '../public-url'
import { Actor, OpError, requireRole } from './core'
import { say } from './settings'

const FORMAT = 1
const STAGING = 'restore-staging'
const MAX_FILES = 200_000
const MAX_MANIFEST = 64 * 1024 * 1024
/** A saved copy must fit with room to spare: the old archive stays until the new one is checked. */
const SPARE_BYTES = 16 * 1024 * 1024
/** Only tables and indexes: a view or a trigger in a file from elsewhere could run on later queries. */
const FORBIDDEN_KINDS = ['view', 'trigger']
const REQUIRED_TABLES = ['persons', 'parent_child', 'unions', 'media', 'user', 'settings', '__drizzle_migrations']
export const isMediaFileName = (name: string) => /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(name)
const SAFE_NAME = /^(family\.db|manifest\.json|media\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)$/

interface ManifestFile { path: string; size: number; sha256: string }
interface Manifest { format: number; createdAt: string; schema: number; files: ManifestFile[] }

const inData = (...p: string[]) => path.join(/*turbopackIgnore: true*/ DATA_DIR, ...p)
const refuse = (text: string, status = 400) => new OpError(status, say(text))

/** The newest database change this version of the app knows. */
async function latestMigration() {
  const journal = JSON.parse(await fs.readFile(path.resolve(/*turbopackIgnore: true*/ 'drizzle/meta/_journal.json'), 'utf8')) as { entries: { when: number }[] }
  return Math.max(...journal.entries.map((e) => e.when))
}

async function roomFor(bytes: number) {
  const s = await fs.statfs(DATA_DIR)
  if (s.bavail * s.bsize < bytes + SPARE_BYTES) throw refuse('На диске не хватает места для этой копии', 507)
}

let exporting = false

/** Everything needed to bring the archive back elsewhere, except the sign-ins of the moment. */
export async function archiveStream(actor: Actor): Promise<{ stream: Readable; filename: string }> {
  requireRole(actor, 'owner')
  if (exporting) throw refuse('Копия уже готовится. Подождите немного', 409)
  exporting = true
  const snapshot = inData(`.archive-${nanoid(8)}.db`)
  const done = async () => {
    exporting = false
    await fs.rm(snapshot, { force: true })
  }
  try {
    await getDb().$client.backup(snapshot)
    const copy = new Database(snapshot)
    // A session in the file could sign someone in on this very server. Vacuum, or the pages would keep them.
    copy.exec('delete from session; delete from verification; vacuum;')
    copy.close()
    const zip = new yazl.ZipFile()
    const out = new PassThrough()
    const fail = (e: Error) => out.destroy(e)
    const files: ManifestFile[] = []
    const queue: { name: string; file: string }[] = [{ name: 'family.db', file: snapshot }]
    for (const f of await fs.readdir(MEDIA_DIR)) {
      // Avatars are cut again on demand, and a .part is an unfinished write.
      if (!f.includes('.avatar.') && !f.endsWith('.part')) queue.push({ name: `media/${f}`, file: path.join(/*turbopackIgnore: true*/ MEDIA_DIR, f) })
    }
    const schema = await latestMigration()
    // One at a time: the sums go into the manifest, which is written last.
    const next = async (): Promise<void> => {
      const item = queue.shift()
      if (!item) {
        zip.addBuffer(Buffer.from(JSON.stringify({ format: FORMAT, createdAt: new Date().toISOString(), schema, files } satisfies Manifest, null, 1)), 'manifest.json', { compress: false })
        zip.end()
        return
      }
      const stat = await fs.stat(item.file).catch(() => null)
      // Deleted a moment ago by someone else: the database copy already says so.
      if (!stat) return next()
      const sum = createHash('sha256')
      const counted = new Transform({
        transform(chunk, _, cb) {
          sum.update(chunk)
          cb(null, chunk)
        },
      })
      counted.on('end', () => {
        files.push({ path: item.name, size: stat.size, sha256: sum.digest('hex') })
        next().catch(fail)
      })
      createReadStream(item.file).on('error', fail).pipe(counted)
      zip.addReadStream(counted, item.name, { compress: false, mtime: stat.mtime })
    }
    zip.outputStream.on('error', (e) => out.destroy(e)).pipe(out)
    out.on('close', () => { void done() })
    await next()
    const day = new Date().toISOString().slice(0, 10)
    return { stream: out, filename: `folkbranch-archive-${day}.zip` }
  } catch (e) {
    await done()
    throw e
  }
}

const openZip = (file: string) => new Promise<yauzl.ZipFile>((resolve, reject) => {
  yauzl.open(file, { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: true }, (e, z) => (e || !z ? reject(refuse('Это не файл копии архива')) : resolve(z)))
})

const entriesOf = (zip: yauzl.ZipFile) => new Promise<yauzl.Entry[]>((resolve, reject) => {
  const list: yauzl.Entry[] = []
  zip.on('error', () => reject(refuse('Файл копии повреждён')))
  zip.on('end', () => resolve(list))
  zip.on('entry', (e: yauzl.Entry) => {
    list.push(e)
    if (list.length > MAX_FILES) reject(refuse('В файле копии слишком много файлов'))
    else zip.readEntry()
  })
  zip.readEntry()
})

const streamOf = (zip: yauzl.ZipFile, entry: yauzl.Entry) => new Promise<Readable>((resolve, reject) => {
  zip.openReadStream(entry, (e, s) => (e || !s ? reject(refuse('Файл копии повреждён')) : resolve(s)))
})

async function readManifest(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Manifest> {
  if (entry.uncompressedSize > MAX_MANIFEST) throw refuse('Файл копии повреждён')
  const chunks: Buffer[] = []
  for await (const c of await streamOf(zip, entry)) chunks.push(c as Buffer)
  try {
    const m = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Manifest
    const sound = m.format === FORMAT && Array.isArray(m.files) && m.files.every((f) => typeof f.path === 'string' && Number.isSafeInteger(f.size) && f.size >= 0 && /^[0-9a-f]{64}$/.test(f.sha256))
    if (sound) return m
  } catch {
    // Reported below, like any other broken manifest.
  }
  throw refuse('Файл копии повреждён')
}

/** Writes one file out, stopping as soon as it grows past what the manifest promised. */
async function extract(zip: yauzl.ZipFile, entry: yauzl.Entry, expected: ManifestFile, target: string) {
  const sum = createHash('sha256')
  let seen = 0
  const check = new Transform({
    transform(chunk: Buffer, _, cb) {
      seen += chunk.length
      if (seen > expected.size) return cb(refuse('Файл копии повреждён'))
      sum.update(chunk)
      cb(null, chunk)
    },
  })
  await pipeline(await streamOf(zip, entry), check, createWriteStream(target, { flags: 'wx' }))
  if (seen !== expected.size || sum.digest('hex') !== expected.sha256) throw refuse('Файл копии повреждён: не совпадает контрольная сумма')
}

/** Only what this app could have written, and not from a newer version of it. Gives a one-time way back in for the owner. */
async function inspectDatabase(file: string, newestKnown: number) {
  let db: Database.Database
  try {
    db = new Database(file)
  } catch {
    throw refuse('Файл копии повреждён')
  }
  try {
    const objects = db.prepare('select type, name from sqlite_master').all() as { type: string; name: string }[]
    if (objects.some((o) => FORBIDDEN_KINDS.includes(o.type))) throw refuse('В файле копии есть то, чего не бывает в архиве')
    const tables = new Set(objects.filter((o) => o.type === 'table').map((o) => o.name))
    if (!REQUIRED_TABLES.every((t) => tables.has(t))) throw refuse('Это не копия семейного архива')
    if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw refuse('Файл копии повреждён')
    const made = db.prepare('select max(created_at) from __drizzle_migrations').pluck().get() as number
    if (made > newestKnown) throw refuse('Копия сделана более новой версией приложения. Сначала обновите приложение', 409)
    // A file name from the copy is later joined to the media folder: it must not lead out of it.
    const names = db.prepare('select filename from media').pluck().all() as string[]
    if (names.some((n) => !isMediaFileName(n))) throw refuse('В файле копии есть лишние файлы')
    const count = (t: string) => db.prepare(`select count(*) from ${t}`).pluck().get() as number
    const owner = db.prepare("select id, name from user where role = 'owner' limit 1").get() as { id: string; name: string } | undefined
    let login: string | null = null
    if (owner) {
      // The file holds no sessions, and a new server has a new secret: nobody could get in otherwise.
      const token = randomBytes(24).toString('base64url')
      const now = Date.now()
      db.prepare('insert into invites (id, token_hash, name, role, user_id, created_by, created_at, expires_at) values (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(nanoid(12), createHash('sha256').update(token).digest('hex'), owner.name, 'owner', owner.id, 'restore', now, now + 24 * 60 * 60 * 1000)
      login = `${publicUrl()}/invite/${token}`
    }
    return { people: count('persons'), photos: count('media'), login }
  } finally {
    db.close()
  }
}

/** What an interrupted copy or upload left behind. */
export async function sweepArchiveLeftovers() {
  const names = await fs.readdir(DATA_DIR).catch(() => [] as string[])
  await Promise.all(names.filter((n) => n.startsWith('.archive-') || n.startsWith('.restore-') || n === STAGING).map((n) => fs.rm(inData(n), { recursive: true, force: true })))
}

let staging = false

/** Checks a saved copy completely and lays it out next to the archive, which is not touched. The swap comes at the next start. */
export async function stageRestore(zipFile: string) {
  if (staging) throw refuse('Восстановление уже идёт', 409)
  staging = true
  const stage = inData(STAGING)
  let zip: yauzl.ZipFile | null = null
  try {
    await fs.rm(stage, { recursive: true, force: true })
    zip = await openZip(zipFile)
    const entries = await entriesOf(zip)
    if (entries.some((e) => !SAFE_NAME.test(e.fileName))) throw refuse('В файле копии есть лишние файлы')
    const names = entries.map((e) => e.fileName)
    if (new Set(names).size !== names.length) throw refuse('В файле копии есть лишние файлы')
    const manifestEntry = entries.find((e) => e.fileName === 'manifest.json')
    if (!manifestEntry) throw refuse('Это не файл копии архива')
    const manifest = await readManifest(zip, manifestEntry)
    const body = entries.filter((e) => e !== manifestEntry)
    const promised = new Map(manifest.files.map((f) => [f.path, f]))
    if (promised.size !== body.length || body.some((e) => !promised.has(e.fileName)) || !promised.has('family.db')) throw refuse('Файл копии повреждён: не хватает файлов')
    const newest = await latestMigration()
    if (manifest.schema > newest) throw refuse('Копия сделана более новой версией приложения. Сначала обновите приложение', 409)
    await roomFor(manifest.files.reduce((n, f) => n + f.size, 0))
    await fs.mkdir(path.join(/*turbopackIgnore: true*/ stage, 'media'), { recursive: true })
    for (const e of body) await extract(zip, e, promised.get(e.fileName)!, path.join(/*turbopackIgnore: true*/ stage, e.fileName))
    const report = await inspectDatabase(path.join(/*turbopackIgnore: true*/ stage, 'family.db'), newest)
    await fs.rm(inData(PENDING), { recursive: true, force: true })
    await fs.rename(stage, inData(PENDING))
    return report
  } catch (e) {
    await fs.rm(stage, { recursive: true, force: true })
    if ((e as { code?: string }).code === 'ENOSPC') throw refuse('На диске не хватает места для этой копии', 507)
    throw e
  } finally {
    zip?.close()
    staging = false
  }
}
