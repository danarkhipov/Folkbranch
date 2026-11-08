// Cloud transcription: the owner connects a speech service once and pays for it; every editor can use it through
// this server, which keeps the key, forwards the recording and keeps nothing of it. Nothing here runs unless the owner set it up.
import { z } from 'zod'
import { currentProvider } from '../agent/provider-key'
import { type Actor, OpError, requireRole } from '../ops/core'
import { getSetting, say, setSetting } from '../ops/settings'
import { seal, unseal } from '../sealed'
import { newestOfLine, type Line } from '../agent/lines'
import { STT_PRESETS, sttPreset, type SttId } from './presets'

/** The speech models we tested, by service: the newest of the line the service lists is used from then on, never an older one. */
const STT_LINES: Partial<Record<SttId, Line>> = {
  groq: { match: /^whisper-large-v(\d+)-turbo$/, floor: 'whisper-large-v3-turbo', status: 'provisional' },
}
const chosenModels = new Map<string, { at: number; id: string }>()

/** `auto` means the tested default, or a newer model of its line when the service lists one. Any failure keeps the tested default. */
async function modelFor(c: { cfg: Config; preset: NonNullable<ReturnType<typeof sttPreset>>; base: string; key: string }) {
  if (c.cfg.model !== 'auto') return c.cfg.model
  const fallback = c.preset.models[0].id
  const line = STT_LINES[c.preset.id]
  if (!line) return fallback
  const hit = chosenModels.get(c.preset.id)
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.id
  const res = await fetch(`${c.base}/models`, { headers: { authorization: `Bearer ${c.key}` }, signal: AbortSignal.timeout(8_000) }).catch(() => null)
  const body = res?.ok ? await res.json().catch(() => null) : null
  const id = newestOfLine(Array.isArray(body?.data) ? body.data.map((m: { id: string }) => m.id) : [], line) ?? fallback
  chosenModels.set(c.preset.id, { at: Date.now(), id })
  return id
}

const purpose = 'stt-key'
const MAX_BYTES = 25 * 1024 * 1024
const DEFAULT_LIMIT_MINUTES = 600

interface Config { provider: SttId; model: string; baseUrl?: string; key?: string; sameKey?: boolean; limitMinutes: number }

function fromApp(): Config | null {
  const sealed = getSetting('sttConfig')
  const text = sealed ? unseal(sealed, purpose) : null
  try {
    return text ? (JSON.parse(text) as Config) : null
  } catch {
    return null
  }
}

function fromEnv(): Config | null {
  const provider = process.env.STT_PROVIDER as SttId | undefined
  const preset = provider && sttPreset(provider)
  const key = process.env.STT_API_KEY?.trim()
  if (!preset || !key) return null
  return { provider: preset.id, model: process.env.STT_MODEL?.trim() || 'auto', baseUrl: process.env.STT_BASE_URL?.trim() || undefined, key, limitMinutes: Number(process.env.STT_LIMIT_MINUTES ?? DEFAULT_LIMIT_MINUTES) }
}

/** The setup that answers now: the server's environment first, so an admin's choice always wins. */
function config() {
  const cfg = fromEnv() ?? fromApp()
  if (!cfg) return null
  const preset = sttPreset(cfg.provider)!
  const base = (preset.id === 'custom' ? cfg.baseUrl : preset.base)?.replace(/\/+$/, '')
  // The assistant's key is borrowed only while it is still for this service.
  const key = cfg.sameKey ? (currentProvider()?.id === preset.assistantKey ? currentProvider()!.key : null) : cfg.key
  return base && key !== null && key !== undefined ? { cfg, preset, base, key } : null
}

const month = () => new Date().toISOString().slice(0, 7)
interface Usage { seconds: number; dollars: number; requests: number }
const readUsage = (): Usage => { try { return JSON.parse(getSetting(`sttUsage:${month()}`) ?? '') } catch { return { seconds: 0, dollars: 0, requests: 0 } } }

/** What any signed-in editor may know: whether it works and where a recording goes. */
export function transcriptionInfo() {
  const c = config()
  return { enabled: !!c, label: c?.preset.label ?? null, where: c?.preset.where ?? null }
}

/** For the owner: the services, what is set, and what this month has cost. The key itself never leaves. */
export function transcriptionStatus(actor: Actor) {
  requireRole(actor, 'owner')
  const c = config()
  const usage = readUsage()
  return {
    presets: STT_PRESETS,
    current: c && { provider: c.cfg.provider, model: c.cfg.model, baseUrl: c.cfg.baseUrl ?? null, source: fromEnv() ? 'server' as const : 'app' as const, keyEnding: c.cfg.sameKey ? null : c.key.slice(-4), sameKey: !!c.cfg.sameKey, limitMinutes: c.cfg.limitMinutes },
    assistant: currentProvider()?.id ?? null,
    usage: { month: month(), minutes: Math.round(usage.seconds / 6) / 10, dollars: Math.round(usage.dollars * 10000) / 10000, requests: usage.requests },
  }
}

const input = z.object({
  provider: z.enum(['openrouter', 'groq', 'openai', 'mistral', 'siliconflow', 'custom']),
  model: z.string().trim().min(1).max(120).optional(),
  baseUrl: z.string().trim().url().max(300).optional(),
  key: z.string().trim().max(400).optional(),
  sameKey: z.boolean().optional(),
  limitMinutes: z.number().int().min(0).max(1_000_000).optional(),
})

async function ask(url: string, init: RequestInit, timeout = 20_000) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) }).catch(() => null)
  if (!res) throw new OpError(502, say('Не удалось связаться с сервисом. Проверьте адрес и интернет на сервере'))
  return res
}

/** Reading the list of models costs nothing, so a check never spends the owner's money. */
async function checkKey(style: 'openai' | 'openrouter', base: string, key: string) {
  const res = await ask(style === 'openrouter' ? 'https://openrouter.ai/api/v1/key' : `${base}/models`, { headers: { authorization: `Bearer ${key}` } })
  if (res.status === 401 || res.status === 403) throw new OpError(400, say('Сервис не принял этот ключ. Проверьте, что он скопирован целиком'))
  if (res.status === 429) throw new OpError(429, say('Сервис просит подождать. Попробуйте через минуту'))
  // A server of one's own may not list its models; that is no reason to refuse it.
  if (!res.ok && res.status !== 404) throw new OpError(502, `${say('Сервис ответил ошибкой')}: ${res.status}`)
}

export async function saveTranscription(actor: Actor, raw: unknown) {
  requireRole(actor, 'owner')
  if (fromEnv()) throw new OpError(409, say('Расшифровка задана в настройках сервера'))
  const b = input.parse(raw)
  const preset = sttPreset(b.provider)!
  const old = fromApp()
  if (preset.id === 'custom' && !b.baseUrl) throw new OpError(400, say('Укажите адрес сервера'))
  if (b.sameKey && (!preset.assistantKey || currentProvider()?.id !== preset.assistantKey)) throw new OpError(400, say('Ключ ассистента подходит только для того же сервиса'))
  // Leaving the key empty keeps the one saved for the same service.
  const key = b.sameKey ? undefined : b.key || (old?.provider === b.provider ? old.key : undefined)
  if (!b.sameKey && !key) throw new OpError(400, say('Вставьте ключ сервиса'))
  const base = (preset.id === 'custom' ? b.baseUrl! : preset.base).replace(/\/+$/, '')
  await checkKey(preset.style, base, b.sameKey ? currentProvider()!.key : key!)
  const cfg: Config = { provider: preset.id, model: b.model ?? 'auto', baseUrl: preset.id === 'custom' ? b.baseUrl : undefined, key, sameKey: b.sameKey, limitMinutes: b.limitMinutes ?? old?.limitMinutes ?? DEFAULT_LIMIT_MINUTES }
  setSetting('sttConfig', seal(JSON.stringify(cfg), purpose))
  return transcriptionStatus(actor)
}

export function removeTranscription(actor: Actor) {
  requireRole(actor, 'owner')
  if (fromEnv()) throw new OpError(409, say('Расшифровка задана в настройках сервера'))
  setSetting('sttConfig', '')
  return transcriptionStatus(actor)
}

const formatOf = (name: string, mime: string) => {
  const m = `${mime} ${name}`.toLowerCase()
  return /webm/.test(m) ? 'webm' : /ogg|opus/.test(m) ? 'ogg' : /mp4|m4a|aac/.test(m) ? 'm4a' : /wav/.test(m) ? 'wav' : /mpeg|mp3/.test(m) ? 'mp3' : /flac/.test(m) ? 'flac' : 'webm'
}

/** One recording to the service, and the words back. The recording is not kept anywhere. */
async function send(c: NonNullable<ReturnType<typeof config>>, audio: { bytes: Buffer; name: string; mime: string }, language: string | null) {
  const { preset, base, key } = c
  const model = await modelFor(c)
  let res: Response
  if (preset.style === 'openrouter') {
    res = await ask('https://openrouter.ai/api/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, input_audio: { data: audio.bytes.toString('base64'), format: formatOf(audio.name, audio.mime) }, ...(language ? { language } : {}) }),
    }, 120_000)
  } else {
    const form = new FormData()
    form.set('file', new Blob([new Uint8Array(audio.bytes)], { type: audio.mime || 'audio/webm' }), audio.name || 'recording.webm')
    form.set('model', model)
    // OpenAI's newest model finds the language itself and refuses the old field.
    if (language && model !== 'gpt-transcribe') form.set('language', language)
    res = await ask(`${base}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form }, 120_000)
  }
  if (res.status === 401 || res.status === 403) throw new OpError(502, say('Сервис не принял ключ владельца. Сообщите ему'))
  if (res.status === 402) throw new OpError(502, say('На счёте сервиса закончились деньги. Сообщите владельцу'))
  if (res.status === 413) throw new OpError(413, say('Запись слишком длинная для сервиса. Разделите её на части'))
  if (res.status === 429) throw new OpError(429, say('Сервис просит подождать. Попробуйте через минуту'))
  if (!res.ok) throw new OpError(502, `${say('Сервис ответил ошибкой')}: ${res.status}`)
  const body = await res.json().catch(() => null)
  if (typeof body?.text !== 'string') throw new OpError(502, say('Сервис ответил непонятно'))
  return { text: body.text.trim(), cost: typeof body.usage?.cost === 'number' ? (body.usage.cost as number) : null, model }
}

// A few recordings a minute from one person is plenty; more is a stuck button or someone testing the owner's wallet.
const recent = new Map<string, number[]>()
function slowDown(userId: string) {
  const now = Date.now()
  const list = (recent.get(userId) ?? []).filter((t) => now - t < 60_000)
  if (list.length >= 8) throw new OpError(429, say('Слишком много записей подряд. Подождите минуту'))
  recent.set(userId, [...list, now])
}

export async function transcribe(actor: Actor, audio: { bytes: Buffer; name: string; mime: string }, opts: { language?: string | null; seconds: number }) {
  requireRole(actor, 'editor')
  const c = config()
  if (!c) throw new OpError(409, say('Расшифровка в облаке не настроена'))
  if (!audio.bytes.length) throw new OpError(400, say('Запись пустая'))
  if (audio.bytes.length > MAX_BYTES) throw new OpError(413, say('Запись слишком длинная для сервиса: до 25 МБ'))
  const seconds = Math.min(Math.max(opts.seconds, 1), 6 * 3600)
  const usage = readUsage()
  const cap = c.cfg.limitMinutes
  if (cap > 0 && (usage.seconds + seconds) / 60 > cap) throw new OpError(429, say('В этом месяце исчерпан предел расшифровки, который поставил владелец'))
  slowDown(actor.userId)
  const out = await send(c, audio, opts.language ? opts.language.slice(0, 2).toLowerCase() : null)
  const perMinute = c.preset.models.find((m) => m.id === out.model)?.perMinute ?? c.preset.models[0].perMinute ?? 0
  const billed = Math.max(seconds, c.preset.minSeconds ?? 0)
  const dollars = out.cost ?? (perMinute * billed) / 60
  setSetting(`sttUsage:${month()}`, JSON.stringify({ seconds: usage.seconds + seconds, dollars: usage.dollars + dollars, requests: usage.requests + 1 }))
  return { text: out.text, seconds }
}

/** Two seconds of silence: enough to see that the key, the model and the address work together, for a fraction of a cent. */
export async function testTranscription(actor: Actor) {
  requireRole(actor, 'owner')
  const c = config()
  if (!c) throw new OpError(409, say('Сначала подключите сервис'))
  const rate = 16000, n = rate * 2
  const wav = Buffer.alloc(44 + n * 2)
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 2, 40)
  await send(c, { bytes: wav, name: 'test.wav', mime: 'audio/wav' }, null)
  return { ok: true }
}
