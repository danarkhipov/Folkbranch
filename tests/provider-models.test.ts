// The models a provider lists today, what they can do, and what the assistant does when its model cannot see.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { newestFirst, PARSERS } from '../lib/agent/models'
import { connectProvider, disconnectProvider, modelChoices, modelSees, providerFailure, replaceMissingModel } from '../lib/agent/provider-key'
import { PRESETS } from '../lib/agent/presets'
import { getSetting, setSetting } from '../lib/ops/settings'
import { owner, reader } from './fixture-family'

const KEY = 'sk-test-secret-key-1234'
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const ENV = ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'AGENT_PROVIDER', 'AGENT_MODEL']
const keep: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV) { keep[k] = process.env[k]; delete process.env[k] }
  disconnectProvider(owner)
})
afterEach(() => {
  vi.restoreAllMocks()
  for (const k of ENV) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k] }
})

describe('each provider\'s own list', () => {
  it('OpenRouter: tools and a text answer make a model usable, a picture input makes it see, the price is per million', () => {
    const list = PARSERS.openrouter({ data: [
      { id: 'a/seer', name: 'Seer', created: 200, pricing: { prompt: '0.0000005', completion: '0.000002' }, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, supported_parameters: ['tools'] },
      { id: 'a/blind', name: 'Blind', created: 100, pricing: { prompt: '0.0000001', completion: '0.0000005' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['tools'] },
      { id: 'a/draws', name: 'Draws', created: 300, architecture: { input_modalities: ['text'], output_modalities: ['image'] }, supported_parameters: ['tools'] },
      { id: 'a/no-tools', name: 'No tools', created: 400, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: [] },
    ] }, '')
    expect(list.filter((m) => m.usable).map((m) => m.id)).toEqual(['a/seer', 'a/blind'])
    expect(list[0]).toMatchObject({ vision: true, price: '$0.5 / $2' })
    expect(list[1]).toMatchObject({ vision: false, price: '$0.1 / $0.5' })
  })
  it('Anthropic and Moonshot say whether a model takes pictures; OpenAI, DeepSeek and Cloud.ru say nothing', () => {
    expect(PARSERS.anthropic({ data: [{ id: 'c-1', display_name: 'C One', created_at: '2026-07-24T00:00:00Z', capabilities: { image_input: { supported: true } } }, { id: 'c-0', capabilities: { image_input: { supported: false } } }] }, '').map((m) => m.vision)).toEqual([true, false])
    expect(PARSERS.moonshot({ data: [{ id: 'k', supports_image_in: true }, { id: 'j', supports_image_in: false }] }, '').map((m) => m.vision)).toEqual([true, false])
    for (const id of ['openai', 'deepseek'] as const) expect(PARSERS[id]({ data: [{ id: 'gpt-6-luna' }] }, '')[0].vision).toBeNull()
  })
  it('Cloud.ru: inputs, tools and roubles come from its list, and speech or models without tools are not offered', () => {
    const list = PARSERS.cloudru({ data: [
      { id: 'Qwen/Q', function_calling: true, metadata: { type: 'llm', name: 'Q', input_modalities: ['text', 'image'], prompt_tokens_cost: 219.6, generated_tokens_cost: 329.4 } },
      { id: 'ai-sage/G', metadata: { type: 'llm', input_modalities: ['text'] } },
      { id: 'openai/whisper', metadata: { type: 'asr' }, function_calling: true },
    ] }, '')
    expect(list.filter((m) => m.usable).map((m) => m.id)).toEqual(['Qwen/Q'])
    expect(list[0]).toMatchObject({ vision: true, price: '220 ₽ / 329 ₽' })
    expect(list[1].vision).toBe(false)
  })
  it('OpenAI and Google keep chats and drop speech, images and embeddings', () => {
    expect(PARSERS.openai({ data: ['gpt-6-luna', 'gpt-6-luna-tts', 'text-embedding-4', 'o5', 'gpt-realtime'].map((id) => ({ id })) }, '').filter((m) => m.usable).map((m) => m.id)).toEqual(['gpt-6-luna', 'o5'])
    expect(PARSERS.google({ models: [{ name: 'models/gemini-4-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-embedding', supportedGenerationMethods: ['embedContent'] }, { name: 'models/imagen-5' }] }, '').filter((m) => m.usable).map((m) => m.id)).toEqual(['gemini-4-flash'])
  })
  it('Yandex ids lose the folder, and newest comes first', () => {
    expect(PARSERS.yandex({ data: [{ id: 'gpt://b1gx/yandexgpt/latest' }, { id: 'emb://b1gx/text-embeddings/latest' }] }, 'b1gx').map((m) => m.id)).toEqual(['yandexgpt/latest'])
    expect(newestFirst([{ id: 'a', created: 1 }, { id: 'b', created: 3 }, { id: 'c', created: 2 }] as never).map((m) => m.id)).toEqual(['b', 'c', 'a'])
  })
  it('every preset has a parser, so a provider cannot be added without one', () => {
    for (const p of PRESETS) expect(typeof PARSERS[p.id]).toBe('function')
  })
})

describe('what the owner sees and what the assistant knows', () => {
  const list = { data: [
    { id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5', created_at: '2026-10-01T00:00:00Z', capabilities: { image_input: { supported: true } } },
    { id: 'old-text-model', display_name: 'Old', created_at: '2025-01-01T00:00:00Z', capabilities: { image_input: { supported: false } } },
  ] }
  it('a connected key lists its models, newest first, and only the owner may ask', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(list))
    await connectProvider(owner, { provider: 'anthropic', key: KEY })
    expect((await modelChoices(owner)).models.map((m) => m.id)).toEqual(['claude-haiku-5-5', 'old-text-model'])
    await expect(modelChoices(reader)).rejects.toThrow('forbidden')
  })
  it('the model in use is known to see, or not, from the provider\'s list', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(list))
    await connectProvider(owner, { provider: 'anthropic', key: KEY })
    expect(await modelSees()).toBe(true)
    setSetting('agentModel', 'old-text-model')
    expect(await modelSees()).toBe(false)
  })
  it('a provider that cannot be reached leaves it unknown, not no', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(list))
    await connectProvider(owner, { provider: 'anthropic', key: KEY })
    setSetting('agentModel', 'something-new')
    expect(await modelSees()).toBeNull()
  })
})

describe('a model the provider took away', () => {
  const at = (ids: string[]) => ({ data: ids.map((id) => ({ id, display_name: id, created_at: '2026-10-01T00:00:00Z' })) })
  it('is replaced by the newest of its line, or else by a tested model of the service', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(at(['claude-haiku-5-5'])))
    await connectProvider(owner, { provider: 'anthropic', key: KEY })
    spy.mockImplementation(async () => json(at(['claude-haiku-5-6', 'claude-sonnet-5-5'])))
    setSetting('agentModel', 'claude-haiku-5-5')
    await replaceMissingModel(true)
    expect(getSetting('agentModel')).toBe('claude-haiku-5-6')
    spy.mockImplementation(async () => json(at(['claude-haiku-5-5', 'something-else'])))
    setSetting('agentModel', 'retired-model')
    await replaceMissingModel(true)
    expect(getSetting('agentModel')).toBe('claude-haiku-5-5')
  })
  it('stays when the list cannot be read or is empty', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(at(['claude-haiku-5-5'])))
    await connectProvider(owner, { provider: 'anthropic', key: KEY })
    spy.mockImplementation(async () => json({ unexpected: 'shape' }))
    await replaceMissingModel(true)
    expect(getSetting('agentModel')).toBe('claude-haiku-5-5')
    spy.mockImplementation(async () => { throw new Error('offline') })
    await replaceMissingModel(true)
    expect(getSetting('agentModel')).toBe('claude-haiku-5-5')
  })
  it('a refused request says so in the log and in words', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(providerFailure({ statusCode: 400, url: 'https://x/v1/chat', responseBody: 'unknown field' })).toContain('API')
    expect(log.mock.calls[0][0]).toContain('unknown field')
  })
})
