import fs from 'node:fs/promises'
import path from 'node:path'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import sharp from 'sharp'
import { eq, inArray } from 'drizzle-orm'
import { getDb, MEDIA_DIR, schema } from '../db'
import type { Box, Media } from '../types'
import { translate } from '../i18n'
import { Actor, Changes, mutate, newId, OpError, requireRole } from './core'
import { getGraph } from './people'
import { getSetting } from './settings'

const say = (key: string) => translate(getSetting('language') === 'en' ? 'en' : 'ru', key)
const MAX_SIZE = 40 * 1024 * 1024
const SIZES = { thumb: 360, medium: 1600 } as const
export type MediaSize = keyof typeof SIZES | 'orig'

function row(id: string) {
  const r = getDb().select().from(schema.media).where(eq(schema.media.id, id)).get()
  if (!r) throw new OpError(404, 'not found')
  return r
}

/** Readers lose access to any photo that shows a relative hidden from them. */
function hiddenIds(actor: Actor) {
  return actor.role === 'reader' ? new Set(getGraph(actor).persons.filter((p) => p.hidden).map((p) => p.id)) : new Set<string>()
}

export function canSeeMedia(actor: Actor, mediaId: string) {
  const hidden = hiddenIds(actor)
  if (!hidden.size) return true
  return !getDb().select().from(schema.mediaTags).where(eq(schema.mediaTags.mediaId, mediaId)).all().some((t) => hidden.has(t.personId))
}

function withTags(rows: (typeof schema.media.$inferSelect)[]): Media[] {
  if (!rows.length) return []
  const tags = getDb().select().from(schema.mediaTags).where(inArray(schema.mediaTags.mediaId, rows.map((r) => r.id))).all()
  return rows.map((r) => ({
    id: r.id, kind: r.kind as Media['kind'], originalName: r.originalName, mime: r.mime, width: r.width, height: r.height,
    caption: r.caption, date: r.date, place: r.place, createdAt: r.createdAt,
    tags: tags.filter((t) => t.mediaId === r.id),
  }))
}

export function listPersonMedia(actor: Actor, personId: string): Media[] {
  const db = getDb()
  const ids = db.select({ id: schema.mediaTags.mediaId }).from(schema.mediaTags).where(eq(schema.mediaTags.personId, personId)).all().map((r) => r.id)
  if (!ids.length) return []
  return withTags(db.select().from(schema.media).where(inArray(schema.media.id, ids)).all()).filter((m) => canSeeMedia(actor, m.id))
}

export function getMedia(actor: Actor, id: string): Media {
  if (!canSeeMedia(actor, id)) throw new OpError(404, 'not found')
  return withTags([row(id)])[0]
}

/** Stores the bytes and returns a row; the caller records it in a mutation. */
export async function storeUpload(buf: Buffer, originalName: string, uploadedBy: string) {
  if (buf.length > MAX_SIZE) throw new OpError(413, 'file too large')
  const id = newId()
  const meta = await sharp(buf, { failOn: 'none' }).metadata().catch(() => null)
  // Only raster photos become images. SVG is served as a download, since it can carry scripts.
  const isImage = !!meta?.format && ['jpeg', 'png', 'webp', 'gif', 'heif', 'tiff', 'avif'].includes(meta.format)
  const ext = path.extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8)
  const filename = isImage ? `${id}.orig${ext || '.' + meta!.format}` : `${id}.file${ext}`
  await fs.writeFile(path.join(MEDIA_DIR, filename), buf)
  let width = 0, height = 0
  if (isImage) {
    const rotated = sharp(buf, { failOn: 'none' }).rotate()
    const info = await rotated.clone().webp({ quality: 82 }).resize({ width: SIZES.medium, height: SIZES.medium, fit: 'inside', withoutEnlargement: true }).toFile(path.join(MEDIA_DIR, `${id}.medium.webp`))
    await rotated.clone().webp({ quality: 76 }).resize({ width: SIZES.thumb, height: SIZES.thumb, fit: 'inside', withoutEnlargement: true }).toFile(path.join(MEDIA_DIR, `${id}.thumb.webp`))
    width = info.width
    height = info.height
  }
  return {
    id, kind: isImage ? 'image' : 'file', filename, originalName, mime: isImage ? `image/${meta!.format}` : 'application/octet-stream',
    width, height, size: buf.length, uploadedBy, createdAt: Date.now(),
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

/** Removes the files of an upload that was never accepted. */
export async function discardUpload(id: string) {
  const files = await fs.readdir(MEDIA_DIR)
  await Promise.all(files.filter((f) => f.startsWith(`${id}.`)).map((f) => fs.unlink(path.join(MEDIA_DIR, f)).catch(() => null)))
}

export function listAllMedia(actor: Actor, limit = 200): Media[] {
  return withTags(getDb().select().from(schema.media).limit(limit).all()).filter((m) => canSeeMedia(actor, m.id))
}

/** Fetches a photo for an upload-by-link, refusing addresses inside our own network. */
export async function fetchRemote(url: string): Promise<{ buf: Buffer; name: string }> {
  const u = new URL(url)
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new OpError(400, 'only http and https links')
  const hosts = await lookup(u.hostname, { all: true }).catch(() => { throw new OpError(400, 'host not found') })
  if (!hosts.length || hosts.some((h) => isPrivateAddress(h.address))) throw new OpError(400, 'address not allowed')
  // Redirects could lead to an internal address, so they are not followed.
  const res = await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(20_000) }).catch(() => { throw new OpError(400, 'could not download the file') })
  if (!res.ok) throw new OpError(400, `download failed: ${res.status}`)
  if (Number(res.headers.get('content-length') ?? 0) > MAX_SIZE) throw new OpError(413, 'file too large')
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_SIZE) throw new OpError(413, 'file too large')
  return { buf, name: decodeURIComponent(path.basename(u.pathname)) || 'photo' }
}

export function isPrivateAddress(ip: string) {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip
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
    data: await fs.readFile(path.join(MEDIA_DIR, file)),
    mime: file.endsWith('.webp') ? 'image/webp' : r.mime,
    name: r.originalName,
    download: r.kind !== 'image',
  }
}

/** Square avatar cut from the medium copy and cached on disk. */
export async function readAvatar(mediaId: string, crop: string | null) {
  const c: Box = crop ? JSON.parse(crop) : { x: 0, y: 0, w: 1, h: 1 }
  const key = [c.x, c.y, c.w, c.h].map((n) => Math.round(n * 1000)).join('_')
  const cached = path.join(MEDIA_DIR, `${mediaId}.avatar.${key}.webp`)
  const hit = await fs.readFile(cached).catch(() => null)
  if (hit) return hit
  const src = path.join(MEDIA_DIR, `${mediaId}.medium.webp`)
  const m = await sharp(src).metadata()
  const W = m.width!, H = m.height!
  const left = Math.max(0, Math.round(c.x * W)), top = Math.max(0, Math.round(c.y * H))
  const width = Math.max(1, Math.min(W - left, Math.round(c.w * W))), height = Math.max(1, Math.min(H - top, Math.round(c.h * H)))
  const out = await sharp(src).extract({ left, top, width, height }).resize(192, 192, { fit: 'cover' }).webp({ quality: 82 }).toBuffer()
  await fs.writeFile(cached, out)
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
  mutate(actor, { summary: `${say('Удалить')}: ${r.originalName}`, personIds: tags.map((t) => t.personId) }, (c: Changes) => {
    tags.forEach((t) => c.remove('mediaTags', t.id))
    db.select().from(schema.persons).where(eq(schema.persons.avatarMediaId, id)).all().forEach((p) => c.update('persons', p.id, { avatarMediaId: null, avatarCrop: null }))
    c.remove('media', id)
  })
}

export function addTag(actor: Actor, mediaId: string, personId: string, box: Box | null) {
  requireRole(actor, 'editor')
  const r = row(mediaId)
  const db = getDb()
  return mutate(actor, { summary: `${say('Фото')}: ${r.originalName}`, personIds: [personId] }, (c) => {
    // Replace the frameless tag from upload rather than listing the person twice.
    const loose = db.select().from(schema.mediaTags).where(eq(schema.mediaTags.mediaId, mediaId)).all().find((t) => t.personId === personId && t.x === null)
    if (loose && box) return c.update('mediaTags', loose.id, { ...box })
    return c.insert('mediaTags', { id: newId(), mediaId, personId, ...(box ?? {}) })
  })
}

export function removeTag(actor: Actor, id: string) {
  requireRole(actor, 'editor')
  const t = getDb().select().from(schema.mediaTags).where(eq(schema.mediaTags.id, id)).get()
  if (!t) throw new OpError(404, 'not found')
  mutate(actor, { summary: `${say('Удалить')}: ${say('Фото')}`, personIds: [t.personId] }, (c) => c.remove('mediaTags', id))
}
