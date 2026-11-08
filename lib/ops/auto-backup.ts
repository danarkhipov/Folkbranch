// A copy of the database each day, kept beside it, so a mistake or a broken update can be undone even without the
// history. It lives on the same disk, so it does not replace a copy the family keeps elsewhere, and the page says so.
// Photos are written once and never changed, so they are not copied again: the folder already keeps every one.
import { lowOnRoom } from './disk'
import fs from 'node:fs/promises'
import path from 'node:path'
import { DATA_DIR, getDb } from '../db'
import { Actor, requireRole } from './core'

const DAY = 24 * 3600 * 1000
export const KEEP = 7
// The ignore mark keeps the build from copying the family's own backups into what it ships.
const dir = () => path.join(/*turbopackIgnore: true*/ DATA_DIR, 'backups', 'daily')
const NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}$/

export interface BackupStatus { on: boolean; last: number | null; count: number; bytes: number; keep: number; problem: 'disk' | 'failed' | null }

let problem: BackupStatus['problem'] = null
export const autoBackupOn = () => process.env.FOLKBRANCH_AUTO_BACKUP !== '0'

async function copies() {
  const names = (await fs.readdir(dir()).catch(() => [] as string[])).filter((n) => NAME.test(n)).sort()
  return Promise.all(names.map(async (name) => {
    const file = path.join(/*turbopackIgnore: true*/ dir(), name, 'family.db')
    const stat = await fs.stat(file).catch(() => null)
    return { name, file, at: stat?.mtimeMs ?? 0, bytes: stat?.size ?? 0 }
  }))
}

/** Makes one copy when the last is a day old, or now when asked; keeps the newest few. */
export async function runAutoBackup({ force = false, now = Date.now() } = {}) {
  const list = (await copies()).filter((c) => c.at)
  if (!force && list.length && now - list[list.length - 1].at < DAY) return null
  const disk = await fs.statfs(DATA_DIR).catch(() => null)
  if (disk && lowOnRoom(disk)) { problem = 'disk'; return null }
  const name = new Date(now).toISOString().slice(0, 16).replace(':', '-')
  const target = path.join(/*turbopackIgnore: true*/ dir(), name)
  try {
    await fs.mkdir(target, { recursive: true })
    // A consistent copy, safe while people are writing.
    await getDb().$client.backup(path.join(/*turbopackIgnore: true*/ target, 'family.db'))
    problem = null
  } catch (e) {
    problem = 'failed'
    await fs.rm(target, { recursive: true, force: true })
    throw e
  }
  const kept = (await copies()).filter((c) => c.at)
  for (const old of kept.slice(0, Math.max(0, kept.length - KEEP))) await fs.rm(path.join(/*turbopackIgnore: true*/ dir(), old.name), { recursive: true, force: true })
  return name
}

export async function backupStatus(actor: Actor): Promise<BackupStatus> {
  requireRole(actor, 'owner')
  const list = (await copies()).filter((c) => c.at)
  const last = list[list.length - 1]
  return { on: autoBackupOn(), last: last?.at ?? null, count: list.length, bytes: last?.bytes ?? 0, keep: KEEP, problem }
}

export async function backupNow(actor: Actor) {
  requireRole(actor, 'owner')
  await runAutoBackup({ force: true })
  return backupStatus(actor)
}
