// What the AI screen says was spent: the provider's stated cost, and the request counted as unpriced when it states none.
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { overLimit, tokensToday } from '../lib/agent/limits'
import { assistantResponse } from '../lib/agent/respond'
import { editor, owner } from './fixture-family'
import { monthTotal, recordUse, usageReport } from '../lib/ai/usage'

describe('assistant spending', () => {
  it('a real answer is counted once per model call, and the daily limit then stops the next one', async () => {
    const usage = { inputTokens: { total: 700, noCache: 500, cacheRead: 200, cacheWrite: 0 }, outputTokens: { total: 300, text: 300, reasoning: 0 } }
    const model = new MockLanguageModelV4({ doStream: async () => ({ stream: simulateReadableStream({ chunks: [{ type: 'stream-start', warnings: [] }, { type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'ok' }, { type: 'text-end', id: 't' }, { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage }] as never[] }) }) })
    const was = monthTotal('assistant'), today = tokensToday()
    const res = await assistantResponse(editor, { messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'hello' }] }] }, { model })
    await res.text()
    expect(tokensToday()).toBe(today + 1000)
    expect(monthTotal('assistant')).toMatchObject({ requests: was.requests + 1, tokens: was.tokens + 1000, dollars: was.dollars, unpriced: was.unpriced + 1 })
    process.env.AGENT_DAILY_TOKENS = String(tokensToday())
    expect(overLimit('someone-new')).toMatch(/Дневной|daily/i)
    delete process.env.AGENT_DAILY_TOKENS
  })
})

describe('who used what', () => {
  it('the assistant records each model call for the person who asked, with the tokens the provider reported and no made-up price', async () => {
    const before = usageReport(owner).people.find((p) => p.id === editor.userId)?.assistant ?? { requests: 0, tokens: 0, dollars: 0, unpriced: 0 }
    const usage = { inputTokens: { total: 40, noCache: 40, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 2, text: 2, reasoning: 0 } }
    const model = new MockLanguageModelV4({ doStream: async () => ({ stream: simulateReadableStream({ chunks: [{ type: 'stream-start', warnings: [] }, { type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'ok' }, { type: 'text-end', id: 't' }, { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage }] as never[] }) }) })
    await (await assistantResponse(editor, { messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'hi' }] }] }, { model })).text()
    const after = usageReport(owner).people.find((p) => p.id === editor.userId)!.assistant
    expect(after).toMatchObject({ requests: before.requests + 1, tokens: before.tokens + 42, dollars: before.dollars, unpriced: before.unpriced + 1 })
  })

  it("OpenRouter's stated cost of a call is what is counted, to the last digit", async () => {
    const before = usageReport(owner).totals.assistant
    const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }
    const model = new MockLanguageModelV4({ doStream: async () => ({ stream: simulateReadableStream({ chunks: [{ type: 'stream-start', warnings: [] }, { type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'ok' }, { type: 'text-end', id: 't' }, { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage, providerMetadata: { openrouter: { usage: { cost: 0.0001234 } } } }] as never[] }) }) })
    await (await assistantResponse(editor, { messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'hi' }] }] }, { model })).text()
    const after = usageReport(owner).totals.assistant
    expect(after.dollars - before.dollars).toBeCloseTo(0.0001234, 12)
    expect(after.unpriced).toBe(before.unpriced)
  })

  it('a stated cost is added exactly, MCP calls are counted per token, and only the owner sees the report', () => {
    const was = usageReport(owner)
    recordUse('speech', editor.userId, { requests: 1, seconds: 9.2, dollars: 0.000508 })
    recordUse('mcp', 'token-for-test', { requests: 3 })
    const now = usageReport(owner)
    expect(now.totals.speech.dollars - was.totals.speech.dollars).toBeCloseTo(0.000508, 9)
    expect(now.totals.speech.seconds - was.totals.speech.seconds).toBeCloseTo(9.2, 9)
    expect(now.tokens.find((t) => t.id === 'token-for-test')?.requests).toBe((was.tokens.find((t) => t.id === 'token-for-test')?.requests ?? 0) + 3)
    expect(now.totals.mcp.dollars).toBe(0)
    expect(() => usageReport(editor)).toThrow()
  })
})
