// What each AI service is told about keeping the family's data, on every request.
import { generateText } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { activeProvider } from '../lib/agent/provider'

afterEach(() => vi.restoreAllMocks())

describe('privacy settings sent with each request', () => {
  it('Yandex is told not to log the request, so it cannot keep or train on it', async () => {
    const seen: Headers[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      seen.push(new Headers(init?.headers))
      return new Response(JSON.stringify({ id: 'x', object: 'chat.completion', created: 0, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const p = activeProvider({ AGENT_PROVIDER: 'yandex', YANDEX_API_KEY: 'AQVN-test-key', AGENT_FOLDER: 'b1gabcdefghij12345' })!
    await generateText({ model: p.create(p.key, p.model, p.folder), prompt: 'hi' })
    expect(seen[0].get('x-data-logging-enabled')).toBe('false')
  })
})
