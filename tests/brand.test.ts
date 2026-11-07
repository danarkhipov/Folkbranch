// The icons every platform asks for, and the words that describe the app to it.
import { existsSync, readFileSync } from 'node:fs'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import manifest from '../app/manifest'

describe('the brand', () => {
  it('has the icons browsers and phones look for', async () => {
    for (const file of ['app/favicon.ico', 'app/icon.svg', 'docs/brand/logo.svg', 'docs/brand/logo-dark.svg']) expect(existsSync(file), file).toBe(true)
    expect((await sharp('app/apple-icon.png').metadata()).width).toBe(180)
  })

  it('names itself and lists icons that exist at their stated size', async () => {
    const m = manifest()
    expect(m.name).toBe('Folkbranch')
    expect(m.icons?.some((i) => i.purpose === 'maskable')).toBe(true)
    for (const icon of m.icons ?? []) {
      const { width, height } = await sharp(`public${icon.src}`).metadata()
      expect(`${width}x${height}`).toBe(icon.sizes)
    }
  })

  it('tells people to run the command the installer actually puts there', () => {
    const texts = ['README.md', 'README.ru.md', '.env.example', 'skills/folkbranch/SKILL.md', 'docs/SELF_HOSTING.md', 'docs/AGENTS.md', 'components/settings/setup-guide.tsx']
    expect(existsSync('folkbranch')).toBe(true)
    for (const file of texts) expect(readFileSync(file, 'utf8'), file).not.toMatch(/\.\/family\b/)
  })

  it('keeps the installer working through curl | sh, where the script is on stdin', () => {
    const execs = readFileSync('install.sh', 'utf8').split('\n').filter((l) => l.includes('compose exec'))
    expect(execs.length).toBeGreaterThan(0)
    for (const line of execs) expect(line).toContain('</dev/null')
    const local = readFileSync('install.sh', 'utf8').split('\n').filter((l) => /\.\/folkbranch (start|stop|doctor)|runtime\/node -v/.test(l) && !l.startsWith('echo'))
    expect(local.length).toBeGreaterThan(0)
    for (const line of local) expect(line).toContain('</dev/null')
  })

  it('brings a Node the app accepts, and builds an archive for every platform the installer asks for', () => {
    const pinned = Number(readFileSync('install.sh', 'utf8').match(/^NODE_VERSION=(\d+)\./m)?.[1])
    expect(pinned).toBeGreaterThanOrEqual(Number(JSON.parse(readFileSync('package.json', 'utf8')).engines.node.replace('>=', '')))
    const release = readFileSync('.github/workflows/release.yml', 'utf8')
    for (const runner of ['macos-latest', 'macos-15-intel', 'ubuntu-latest', 'ubuntu-24.04-arm']) expect(release).toContain(runner)
  })

  it('keeps the two kinds of install apart, so an update never leaves the data behind', () => {
    const script = readFileSync('install.sh', 'utf8')
    expect(script).toContain('MODE=${WANT:-${HAVE:-local}}')
    expect(script).toContain('elif [ -f "$DIR/docker-compose.yml" ]; then HAVE=docker')
  })

  it('never packs a family\'s files into the public archive', () => {
    expect(readFileSync('scripts/make-bundle.mjs', 'utf8')).toContain('Refusing to pack')
    for (const file of ['.gitignore', '.dockerignore']) expect(readFileSync(file, 'utf8')).toMatch(/^dist/m)
  })
})
