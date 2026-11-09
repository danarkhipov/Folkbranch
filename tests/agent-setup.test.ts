// Connecting a provider from the app. The provider's answers are stubbed: nothing leaves this machine.
import { MockLanguageModelV4 } from 'ai/test'
import { APICallError } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assistantRefusal, assistantState } from '../lib/agent/agent'
import { PRESETS } from '../lib/agent/presets'
import { chooseModel, connectProvider, currentProvider, disconnectProvider, providerFailure, providerStatus } from '../lib/agent/provider-key'
import { assistantResponse } from '../lib/agent/respond'
import { getDb, schema } from '../lib/db'
import { getSetting, setSetting } from '../lib/ops/settings'
import { editor, owner, reader } from './fixture-family'

const KEY = 'sk-test-secret-key-1234'
const answer = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status })
const stub = (res: () => Response) => vi.spyOn(globalThis, 'fetch').mockImplementation(async () => res())
const sent = () => vi.mocked(fetch).mock.calls[0] as [string, { headers: Record<string, string> }]
const keep: Record<string, string | undefined> = {}
const ENV = ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'AGENT_PROVIDER', 'AGENT_MODEL']

beforeEach(() => {
  for (const k of ENV) { keep[k] = process.env[k]; delete process.env[k] }
  disconnectProvider(owner)
  setSetting('assistantEnabled', '0')
})
afterEach(() => {
  vi.restoreAllMocks()
  for (const k of ENV) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k] }
})

describe('what a person is told', () => {
  it('the owner without a key is asked for one; others are told who can', () => {
    expect(assistantState(owner)).toEqual({ ready: false, reason: 'no-key', canFix: true })
    expect(assistantState(editor)).toEqual({ ready: false, reason: 'no-key', canFix: false })
  })
  it('with a key but turned off, the owner can turn it on', async () => {
    stub(() => answer(200, { data: {} }))
    await connectProvider(owner, { provider: 'openrouter', key: KEY })
    setSetting('assistantEnabled', '0')
    expect(assistantState(owner)).toEqual({ ready: false, reason: 'off', canFix: true })
    expect(assistantState(editor)).toEqual({ ready: false, reason: 'off', canFix: false })
  })
  it('a reader not yet allowed is told so, and an allowed one can use it', async () => {
    stub(() => answer(200, { data: {} }))
    await connectProvider(owner, { provider: 'openrouter', key: KEY })
    setSetting('assistantForReaders', '0')
    expect(assistantState(reader)).toEqual({ ready: false, reason: 'readers', canFix: false })
    setSetting('assistantForReaders', '1')
    expect(assistantState(reader)).toEqual({ ready: true })
    expect(assistantState(owner)).toEqual({ ready: true })
  })
})

describe('connecting', () => {
  it('a good key is stored encrypted, turns the assistant on, and is used', async () => {
    stub(() => answer(200, { data: {} }))
    const status = await connectProvider(owner, { provider: 'openrouter', key: `  ${KEY}\n` })
    expect(status).toEqual({ connected: true, autoPossible: true, auto: true, provider: 'openrouter', label: 'OpenRouter', model: 'openai/gpt-6-luna', source: 'app', keyEnding: '1234' })
    expect(JSON.stringify(getDb().select().from(schema.settings).all())).not.toContain(KEY)
    expect(getSetting('assistantEnabled')).toBe('1')
    expect(currentProvider()).toMatchObject({ id: 'openrouter', key: KEY })
    expect(assistantRefusal(owner)).toBeNull()
  })
  it('moves to the newest model of the tested line by itself, never to an older one, and leaves a hand-picked model alone', async () => {
    const list = (ids: string[]) => answer(200, { data: ids.map((id) => ({ id, name: id, created: 1, supported_parameters: ['tools'], architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0' } })) })
    stub(() => list(['openai/gpt-6-luna', 'openai/gpt-5-luna', 'openai/gpt-6.5-luna', 'openai/gpt-6.5-luna-pro']))
    const status = await connectProvider(owner, { provider: 'openrouter', key: KEY })
    expect(status.model).toBe('openai/gpt-6.5-luna')
    // Next year: the service lists a newer one, and the app moves to it when it next looks.
    stub(() => list(['openai/gpt-6.5-luna', 'openai/gpt-7-luna']))
    const { refreshAutoModel } = await import('../lib/agent/provider-key')
    await refreshAutoModel(true)
    expect(providerStatus(owner).model).toBe('openai/gpt-7-luna')
    // A model chosen by hand stays, whatever comes out.
    await chooseModel(owner, { model: 'openai/gpt-6.5-luna' })
    stub(() => list(['openai/gpt-9-luna']))
    await refreshAutoModel(true)
    expect(providerStatus(owner)).toMatchObject({ model: 'openai/gpt-6.5-luna', auto: false })
    // And back to automatic on request.
    stub(() => list(['openai/gpt-9-luna']))
    expect((await chooseModel(owner, { auto: true })).model).toBe('openai/gpt-9-luna')
  })
  it('the key is never given back', async () => {
    stub(() => answer(200, { data: {} }))
    await connectProvider(owner, { provider: 'openrouter', key: KEY })
    expect(JSON.stringify(providerStatus(owner))).not.toContain(KEY)
  })
  it('a refused key is not stored, and the person is told in words', async () => {
    stub(() => answer(401))
    await expect(connectProvider(owner, { provider: 'openrouter', key: KEY })).rejects.toThrow(/не принял этот ключ/)
    expect(getSetting('agentKey')).toBeNull()
    expect(currentProvider()).toBeNull()
  })
  it('no connection, too many requests and a provider failure each say what happened', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(answer(429)).mockResolvedValueOnce(answer(503))
    await expect(connectProvider(owner, { provider: 'openrouter', key: KEY })).rejects.toThrow(/связаться/)
    await expect(connectProvider(owner, { provider: 'openrouter', key: KEY })).rejects.toThrow(/подождать/)
    await expect(connectProvider(owner, { provider: 'openrouter', key: KEY })).rejects.toThrow(/503/)
    expect(getSetting('agentKey')).toBeNull()
  })
  it('a model this key cannot use is refused', async () => {
    stub(() => answer(200, { data: [{ id: 'other' }] }))
    await expect(connectProvider(owner, { provider: 'openai', key: KEY })).rejects.toThrow(/gpt-6-luna/)
    expect(getSetting('agentKey')).toBeNull()
  })
  it('each provider is asked only for what costs nothing, with the key where it belongs', async () => {
    const cases = [
      ['openrouter', 'openrouter.ai/api/v1/key', 'authorization', { data: {} }],
      ['anthropic', 'api.anthropic.com/v1/models', 'x-api-key', { data: [{ id: 'claude-haiku-5-5' }] }],
      ['openai', 'api.openai.com/v1/models', 'authorization', { data: [{ id: 'gpt-6-luna' }] }],
      ['google', 'generativelanguage.googleapis.com/v1beta/models', 'x-goog-api-key', { models: [{ name: 'models/gemini-3.5-flash-lite' }] }],
    ] as const
    for (const [provider, url, header, body] of cases) {
      vi.restoreAllMocks()
      stub(() => answer(200, body))
      await connectProvider(owner, { provider, key: KEY })
      const [address, init] = sent()
      expect(address).toContain(url)
      expect(address).not.toContain(KEY)
      expect((init as any).method ?? 'GET').toBe('GET')
      expect(init.headers[header]).toContain(KEY)
      expect(currentProvider()?.id).toBe(provider)
    }
  })
  it('services in Russia and China are asked the same way, and Yandex also names its folder', async () => {
    const FOLDER = 'b1gabcdefghij12345'
    const cases = [
      ['cloudru', 'foundation-models.api.cloud.ru/v1/models', { data: [{ id: 'Qwen/Qwen3.6-35B-A3B' }] }],
      ['deepseek', 'api.deepseek.com/models', { data: [{ id: 'deepseek-flash' }] }],
      ['moonshot', 'api.moonshot.ai/v1/models', { data: [{ id: 'kimi-k3.1-pro' }] }],
      ['yandex', 'ai.api.cloud.yandex.net/v1/models', { data: [{ id: `gpt://${FOLDER}/yandexgpt/latest` }] }],
    ] as const
    for (const [provider, url, body] of cases) {
      vi.restoreAllMocks()
      stub(() => answer(200, body))
      await connectProvider(owner, { provider, key: KEY, folder: FOLDER })
      expect(sent()[0]).toContain(url)
      expect(currentProvider()).toMatchObject({ id: provider, key: KEY })
      expect(getSetting('agentFolder')).toBe(provider === 'yandex' ? FOLDER : null)
    }
    expect(currentProvider()!.folder).toBe(FOLDER)
    await expect(connectProvider(owner, { provider: 'yandex', key: KEY })).rejects.toThrow(/каталога/)
  })
  it('a chosen model is kept', async () => {
    stub(() => answer(200, { data: {} }))
    await connectProvider(owner, { provider: 'openrouter', key: KEY, model: 'qwen/qwen3.7-flash' })
    expect(currentProvider()?.model).toBe('qwen/qwen3.7-flash')
  })
  it('another model can be chosen with the saved key, and a wrong one changes nothing', async () => {
    stub(() => answer(200, { data: {} }))
    await connectProvider(owner, { provider: 'openrouter', key: KEY })
    vi.restoreAllMocks()
    stub(() => answer(200, { data: [{ id: 'qwen/qwen3.7-flash', supported_parameters: ['tools'] }, { id: 'no/tools', supported_parameters: [] }] }))
    expect((await chooseModel(owner, { model: 'qwen/qwen3.7-flash' })).model).toBe('qwen/qwen3.7-flash')
    await expect(chooseModel(owner, { model: 'no/such' })).rejects.toThrow(/no\/such/)
    await expect(chooseModel(owner, { model: 'no/tools' })).rejects.toThrow(/инструменты/)
    expect(currentProvider()?.model).toBe('qwen/qwen3.7-flash')
    await expect(chooseModel(editor, { model: 'x/y' })).rejects.toThrow('forbidden')
  })
  it('a model set on the server cannot be changed from the app', async () => {
    process.env.ANTHROPIC_API_KEY = 'server-key-value'
    await expect(chooseModel(owner, { model: 'x/y' })).rejects.toThrow(/сервера/)
  })
  it('only the owner can connect, read or remove it', async () => {
    const f = stub(() => answer(200, { data: {} }))
    await expect(connectProvider(editor, { provider: 'openrouter', key: KEY })).rejects.toThrow('forbidden')
    expect(() => providerStatus(editor)).toThrow('forbidden')
    expect(() => disconnectProvider(reader)).toThrow('forbidden')
    expect(f).not.toHaveBeenCalled()
  })
  it('bad input is refused before anything is sent', async () => {
    const f = stub(() => answer(200, { data: {} }))
    await expect(connectProvider(owner, { provider: 'openrouter', key: 'short' })).rejects.toThrow()
    await expect(connectProvider(owner, { provider: 'evil', key: KEY })).rejects.toThrow()
    expect(f).not.toHaveBeenCalled()
  })
  it('a key on the server wins, and is shown as such', async () => {
    stub(() => answer(200, { data: {} }))
    await connectProvider(owner, { provider: 'openrouter', key: KEY })
    process.env.ANTHROPIC_API_KEY = 'server-key-value'
    expect(currentProvider()).toMatchObject({ id: 'anthropic', key: 'server-key-value' })
    expect(providerStatus(owner)).toMatchObject({ source: 'server', keyEnding: null })
  })
  it('removing it stops the assistant and asks for a key again', async () => {
    stub(() => answer(200, { data: {} }))
    await connectProvider(owner, { provider: 'openrouter', key: KEY })
    disconnectProvider(owner)
    expect(currentProvider()).toBeNull()
    expect(assistantState(owner)).toEqual({ ready: false, reason: 'no-key', canFix: true })
  })
  it('a key that can no longer be read counts as no key', async () => {
    stub(() => answer(200, { data: {} }))
    await connectProvider(owner, { provider: 'openrouter', key: KEY })
    setSetting('agentKey', 'not.a.real-key')
    expect(currentProvider()).toBeNull()
    expect(assistantState(owner)).toMatchObject({ reason: 'no-key' })
  })
  it('every preset says where to go and has a cheap model', () => {
    expect(PRESETS.map((p) => p.id).sort()).toEqual(['anthropic', 'cloudru', 'deepseek', 'google', 'moonshot', 'openai', 'openrouter', 'yandex'])
    for (const p of PRESETS) {
      expect(p.keysUrl).toMatch(/^https:\/\//)
      expect(p.howTo.length).toBeGreaterThan(5)
      expect(p.models[0].id).not.toMatch(/opus|sonnet|fable/)
      expect(p.models.every((m) => m.id && m.label && m.price)).toBe(true)
    }
  })
})

describe('when the provider fails during a conversation', () => {
  const failing = (status: number) => new APICallError({ message: 'secret detail sk-abc', url: 'https://x', requestBodyValues: {}, statusCode: status, responseBody: 'sk-abc', isRetryable: false })
  it.each([[401, /не принял ключ/], [403, /не принял ключ/], [402, /закончились деньги/], [404, /модель/], [429, /подождать/], [500, /сбой/]])('%i says what to do', (status, words) => {
    expect(providerFailure(failing(status))).toMatch(words)
    expect(providerFailure({ lastError: failing(status) })).toMatch(words)
  })
  it('the person gets those words, and never the details', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const m = new MockLanguageModelV4({ doStream: async () => { throw failing(402) } })
    const text = await (await assistantResponse(owner, { messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'Привет' }] }] }, { model: m })).text()
    expect(text).toContain('закончились деньги')
    expect(text).not.toContain('sk-abc')
    spy.mockRestore()
  })
  it('something unknown stays a plain sentence', async () => {
    expect(providerFailure(new Error('boom'))).toBeNull()
  })
})
