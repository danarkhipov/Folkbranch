// The owner's list of AI services: each key is checked with its service before it is kept, and each one says
// which functions can use it and which do. Removing a key switches off whatever used it, never silently.
import { z } from 'zod'
import { type Actor, OpError, requireRole } from '../ops/core'
import { getSetting, tell, setSetting } from '../ops/settings'
import { PRESETS, type PresetId } from '../agent/presets'
import { checkServiceKey, disconnectProvider } from '../agent/provider-key'
import { activeProvider } from '../agent/provider'
import { STT_PRESETS } from '../transcribe/presets'
import { checkKey, removeTranscription, speechSetup } from '../transcribe/service'
import { readKeys, SERVICES, writeKey, type Service } from './keys'

const agentPreset = (s: string) => PRESETS.find((p) => p.id === s)
const speechPreset = (s: string) => STT_PRESETS.find((p) => p.id === s)

export function listServices(actor: Actor) {
  requireRole(actor, 'owner')
  const keys = readKeys()
  const assistant = activeProvider(process.env) ? null : getSetting('agentProvider')
  const speech = speechSetup()
  return {
    keys: SERVICES.filter((s) => keys[s]).map((s) => ({
      service: s,
      label: agentPreset(s)?.label ?? speechPreset(s)?.label ?? s,
      keyEnding: keys[s]!.key.slice(-4),
      folder: keys[s]!.folder ?? null,
      addedAt: keys[s]!.addedAt,
      can: { assistant: !!agentPreset(s), speech: !!speechPreset(s) && speechPreset(s)!.id !== 'custom' },
      usedBy: { assistant: assistant === s, speech: !speech?.fromServer && speech?.provider === s && !!speech.sameKey },
    })),
    // What can be added, with where to get a key.
    available: SERVICES.filter((s) => !agentPreset(s)?.hidden).map((s) => ({ service: s, label: agentPreset(s)?.label ?? speechPreset(s)?.label ?? s, keysUrl: agentPreset(s)?.keysUrl ?? speechPreset(s)?.keysUrl ?? null, can: { assistant: !!agentPreset(s), speech: !!speechPreset(s) }, needsFolder: s === 'yandex' })),
  }
}

const addInput = z.object({
  service: z.enum(SERVICES),
  key: z.string().trim().min(10).max(500),
  folder: z.string().trim().optional(),
})

/** Checked for free with the service itself before it is kept; nothing is switched on by adding it. */
export async function addKey(actor: Actor, raw: unknown) {
  requireRole(actor, 'owner')
  const parsed = addInput.safeParse(raw)
  if (!parsed.success) throw new OpError(400, parsed.error.issues.some((i) => i.path[0] === 'key') ? tell('Ключ слишком короткий: скопируйте его целиком') : tell('Выберите сервис из списка'))
  const b = parsed.data
  if (b.folder && !/^[a-z0-9]{10,30}$/.test(b.folder)) throw new OpError(400, tell('Идентификатор каталога состоит из латинских букв и цифр, например b1g…'))
  if (b.service === 'yandex' && !b.folder) throw new OpError(400, tell('Укажите идентификатор каталога Яндекса'))
  const agent = agentPreset(b.service)
  if (agent) await checkServiceKey(agent.id as PresetId, b.key, b.folder)
  else {
    const p = speechPreset(b.service)!
    await checkKey(p.style, p.base, b.key)
  }
  writeKey(b.service, { key: b.key, folder: b.service === 'yandex' ? b.folder : undefined })
  return listServices(actor)
}

export function removeKey(actor: Actor, service: string) {
  requireRole(actor, 'owner')
  const s = z.enum(SERVICES).parse(service) as Service
  const { keys } = listServices(actor)
  const used = keys.find((k) => k.service === s)?.usedBy
  if (used?.assistant) {
    disconnectProvider(actor)
    setSetting('assistantEnabled', '0')
  }
  if (used?.speech) removeTranscription(actor)
  writeKey(s, null)
  return listServices(actor)
}
