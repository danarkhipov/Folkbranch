// Files on the volume: where they lie and how they are written. What a file means is up to its caller.
import fs from 'node:fs/promises'
import path from 'node:path'
import { nanoid } from 'nanoid'
import { MEDIA_DIR } from './db'

export const mediaFile = (name: string) => path.join(/*turbopackIgnore: true*/ MEDIA_DIR, name)

export const listMediaFiles = () => fs.readdir(MEDIA_DIR)

/** By rename, so a crash or a full disk cannot leave half a file that later reads take for the real one. */
export async function writeAtomic(file: string, data: Buffer | string) {
  const part = `${file}.${nanoid(8)}.part`
  try {
    await fs.writeFile(part, data)
    await fs.rename(part, file)
  } catch (e) {
    await fs.unlink(part).catch(() => {})
    throw e
  }
}

/** Removes every copy of one stored item: its files all start with its id. */
export async function removeMediaFiles(id: string) {
  const files = await listMediaFiles()
  await Promise.all(files.filter((f) => f.startsWith(`${id}.`)).map((f) => fs.unlink(mediaFile(f)).catch(() => null)))
}
