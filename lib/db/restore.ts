// Puts a checked copy of the archive in place. This runs at startup, before anything opens the database:
// a running app holds the connection in its sign-in and caches, so swapping underneath it is not safe.
import fs from 'node:fs'
import path from 'node:path'

export const PENDING = 'restore-pending'
const PREVIOUS = path.join('backups', 'before-restore')
const DB_FILES = ['family.db', 'family.db-wal', 'family.db-shm']

/** Each step is safe to repeat, so a crash halfway through finishes on the next start. The previous archive is kept once. */
export function applyPendingRestore(dataDir: string) {
  const at = (...p: string[]) => path.join(/*turbopackIgnore: true*/ dataDir, ...p)
  const pending = at(PENDING)
  if (!fs.existsSync(pending)) return false
  const previous = at(PREVIOUS)
  // Nothing has moved yet only if the new database is still waiting; otherwise this is the second attempt.
  if (fs.existsSync(path.join(/*turbopackIgnore: true*/ pending, 'family.db'))) {
    fs.rmSync(previous, { recursive: true, force: true })
    fs.mkdirSync(previous, { recursive: true })
    for (const f of DB_FILES) if (fs.existsSync(at(f))) fs.renameSync(at(f), path.join(/*turbopackIgnore: true*/ previous, f))
    if (fs.existsSync(at('media'))) fs.renameSync(at('media'), path.join(/*turbopackIgnore: true*/ previous, 'media'))
    if (fs.existsSync(path.join(/*turbopackIgnore: true*/ pending, 'media'))) fs.renameSync(path.join(/*turbopackIgnore: true*/ pending, 'media'), at('media'))
    fs.renameSync(path.join(/*turbopackIgnore: true*/ pending, 'family.db'), at('family.db'))
  }
  fs.rmSync(pending, { recursive: true, force: true })
  console.log(`Archive restored from a copy. The previous one is kept in ${previous}.`)
  return true
}
