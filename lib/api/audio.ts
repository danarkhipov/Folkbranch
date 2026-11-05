import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import { Readable } from 'node:stream'
import { mediaFile } from '@/lib/storage'

/** Sends a sound file piece by piece, so a player can jump ahead and a long recording does not sit in memory. */
export async function audioResponse(audio: { filename: string; mime: string }, req: Request) {
  const file = mediaFile(audio.filename)
  const { size } = await fs.stat(file)
  const headers: Record<string, string> = { 'Content-Type': audio.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-cache' }
  const range = req.headers.get('range')?.match(/^bytes=(\d*)-(\d*)$/)
  let start = 0, end = size - 1
  if (req.headers.has('range')) {
    const [from, to] = [range?.[1], range?.[2]]
    if (from) { start = Number(from); if (to) end = Math.min(Number(to), size - 1) }
    else if (to) start = Math.max(size - Number(to), 0)
    if (!range || (!from && !to) || start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  }
  headers['Content-Length'] = String(end - start + 1)
  return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, { status: headers['Content-Range'] ? 206 : 200, headers })
}
