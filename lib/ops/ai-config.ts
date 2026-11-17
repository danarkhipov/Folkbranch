// One file for what the owner chose about the AI: the assistant, the cloud speech service and, on a device,
// the face and voice models. Keys never go into it: they stay where they were typed, so the file is safe to keep.
import { z } from 'zod'
import { chooseModel, providerStatus } from '../agent/provider-key'
import { vaultKey } from '../ai/keys'
import { saveTranscription, speechSetup } from '../transcribe/service'
import { STT_PRESETS } from '../transcribe/presets'
import { faceSetup, saveFaces } from '../faces/service'
import { FACE_PRESETS } from '../faces/presets'
import { type Actor, OpError, requireRole } from './core'
import { getSetting, tell, setSetting } from './settings'

const FILE = 'ai-settings'

/** The version this app writes. A file of another version is still read: each part on its own, what is not understood is listed. */
const VERSION = 1
const assistantPart = z.object({
    enabled: z.boolean().optional(),
    forReaders: z.boolean().optional(),
    provider: z.string().max(40).nullish(),
    /** `auto` is the tested model of the service, kept on the newest of its line. */
    model: z.string().trim().min(1).max(120).optional(),
  })
const speechPart = z.object({
    provider: z.string().max(40),
    model: z.string().trim().min(1).max(120).optional(),
    baseUrl: z.string().trim().max(300).nullish(),
    sameKey: z.boolean().optional(),
    limitMinutes: z.number().int().min(0).max(1_000_000).optional(),
  })
const facesPart = z.object({
    provider: z.string().max(40),
    baseUrl: z.string().trim().max(300).nullish(),
    limitRequests: z.number().int().min(0).max(1_000_000).optional(),
  })
/** Per device: the browser applies it itself, since the server does not know what a device has. */
const onDevicePart = z.object({ faces: z.string().max(40).optional(), recognize: z.string().max(40).optional(), speech: z.string().max(40).optional() })
/** Only the envelope must match; the parts are checked one by one, so one part a version cannot read does not sink the rest. */
const schema = z.object({ folkbranch: z.literal(FILE), version: z.number().int().min(1), assistant: z.unknown().optional(), speech: z.unknown().optional(), faces: z.unknown().optional(), onDevice: z.unknown().optional() })
export type AiSettingsFile = { folkbranch: typeof FILE; version: number; assistant?: z.infer<typeof assistantPart>; speech?: z.infer<typeof speechPart> | null; faces?: z.infer<typeof facesPart> | null; onDevice?: z.infer<typeof onDevicePart> }

export function exportAiSettings(actor: Actor): AiSettingsFile {
  requireRole(actor, 'owner')
  const p = providerStatus(actor)
  const speech = speechSetup()
  const faces = faceSetup()
  return {
    folkbranch: FILE,
    version: VERSION,
    assistant: { enabled: getSetting('assistantEnabled') === '1', forReaders: getSetting('assistantForReaders') === '1', provider: p.provider, ...(p.connected && p.model ? { model: p.auto ? 'auto' : p.model } : {}) },
    speech: speech && { provider: speech.provider, model: speech.model, baseUrl: speech.baseUrl, sameKey: speech.sameKey, limitMinutes: speech.limitMinutes },
    faces: faces && { provider: faces.provider, baseUrl: faces.baseUrl, limitRequests: faces.limitRequests },
  }
}

/** Applies what it can and says what it could not, and why: a half-applied file is told, not hidden. */
export async function importAiSettings(actor: Actor, raw: unknown) {
  requireRole(actor, 'owner')
  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw new OpError(400, tell('Это не файл настроек ИИ приложения'))
  const f = parsed.data
  const applied: string[] = []
  const skipped: { what: string; why: string }[] = []
  if (f.version > VERSION) skipped.push({ what: tell('Файл из более новой версии приложения'), why: tell('Применено то, что эта версия понимает') })
  /** One part of the file, or null when this version cannot read it (said in skipped). */
  const part = <T,>(what: string, value: unknown, shape: z.ZodType<T>): T | null => {
    if (value === undefined || value === null) return null
    const r = shape.safeParse(value)
    if (r.success) return r.data
    skipped.push({ what, why: tell('Эта версия приложения не может прочитать эту часть файла') })
    return null
  }
  const known = (what: string, id: string, ids: string[]) => {
    if (ids.includes(id)) return true
    skipped.push({ what, why: tell('Этого сервиса в этой версии приложения нет') })
    return false
  }
  const attempt = async (what: string, run: () => unknown | Promise<unknown>) => {
    try {
      await run()
      applied.push(what)
    } catch (e) {
      if (!(e instanceof OpError)) throw e
      skipped.push({ what, why: e.message })
    }
  }

  const a = part(tell('Ассистент'), f.assistant, assistantPart)
  if (a?.enabled !== undefined) { setSetting('assistantEnabled', a.enabled ? '1' : '0'); applied.push(tell('Ассистент: включён или выключен')) }
  if (a?.forReaders !== undefined) { setSetting('assistantForReaders', a.forReaders ? '1' : '0'); applied.push(tell('Ассистент: доступ для читателей')) }
  if (a?.model) {
    const what = tell('Ассистент: модель')
    const now = providerStatus(actor)
    // Another service is taken when its key is already on the list of keys; keys never travel in the file.
    if (a.provider && a.provider !== now.provider && !vaultKey(a.provider)) skipped.push({ what, why: tell('Сначала подключите этого провайдера: ключи в файл не попадают') })
    else if (a.provider && a.provider !== now.provider) await attempt(what, () => chooseModel(actor, { provider: a.provider, ...(a.model && a.model !== 'auto' ? { model: a.model } : {}) }))
    else await attempt(what, () => chooseModel(actor, a.model === 'auto' ? { auto: true } : { model: a.model }))
  }
  const s = part(tell('Расшифровка в облаке'), f.speech, speechPart)
  if (s && known(tell('Расшифровка в облаке'), s.provider, STT_PRESETS.map((x) => x.id))) {
    const now = speechSetup()
    // The file carries no key, so the one saved here would be checked against, and later sent to, a server it names.
    if (now && s.baseUrl != null && s.baseUrl.replace(/\/+$/, '') !== (now.baseUrl ?? '').replace(/\/+$/, '')) {
      skipped.push({ what: tell('Расшифровка в облаке'), why: tell('Файл указывает другой адрес сервиса, а ключ остаётся здесь: подключите сервис заново') })
    } else await attempt(tell('Расшифровка в облаке'), () => saveTranscription(actor, { provider: s.provider, model: s.model, baseUrl: s.baseUrl ?? undefined, sameKey: s.sameKey, limitMinutes: s.limitMinutes }))
  }
  const c = part(tell('Распознавание лиц в облаке'), f.faces, facesPart)
  if (c && known(tell('Распознавание лиц в облаке'), c.provider, FACE_PRESETS.map((x) => x.id))) {
    const now = faceSetup()
    // The same for faces: a server named by the file must not receive the saved key and secret.
    if (now && c.baseUrl != null && c.baseUrl.replace(/\/+$/, '') !== (now.baseUrl ?? '').replace(/\/+$/, '')) {
      skipped.push({ what: tell('Распознавание лиц в облаке'), why: tell('Файл указывает другой адрес сервиса, а ключ остаётся здесь: подключите сервис заново') })
    } else await attempt(tell('Распознавание лиц в облаке'), () => saveFaces(actor, { provider: c.provider, baseUrl: c.baseUrl ?? undefined, limitRequests: c.limitRequests }))
  }
  return { applied, skipped, onDevice: part(tell('Модели на устройстве'), f.onDevice, onDevicePart) }
}
