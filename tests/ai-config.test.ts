// The AI settings file: one place to read and set what the owner chose, with no keys in it.
import { writeKey } from '../lib/ai/keys'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectProvider, disconnectProvider, providerStatus } from '../lib/agent/provider-key'
import { exportAiSettings, importAiSettings } from '../lib/ops/ai-config'
import { getSetting, setSetting } from '../lib/ops/settings'
import { removeTranscription } from '../lib/transcribe/service'
import { removeFaces, saveFaces } from '../lib/faces/service'
import { editor, owner } from './fixture-family'

const KEY = 'sk-or-test-secret-key-1234'
const FILE = { folkbranch: 'ai-settings', version: 1 }
const stub = () => vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ data: {} }), { status: 200 }))
const env = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'AGENT_PROVIDER', 'AGENT_MODEL', 'STT_PROVIDER', 'STT_API_KEY', 'FACE_PROVIDER', 'FACE_API_KEY', 'FACE_API_SECRET']
const keep: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of env) { keep[k] = process.env[k]; delete process.env[k] }
  disconnectProvider(owner)
  removeTranscription(owner)
  removeFaces(owner)
  setSetting('assistantEnabled', '0')
  setSetting('assistantForReaders', '0')
})
afterEach(() => {
  vi.restoreAllMocks()
  for (const k of env) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k] }
})

describe('reading the settings', () => {
  it('says nothing is set on a new archive', () => {
    expect(exportAiSettings(owner)).toEqual({ folkbranch: 'ai-settings', version: 1, assistant: { enabled: false, forReaders: false, provider: null }, speech: null, faces: null })
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
    writeKey('openrouter', null)
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
  it('connects cloud faces only when the key is already on the server, and changes only its limit', async () => {
    stub()
    const refused = await importAiSettings(owner, { ...FILE, faces: { provider: 'facepp', limitRequests: 20 } })
    expect(refused.skipped).toHaveLength(1)
    await saveFaces(owner, { provider: 'facepp', key: 'fp-secret-key-1234', secret: 'fp-secret-5678' })
    const r = await importAiSettings(owner, { ...FILE, faces: { provider: 'facepp', limitRequests: 20 } })
    expect(r.skipped).toEqual([])
    expect(exportAiSettings(owner).faces).toMatchObject({ provider: 'facepp', limitRequests: 20 })
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
  it('refuses anything that is not such a file', async () => {
    for (const bad of [null, 'text', {}, { folkbranch: 'other', version: 1 }, { ...FILE, version: 0 }]) {
      await expect(importAiSettings(owner, bad)).rejects.toMatchObject({ status: 400 })
    }
  })
  it('reads a file of a newer version part by part: applies what it understands, lists the rest with the reason', async () => {
    setSetting('assistantEnabled', '0')
    const r = await importAiSettings(owner, { ...FILE, version: 2, assistant: { enabled: true, newField: 'x' }, speech: { provider: 'a-service-of-the-future' }, faces: { provider: 'rekognition', limitRequests: 'many' }, extra: { anything: 1 } })
    expect(getSetting('assistantEnabled')).toBe('1')
    expect(r.skipped.map((s) => s.what)).toEqual(expect.arrayContaining([expect.stringMatching(/newer|новой/i), expect.stringMatching(/transcription|Расшифровка/i), expect.stringMatching(/faces|лиц/i)]))
    expect(r.skipped.find((s) => /transcription|Расшифровка/i.test(s.what))?.why).toMatch(/service|сервиса/i)
  })
  it('is for the owner only', async () => {
    await expect(importAiSettings(editor, { ...FILE, assistant: { enabled: true } })).rejects.toBeTruthy()
    expect(getSetting('assistantEnabled')).toBe('0')
  })
})

describe('a file naming another service', () => {
  it('switches the assistant to it when its key is already on the list', async () => {
    stub()
    writeKey('deepseek', { key: 'sk-deepseek-listed-1234' })
    const r = await importAiSettings(owner, { ...FILE, assistant: { provider: 'deepseek', model: 'auto' } })
    expect(r.skipped).toEqual([])
    expect(providerStatus(owner)).toMatchObject({ provider: 'deepseek', connected: true })
    writeKey('deepseek', null)
  })
})
