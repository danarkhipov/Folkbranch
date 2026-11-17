// One list of keys for the AI functions: added once, checked first, picked by each function, removed with what used it.
// Every test starts from an empty list, so each one can run alone or in any order.
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addKey, listServices, removeKey } from '../lib/ai/services'
import { readKeys } from '../lib/ai/keys'
import { answerChoices, chooseModel, connectProvider, currentProvider, disconnectProvider, providerFor } from '../lib/agent/provider-key'
import { PRESETS } from '../lib/agent/presets'
import { assistantResponse } from '../lib/agent/respond'
import { getDb, schema } from '../lib/db'
import { getSetting, setSetting } from '../lib/ops/settings'
import { seal } from '../lib/sealed'
import { removeTranscription, saveTranscription, transcriptionStatus } from '../lib/transcribe/service'
import { editor, owner } from './fixture-family'

const ok = (body: unknown = { data: [] }) => new Response(JSON.stringify(body), { status: 200 })
const models = (id: string) => ({ data: PRESETS.find((p) => p.id === id)!.models.map((m) => ({ id: m.id, supported_parameters: ['tools'] })) })
const services = () => vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ok(String(url).includes('/models') ? models('openrouter') : { data: {} }))
const KEY = 'sk-or-v1-first-key-7777'
// Every provider key the server could read, so a developer's own shell cannot change what these tests see.
const ENV = ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'YANDEX_API_KEY', 'CLOUDRU_API_KEY', 'DEEPSEEK_API_KEY', 'MOONSHOT_API_KEY', 'AGENT_PROVIDER', 'AGENT_MODEL', 'AGENT_FOLDER', 'AGENT_BASE_URL', 'STT_PROVIDER', 'STT_API_KEY']
const keep: Record<string, string | undefined> = {}
const clear = (key: string) => getDb().delete(schema.settings).where(eq(schema.settings.key, key)).run()
beforeEach(() => {
  for (const k of ENV) { keep[k] = process.env[k]; delete process.env[k] }
  for (const k of ['agentProvider', 'agentKey', 'agentModel', 'agentFolder', 'agentAuto', 'sttConfig']) clear(k)
  setSetting('aiKeys', seal('{}', 'ai-keys'))
})
afterEach(() => { vi.restoreAllMocks(); for (const k of ENV) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k] } })

describe('the list of AI keys', () => {
  it('keeps a key only after the service accepted it, encrypted, and shows only its end', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 401 }))
    await expect(addKey(owner, { service: 'groq', key: 'gsk_wrong_key_123' })).rejects.toMatchObject({ status: 400 })
    await expect(connectProvider(owner, { provider: 'openrouter', key: 'sk-or-v1-refused-1234' })).rejects.toMatchObject({ status: 400 })
    expect(readKeys()).toEqual({})
    services()
    const list = await addKey(owner, { service: 'openrouter', key: KEY })
    expect(list.keys).toContainEqual(expect.objectContaining({ service: 'openrouter', keyEnding: '7777', can: { assistant: true, speech: true }, usedBy: { assistant: false, speech: false } }))
    expect(JSON.stringify(list)).not.toContain('first-key')
    expect(JSON.stringify(getDb().select().from(schema.settings).all())).not.toContain('first-key')
    await expect(addKey(editor, { service: 'openrouter', key: 'sk-or-v1-x-123456' })).rejects.toMatchObject({ status: 403 })
  })

  it('checks a speech-only service with its own check, and asks Yandex for its folder', async () => {
    services()
    const list = await addKey(owner, { service: 'groq', key: 'gsk_good_key_12345' })
    expect(list.keys).toContainEqual(expect.objectContaining({ service: 'groq', can: { assistant: false, speech: true } }))
    expect(String(vi.mocked(fetch).mock.calls.at(-1)![0])).toBe('https://api.groq.com/openai/v1/models')
    await expect(addKey(owner, { service: 'yandex', key: 'AQVN-yandex-key-1234' })).rejects.toMatchObject({ status: 400 })
  })

  it('lets the assistant and speech pick a service from it without pasting the key again', async () => {
    services()
    await addKey(owner, { service: 'openrouter', key: KEY })
    await chooseModel(owner, { provider: 'openrouter' })
    expect(currentProvider()).toMatchObject({ id: 'openrouter', key: KEY })
    expect(getSetting('assistantEnabled')).toBe('1')
    await saveTranscription(owner, { provider: 'openrouter', sameKey: true })
    expect(transcriptionStatus(owner).current).toMatchObject({ provider: 'openrouter', keyEnding: '7777' })
    expect(listServices(owner).keys.find((k) => k.service === 'openrouter')?.usedBy).toEqual({ assistant: true, speech: true })
    await expect(chooseModel(owner, { provider: 'anthropic' })).rejects.toMatchObject({ status: 400 })
  })

  it('a different key typed for speech stays with speech and never replaces the assistant key', async () => {
    services()
    await addKey(owner, { service: 'openrouter', key: KEY })
    await chooseModel(owner, { provider: 'openrouter' })
    await saveTranscription(owner, { provider: 'openrouter', key: 'sk-or-v1-speech-only-5555' })
    expect(currentProvider()).toMatchObject({ key: KEY })
    expect(transcriptionStatus(owner).current).toMatchObject({ keyEnding: '5555', sameKey: false })
  })

  it('speech borrows an assistant key set on the server, as before the list existed', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-from-server-8888'
    process.env.AGENT_PROVIDER = 'openrouter'
    services()
    await saveTranscription(owner, { provider: 'openrouter', sameKey: true })
    expect(transcriptionStatus(owner).current).toMatchObject({ provider: 'openrouter', keyEnding: '8888' })
  })

  it('offers each answer only the services and models on the list', async () => {
    services()
    await addKey(owner, { service: 'openrouter', key: KEY })
    await chooseModel(owner, { provider: 'openrouter' })
    const choices = answerChoices()
    expect(new Set(choices.map((c) => c.provider))).toEqual(new Set(['openrouter']))
    const other = PRESETS.find((p) => p.id === 'openrouter')!.models[1].id
    expect(providerFor('openrouter', other)).toMatchObject({ id: 'openrouter', model: other, key: KEY })
    expect(providerFor('openrouter', 'some/model-not-offered')).toBeNull()
    expect(providerFor('anthropic', PRESETS.find((p) => p.id === 'anthropic')!.models[0].id)).toBeNull()
  })

  it('carries over keys saved before the list existed, once', () => {
    clear('aiKeys')
    setSetting('agentProvider', 'yandex')
    setSetting('agentKey', seal('AQVN-old-yandex-key-4242', 'provider-key'))
    setSetting('agentFolder', 'b1gabcdefghij12345')
    setSetting('agentModel', PRESETS.find((p) => p.id === 'yandex')!.models[0].id)
    setSetting('sttConfig', seal(JSON.stringify({ provider: 'groq', model: 'auto', key: 'gsk_old_speech_key_31', limitMinutes: 60 }), 'stt-key'))
    expect(currentProvider()).toMatchObject({ id: 'yandex', key: 'AQVN-old-yandex-key-4242', folder: 'b1gabcdefghij12345' })
    expect(listServices(owner).keys.map((k) => k.service).sort()).toEqual(['groq', 'yandex'])
    // The previous version's copy stays, so going back after an update still answers, until the key is removed.
    expect(getSetting('agentKey')).not.toBe('')
    removeKey(owner, 'yandex')
    expect(getSetting('agentKey') || null).toBeNull()
    // The list was read once: a removed key does not come back.
    expect(listServices(owner).keys.map((k) => k.service)).toEqual(['groq'])
  })

  it('only the owner sends an answer to another service, and services no longer offered are not on the add list', async () => {
    services()
    await addKey(owner, { service: 'openrouter', key: KEY })
    await chooseModel(owner, { provider: 'openrouter' })
    const other = PRESETS.find((p) => p.id === 'openrouter')!.models[1].id
    const body = { messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'hi' }] }], choice: { provider: 'openrouter', model: other } }
    await expect(assistantResponse(editor, body)).rejects.toMatchObject({ status: 403 })
    const offered = listServices(owner).available.map((a) => a.service)
    expect(offered).not.toContain('google')
    expect(offered).not.toContain('moonshot')
  })

  it('removing a key switches off what used it, and only that', async () => {
    services()
    await addKey(owner, { service: 'openrouter', key: KEY })
    await addKey(owner, { service: 'groq', key: 'gsk_good_key_12345' })
    await chooseModel(owner, { provider: 'openrouter' })
    await saveTranscription(owner, { provider: 'groq', sameKey: true })
    removeKey(owner, 'groq')
    expect(transcriptionStatus(owner).current).toBeNull()
    expect(currentProvider()).toMatchObject({ id: 'openrouter' })
    removeKey(owner, 'openrouter')
    expect(currentProvider()).toBeNull()
    expect(getSetting('assistantEnabled')).toBe('0')
    disconnectProvider(owner)
    removeTranscription(owner)
  })
})
