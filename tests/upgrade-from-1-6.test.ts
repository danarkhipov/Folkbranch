// An archive set up with version 1.6.0, opened by this version: the settings are written exactly as 1.6.0 wrote them
// (lib/agent/provider-key.ts, lib/transcribe/service.ts at the v1.6.0 tag), and nothing the owner set may stop working.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { currentProvider, chooseModel } from '../lib/agent/provider-key'
import { PRESETS } from '../lib/agent/presets'
import { monthTotal, usageReport } from '../lib/ai/usage'
import { getSetting, setSetting } from '../lib/ops/settings'
import { seal, unseal } from '../lib/sealed'
import { transcribe, transcriptionStatus } from '../lib/transcribe/service'
import { editor, owner } from './fixture-family'

const KEY = 'sk-or-v1-set-in-1-6-0-4321'
const month = new Date().toISOString().slice(0, 7)
const audio = { bytes: Buffer.from('not really audio'), name: 'story.webm', mime: 'audio/webm' }
afterEach(() => vi.restoreAllMocks())

describe('an archive from version 1.6.0', () => {
  // What 1.6.0 left in the settings table.
  setSetting('agentProvider', 'openrouter')
  setSetting('agentKey', seal(KEY, 'provider-key'))
  setSetting('agentModel', PRESETS.find((p) => p.id === 'openrouter')!.models[0].id)
  setSetting('assistantEnabled', '1')
  // Speech "with the assistant's key": 1.6.0 kept no key of its own for it.
  setSetting('sttConfig', seal(JSON.stringify({ provider: 'openrouter', model: 'auto', sameKey: true, limitMinutes: 10 }), 'stt-key'))
  setSetting(`sttUsage:${month}`, JSON.stringify({ seconds: 540, dollars: 0.04, requests: 6 }))

  it('the assistant answers with the same key', () => {
    expect(currentProvider()).toMatchObject({ id: 'openrouter', key: KEY })
  })

  it("speech still uses the assistant's key", () => {
    expect(transcriptionStatus(owner).current).toMatchObject({ provider: 'openrouter', keyEnding: '4321', limitMinutes: 10 })
  })

  it("this month's minutes count toward the limit the owner set, and their price is not made up", async () => {
    expect(monthTotal('speech')).toMatchObject({ requests: 6, seconds: 540, dollars: 0, unpriced: 6 })
    // 9 minutes used of 10: two more minutes are refused before anything is sent.
    const sent = vi.spyOn(globalThis, 'fetch')
    await expect(transcribe(editor, audio, { seconds: 120 })).rejects.toMatchObject({ status: 429 })
    expect(sent).not.toHaveBeenCalled()
    // The earlier counts are in the totals, not shown as a person.
    expect(usageReport(owner).people.some((p) => p.id.startsWith('~'))).toBe(false)
  })

  it('going back to 1.6.0 after the update still finds its key', () => {
    expect(unseal(getSetting('agentKey')!, 'provider-key')).toBe(KEY)
  })

  it('the old copy goes once the assistant moves to another service, so it is never read as that one', async () => {
    setSetting('aiKeys', seal(JSON.stringify({ ...JSON.parse(unseal(getSetting('aiKeys')!, 'ai-keys')!), deepseek: { key: 'sk-deepseek-5555', addedAt: 1 } }), 'ai-keys'))
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    await chooseModel(owner, { provider: 'deepseek' })
    expect(getSetting('agentKey') || null).toBeNull()
    expect(currentProvider()).toMatchObject({ id: 'deepseek', key: 'sk-deepseek-5555' })
  })
})
