// Corner cases where a family archive could silently lose something.
import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { getDb, MEDIA_DIR, schema } from '../lib/db'
import type { Actor } from '../lib/ops/core'
import { undo } from '../lib/ops/core'
import { importGedcom } from '../lib/ops/gedcom'
import * as media from '../lib/ops/media'
import * as pages from '../lib/ops/pages'
import * as people from '../lib/ops/people'
import { listHistory } from '../lib/ops/settings'
import { layoutFamily } from '../lib/graph/layout'

const owner: Actor = { userId: 'o', name: 'Owner', role: 'owner', personId: null }
const other: Actor = { userId: 'b', name: 'Boris', role: 'editor', personId: null }
const lastId = () => listHistory(owner)[0].id
const person = (name = 'Анна') => people.createPerson(owner, { givenName: name, surname: 'Угол', birthDate: '1900', deathDate: '1950' })
const row = (id: string) => people.getPersonRow(id)
const jpeg = () => sharp({ create: { width: 300, height: 200, channels: 3, background: '#a33' } }).jpeg().toBuffer()
const files = () => fs.readdirSync(MEDIA_DIR)

describe('undo keeps what came later', () => {
  it('rolling back an old edit leaves a newer edit of another field alone', () => {
    const p = person()
    people.updatePerson(owner, p.id, { birthPlace: 'Тула' })
    const first = lastId()
    people.updatePerson(other, p.id, { deathPlace: 'Омск' })
    undo(owner, first, 'undo')
    expect(row(p.id).birthPlace).toBe('')
    expect(row(p.id).deathPlace).toBe('Омск')
  })

  it('does not overwrite a field somebody changed since', () => {
    const p = person()
    people.updatePerson(owner, p.id, { birthPlace: 'Тула' })
    const first = lastId()
    people.updatePerson(other, p.id, { birthPlace: 'Орёл' })
    expect(() => undo(owner, first, 'undo')).toThrow()
    expect(row(p.id).birthPlace).toBe('Орёл')
  })

  it('restoring a link that was added again later does not crash', () => {
    const a = person(), b = person('Борис')
    people.linkPeople(owner, 'spouse', a.id, b.id)
    const u = getDb().select().from(schema.unions).all().find((r) => r.aId === a.id || r.bId === a.id)!
    people.removeRelation(owner, 'union', u.id)
    const removal = lastId()
    people.linkPeople(owner, 'spouse', a.id, b.id)
    undo(owner, removal, 'undo')
    expect(getDb().select().from(schema.unions).all().filter((r) => r.aId === a.id || r.bId === a.id)).toHaveLength(1)
  })

  it('a deleted person comes back with pages, links and photo', async () => {
    const a = person(), b = person('Сын')
    people.linkPeople(owner, 'son', a.id, b.id)
    const page = pages.createPage(owner, { personId: a.id, title: 'Жизнь', content: [{ type: 'paragraph' }] })
    const m = await media.uploadMedia(owner, await jpeg(), 'x.jpg', a.id)
    people.setAvatar(owner, a.id, m.id, null)
    people.deletePerson(owner, a.id)
    undo(owner, lastId(), 'undo')
    expect(row(a.id).avatarMediaId).toBe(m.id)
    expect(pages.getPage(owner, page.id).title).toBe('Жизнь')
    expect(media.listPersonMedia(owner, a.id)).toHaveLength(1)
    expect(getDb().select().from(schema.parentChild).all().filter((r) => r.parentId === a.id)).toHaveLength(1)
  })

  it('undoing the undo brings the edit back', () => {
    const p = person()
    people.updatePerson(owner, p.id, { birthPlace: 'Тула' })
    undo(owner, lastId(), 'undo')
    expect(row(p.id).birthPlace).toBe('')
    undo(owner, lastId(), 'undo')
    expect(row(p.id).birthPlace).toBe('Тула')
  })
})

describe('two people on one page', () => {
  it('a save made from an old copy is refused, not written over', () => {
    const p = person()
    const page = pages.createPage(owner, { personId: p.id, title: 'T', content: [] })
    const seen = pages.getPage(owner, page.id).updatedAt
    pages.updatePage(other, page.id, { content: [{ type: 'paragraph', content: 'Бориса' }], baseUpdatedAt: seen })
    expect(() => pages.updatePage(owner, page.id, { content: [{ type: 'paragraph', content: 'Анны' }], baseUpdatedAt: seen })).toThrow(/changed/)
    expect(pages.getPage(owner, page.id).content).toContain('Бориса')
  })
})

describe('uploads', () => {
  it('a broken image with an image header stays as a file instead of failing', async () => {
    const good = await jpeg()
    const before = files().length
    const m = await media.uploadMedia(owner, good.subarray(0, 180), 'broken.jpg').catch((e) => e)
    expect(m).not.toBeInstanceOf(Error)
    expect(fs.existsSync(path.join(MEDIA_DIR, getDb().select().from(schema.media).all().find((r) => r.id === m.id)!.filename))).toBe(true)
    expect(files().length).toBeGreaterThan(before)
  })

  it('a photo format the server cannot decode, like HEIC, is kept', async () => {
    // A valid HEIC signature with no picture behind it.
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.from([0, 0, 0, 0]), Buffer.from('mif1heic'), Buffer.alloc(300)])
    const m = await media.uploadMedia(owner, heic, 'IMG_0001.HEIC')
    const f = await media.readMediaFile(owner, m.id, 'orig')
    expect(f.data.equals(heic)).toBe(true)
  })

  it('an empty file and odd names are safe', async () => {
    await expect(media.uploadMedia(owner, Buffer.alloc(0), 'empty.jpg')).rejects.toMatchObject({ status: 400 })
    const m = await media.uploadMedia(owner, Buffer.from('x'), '../../../etc/passwd')
    const r = getDb().select().from(schema.media).all().find((x) => x.id === m.id)!
    expect(r.filename).not.toContain('/')
    expect(fs.existsSync(path.join(MEDIA_DIR, r.filename))).toBe(true)
    const named = await media.uploadMedia(owner, Buffer.from('x'), 'Письмо "бабушки" 😀\n.pdf')
    expect((await media.readMediaFile(owner, named.id, 'orig')).name).toContain('бабушки')
  })

  it('a picture too large to decode leaves nothing behind but the file', async () => {
    const big = await sharp({ create: { width: 17000, height: 17000, channels: 3, background: '#000' }, limitInputPixels: false }).png({ compressionLevel: 9 }).toBuffer()
    const m = await media.uploadMedia(owner, big, 'huge.png')
    expect(m.kind).toBe('file')
  }, 120_000)

  it('many at once all finish', async () => {
    const buf = await jpeg()
    const all = await Promise.all(Array.from({ length: 8 }, (_, i) => media.uploadMedia(owner, buf, `${i}.jpg`)))
    expect(all.every((m) => m.kind === 'image')).toBe(true)
  })

  it('sizes of a photo are served, and a missing copy does not take the page down', async () => {
    const m = await media.uploadMedia(owner, await jpeg(), 'p.jpg')
    for (const s of ['thumb', 'medium', 'orig'] as const) expect((await media.readMediaFile(owner, m.id, s)).data.length).toBeGreaterThan(0)
    fs.unlinkSync(path.join(MEDIA_DIR, `${m.id}.thumb.webp`))
    await expect(media.readMediaFile(owner, m.id, 'thumb')).rejects.toMatchObject({ status: 404 })
  })

  it('a bad avatar crop falls back instead of failing', async () => {
    const m = await media.uploadMedia(owner, await jpeg(), 'c.jpg')
    expect((await media.readAvatar(m.id, JSON.stringify({ x: 5, y: 5, w: 2, h: 2 }))).length).toBeGreaterThan(0)
    expect((await media.readAvatar(m.id, 'not json')).length).toBeGreaterThan(0)
  })
})

describe('files left behind', () => {
  const orphan = (name: string) => {
    const file = path.join(MEDIA_DIR, name)
    fs.writeFileSync(file, 'x')
    const old = new Date(Date.now() - 2 * 3600_000)
    fs.utimesSync(file, old, old)
    return file
  }

  it('an interrupted upload is cleared, and nothing that can come back is touched', async () => {
    const stray = orphan('strayUpload1.medium.webp')
    const fresh = path.join(MEDIA_DIR, 'freshUpload1.orig.jpg')
    fs.writeFileSync(fresh, 'x')
    const m = await media.uploadMedia(owner, await jpeg(), 'kept.jpg')
    const gone = await media.uploadMedia(owner, await jpeg(), 'deleted.jpg')
    media.deleteMedia(owner, gone.id)
    const old = new Date(Date.now() - 2 * 3600_000)
    for (const f of files().filter((x) => x.startsWith(gone.id) || x.startsWith(m.id))) fs.utimesSync(path.join(MEDIA_DIR, f), old, old)
    await media.sweepOrphanFiles()
    expect(fs.existsSync(stray)).toBe(false)
    expect(fs.existsSync(fresh)).toBe(true)
    expect(files().some((f) => f.startsWith(m.id))).toBe(true)
    expect(files().some((f) => f.startsWith(gone.id))).toBe(true)
    undo(owner, lastId(), 'undo')
    expect((await media.readMediaFile(owner, gone.id, 'thumb')).data.length).toBeGreaterThan(0)
  })
})

describe('history', () => {
  it('stores only what changed, so a new title does not copy the text', () => {
    const p = person()
    const page = pages.createPage(owner, { personId: p.id, title: 'T', content: [{ type: 'paragraph', content: 'я'.repeat(50_000) }] })
    pages.updatePage(owner, page.id, { title: 'Новое' })
    const entry = getDb().select().from(schema.history).all().find((h) => h.id === lastId())!
    expect(entry.changes.length).toBeLessThan(2000)
    undo(owner, entry.id, 'undo')
    expect(pages.getPage(owner, page.id).title).toBe('T')
    expect(pages.getPage(owner, page.id).content).toContain('яяя')
  })

  it('entries written before history kept only changes still undo correctly', () => {
    const p = person()
    const full = row(p.id)
    const id = 'old-format-entry'
    getDb().update(schema.persons).set({ birthPlace: 'Тула' }).where(eq(schema.persons.id, p.id)).run()
    const after = row(p.id)
    getDb().insert(schema.history).values({ id, at: 1, userId: 'o', actorName: 'O', summary: 'old', personIds: '[]', changes: JSON.stringify([{ table: 'persons', id: p.id, before: full, after }]) }).run()
    people.updatePerson(other, p.id, { deathPlace: 'Омск' })
    undo(owner, id, 'undo')
    expect(row(p.id).birthPlace).toBe('')
    expect(row(p.id).deathPlace).toBe('Омск')
  })

  it('edits in a row merge, but not across somebody else', () => {
    const p = person()
    const page = pages.createPage(owner, { personId: p.id, title: 'T' })
    pages.updatePage(owner, page.id, { title: 'A' })
    const first = lastId()
    pages.updatePage(owner, page.id, { title: 'B' })
    expect(lastId()).toBe(first)
    pages.updatePage(other, page.id, { icon: 'x' })
    pages.updatePage(owner, page.id, { title: 'C' })
    expect(lastId()).not.toBe(first)
  })
})

describe('odd data', () => {
  it('keeps odd text exactly', () => {
    const text = `'; DROP TABLE persons; -- 😀 \u0000 ${'я'.repeat(100_000)}`
    const p = people.createPerson(owner, { givenName: text })
    expect(row(p.id).givenName).toBe(text)
  })

  it('refuses a person as their own parent or a loop of ancestors', () => {
    const a = person(), b = person('B')
    expect(() => people.linkPeople(owner, 'son', a.id, a.id)).toThrow()
    people.linkPeople(owner, 'son', a.id, b.id)
    expect(() => people.linkPeople(owner, 'son', b.id, a.id)).toThrow()
  })

  it('a chart with a loop of ancestors already in the data still draws', () => {
    const p = (id: string) => ({ id, givenName: id, surname: '', sex: 'U', tags: [], facts: [], sources: [], claims: [] })
    const g = { persons: ['a', 'b', 'c'].map(p), parentChild: [['a', 'b'], ['b', 'c'], ['c', 'a'], ['a', 'a'], ['a', 'gone']].map(([parentId, childId], i) => ({ id: `e${i}`, parentId, childId, kind: 'birth', certainty: 'family' })), unions: [] }
    expect(layoutFamily(g as never).cards ?? true).toBeTruthy()
  })

  it('a broken GEDCOM changes nothing or imports cleanly, never half', () => {
    const count = () => getDb().select().from(schema.persons).all().length
    const before = count()
    const r = (() => { try { return importGedcom(owner, '0 HEAD\n0 @I1@ INDI\n1 NAME Иван /Угол/\n1 BIRT\n2 DATE ???\n0 @F1@ FAM\n1 HUSB @I1@\n1 CHIL @I404@\n1 WIFE @I1@\n0 TRLR') } catch (e) { return e } })()
    expect(count() === before || !(r instanceof Error)).toBe(true)
  })

  it('page nesting cannot make a loop, and a deleted parent page takes its children back on undo', () => {
    const p = person()
    const a = pages.createPage(owner, { personId: p.id, title: 'A' })
    const b = pages.createPage(owner, { personId: p.id, title: 'B', parentPageId: a.id })
    expect(() => pages.updatePage(owner, a.id, { parentPageId: b.id })).toThrow()
    pages.deletePage(owner, a.id)
    expect(() => pages.getPage(owner, b.id)).toThrow()
    undo(owner, lastId(), 'undo')
    expect(pages.getPage(owner, b.id).parentPageId).toBe(a.id)
  })
})
