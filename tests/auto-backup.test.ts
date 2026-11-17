// The server's own daily copy: one a day, a few kept, the owner's to see and to ask for.
import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../lib/ops/core'

const owner: Actor = { userId: 'o', name: 'Owner', role: 'owner', personId: null }
const editor: Actor = { userId: 'e', name: 'Editor', role: 'editor', personId: null }
let backup: typeof import('../lib/ops/auto-backup')
let dir = ''

beforeAll(async () => {
  backup = await import('../lib/ops/auto-backup')
  const { DATA_DIR } = await import('../lib/db')
  dir = path.join(DATA_DIR, 'backups', 'daily')
  ;(await import('../lib/ops/people')).createPerson(owner, { givenName: 'Копия', surname: 'Проверочная' })
})

describe('daily copies', () => {
  it('makes one, and not another the same day', async () => {
    const t0 = Date.UTC(2026, 0, 1, 3)
    expect(await backup.runAutoBackup({ now: t0 })).toBeTruthy()
    expect(await backup.runAutoBackup({ now: t0 + 3600_000 })).toBeNull()
    const [name] = fs.readdirSync(dir)
    expect(fs.statSync(path.join(dir, name, 'family.db')).size).toBeGreaterThan(0)
  })

  it('keeps only the newest few', async () => {
    const days = Array.from({ length: backup.KEEP + 3 }, (_, d) => Date.UTC(2026, 1, 1 + d, 3))
    for (const now of days) await backup.runAutoBackup({ force: true, now })
    const nameOf = (t: number) => new Date(t).toISOString().slice(0, 16).replace(':', '-')
    // The folder names come from the same timestamps, so a change to KEEP cannot leave a stale literal.
    expect(fs.readdirSync(dir).sort()).toEqual(days.slice(-backup.KEEP).map(nameOf))
  })

  it('tells the owner, and nobody else', async () => {
    expect(await backup.backupStatus(owner)).toMatchObject({ count: backup.KEEP, keep: backup.KEEP, problem: null })
    await expect(backup.backupStatus(editor)).rejects.toThrow()
    await expect(backup.backupNow(editor)).rejects.toThrow()
  })
})
