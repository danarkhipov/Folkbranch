// Files a person gives the assistant. They belong to that person, stay on the server, and reach the
// model only as part of that person's own conversation. Saving one into the archive is a separate,
// confirmed step.
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { readSheet } from 'read-excel-file/node'
import sharp from 'sharp'
import { sheetCell } from '../import-formats'
import { DATA_DIR } from '../db'
import { newId, OpError, type Actor } from '../ops/core'

const MAX_SIZE = 40 * 1024 * 1024
const MAX_AGE = 14 * 24 * 3600 * 1000
/** How much text goes into the conversation at once; read_attachment gets the rest. */
export const TEXT_PAGE = 30_000
const MODEL_IMAGE_SIDE = 1568

export type AttachmentKind = 'image' | 'pdf' | 'text' | 'binary'
export interface Attachment { id: string; name: string; kind: AttachmentKind; size: number; createdAt: number }

const ROOT = () => path.join(DATA_DIR, 'agent-files')
const ID = /^[A-Za-z0-9_-]{12}$/
const dirOf = (userId: string) => path.join(ROOT(), createHash('sha256').update(userId).digest('hex').slice(0, 24))
const fileOf = (userId: string, id: string, part: string) => {
  if (!ID.test(id)) throw new OpError(404, 'no such attachment')
  return path.join(dirOf(userId), `${id}.${part}`)
}

/** Legacy Russian files are often not UTF-8, GEDCOM especially. */
function asText(buf: Buffer) {
  if (buf.includes(0)) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('windows-1251').decode(buf)
  }
}

async function spreadsheetText(buf: Buffer) {
  const rows = await readSheet(buf)
  return rows.map((r) => r.map((c) => `"${sheetCell(c).replace(/"/g, '""')}"`).join(',')).join('\n')
}

export async function saveAttachment(actor: Actor, buf: Buffer, name: string): Promise<Attachment> {
  if (!buf.length) throw new OpError(400, 'the file is empty')
  if (buf.length > MAX_SIZE) throw new OpError(413, 'file too large')
  const id = newId()
  await fs.mkdir(dirOf(actor.userId), { recursive: true })
  const put = (part: string, data: Buffer | string) => fs.writeFile(fileOf(actor.userId, id, part), data)
  const meta = await sharp(buf, { failOn: 'none' }).metadata().catch(() => null)
  let kind: AttachmentKind = 'binary'
  if (meta?.format && ['jpeg', 'png', 'webp', 'gif', 'heif', 'tiff', 'avif'].includes(meta.format)) {
    // What the model looks at: a copy of a size it can use. A picture this server cannot decode stays a file.
    const copy = await sharp(buf, { failOn: 'none' }).rotate().resize({ width: MODEL_IMAGE_SIDE, height: MODEL_IMAGE_SIDE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer().catch(() => null)
    if (copy) {
      await put('view.jpg', copy)
      kind = 'image'
    }
  } else if (buf.subarray(0, 5).toString('latin1') === '%PDF-') kind = 'pdf'
  else if (/\.xlsx$/i.test(name) && buf.subarray(0, 2).toString('latin1') === 'PK') {
    const table = await spreadsheetText(buf).catch(() => null)
    if (table !== null) {
      await put('txt', table)
      kind = 'text'
    }
  } else {
    const text = asText(buf)
    if (text !== null) {
      await put('txt', text)
      kind = 'text'
    }
  }
  await put('bin', buf)
  const att: Attachment = { id, name: path.basename(name).slice(0, 200) || 'file', kind, size: buf.length, createdAt: Date.now() }
  await put('json', JSON.stringify(att))
  return att
}

export async function getAttachment(actor: Actor, id: string): Promise<Attachment> {
  const raw = await fs.readFile(fileOf(actor.userId, id, 'json'), 'utf8').catch(() => null)
  if (!raw) throw new OpError(404, 'no such attachment')
  return JSON.parse(raw)
}

/** A model may name a file by its link or its name instead of its id: all of them mean the person's own file. */
export async function findAttachment(actor: Actor, ref: string): Promise<Attachment> {
  const id = attachmentIdFromUrl(ref) ?? ref
  const direct = /^[\w-]{12}$/.test(id) ? await getAttachment(actor, id).catch(() => null) : null
  if (direct) return direct
  const dir = dirOf(actor.userId)
  const files = (await fs.readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.json'))
  const all = await Promise.all(files.map(async (f) => JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')) as Attachment))
  const named = all.filter((a) => a.name === ref).sort((a, b) => b.createdAt - a.createdAt)[0]
  if (!named) throw new OpError(404, `no attachment ${ref}. Use the id given with the file in the person's message.`)
  return named
}

export const attachmentBytes = (actor: Actor, id: string) => fs.readFile(fileOf(actor.userId, id, 'bin'))
export const attachmentView = (actor: Actor, id: string) => fs.readFile(fileOf(actor.userId, id, 'view.jpg'))

export async function readAttachmentText(actor: Actor, id: string, offset = 0) {
  const att = await getAttachment(actor, id)
  if (att.kind !== 'text') throw new OpError(400, `${att.name} is not a text file`)
  const text = await fs.readFile(fileOf(actor.userId, id, 'txt'), 'utf8')
  return { name: att.name, total: text.length, offset, text: text.slice(offset, offset + TEXT_PAGE), more: offset + TEXT_PAGE < text.length }
}

/** Conversations are not kept long, so what they brought in is not either. */
export async function sweepAttachments(now = Date.now()) {
  const users = await fs.readdir(ROOT()).catch(() => [] as string[])
  let removed = 0
  for (const user of users) {
    const dir = path.join(ROOT(), user)
    for (const f of await fs.readdir(dir)) {
      const file = path.join(dir, f)
      if (now - (await fs.stat(file)).mtimeMs > MAX_AGE) {
        await fs.unlink(file)
        removed++
      }
    }
  }
  return removed
}

/** A file part as the client sends it points here. Anything else is not ours to open. */
export const attachmentIdFromUrl = (url: unknown) => (typeof url === 'string' ? url.match(/^\/api\/agent\/files\/([A-Za-z0-9_-]{12})$/)?.[1] : undefined) ?? null
