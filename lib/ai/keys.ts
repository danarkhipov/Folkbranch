// The owner's keys to AI services, one per service, kept encrypted in one place. Each function (the assistant,
// speech recognition) then picks a service and a model from what is here, so a key is pasted once however many
// functions use it. Face services keep their own keys: they are not language models and sign their requests.
import { seal, unseal } from '../sealed'
import { getSetting, setSetting } from '../ops/settings'

export const SERVICES = ['openrouter', 'anthropic', 'openai', 'google', 'yandex', 'cloudru', 'deepseek', 'moonshot', 'groq', 'mistral', 'siliconflow'] as const
export type Service = (typeof SERVICES)[number]
export interface KeyEntry { key: string; folder?: string; addedAt: number }
type Vault = Partial<Record<Service, KeyEntry>>

const SETTING = 'aiKeys'
const purpose = 'ai-keys'

/** Keys saved before this list existed: the assistant's, and the speech service's own. Read once into the list. */
function fromOldPlaces(): Vault {
  const out: Vault = {}
  const agent = getSetting('agentProvider') as Service | null
  const sealed = getSetting('agentKey')
  const key = sealed ? unseal(sealed, 'provider-key') : null
  if (agent && key) out[agent] = { key, folder: getSetting('agentFolder') ?? undefined, addedAt: Date.now() }
  try {
    const stt = getSetting('sttConfig')
    const cfg = stt ? (JSON.parse(unseal(stt, 'stt-key') ?? 'null') as { provider?: string; key?: string } | null) : null
    if (cfg?.key && cfg.provider && cfg.provider !== 'custom' && !out[cfg.provider as Service]) out[cfg.provider as Service] = { key: cfg.key, addedAt: Date.now() }
  } catch {
    // An unreadable speech setup has no key to carry over.
  }
  return out
}

function carryOver(): Vault {
  const old = fromOldPlaces()
  setSetting(SETTING, seal(JSON.stringify(old), purpose))
  // The old copy stays where the previous version reads it, so going back after an update still answers.
  // It is dropped as soon as it stops matching the list (see dropOldCopy).
  return old
}

export function readKeys(): Vault {
  const sealed = getSetting(SETTING)
  if (sealed === null) return carryOver()
  try {
    const text = unseal(sealed, purpose)
    if (text === null) throw new Error('unreadable')
    return JSON.parse(text) as Vault
  } catch {
    // A damaged list is rebuilt from the old places where they still hold a key, rather than losing every key.
    console.error('ai keys: the list of keys could not be read')
    return carryOver()
  }
}

export const vaultKey = (s: string): KeyEntry | null => readKeys()[s as Service] ?? null

/** The previous version's copy of the assistant's key, once it no longer matches what the list holds. */
export function dropOldCopy() {
  for (const k of ['agentKey', 'agentFolder']) setSetting(k, '')
}

export function writeKey(s: Service, entry: Omit<KeyEntry, 'addedAt'> | null) {
  const v = readKeys()
  if (getSetting('agentProvider') === s && getSetting('agentKey')) dropOldCopy()
  if (entry) v[s] = { ...entry, addedAt: v[s]?.addedAt ?? Date.now() }
  else delete v[s]
  setSetting(SETTING, seal(JSON.stringify(v), purpose))
}
