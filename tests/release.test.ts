// A release is a version, a changelog section and a tag that agree. This catches the parts that drift.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const version = (path: string) => JSON.parse(readFileSync(path, 'utf8')).version as string
const changelog = readFileSync('CHANGELOG.md', 'utf8')

describe('release bookkeeping', () => {
  it('the app and the install package carry the same version', () => {
    expect(version('npm/package.json')).toBe(version('package.json'))
  })
  it('the changelog has a section, with a date, for the version in package.json', () => {
    const v = version('package.json').replace(/\./g, '\\.')
    expect(changelog).toMatch(new RegExp(`^## ${v} - \\d{4}-\\d{2}-\\d{2}$`, 'm'))
  })
  it('the changelog keeps an Unreleased section on top, newest version first', () => {
    const heads = [...changelog.matchAll(/^## (.+)$/gm)].map((m) => m[1])
    expect(heads[0]).toBe('Unreleased')
    const versions = heads.slice(1).map((h) => h.split(' - ')[0].split('.').map(Number))
    const sorted = [...versions].sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2])
    expect(versions).toEqual(sorted)
  })
})
