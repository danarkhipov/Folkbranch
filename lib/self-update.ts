// Updating from the app, where the install can do it by itself: an install without Docker on one's own computer runs
// the same installer people paste, which swaps only the program folder and never the data folder. Everywhere else
// the owner is told the one step that updates that kind of install. Data first, always: before anything starts, a
// copy of the database is made, opened again and checked, and an update without a good copy does not start.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { DATA_DIR, getDb } from './db'
import { type Actor, OpError, requireRole } from './ops/core'
import { tell } from './ops/settings'
import { updateStatus } from './update-check'

export type InstallKind = 'local' | 'server' | 'docker' | 'railway' | 'render' | 'fly' | 'other'

/** The install folder of an install without Docker: the server runs from its app/ folder. */
const installDir = () => path.resolve(/*turbopackIgnore: true*/ process.cwd(), '..')

export function installKind(env: Record<string, string | undefined> = process.env): InstallKind {
  const dir = installDir()
  if (fs.existsSync(path.join(/*turbopackIgnore: true*/ dir, '.local')) && fs.existsSync(path.join(/*turbopackIgnore: true*/ dir, 'folkbranch'))) {
    return fs.existsSync(path.join(/*turbopackIgnore: true*/ dir, '.server')) ? 'server' : 'local'
  }
  if (env.RAILWAY_PROJECT_ID) return 'railway'
  if (env.RENDER) return 'render'
  if (env.FLY_APP_NAME) return 'fly'
  if (fs.existsSync('/.dockerenv')) return 'docker'
  return 'other'
}

const REPO = 'https://raw.githubusercontent.com/danarkhipov/folkbranch'
/** The installer of the release being installed, so a newer main branch cannot change what this update does. */
const installerUrl = (version: string) => process.env.FOLKBRANCH_INSTALLER ?? `${REPO}/v${version}/install.sh`

/** What the owner can do to update this kind of install. */
export function updateHow(kind: InstallKind, version: string) {
  const paste = `curl -fsSL ${REPO}/v${version}/install.sh | sh`
  switch (kind) {
    case 'local': return { kind, button: process.env.FOLKBRANCH_SELF_UPDATE !== 'off', command: paste }
    case 'server': return { kind, button: false, command: `curl -fsSL ${REPO}/v${version}/install.sh | sudo sh -s -- --server` }
    case 'docker': return { kind, button: false, command: `${paste}   # ${tell('в папке, куда ставили, или')} docker compose pull && docker compose up -d` }
    case 'railway': return { kind, button: false, steps: tell('В Railway: Deployments → Redeploy, или railway up из обновлённой копии репозитория') }
    case 'render': return { kind, button: false, steps: tell('В Render: Manual Deploy → Deploy latest commit') }
    case 'fly': return { kind, button: false, steps: tell('fly deploy из обновлённой копии репозитория') }
    default: return { kind, button: false, command: paste }
  }
}

const backupsDir = () => path.join(/*turbopackIgnore: true*/ DATA_DIR, 'backups', 'before-update')
const KEEP = 5

/** A copy of the database, opened again and checked: a copy that cannot be read is no copy. */
export async function backupBeforeUpdate(version: string) {
  const name = `${new Date().toISOString().slice(0, 16).replace(':', '-')}-to-${version}`
  const target = path.join(/*turbopackIgnore: true*/ backupsDir(), name)
  fs.mkdirSync(target, { recursive: true })
  const file = path.join(/*turbopackIgnore: true*/ target, 'family.db')
  const live = getDb().$client
  await live.backup(file)
  const copy = new Database(file, { readonly: true })
  try {
    const ok = (copy.pragma('integrity_check', { simple: true }) as string) === 'ok'
    const count = (db: Database.Database) => (db.prepare('select count(*) as n from persons').get() as { n: number }).n
    if (!ok || count(copy) !== count(live)) throw new Error('the copy does not match the database')
  } catch (e) {
    copy.close()
    fs.rmSync(target, { recursive: true, force: true })
    throw new OpError(500, `${tell('Не удалось сделать проверенную копию базы, обновление не начато')}: ${(e as Error).message}`)
  }
  copy.close()
  const all = fs.readdirSync(backupsDir()).sort()
  for (const old of all.slice(0, Math.max(0, all.length - KEEP))) fs.rmSync(path.join(/*turbopackIgnore: true*/ backupsDir(), old), { recursive: true, force: true })
  return path.relative(DATA_DIR, file)
}

const lockFile = () => path.join(/*turbopackIgnore: true*/ installDir(), 'update.lock')
/** Whether an update started from the app is still running: the installer removes the lock when it ends, well or not. */
export const updateRunning = () => fs.existsSync(lockFile())

/** Starts the update and returns at once: the installer stops this server, swaps the program and starts it again. */
export async function applyUpdate(actor: Actor, run = spawn) {
  requireRole(actor, 'owner')
  const status = await updateStatus(actor)
  if (!status.newer || !status.latest) throw new OpError(409, tell('Новой версии нет'))
  const how = updateHow(installKind(), status.latest)
  if (!how.button) throw new OpError(409, tell('Эту установку обновляют не из приложения'))
  const lock = lockFile()
  if (fs.existsSync(lock) && Date.now() - fs.statSync(lock).mtimeMs < 15 * 60_000) throw new OpError(409, tell('Обновление уже идёт'))
  const backup = await backupBeforeUpdate(status.latest)
  const dir = installDir()
  fs.mkdirSync(path.join(/*turbopackIgnore: true*/ dir, 'logs'), { recursive: true })
  fs.writeFileSync(lock, status.latest)
  const log = fs.openSync(path.join(/*turbopackIgnore: true*/ dir, 'logs', 'update.log'), 'a')
  // Its own session, so it lives on when the installer stops this server.
  const child = run('sh', ['-c', `curl -fsSL "$INSTALLER" | sh -s -- --dir "$DIR"; rm -f "$DIR/update.lock"`], {
    cwd: dir, detached: true, stdio: ['ignore', log, log],
    env: { ...process.env, INSTALLER: installerUrl(status.latest), DIR: dir },
  })
  child.unref()
  return { started: true, version: status.latest, backup }
}
