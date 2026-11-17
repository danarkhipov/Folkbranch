// Cloud transcription: set up once by the owner, used by editors, never showing the key, and kept within a monthly limit.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Actor } from '../lib/ops/core'
import { removeTranscription, saveTranscription, testTranscription, transcribe, transcriptionInfo, transcriptionStatus } from '../lib/transcribe/service'

const owner: Actor = { userId: 'o', name: 'Owner', role: 'owner', personId: null }
const editor: Actor = { userId: 'e', name: 'Ed', role: 'editor', personId: null }
const reader: Actor = { userId: 'r', name: 'Rita', role: 'reader', personId: null }
const audio = { bytes: Buffer.from('not really audio'), name: 'story.webm', mime: 'audio/webm' }

const calls: { url: string; init: RequestInit }[] = []
const server = (answer: (url: string, init: RequestInit) => Response) => vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => { calls.push({ url, init }); return answer(url, init) }))
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
/** A connected Groq with the key every test here uses; tests that need it no longer depend on an earlier one. */
async function groqSetUp(limitMinutes = 2) {
  server(() => json({ data: [] }))
  return saveTranscription(owner, { provider: 'groq', key: 'gsk_secretvalue1234', limitMinutes })
}
/** The JSON service: its key check and its answers have a different shape from Groq's form. */
async function openRouterSetUp() {
  server((url) => (url.includes('/key') ? json({ data: {} }) : json({ text: '' })))
  return saveTranscription(owner, { provider: 'openrouter', key: 'sk-or-v1-abcdef9999', limitMinutes: 100, model: 'mistralai/voxtral-mini-transcribe' })
}
afterEach(() => { vi.unstubAllGlobals(); calls.length = 0 })

describe('cloud transcription', () => {
  it('is off until the owner connects a service', async () => {
    expect(transcriptionInfo()).toEqual({ enabled: false, label: null, where: null })
    await expect(transcribe(editor, audio, { seconds: 5 })).rejects.toMatchObject({ status: 409 })
  })

  it('checks the key for free before keeping it, and keeps it away from everyone', async () => {
    server((url) => (url.endsWith('/models') ? json({}, 401) : json({})))
    await expect(saveTranscription(owner, { provider: 'groq', key: 'gsk_wrong' })).rejects.toMatchObject({ status: 400 })
    server(() => json({ data: [] }))
    const status = await saveTranscription(owner, { provider: 'groq', key: 'gsk_secretvalue1234', limitMinutes: 2 })
    expect(JSON.stringify(status)).not.toContain('gsk_secretvalue')
    expect(status.current).toMatchObject({ provider: 'groq', model: 'auto', keyEnding: '1234', limitMinutes: 2 })
    expect(calls.at(-1)!.url).toBe('https://api.groq.com/openai/v1/models')
    expect(transcriptionInfo()).toMatchObject({ enabled: true, label: 'Groq' })
    // Only the owner sees or changes the setup.
    await expect(saveTranscription(editor, { provider: 'groq', key: 'x' })).rejects.toMatchObject({ status: 403 })
    expect(() => transcriptionStatus(editor)).toThrow()
  })

  it('sends a recording as a form to a service that works like OpenAI, and counts what it costs', async () => {
    await groqSetUp(2)
    const before = transcriptionStatus(owner).usage
    // The service lists a newer model of the tested line: it is used, and an older one is not.
    server((url) => (url.endsWith('/models') ? json({ data: [{ id: 'whisper-large-v2-turbo' }, { id: 'whisper-large-v3-turbo' }, { id: 'whisper-large-v4-turbo' }] }) : json({ text: ' Привет, это бабушка ' })))
    const r = await transcribe(editor, audio, { language: 'ru', seconds: 30 })
    expect(r.text).toBe('Привет, это бабушка')
    const { url, init } = calls.find((c) => c.url.endsWith('/audio/transcriptions'))!
    expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer gsk_secretvalue1234')
    const form = init.body as FormData
    expect(form.get('model')).toBe('whisper-large-v4-turbo')
    expect(form.get('language')).toBe('ru')
    expect(form.get('file')).toBeInstanceOf(Blob)
    const s = transcriptionStatus(owner).usage
    expect(s.requests).toBe(before.requests + 1)
    // Groq states no cost, so none is made up: the request is counted, its price is unknown.
    expect(s.dollars).toBe(before.dollars)
    expect(s.unpriced).toBe(before.unpriced + 1)
    expect(s.minutes).toBeCloseTo(before.minutes + 0.5)
  })

  it('stops at the monthly limit the owner set', async () => {
    await groqSetUp(1)
    server(() => json({ text: 'ещё' }))
    await expect(transcribe(editor, audio, { seconds: 100 })).rejects.toMatchObject({ status: 429 })
  })

  it('lets readers and strangers do nothing', async () => {
    await groqSetUp()
    server(() => json({ text: 'x' }))
    await expect(transcribe(reader, audio, { seconds: 5 })).rejects.toMatchObject({ status: 403 })
  })

  it('speaks the other shape to OpenRouter, takes its exact cost, and can borrow the assistant key only for the same service', async () => {
    server((url) => (url.includes('/key') ? json({ data: {} }) : json({ text: 'hello', usage: { seconds: 9.2, cost: 0.000508 } })))
    await saveTranscription(owner, { provider: 'openrouter', key: 'sk-or-v1-abcdef9999', limitMinutes: 100, model: 'mistralai/voxtral-mini-transcribe' })
    const r = await transcribe(editor, audio, { language: 'en', seconds: 9 })
    expect(r.text).toBe('hello')
    const sent = calls.find((c) => c.url.endsWith('/audio/transcriptions'))!
    expect(sent.url).toBe('https://openrouter.ai/api/v1/audio/transcriptions')
    const body = JSON.parse(sent.init.body as string)
    expect(body).toMatchObject({ model: 'mistralai/voxtral-mini-transcribe', language: 'en', input_audio: { format: 'webm' }, provider: { data_collection: 'deny' } })
    expect(Buffer.from(body.input_audio.data, 'base64').toString()).toBe('not really audio')
    // OpenRouter states the cost and the seconds it heard: both are taken as they are.
    expect(transcriptionStatus(owner).usage.dollars).toBeCloseTo(0.000508, 6)
    // The key went into the list of keys, so choosing the service again needs no key pasted.
    await expect(saveTranscription(owner, { provider: 'openrouter', sameKey: true })).resolves.toMatchObject({ current: { provider: 'openrouter', keyEnding: '9999' } })
    // A service with no key in the list cannot be chosen without one.
    await expect(saveTranscription(owner, { provider: 'mistral', sameKey: true })).rejects.toMatchObject({ status: 400 })
  })

  it('shows a refused key as the owner\'s problem, and tests with silence', async () => {
    await openRouterSetUp()
    server(() => json({ error: 'bad' }, 401))
    await expect(transcribe(editor, audio, { seconds: 5 })).rejects.toMatchObject({ status: 502 })
    server(() => json({ text: '' }))
    await expect(testTranscription(owner)).resolves.toEqual({ ok: true })
    const sent = calls.at(-1)!.init.body as string
    expect(JSON.parse(sent).input_audio.format).toBe('wav')
  })

  it('a speech model the service took away is replaced by another tested one, and that one is kept', async () => {
    server((url) => (url.endsWith('/models') ? json({ data: [{ id: 'whisper-large-v3-turbo' }] }) : json({ text: 'x' })))
    await saveTranscription(owner, { provider: 'groq', key: 'gsk_secretvalue1234' })
    let gone = true
    server((url, init) => (url.endsWith('/models') ? json({ data: [{ id: 'whisper-large-v3-turbo' }] }) : gone && String((init.body as FormData).get('model')) !== 'whisper-large-v3' ? json({ error: 'model not found' }, 404) : json({ text: 'сказано' })))
    expect((await transcribe(editor, audio, { language: 'ru', seconds: 30 })).text).toBe('сказано')
    expect(calls.filter((c) => c.url.endsWith('/audio/transcriptions')).length).toBeGreaterThan(1)
    gone = false
  })

  it('sends OpenAI\'s current gpt-transcribe a plural language hint, not the old singular field', async () => {
    // https://developers.openai.com/api/docs/guides/speech-to-text
    server(() => json({ text: 'hello', languages: [{ code: 'en' }] }))
    await saveTranscription(owner, { provider: 'openai', key: 'sk-openai-secret-1234' })
    await transcribe(editor, audio, { language: 'ru', seconds: 3 })
    const sent = calls.find((c) => c.url.endsWith('/audio/transcriptions'))!
    const form = sent.init.body as FormData
    expect(form.get('model')).toBe('gpt-transcribe')
    expect(form.get('languages[]')).toBe('ru')
    expect(form.get('language')).toBeNull()
  })

  it('sends SiliconFlow only the fields its documentation lists', async () => {
    // https://docs.siliconflow.cn/en/api-reference/audio/create-audio-transcriptions
    server((url) => url.endsWith('/models') ? json({ data: [{ id: 'FunAudioLLM/SenseVoiceSmall' }] }) : json({ text: 'привет' }))
    await saveTranscription(owner, { provider: 'siliconflow', key: 'sf-secret-1234' })
    await transcribe(editor, audio, { language: 'ru', seconds: 4 })
    const sent = calls.find((c) => c.url.endsWith('/audio/transcriptions'))!
    const form = sent.init.body as FormData
    expect(form.get('model')).toBe('FunAudioLLM/SenseVoiceSmall')
    expect(form.get('language')).toBeNull()
  })

  it('a model with no known price is counted as unknown, never as free', async () => {
    // Groq's first model has a price, so falling back to it would count this as paid: the test fails then.
    server((url) => (url.endsWith('/models') ? json({ data: [{ id: 'my-whisper' }] }) : json({ text: 'x' })))
    await saveTranscription(owner, { provider: 'groq', key: 'gsk_secretvalue1234', model: 'my-whisper' })
    const before = transcriptionStatus(owner).usage
    await transcribe(editor, audio, { seconds: 30 })
    const after = transcriptionStatus(owner).usage
    expect(after.dollars).toBe(before.dollars)
    expect(after.unpriced).toBe(before.unpriced + 1)
  })

  it('can be taken away', async () => {
    await groqSetUp()
    expect(removeTranscription(owner).current).toBeNull()
    expect(transcriptionInfo().enabled).toBe(false)
  })
})
