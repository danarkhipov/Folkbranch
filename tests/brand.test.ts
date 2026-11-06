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
})
