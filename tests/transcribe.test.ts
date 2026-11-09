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
    expect(s.requests).toBe(1)
    // Billed for at least ten seconds, so thirty seconds is thirty.
    expect(s.dollars).toBeCloseTo(((0.04 / 60) * 30) / 60, 4)
  })

  it('stops at the monthly limit the owner set', async () => {
    server(() => json({ text: 'ещё' }))
    await expect(transcribe(editor, audio, { seconds: 100 })).rejects.toMatchObject({ status: 429 })
  })

  it('lets readers and strangers do nothing', async () => {
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
    expect(body).toMatchObject({ model: 'mistralai/voxtral-mini-transcribe', language: 'en', input_audio: { format: 'webm' } })
    expect(Buffer.from(body.input_audio.data, 'base64').toString()).toBe('not really audio')
    expect(transcriptionStatus(owner).usage.dollars).toBeCloseTo(((0.04 / 60) * 30) / 60 + 0.000508, 4)
    // No assistant is connected here, so its key cannot be borrowed.
    await expect(saveTranscription(owner, { provider: 'openrouter', sameKey: true })).rejects.toMatchObject({ status: 400 })
  })

  it('shows a refused key as the owner\'s problem, and tests with silence', async () => {
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

  it('can be taken away', async () => {
    expect(removeTranscription(owner).current).toBeNull()
    expect(transcriptionInfo().enabled).toBe(false)
  })
})
