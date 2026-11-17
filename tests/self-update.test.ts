// Updating from the app: never without a checked copy of the database, never twice at once, only where the install
// can do it by itself, and only to a newer release.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DATA_DIR } from '../lib/db'
import { applyUpdate, backupBeforeUpdate, installKind, updateHow } from '../lib/self-update'
import { forgetUpdateCache } from '../lib/update-check'
import { editor, loadFamily, owner } from './fixture-family'

let install = ''
const release = (tag: string) => vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ tag_name: tag, html_url: `https://example.org/${tag}` }), { status: 200 }))
const asInstall = (marks: string[]) => {
  install = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-install-'))
  fs.mkdirSync(path.join(install, 'app'))
  for (const m of marks) fs.writeFileSync(path.join(install, m), '')
  vi.spyOn(process, 'cwd').mockReturnValue(path.join(install, 'app'))
}
const fakeRun = () => vi.fn(() => ({ unref: () => {} }) as never)

beforeEach(async () => {
  forgetUpdateCache()
  if (!(await import('../lib/ops/settings')).findOwnerId()) await loadFamily()
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('what kind of install this is', () => {
  it('an install without Docker on a computer', () => { asInstall(['.local', 'folkbranch']); expect(installKind({})).toBe('local') })
  it('a server install, run by a service account', () => { asInstall(['.local', 'folkbranch', '.server']); expect(installKind({})).toBe('server') })
  it('a hosting platform', () => { asInstall([]); expect(installKind({ RAILWAY_PROJECT_ID: 'x' })).toBe('railway') })
  it('only a computer install gets the button, and it can be switched off', () => {
    expect(updateHow('local', '1.6.0').button).toBe(true)
    expect(updateHow('server', '1.6.0')).toMatchObject({ button: false, command: expect.stringContaining('sudo sh -s -- --server') })
    expect(updateHow('server', '1.6.0').command).toContain('/v1.6.0/install.sh')
    vi.stubEnv('FOLKBRANCH_SELF_UPDATE', 'off')
    expect(updateHow('local', '1.6.0').button).toBe(false)
  })
})

describe('the copy before an update', () => {
  it('is a readable copy with every person in it', async () => {
    const rel = await backupBeforeUpdate('1.6.0')
    const copy = new Database(path.join(DATA_DIR, rel), { readonly: true })
    const n = (copy.prepare('select count(*) as n from persons').get() as { n: number }).n
    copy.close()
    expect(n).toBeGreaterThan(0)
  })
  it('keeps the last five', async () => {
    for (let i = 0; i < 7; i++) await backupBeforeUpdate(`1.6.${i}`)
    expect(fs.readdirSync(path.join(DATA_DIR, 'backups', 'before-update'))).toHaveLength(5)
  })
})

describe('starting an update', () => {
  it('makes the checked copy before the installer runs, and runs the installer of that release', async () => {
    asInstall(['.local', 'folkbranch'])
    release('v9.9.9')
    let copiedFirst = false
    const run = vi.fn((...a: unknown[]) => {
      const dir = path.join(DATA_DIR, 'backups', 'before-update')
      copiedFirst = fs.readdirSync(dir).some((n) => n.endsWith('-to-9.9.9'))
      return { unref: () => {}, args: a } as never
    })
    const r = await applyUpdate(owner, run as never)
    expect(r).toMatchObject({ started: true, version: '9.9.9' })
    expect(copiedFirst).toBe(true)
    const [, , opts] = run.mock.calls[0] as unknown as [string, string[], { detached: boolean; env: Record<string, string> }]
    expect(opts.detached).toBe(true)
    expect(opts.env.INSTALLER).toContain('/v9.9.9/install.sh')
    expect(opts.env.DIR).toBe(install)
  })
  it('does not start a second update while one runs', async () => {
    asInstall(['.local', 'folkbranch'])
    release('v9.9.9')
    await applyUpdate(owner, fakeRun())
    await expect(applyUpdate(owner, fakeRun())).rejects.toMatchObject({ status: 409 })
  })
  it('does not start without a good copy', async () => {
    asInstall(['.local', 'folkbranch'])
    release('v9.9.9')
    // The backups folder cannot be written: a file stands where the folder should be.
    const blocked = path.join(DATA_DIR, 'backups', 'before-update')
    fs.rmSync(blocked, { recursive: true, force: true })
    fs.writeFileSync(blocked, '')
    const run = fakeRun()
    await expect(applyUpdate(owner, run)).rejects.toBeTruthy()
    expect(run).not.toHaveBeenCalled()
    fs.rmSync(blocked)
  })
  it('refuses when there is nothing newer, so it never goes back to an older version', async () => {
    asInstall(['.local', 'folkbranch'])
    release('v1.0.0')
    const run = fakeRun()
    await expect(applyUpdate(owner, run)).rejects.toMatchObject({ status: 409 })
    expect(run).not.toHaveBeenCalled()
  })
  it('refuses where the install is not updated from the app', async () => {
    asInstall(['.local', 'folkbranch', '.server'])
    release('v9.9.9')
    const run = fakeRun()
    await expect(applyUpdate(owner, run)).rejects.toMatchObject({ status: 409 })
    expect(run).not.toHaveBeenCalled()
  })
  it('is for the owner only', async () => {
    asInstall(['.local', 'folkbranch'])
    release('v9.9.9')
    const run = fakeRun()
    await expect(applyUpdate(editor, run)).rejects.toBeTruthy()
    expect(run).not.toHaveBeenCalled()
  })
})
