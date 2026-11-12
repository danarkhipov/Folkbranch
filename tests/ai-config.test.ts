// The AI settings file: one place to read and set what the owner chose, with no keys in it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectProvider, disconnectProvider, providerStatus } from '../lib/agent/provider-key'
import { exportAiSettings, importAiSettings } from '../lib/ops/ai-config'
import { getSetting, setSetting } from '../lib/ops/settings'
import { removeTranscription } from '../lib/transcribe/service'
import { editor, owner } from './fixture-family'

const KEY = 'sk-or-test-secret-key-1234'
const FILE = { folkbranch: 'ai-settings', version: 1 }
const stub = () => vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ data: {} }), { status: 200 }))
const env = ['OPENROUTER_API_KEY', 'AGENT_PROVIDER', 'AGENT_MODEL', 'STT_PROVIDER', 'STT_API_KEY']
const keep: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of env) { keep[k] = process.env[k]; delete process.env[k] }
  disconnectProvider(owner)
  removeTranscription(owner)
  setSetting('assistantEnabled', '0')
  setSetting('assistantForReaders', '0')
})
afterEach(() => {
  vi.restoreAllMocks()
  for (const k of env) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k] }
})

describe('reading the settings', () => {
  it('says nothing is set on a new archive', () => {
    expect(exportAiSettings(owner)).toEqual({ folkbranch: 'ai-settings', version: 1, assistant: { enabled: false, forReaders: false, provider: null }, speech: null })
  })
  it('is for the owner only', () => expect(() => exportAiSettings(editor)).toThrow())
  it('holds what was chosen and never a key', async () => {
    stub()
    await connectProvider(owner, { provider: 'openrouter', key: KEY })
    const out = exportAiSettings(owner)
    expect(out.assistant).toMatchObject({ enabled: true, provider: 'openrouter', model: 'auto' })
    expect(JSON.stringify(out)).not.toContain(KEY)
  })
})

describe('applying a file', () => {
  it('switches the assistant on and off, and lets readers in', async () => {
    const r = await importAiSettings(owner, { ...FILE, assistant: { enabled: true, forReaders: true } })
    expect(r.skipped).toEqual([])
    expect(getSetting('assistantEnabled')).toBe('1')
    expect(getSetting('assistantForReaders')).toBe('1')
  })
  it('names what it could not apply: a provider the server has no key for', async () => {
    const r = await importAiSettings(owner, { ...FILE, assistant: { provider: 'openrouter', model: 'z-ai/glm-5.3-flash' } })
    expect(r.applied).toEqual([])
    expect(r.skipped).toHaveLength(1)
    expect(r.skipped[0].why).toMatch(/подключите/i)
  })
  it('sets the model of the connected provider, and "auto" returns to the tested line', async () => {
    stub()
    await connectProvider(owner, { provider: 'openrouter', key: KEY, model: 'z-ai/glm-5.3-flash' })
    expect(providerStatus(owner).auto).toBe(false)
    const r = await importAiSettings(owner, { ...FILE, assistant: { provider: 'openrouter', model: 'auto' } })
    expect(r.skipped).toEqual([])
    expect(providerStatus(owner).auto).toBe(true)
  })
  it('connects cloud speech with the assistant\'s key, and a second file changes only what it names', async () => {
    stub()
    await connectProvider(owner, { provider: 'openrouter', key: KEY })
    const r = await importAiSettings(owner, { ...FILE, speech: { provider: 'openrouter', sameKey: true, limitMinutes: 30 } })
    expect(r.skipped).toEqual([])
    expect(exportAiSettings(owner).speech).toMatchObject({ provider: 'openrouter', sameKey: true, limitMinutes: 30 })
    await importAiSettings(owner, { ...FILE, assistant: { enabled: false } })
    expect(exportAiSettings(owner).speech).toMatchObject({ provider: 'openrouter', limitMinutes: 30 })
  })
  it('does not change what the server\'s own settings decide, and says so', async () => {
    process.env.OPENROUTER_API_KEY = KEY
    const r = await importAiSettings(owner, { ...FILE, assistant: { model: 'z-ai/glm-5.3-flash' } })
    expect(r.applied).toEqual([])
    expect(r.skipped[0].why).toMatch(/сервер/i)
  })
  it('hands the per-device part back for the browser to apply', async () => {
    const r = await importAiSettings(owner, { ...FILE, onDevice: { faces: 'yunet', speech: 'gigaam' } })
    expect(r.onDevice).toEqual({ faces: 'yunet', speech: 'gigaam' })
  })
  it('refuses anything that is not such a file, or one from another version', async () => {
    for (const bad of [null, 'text', {}, { ...FILE, version: 2 }, { folkbranch: 'other', version: 1 }, { ...FILE, speech: { provider: 'nope' } }]) {
      await expect(importAiSettings(owner, bad)).rejects.toMatchObject({ status: 400 })
    }
  })
  it('is for the owner only', async () => {
    await expect(importAiSettings(editor, { ...FILE, assistant: { enabled: true } })).rejects.toBeTruthy()
    expect(getSetting('assistantEnabled')).toBe('0')
  })
})
