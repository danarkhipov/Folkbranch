import fs from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import sharp from 'sharp'
import { desc, eq, inArray, sql } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { listMediaFiles, mediaFile, removeMediaFiles, writeAtomic } from '../storage'
import type { Box, Media } from '../types'
import { Actor, Changes, mutate, newId, OpError, requireRole, seesOnlyPublic } from './core'
import { hiddenPeople } from './people'
import { say } from './settings'

const MAX_SIZE = 40 * 1024 * 1024
const SIZES = { thumb: 360, medium: 1600 } as const
export type MediaSize = keyof typeof SIZES | 'orig'

function row(id: string) {
  const r = getDb().select().from(schema.media).where(eq(schema.media.id, id)).get()
  if (!r) throw new OpError(404, 'not found')
  return r
}

/** Readers lose access to any photo that shows a relative hidden from them. */
export function canSeeMedia(actor: Actor, mediaId: string) {
  const hidden = hiddenPeople(actor)
  if (!hidden.size) return true
  return !getDb().select().from(schema.mediaTags).where(eq(schema.mediaTags.mediaId, mediaId)).all().some((t) => t.personId && hidden.has(t.personId))
}

function withTags(rows: (typeof schema.media.$inferSelect)[], actor: Actor): Media[] {
  if (!rows.length) return []
  const tags = Map.groupBy(getDb().select().from(schema.mediaTags).where(inArray(schema.mediaTags.mediaId, rows.map((r) => r.id))).all(), (t) => t.mediaId)
  return rows.map((r) => ({
    id: r.id, kind: r.kind as Media['kind'], originalName: r.originalName, mime: r.mime, width: r.width, height: r.height,
    caption: r.caption, date: r.date, place: r.place, createdAt: r.createdAt,
    // A caption can name a living person, and a reader has no way to be told apart from one.
    tags: (tags.get(r.id) ?? []).map((t) => (!seesOnlyPublic(actor) ? t : { ...t, label: t.label && '' })),
  }))
}

function visible(actor: Actor, list: Media[]) {
  const hidden = hiddenPeople(actor)
  return hidden.size ? list.filter((m) => !m.tags.some((t) => t.personId && hidden.has(t.personId))) : list
}

export function listPersonMedia(actor: Actor, personId: string): Media[] {
  const db = getDb()
  const ids = db.select({ id: schema.mediaTags.mediaId }).from(schema.mediaTags).where(eq(schema.mediaTags.personId, personId)).all().map((r) => r.id)
  if (!ids.length) return []
  return visible(actor, withTags(db.select().from(schema.media).where(inArray(schema.media.id, ids)).all(), actor))
}

export function getMedia(actor: Actor, id: string): Media {
  if (!canSeeMedia(actor, id)) throw new OpError(404, 'not found')
  return withTags([row(id)], actor)[0]
}

// A big photo takes hundreds of megabytes to decode, so a batch on a small server waits its turn.
sharp.cache(false)
sharp.concurrency(1)
let decoding: Promise<unknown>[] = []
async function inTurn<T>(job: () => Promise<T>): Promise<T> {
  while (decoding.length >= 1) await Promise.race(decoding).catch(() => {})
  const run = job()
  const done = run.finally(() => { decoding = decoding.filter((d) => d !== done) })
  decoding.push(done)
  return run
}

/** The copies the app shows. Null when this server cannot decode the picture, such as some HEIC files. */
async function makeCopies(id: string, buf: Buffer) {
  try {
    const rotated = sharp(buf, { failOn: 'none' }).rotate()
    const info = await rotated.clone().webp({ quality: 82 }).resize({ width: SIZES.medium, height: SIZES.medium, fit: 'inside', withoutEnlargement: true }).toFile(mediaFile(`${id}.medium.webp`))
    await rotated.clone().webp({ quality: 76 }).resize({ width: SIZES.thumb, height: SIZES.thumb, fit: 'inside', withoutEnlargement: true }).toFile(mediaFile(`${id}.thumb.webp`))
    return info
  } catch {
    await discardUpload(id)
    return null
  }
}

/** Stores the bytes and returns a row; the caller records it in a mutation. Whatever cannot be shown is still kept, as a download. */
export async function storeUpload(buf: Buffer, originalName: string, uploadedBy: string) {
  if (buf.length > MAX_SIZE) throw new OpError(413, 'file too large')
  if (!buf.length) throw new OpError(400, 'the file is empty')
  const id = newId()
  const meta = await sharp(buf, { failOn: 'none' }).metadata().catch(() => null)
  // Only raster photos become images. SVG is served as a download, since it can carry scripts.
  const raster = !!meta?.format && ['jpeg', 'png', 'webp', 'gif', 'heif', 'tiff', 'avif'].includes(meta.format)
  const copies = raster ? await inTurn(() => makeCopies(id, buf)) : null
  const ext = path.extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8)
  const filename = copies ? `${id}.orig${ext || '.' + meta!.format}` : `${id}.file${ext}`
  try {
    await writeAtomic(mediaFile(filename), buf)
  } catch (e) {
    await discardUpload(id)
    throw e
  }
  return {
    id, kind: copies ? 'image' : 'file', filename, originalName, mime: copies ? `image/${meta!.format}` : 'application/octet-stream',
    width: copies?.width ?? 0, height: copies?.height ?? 0, size: buf.length, uploadedBy, createdAt: Date.now(),
  }
}

export type StoredUpload = Awaited<ReturnType<typeof storeUpload>>

export function commitUpload(actor: Actor, r: StoredUpload, personId?: string | null) {
  requireRole(actor, 'editor')
  mutate(actor, { summary: `${say('Загрузить фото')}: ${r.originalName}`, personIds: personId ? [personId] : [] }, (c) => {
    c.insert('media', r)
    if (personId) c.insert('mediaTags', { id: newId(), mediaId: r.id, personId })
  })
  return getMedia(actor, r.id)
}

export async function uploadMedia(actor: Actor, buf: Buffer, name: string, personId?: string | null) {
  requireRole(actor, 'editor')
  return commitUpload(actor, await storeUpload(buf, name, actor.userId), personId)
}

const OLD_ENOUGH = 60 * 60 * 1000

/**
 * A crash during an upload leaves files no row points at. They are removed on start, unless history
 * or a draft can still bring the photo back: deleting a photo keeps its files for undo.
 */
export async function sweepOrphanFiles(now = Date.now()) {
  const db = getDb()
  const known = new Set(db.select({ id: schema.media.id }).from(schema.media).all().map((r) => r.id))
  const mentioned = (id: string) => {
    const like = (t: typeof schema.history.changes | typeof schema.proposals.ops) => sql`instr(${t}, ${id}) > 0`
    return !!db.select({ id: schema.history.id }).from(schema.history).where(like(schema.history.changes)).limit(1).get()
      || !!db.select({ id: schema.proposals.id }).from(schema.proposals).where(like(schema.proposals.ops)).limit(1).get()
  }
  const orphans = new Map<string, string[]>()
  for (const f of await listMediaFiles()) {
    const id = f.slice(0, f.indexOf('.'))
    if (id && !known.has(id)) orphans.set(id, [...(orphans.get(id) ?? []), f])
  }
  let removed = 0
  for (const [id, files] of orphans) {
    const stats = await Promise.all(files.map((f) => fs.stat(mediaFile(f))))
    if (stats.some((s) => now - s.mtimeMs < OLD_ENOUGH) || mentioned(id)) continue
    await Promise.all(files.map((f) => fs.unlink(mediaFile(f))))
    removed += files.length
  }
  return removed
}

/** Removes the files of an upload that was never accepted. */
export const discardUpload = removeMediaFiles

export function listAllMedia(actor: Actor, limit = 200): Media[] {
  return visible(actor, withTags(getDb().select().from(schema.media).orderBy(desc(schema.media.createdAt)).limit(limit).all(), actor))
}

/** Fetches a photo for an upload-by-link, refusing addresses inside our own network. */
export async function fetchRemote(url: string): Promise<{ buf: Buffer; name: string }> {
  const u = new URL(url)
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new OpError(400, 'only http and https links')
  const literal = u.hostname.replace(/^\[|\]$/g, '')
  if (isIP(literal) && isPrivateAddress(literal)) throw new OpError(400, 'address not allowed')
  const buf = await new Promise<Buffer>((resolve, reject) => {
    const failed = (e: unknown) => reject(e instanceof OpError ? e : new OpError(400, 'could not download'))
    // The check runs at the moment of connecting, so a name cannot answer differently the second time.
    const checked = ((host: string, opts: object, done: (e: Error | null, a?: unknown, f?: number) => void) => lookup(host, { all: true }).then((all) => {
      if (!all.length || all.some((h) => isPrivateAddress(h.address))) return done(new OpError(400, 'address not allowed'))
      ;(opts as { all?: boolean }).all ? done(null, all) : done(null, all[0].address, all[0].family)
    }, () => done(new OpError(400, 'host not found')))) as never
    const req = (u.protocol === 'https:' ? https : http).get(u, { lookup: checked, timeout: 20_000 }, (res) => {
      // Redirects could lead to an internal address, so they are not followed.
      if (res.statusCode !== 200) { res.destroy(); return reject(new OpError(400, `download failed: ${res.statusCode}`)) }
      const parts: Buffer[] = []
      let size = 0
      res.on('data', (c: Buffer) => { size += c.length; if (size > MAX_SIZE) { res.destroy(); reject(new OpError(413, 'file too large')) } else parts.push(c) })
      res.on('end', () => resolve(Buffer.concat(parts)))
      res.on('error', failed)
    })
    req.on('timeout', () => req.destroy(new OpError(400, 'could not download')))
    req.on('error', failed)
  })
  return { buf, name: decodeURIComponent(path.basename(u.pathname)) || 'photo' }
}

export function isPrivateAddress(ip: string) {
  const mapped = ip.toLowerCase().startsWith('::ffff:') ? ip.slice(7) : ip
  // ::ffff:7f00:1 is 127.0.0.1 written in hex.
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(mapped)
  const v4 = hex ? [parseInt(hex[1], 16) >> 8, parseInt(hex[1], 16) & 255, parseInt(hex[2], 16) >> 8, parseInt(hex[2], 16) & 255].join('.') : mapped
  if (isIP(v4) === 4) {
    const [a, b] = v4.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
  }
  const low = ip.toLowerCase()
  return low === '::' || low === '::1' || low.startsWith('fc') || low.startsWith('fd') || /^fe[89ab]/.test(low) || low.startsWith('ff')
}

export async function readMediaFile(actor: Actor, id: string, size: MediaSize) {
  if (!canSeeMedia(actor, id)) throw new OpError(404, 'not found')
  const r = row(id)
  const file = r.kind === 'image' && size !== 'orig' ? `${id}.${size}.webp` : r.filename
  return {
    // The camera's record of where a picture was taken stays with those who may edit the archive.
    data: await fs.readFile(mediaFile(file)).then((b) => (r.kind === 'image' && file === r.filename && seesOnlyPublic(actor) ? sharp(b, { failOn: 'none' }).rotate().jpeg({ quality: 92 }).toBuffer() : b)).catch(() => { throw new OpError(404, 'the file is missing') }),
    mime: file.endsWith('.webp') ? 'image/webp' : r.kind === 'image' && seesOnlyPublic(actor) ? 'image/jpeg' : r.mime,
    name: r.originalName,
    download: r.kind !== 'image',
  }
}

/** A stored crop, or the whole picture when it makes no sense. */
function cropBox(crop: string | null): Box {
  try {
    const c = JSON.parse(crop ?? '')
    if ([c.x, c.y, c.w, c.h].every(Number.isFinite) && c.x >= 0 && c.x < 1 && c.y >= 0 && c.y < 1 && c.w > 0 && c.h > 0) return c
  } catch {}
  return { x: 0, y: 0, w: 1, h: 1 }
}

/** Square avatar cut from the medium copy and cached on disk. */
export async function readAvatar(mediaId: string, crop: string | null) {
  const c = cropBox(crop)
  const key = [c.x, c.y, c.w, c.h].map((n) => Math.round(n * 1000)).join('_')
  const cached = mediaFile(`${mediaId}.avatar.${key}.webp`)
  const hit = await fs.readFile(cached).catch(() => null)
  if (hit) return hit
  const src = mediaFile(`${mediaId}.medium.webp`)
  const m = await sharp(src).metadata().catch(() => { throw new OpError(404, 'the file is missing') })
  const W = m.width!, H = m.height!
  const left = Math.min(W - 1, Math.round(c.x * W)), top = Math.min(H - 1, Math.round(c.y * H))
  const width = Math.max(1, Math.min(W - left, Math.round(c.w * W))), height = Math.max(1, Math.min(H - top, Math.round(c.h * H)))
  const out = await sharp(src).extract({ left, top, width, height }).resize(192, 192, { fit: 'cover' }).webp({ quality: 82 }).toBuffer()
  await writeAtomic(cached, out)
  return out
}

export function updateMedia(actor: Actor, id: string, patch: { caption?: string; date?: string; place?: string }) {
  requireRole(actor, 'editor')
  const r = row(id)
  mutate(actor, { summary: `${say('Подпись')}: ${r.originalName}`, key: `media:${id}` }, (c) => c.update('media', id, patch))
}

export function deleteMedia(actor: Actor, id: string) {
  requireRole(actor, 'editor')
  const db = getDb()
  const r = row(id)
  // Files stay on disk so the deletion can be rolled back.
  const tags = db.select().from(schema.mediaTags).where(eq(schema.mediaTags.mediaId, id)).all()
  mutate(actor, { summary: `${say('Удалить')}: ${r.originalName}`, personIds: tags.flatMap((t) => t.personId ?? []) }, (c: Changes) => {
    tags.forEach((t) => c.remove('mediaTags', t.id))
    db.select().from(schema.persons).where(eq(schema.persons.avatarMediaId, id)).all().forEach((p) => c.update('persons', p.id, { avatarMediaId: null, avatarCrop: null }))
    c.remove('media', id)
  })
}

/** Marks someone on a photo: a person with a card, or anyone else by a caption alone. */
export function addTag(actor: Actor, mediaId: string, who: { personId?: string | null; label?: string | null }, box: Box | null) {
  requireRole(actor, 'editor')
  const r = row(mediaId)
  const personId = who.personId || null
  const label = who.label?.trim() || null
  if (!personId && !label) throw new OpError(400, 'who is on the photo?')
  const db = getDb()
  return mutate(actor, { summary: `${say('Фото')}: ${r.originalName}`, personIds: personId ? [personId] : [] }, (c) => {
    // Replace the frameless tag from upload rather than listing the person twice.
    const loose = personId ? db.select().from(schema.mediaTags).where(eq(schema.mediaTags.mediaId, mediaId)).all().find((t) => t.personId === personId && t.x === null) : undefined
    if (loose && box) return c.update('mediaTags', loose.id, { ...box })
    return c.insert('mediaTags', { id: newId(), mediaId, personId, label: personId ? null : label, ...(box ?? {}) })
  })
}

export function removeTag(actor: Actor, id: string) {
  requireRole(actor, 'editor')
  const t = getDb().select().from(schema.mediaTags).where(eq(schema.mediaTags.id, id)).get()
  if (!t) throw new OpError(404, 'not found')
  mutate(actor, { summary: `${say('Удалить')}: ${say('Фото')}`, personIds: t.personId ? [t.personId] : [] }, (c) => c.remove('mediaTags', id))
}
