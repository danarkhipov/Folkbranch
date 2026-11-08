// A provider's key set from the app: checked with the provider, then kept encrypted in the database.
// A key in the server's environment comes first, so an admin's setup always wins.
import { z } from 'zod'
import { seal as sealWith, unseal as unsealWith } from '../sealed'
import { type Actor, OpError, requireRole } from '../ops/core'
import { getSetting, say, setSetting } from '../ops/settings'
import { getDb, schema } from '../db'
import { eq } from 'drizzle-orm'
import { type LiveModel, newestFirst, PARSERS } from './models'
import { lineOf, LINES, newestOfLine } from './lines'
import { PRESETS, type PresetId } from './presets'
import { activeProvider, keyEnvOf } from './provider'

const seal = (text: string) => sealWith(text, 'provider-key')
const unseal = (sealed: string) => unsealWith(sealed, 'provider-key')

function saved() {
  const id = getSetting('agentProvider') as PresetId | null
  const sealed = getSetting('agentKey')
  const key = sealed ? unseal(sealed) : null
  return id && key ? { id, key, model: getSetting('agentModel') ?? undefined, folder: getSetting('agentFolder') ?? undefined } : null
}

/** What answers now: the environment's provider, or the one set in the app. */
export function currentProvider() {
  const fromEnv = activeProvider(process.env)
  if (fromEnv) return fromEnv
  const s = saved()
  if (s && getSetting('agentAuto') === '1') void refreshAutoModel()
  return s ? activeProvider({ AGENT_PROVIDER: s.id, [keyEnvOf(s.id)]: s.key, AGENT_MODEL: s.model, AGENT_FOLDER: s.folder }) : null
}

export function providerStatus(actor: Actor) {
  requireRole(actor, 'owner')
  const p = currentProvider()
  const fromEnv = !!activeProvider(process.env)
  return { connected: !!p, autoPossible: !!(p && LINES[p.id as PresetId]?.length), auto: !fromEnv && getSetting('agentAuto') === '1', provider: p?.id ?? null, label: p?.label ?? null, model: p?.model ?? null, source: !p ? null : fromEnv ? 'server' as const : 'app' as const, keyEnding: p && !fromEnv ? p.key.slice(-4) : null }
}

// How often the newest model of the line is looked for: a release is picked up within hours, and the provider is not asked on every message.
const REFRESH_EVERY = 6 * 3600_000
let refreshedAt = 0

/**
 * Keeps the model on the newest of its line that the service lists, never older than the one we tested.
 * Only for a model chosen by the app itself; one the owner picked by hand is left alone.
 */
export async function refreshAutoModel(force = false) {
  if (!force && Date.now() - refreshedAt < REFRESH_EVERY) return
  refreshedAt = Date.now()
  const s = saved()
  if (!s || getSetting('agentAuto') !== '1' || activeProvider(process.env)) return
  const line = lineOf(s.model ?? '', LINES[s.id] ?? [])
  if (!line) return
  try {
    const live = await liveModels({ id: s.id, key: s.key, folder: s.folder ?? '' }, undefined, true)
    const best = newestOfLine(live.filter((m) => m.usable).map((m) => m.id), line)
    if (best && best !== s.model) setSetting('agentModel', best)
  } catch {
    // The service could not be asked now: the model in use stays, and the next try is in a few hours.
  }
}

const CHECKS: Record<PresetId, (key: string, folder: string) => { url: string; headers: Record<string, string>; lists?: boolean }> = {
  // Reading the account or the list of models costs nothing, so a check never spends the person's money.
  openrouter: (key) => ({ url: 'https://openrouter.ai/api/v1/key', headers: { authorization: `Bearer ${key}` } }),
  anthropic: (key) => ({ url: 'https://api.anthropic.com/v1/models?limit=1000', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, lists: true }),
  openai: (key) => ({ url: 'https://api.openai.com/v1/models', headers: { authorization: `Bearer ${key}` }, lists: true }),
  yandex: (key, folder) => ({ url: 'https://ai.api.cloud.yandex.net/v1/models', headers: { authorization: `Api-Key ${key}`, 'openai-project': folder }, lists: true }),
  cloudru: (key) => ({ url: 'https://foundation-models.api.cloud.ru/v1/models', headers: { authorization: `Bearer ${key}` }, lists: true }),
  deepseek: (key) => ({ url: 'https://api.deepseek.com/models', headers: { authorization: `Bearer ${key}` }, lists: true }),
  moonshot: (key) => ({ url: 'https://api.moonshot.ai/v1/models', headers: { authorization: `Bearer ${key}` }, lists: true }),
  google: (key) => ({ url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', headers: { 'x-goog-api-key': key }, lists: true }),
}

/** One free request to the provider, and the provider's refusals in words. */
async function get(url: string, headers: Record<string, string>, timeout = 15_000) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) }).catch(() => null)
  if (!res) throw new OpError(502, say('Не удалось связаться с провайдером. Проверьте интернет на сервере и попробуйте ещё раз'))
  if (res.status === 400 || res.status === 401 || res.status === 403) throw new OpError(400, say('Провайдер не принял этот ключ. Проверьте, что он скопирован целиком'))
  if (res.status === 429) throw new OpError(429, say('Провайдер просит подождать. Попробуйте через минуту'))
  if (!res.ok) throw new OpError(502, `${say('Провайдер ответил ошибкой')}: ${res.status}`)
  return res
}

async function check(id: PresetId, key: string, model: string, folder = '') {
  const { url, headers, lists } = CHECKS[id](key, folder)
  const res = await get(url, headers)
  if (lists && !PARSERS[id](await res.json(), folder).some((m) => m.id === model)) throw new OpError(400, `${say('Этому ключу недоступна модель')} ${model}`)
  if (id === 'openrouter') await checkOpenRouterModel(model)
}

/** The public list costs nothing. If it cannot be read, the model's first answer will say. */
async function checkOpenRouterModel(model: string) {
  const list = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(15_000) }).then((r) => r.json()).catch(() => null)
  if (!Array.isArray(list?.data)) return
  const found = list.data.find((m: { id: string }) => m.id === model)
  if (!found) throw new OpError(400, `${say('Этому ключу недоступна модель')} ${model}`)
  if (!found.supported_parameters?.includes('tools')) throw new OpError(400, `${say('Модель не умеет вызывать инструменты')}: ${model}`)
}

// The provider's list is read again after ten minutes, so a model released today is offered today.
const listed = new Map<string, { at: number; models: LiveModel[] }>()

async function liveModels(p: { id: PresetId; key: string; folder: string }, timeout?: number, fresh = false): Promise<LiveModel[]> {
  const name = `${p.id}:${p.key.slice(-6)}:${p.folder}`
  const hit = listed.get(name)
  if (hit && !fresh && Date.now() - hit.at < 10 * 60_000) return hit.models
  const { url, headers } = p.id === 'openrouter' ? { url: 'https://openrouter.ai/api/v1/models', headers: {} } : CHECKS[p.id](p.key, p.folder)
  const models = PARSERS[p.id](await (await get(url, headers, timeout)).json(), p.folder)
  listed.set(name, { at: Date.now(), models })
  return models
}

/** Every model the connected key can use for the assistant, newest first, with what the provider says it can do. */
export async function modelChoices(actor: Actor) {
  requireRole(actor, 'owner')
  const p = currentProvider()
  if (!p || p.id === 'local') return { current: p?.model ?? null, models: [] as LiveModel[] }
  const all = await liveModels({ id: p.id as PresetId, key: p.key, folder: p.folder })
  return { current: p.model, models: newestFirst(all.filter((m) => m.usable || m.id === p.model)).slice(0, 500) }
}

/** Whether the model answering now takes pictures: null when the provider does not say or cannot be reached. */
export async function modelSees(): Promise<boolean | null> {
  const p = currentProvider()
  if (!p || p.id === 'local') return null
  try {
    return (await liveModels({ id: p.id as PresetId, key: p.key, folder: p.folder }, 4_000)).find((m) => m.id === p.model)?.vision ?? null
  } catch {
    return null
  }
}

/** Another model for the key already saved. */
export async function chooseModel(actor: Actor, raw: unknown) {
  requireRole(actor, 'owner')
  const { model, auto } = z.object({ model: z.string().trim().min(1).max(120).optional(), auto: z.boolean().optional() }).parse(raw)
  if (activeProvider(process.env)) throw new OpError(409, say('Модель задана в настройках сервера'))
  const s = saved()
  if (!s) throw new OpError(409, say('Сначала подключите провайдера'))
  if (auto) {
    // Back to the tested default of the service; the newest of its line is then found by itself.
    const first = PRESETS.find((p) => p.id === s.id)!.models[0].id
    if (!LINES[s.id]?.length) throw new OpError(400, say('Для этого сервиса автоматический выбор не настроен'))
    setSetting('agentModel', lineOf(s.model ?? '', LINES[s.id]!) ? s.model! : first)
    setSetting('agentAuto', '1')
    await refreshAutoModel(true)
    return providerStatus(actor)
  }
  if (!model) throw new OpError(400, 'model or auto required')
  await check(s.id, s.key, model, s.folder)
  setSetting('agentModel', model)
  setSetting('agentAuto', '0')
  return providerStatus(actor)
}

export const connectInput = z.object({
  provider: z.enum(['openrouter', 'anthropic', 'openai', 'google', 'yandex', 'cloudru', 'deepseek', 'moonshot']),
  key: z.string().trim().min(10, 'the key is too short').max(500),
  model: z.string().trim().min(1).max(120).optional(),
  /** Yandex only: the folder the key's service account belongs to. */
  folder: z.string().trim().regex(/^[a-z0-9]{10,30}$/, 'the folder ID is letters and digits').optional(),
})

/** Nothing is stored until the provider has accepted the key. */
export async function connectProvider(actor: Actor, raw: unknown) {
  requireRole(actor, 'owner')
  const input = connectInput.parse(raw)
  const model = input.model || PRESETS.find((p) => p.id === input.provider)!.models[0].id
  const folder = input.provider === 'yandex' ? input.folder : undefined
  if (input.provider === 'yandex' && !folder) throw new OpError(400, say('Укажите идентификатор каталога Яндекса'))
  await check(input.provider, input.key, model, folder)
  getDb().delete(schema.settings).where(eq(schema.settings.key, 'agentFolder')).run()
  if (folder) setSetting('agentFolder', folder)
  setSetting('agentProvider', input.provider)
  setSetting('agentKey', seal(input.key))
  setSetting('agentModel', model)
  // No model named: the tested one is the floor, and the newest of its line is taken from then on.
  setSetting('agentAuto', !input.model && LINES[input.provider]?.length ? '1' : '0')
  setSetting('assistantEnabled', '1')
  if (getSetting('agentAuto') === '1') await refreshAutoModel(true)
  return providerStatus(actor)
}

export function disconnectProvider(actor: Actor) {
  requireRole(actor, 'owner')
  for (const key of ['agentProvider', 'agentKey', 'agentModel', 'agentFolder', 'agentAuto']) getDb().delete(schema.settings).where(eq(schema.settings.key, key)).run()
  return providerStatus(actor)
}

/** What went wrong with a request to the model, in words that say what to do. */
export function providerFailure(e: unknown): string | null {
  const failure = (e as { lastError?: unknown })?.lastError ?? e
  const status = (failure as { statusCode?: number })?.statusCode
  if (status === 401 || status === 403) return say('Провайдер не принял ключ. Замените его в настройках, вкладка «Нейросеть»')
  if (status === 402) return say('На счёте провайдера закончились деньги. Пополните его, и ассистент снова заработает')
  if (status === 404) return say('Провайдер не нашёл эту модель. Выберите другую в настройках, вкладка «Нейросеть»')
  if (status === 429) return say('Провайдер просит подождать: слишком много запросов. Попробуйте через минуту')
  if (status && status >= 500) return say('У провайдера сбой. Попробуйте через несколько минут')
  return null
}
