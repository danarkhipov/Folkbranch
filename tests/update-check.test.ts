// Is a newer release out? GitHub's answers are stubbed: nothing leaves this machine.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import pkg from '../package.json'
import { forgetUpdateCache, updateStatus } from '../lib/update-check'
import { editor, owner, reader } from './fixture-family'

const release = (tag: string) => new Response(JSON.stringify({ tag_name: tag, html_url: `https://github.com/danarkhipov/folkbranch/releases/tag/${tag}` }))
const stub = (res: () => Response | Promise<Response>) => vi.spyOn(globalThis, 'fetch').mockImplementation(async () => res())
const bump = (part: 0 | 1 | 2) => { const v = pkg.version.split('.').map(Number); v[part]++; return `v${v.join('.')}` }
let keep: string | undefined

beforeEach(() => { keep = process.env.FOLKBRANCH_UPDATE_CHECK; delete process.env.FOLKBRANCH_UPDATE_CHECK; forgetUpdateCache() })
afterEach(() => {
  vi.restoreAllMocks()
  if (keep === undefined) delete process.env.FOLKBRANCH_UPDATE_CHECK; else process.env.FOLKBRANCH_UPDATE_CHECK = keep
})

describe('update check', () => {
  it('a newer release is reported with its link', async () => {
    stub(() => release(bump(1)))
    expect(await updateStatus(owner)).toEqual({ current: pkg.version, latest: bump(1).slice(1), url: expect.stringContaining('/releases/'), newer: true })
  })
  it('the same version and an older one are not news', async () => {
    stub(() => release(`v${pkg.version}`))
    expect((await updateStatus(owner)).newer).toBe(false)
    forgetUpdateCache()
    stub(() => release('v0.0.1'))
    expect((await updateStatus(owner)).newer).toBe(false)
  })
  it('versions compare as numbers, not as text', async () => {
    // 1.10.0 is newer than 1.9.0, though as text "1.10.0" sorts before "1.9.0". The running version
    // is set explicitly so the case stays valid whatever package.json says.
    const had = pkg.version
    ;(pkg as { version: string }).version = '1.9.0'
    try {
      stub(() => release('v1.10.0'))
      expect((await updateStatus(owner)).newer).toBe(true)
    } finally { (pkg as { version: string }).version = had }
  })
  it('a pre-release suffix is ignored', async () => {
    stub(() => release(`${bump(2)}-rc.1`))
    expect((await updateStatus(owner)).newer).toBe(true)
  })
  it('GitHub failing or timing out gives no answer and no throw', async () => {
    stub(() => new Response('', { status: 500 }))
    expect(await updateStatus(owner)).toEqual({ current: pkg.version, latest: null, newer: false })
    forgetUpdateCache()
    stub(() => { throw new DOMException('timeout', 'TimeoutError') })
    expect(await updateStatus(owner)).toEqual({ current: pkg.version, latest: null, newer: false })
  })
  it('a reply without a tag is no answer', async () => {
    stub(() => new Response('{}'))
    expect((await updateStatus(owner)).latest).toBeNull()
  })
  it('switched off, GitHub is not asked', async () => {
    process.env.FOLKBRANCH_UPDATE_CHECK = 'off'
    const f = stub(() => release(bump(0)))
    expect((await updateStatus(owner)).latest).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
  it('the answer is kept', async () => {
    const f = stub(() => release(bump(1)))
    await updateStatus(owner); await updateStatus(owner)
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('a failure is kept too, so a dead network is not retried on every open', async () => {
    const f = stub(() => new Response('', { status: 503 }))
    await updateStatus(owner); await updateStatus(owner)
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('only the owner may ask', async () => {
    const f = stub(() => release(bump(1)))
    await expect(updateStatus(editor)).rejects.toMatchObject({ status: 403 })
    await expect(updateStatus(reader)).rejects.toMatchObject({ status: 403 })
    expect(f).not.toHaveBeenCalled()
  })
})
