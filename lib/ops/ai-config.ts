// One file for what the owner chose about the AI: the assistant, the cloud speech service and, on a device,
// the face and voice models. Keys never go into it: they stay where they were typed, so the file is safe to keep.
import { z } from 'zod'
import { chooseModel, providerStatus } from '../agent/provider-key'
import { saveTranscription, speechSetup } from '../transcribe/service'
import { STT_PRESETS } from '../transcribe/presets'
import { type Actor, OpError, requireRole } from './core'
import { getSetting, say, setSetting } from './settings'

const FILE = 'ai-settings'

const schema = z.object({
  folkbranch: z.literal(FILE),
  version: z.literal(1),
  assistant: z.object({
    enabled: z.boolean().optional(),
    forReaders: z.boolean().optional(),
    provider: z.string().max(40).nullish(),
    /** `auto` is the tested model of the service, kept on the newest of its line. */
    model: z.string().trim().min(1).max(120).optional(),
  }).optional(),
  speech: z.object({
    provider: z.enum(STT_PRESETS.map((p) => p.id) as [string, ...string[]]),
    model: z.string().trim().min(1).max(120).optional(),
    baseUrl: z.string().trim().max(300).nullish(),
    sameKey: z.boolean().optional(),
    limitMinutes: z.number().int().min(0).max(1_000_000).optional(),
  }).nullish(),
  /** Per device: the browser applies it itself, since the server does not know what a device has. */
  onDevice: z.object({ faces: z.string().max(40).optional(), recognize: z.string().max(40).optional(), speech: z.string().max(40).optional() }).optional(),
})
export type AiSettingsFile = z.infer<typeof schema>

export function exportAiSettings(actor: Actor): AiSettingsFile {
  requireRole(actor, 'owner')
  const p = providerStatus(actor)
  const speech = speechSetup()
  return {
    folkbranch: FILE,
    version: 1,
    assistant: { enabled: getSetting('assistantEnabled') === '1', forReaders: getSetting('assistantForReaders') === '1', provider: p.provider, ...(p.connected && p.model ? { model: p.auto ? 'auto' : p.model } : {}) },
    speech: speech && { provider: speech.provider, model: speech.model, baseUrl: speech.baseUrl, sameKey: speech.sameKey, limitMinutes: speech.limitMinutes },
  }
}

/** Applies what it can and says what it could not, and why: a half-applied file is told, not hidden. */
export async function importAiSettings(actor: Actor, raw: unknown) {
  requireRole(actor, 'owner')
  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw new OpError(400, say('Это не файл настроек ИИ приложения'))
  const f = parsed.data
  const applied: string[] = []
  const skipped: { what: string; why: string }[] = []
  const attempt = async (what: string, run: () => unknown | Promise<unknown>) => {
    try {
      await run()
      applied.push(what)
    } catch (e) {
      if (!(e instanceof OpError)) throw e
      skipped.push({ what, why: e.message })
    }
  }

  const a = f.assistant
  if (a?.enabled !== undefined) { setSetting('assistantEnabled', a.enabled ? '1' : '0'); applied.push(say('Ассистент: включён или выключен')) }
  if (a?.forReaders !== undefined) { setSetting('assistantForReaders', a.forReaders ? '1' : '0'); applied.push(say('Ассистент: доступ для читателей')) }
  if (a?.model) {
    const what = say('Ассистент: модель')
    const now = providerStatus(actor)
    if (a.provider && a.provider !== now.provider) skipped.push({ what, why: say('Сначала подключите этого провайдера: ключи в файл не попадают') })
    else await attempt(what, () => chooseModel(actor, a.model === 'auto' ? { auto: true } : { model: a.model }))
  }
  if (f.speech) {
    const s = f.speech
    await attempt(say('Расшифровка в облаке'), () => saveTranscription(actor, { provider: s.provider, model: s.model, baseUrl: s.baseUrl ?? undefined, sameKey: s.sameKey, limitMinutes: s.limitMinutes }))
  }
  return { applied, skipped, onDevice: f.onDevice ?? null }
}
