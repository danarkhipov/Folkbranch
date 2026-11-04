import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { getDb } from '../lib/db'
import { actorFromToken } from '../lib/ops/tokens'

getDb()
const family = (...args: string[]) => execFileSync(process.execPath, ['scripts/family.mjs', ...args], { encoding: 'utf8', env: { ...process.env, BETTER_AUTH_URL: 'https://family.test' } })

describe('server commands', () => {
  it('make a token the app accepts, and cut it off', () => {
    const made = JSON.parse(family('token', 'create', '--name', 'cli-bot', '--role', 'editor', '--days', '7', '--json'))
    expect(made.url).toBe('https://family.test/api/mcp')
    expect(actorFromToken(made.token)).toMatchObject({ role: 'editor' })
    const id = family('token', 'list').split('\n').find((l) => l.includes('cli-bot'))!.split(' ')[0]
    family('token', 'revoke', id)
    expect(actorFromToken(made.token)).toBeNull()
  })

  it('print a ready command for Claude Code', () => {
    expect(family('token', 'create', '--name', 'reader-bot')).toContain('claude mcp add --transport http family https://family.test/api/mcp')
  })

  it('report the archive', () => {
    expect(family('doctor')).toContain('People:')
  })
})
