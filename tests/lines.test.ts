// A model chosen by its line: the newest that is not older than the one we tested, so a new release is used without a change here.
import { describe, expect, it } from 'vitest'
import { compare, lineOf, LINES, newestOfLine, versionOf } from '../lib/agent/lines'

const flashLite = LINES.google![0]
const haiku = LINES.anthropic![0]
const glm = LINES.openrouter![0]
const deepseek = LINES.openrouter![1]

describe('model lines', () => {
  it('reads the version out of an id, written with dots or dashes', () => {
    expect(versionOf('gemini-3.5-flash-lite', flashLite)).toEqual([3, 5])
    expect(versionOf('claude-haiku-5-5', haiku)).toEqual([5, 5])
    expect(versionOf('claude-sonnet-5-5', haiku)).toBeNull()
    expect(versionOf('deepseek/deepseek-v4.1-flash-1017', deepseek)).toEqual([4, 1])
  })

  it('compares versions as numbers, not as text', () => {
    expect(compare([3, 10], [3, 9])).toBeGreaterThan(0)
    expect(compare([5], [5, 0])).toBe(0)
  })

  it('takes the newest of the line next year as well, and never one older than the tested', () => {
    const listed = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-4.2-flash-lite', 'gemini-4.2-flash', 'gemini-2.5-flash-lite', 'gemma-4-31b-it']
    expect(newestOfLine(listed, flashLite)).toBe('gemini-4.2-flash-lite')
    // Only an older model is listed: nothing qualifies, and the tested floor stays in use.
    expect(newestOfLine(['gemini-2.5-flash-lite', 'gemini-3.0-flash-lite'], flashLite)).toBeNull()
    expect(newestOfLine(['z-ai/glm-5.2-flash', 'z-ai/glm-6.0-flash', 'z-ai/glm-6.0-flash-air'], glm)).toBe('z-ai/glm-6.0-flash')
  })

  it('knows which line a chosen model is of', () => {
    expect(lineOf('claude-haiku-6-0', LINES.anthropic!)).toBe(haiku)
    expect(lineOf('mystery-model', LINES.anthropic!)).toBeNull()
  })

  it('has a floor that belongs to its own line, for every line we offer', () => {
    for (const lines of Object.values(LINES)) for (const l of lines!) expect(versionOf(l.floor, l), l.floor).not.toBeNull()
  })
})
