// Daniel is the only author: no commit may name an AI assistant, and the check that says so must catch it.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const script = path.resolve(__dirname, '../scripts/authorship.sh')
let repo = ''
const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const check = (...a: string[]) => spawnSync('sh', [script, ...a], { cwd: repo, encoding: 'utf8' })
const commit = (message: string, author = 'Daniel Arkhipov <daniel@example.org>') => {
  fs.writeFileSync(path.join(repo, 'f.txt'), `${Math.random()}`)
  git('add', 'f.txt')
  git('-c', 'user.name=Daniel Arkhipov', '-c', 'user.email=daniel@example.org', 'commit', '-q', '--author', author, '-m', message)
}

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'authorship-'))
  git('init', '-q', '-b', 'main')
  commit('chore: the first commit')
})

describe('a commit message', () => {
  const msg = (text: string) => { const f = path.join(repo, 'MSG'); fs.writeFileSync(f, text); return check('message', f) }
  it('with a Claude co-author is refused', () => expect(msg('fix: x\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n').status).toBe(1))
  it('with a "generated with" line is refused', () => expect(msg('fix: x\n\n🤖 Generated with [Claude Code](https://claude.ai/code)\n').status).toBe(1))
  it('that only talks about Claude, as a feature of the app, is fine', () => expect(msg('feat: a Claude Code plugin, and the claude-haiku model\n').status).toBe(0))
  it('from Daniel alone is fine', () => expect(msg('fix: the chart\n\nCo-authored-by: Anna Petrova <anna@example.org>\n').status).toBe(0))
})

describe('the commits of a range', () => {
  it('are clean when Daniel wrote them', () => expect(check('range', 'HEAD').status).toBe(0))
  it('are refused when one has a Claude co-author', () => {
    commit('fix: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>')
    const r = check('range', 'HEAD')
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('fix: x')
  })
  it('are refused when Claude is the author', () => {
    git('reset', '-q', '--hard', 'HEAD~1')
    commit('fix: y', 'Claude <noreply@anthropic.com>')
    expect(check('range', 'HEAD').status).toBe(1)
  })
})
