// A provider's key set from the app: checked with the provider, then kept encrypted in the database.
// A key in the server's environment comes first, so an admin's setup always wins.
import { dailyLimit, tokensToday } from './limits'
import { monthTotal } from '../ai/usage'
import { z } from 'zod'
import { type Actor, OpError, requireRole } from '../ops/core'
import { getSetting, tell, setSetting } from '../ops/settings'
import { getDb, schema } from '../db'
import { eq } from 'drizzle-orm'
import { type LiveModel, newestFirst, PARSERS } from './models'
import { lineOf, LINES, newestOfLine } from './lines'
import { PRESETS, type PresetId } from './presets'
import { activeProvider, keyEnvOf } from './provider'
import { dropOldCopy, vaultKey, writeKey } from '../ai/keys'


/** The service the assistant uses, with its key from the owner's list of keys. */
function saved() {
  const id = getSetting('agentProvider') as PresetId | null
  const entry = id ? vaultKey(id) : null
  return id && entry ? { id, key: entry.key, model: getSetting('agentModel') ?? undefined, folder: entry.folder } : null
}

/** What a person may pick in the assistant for one answer: each service with a key, and its tested models. */
export function answerChoices() {
  if (activeProvider(process.env)) return []
  const current = saved()
  return PRESETS.filter((p) => vaultKey(p.id)).flatMap((p) => {
    // A model the provider no longer lists is not offered: the tested list ages, the provider's own list does not.
    const entry = vaultKey(p.id)!
    const live = listed.get(`${p.id}:${entry.key.slice(-6)}:${entry.folder ?? ''}`)?.models
    const models = p.models.filter((m) => !live?.length || live.some((x) => x.id === m.id)).map((m) => ({ id: m.id, label: m.label }))
    if (current?.id === p.id && current.model && !models.some((m) => m.id === current.model)) models.unshift({ id: current.model, label: current.model })
    return models.map((m) => ({ provider: p.id, label: p.label, model: m.id, modelLabel: m.label, current: current?.id === p.id && current.model === m.id, autoPossible: !!LINES[p.id]?.length }))
  })
}

/** A service from the list of keys as the assistant would use it, for one answer someone picked. */
export function providerFor(id: string, model: string) {
  if (!answerChoices().some((c) => c.provider === id && c.model === model)) return null
  const entry = vaultKey(id)
  return entry ? activeProvider({ AGENT_PROVIDER: id, [keyEnvOf(id as PresetId)]: entry.key, AGENT_MODEL: model, AGENT_FOLDER: entry.folder }) : null
}

/** What answers now: the environment's provider, or the one set in the app. */
export function currentProvider() {
  const fromEnv = activeProvider(process.env)
  if (fromEnv) return fromEnv
  const s = saved()
  if (s && getSetting('agentAuto') === '1') void refreshAutoModel()
  return s ? activeProvider({ AGENT_PROVIDER: s.id, [keyEnvOf(s.id)]: s.key, AGENT_MODEL: s.model, AGENT_FOLDER: s.folder }) : null
}

/** Only OpenRouter tells an ordinary key what is left on it; the others keep that in their own account pages. Reading it costs nothing. */
export async function keyBalance(actor: Actor) {
  requireRole(actor, 'owner')
  const p = currentProvider()
  if (p?.id !== 'openrouter' || activeProvider(process.env)) return null
  const r = await fetch('https://openrouter.ai/api/v1/key', { headers: { authorization: `Bearer ${p.key}` }, signal: AbortSignal.timeout(8_000) }).catch(() => null)
  const d = r?.ok ? ((await r.json().catch(() => null)) as { data?: { limit_remaining?: number | null; usage_monthly?: number } } | null)?.data : null
  return d ? { remaining: d.limit_remaining ?? null, spentThisMonth: d.usage_monthly ?? null } : null
}

export function providerStatus(actor: Actor) {
  requireRole(actor, 'owner')
  const p = currentProvider()
  const fromEnv = !!activeProvider(process.env)
  return { connected: !!p, autoPossible: !!(p && LINES[p.id as PresetId]?.length), auto: !fromEnv && getSetting('agentAuto') === '1', provider: p?.id ?? null, label: p?.label ?? null, model: p?.model ?? null, source: !p ? null : fromEnv ? 'server' as const : 'app' as const, keyEnding: p && !fromEnv ? p.key.slice(-4) : null, tokensToday: tokensToday(), dailyLimit: dailyLimit(), month: monthTotal('assistant') }
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

/**
 * When the service no longer lists the model in use, another takes its place: the newest of its line, else a tested
 * model of the service. Only for a key set in the app; the server's own setting is the admin's to change.
 */
export async function replaceMissingModel(force = false) {
  const s = saved()
  if (!s || activeProvider(process.env)) return
  try {
    const live = (await liveModels({ id: s.id, key: s.key, folder: s.folder ?? '' }, 4_000, force)).filter((m) => m.usable)
    // An empty list means we could not read it, not that every model is gone.
    if (!live.length || live.some((m) => m.id === s.model)) return
    const ids = live.map((m) => m.id)
    const line = lineOf(s.model ?? '', LINES[s.id] ?? [])
    const next = (line && newestOfLine(ids, line)) ?? PRESETS.find((p) => p.id === s.id)?.models.find((m) => ids.includes(m.id))?.id
    if (next) setSetting('agentModel', next)
  } catch {
    // The service could not be asked now: the next message tries again.
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
  if (!res) throw new OpError(502, tell('Не удалось связаться с провайдером. Проверьте интернет на сервере и попробуйте ещё раз'))
  if (res.status === 400 || res.status === 401 || res.status === 403) throw new OpError(400, tell('Провайдер не принял этот ключ. Проверьте, что он скопирован целиком'))
  if (res.status === 429) throw new OpError(429, tell('Провайдер просит подождать. Попробуйте через минуту'))
  if (!res.ok) throw new OpError(502, `${tell('Провайдер ответил ошибкой')}: ${res.status}`)
  return res
}

/** The key alone: the service accepts it. Which model it may use is checked when the assistant is set to one. */
export async function checkServiceKey(id: PresetId, key: string, folder = '') {
  const { url, headers } = CHECKS[id](key, folder)
  await get(url, headers)
  if (id === 'cloudru') await checkCloudRuKey(key)
}

export async function check(id: PresetId, key: string, model: string, folder = '') {
  const { url, headers, lists } = CHECKS[id](key, folder)
  const res = await get(url, headers)
  if (lists && !PARSERS[id](await res.json(), folder).some((m) => m.id === model)) throw new OpError(400, `${tell('Этому ключу недоступна модель')} ${model}`)
  if (id === 'openrouter') await checkOpenRouterModel(model)
  if (id === 'cloudru') await checkCloudRuKey(key)
}

/** Cloud.ru lists its models to anyone, so the list proves nothing. An empty request is refused before any model runs, and says whether the key was the reason. */
async function checkCloudRuKey(key: string) {
  const res = await fetch('https://foundation-models.api.cloud.ru/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15_000) }).catch(() => null)
  if (!res) throw new OpError(502, tell('Не удалось связаться с провайдером. Проверьте интернет на сервере и попробуйте ещё раз'))
  if (res.status === 401 || res.status === 403 || /api key|unauthori[sz]ed|invalid token|authenticat|credential/i.test(await res.text().catch(() => ''))) throw new OpError(400, tell('Провайдер не принял этот ключ. Проверьте, что он скопирован целиком'))
}

/** The public list costs nothing. If it cannot be read, the model's first answer will say. */
async function checkOpenRouterModel(model: string) {
  const list = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(15_000) }).then((r) => r.json()).catch(() => null)
  if (!Array.isArray(list?.data)) return
  const found = list.data.find((m: { id: string }) => m.id === model)
  if (!found) throw new OpError(400, `${tell('Этому ключу недоступна модель')} ${model}`)
  if (!found.supported_parameters?.includes('tools')) throw new OpError(400, `${tell('Модель не умеет вызывать инструменты')}: ${model}`)
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
export async function modelSees(provider?: { id: string; key: string; folder: string; model: string }): Promise<boolean | null> {
  const p = provider ?? currentProvider()
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
  const { model, auto, provider } = z.object({ model: z.string().trim().min(1).max(120).optional(), auto: z.boolean().optional(), provider: z.enum(PRESETS.map((p) => p.id) as [PresetId, ...PresetId[]]).optional() }).parse(raw)
  if (activeProvider(process.env)) throw new OpError(409, tell('Модель задана в настройках сервера'))
  // Another service from the list of keys: its tested model, unless one is named.
  if (provider && provider !== getSetting('agentProvider')) {
    const entry = vaultKey(provider)
    if (!entry) throw new OpError(400, tell('Сначала добавьте ключ этого сервиса'))
    if (model) await check(provider, entry.key, model, entry.folder)
    // The previous version's key was for the old service: kept, it would be read as this one's.
    dropOldCopy()
    setSetting('agentProvider', provider)
    setSetting('agentModel', model ?? PRESETS.find((p) => p.id === provider)!.models[0].id)
    setSetting('agentAuto', !model && LINES[provider]?.length ? '1' : '0')
    // Picking a service for the assistant is asking for it to answer.
    setSetting('assistantEnabled', '1')
    if (getSetting('agentAuto') === '1') await refreshAutoModel(true)
    return providerStatus(actor)
  }
  const s = saved()
  if (!s) throw new OpError(409, tell('Сначала подключите провайдера'))
  if (auto) {
    // Back to the tested default of the service; the newest of its line is then found by itself.
    const first = PRESETS.find((p) => p.id === s.id)!.models[0].id
    if (!LINES[s.id]?.length) throw new OpError(400, tell('Для этого сервиса автоматический выбор не настроен'))
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
  if (input.provider === 'yandex' && !folder) throw new OpError(400, tell('Укажите идентификатор каталога Яндекса'))
  await check(input.provider, input.key, model, folder)
  writeKey(input.provider, { key: input.key, folder })
  setSetting('agentProvider', input.provider)
  setSetting('agentModel', model)
  // No model named: the tested one is the floor, and the newest of its line is taken from then on.
  setSetting('agentAuto', !input.model && LINES[input.provider]?.length ? '1' : '0')
  setSetting('assistantEnabled', '1')
  if (getSetting('agentAuto') === '1') await refreshAutoModel(true)
  return providerStatus(actor)
}

export function disconnectProvider(actor: Actor) {
  requireRole(actor, 'owner')
  // The key stays in the list for the other functions; it is removed there, under Providers.
  for (const key of ['agentProvider', 'agentKey', 'agentModel', 'agentFolder', 'agentAuto']) getDb().delete(schema.settings).where(eq(schema.settings.key, key)).run()
  return providerStatus(actor)
}

/** What went wrong with a request to the model, in words that say what to do. */
export function providerFailure(e: unknown): string | null {
  const failure = (e as { lastError?: unknown })?.lastError ?? e
  const status = (failure as { statusCode?: number })?.statusCode
  // The cause stays in the server log, without the conversation: a provider that changed its API shows up here.
  const f = failure as { url?: string; responseBody?: string; message?: string }
  console.error(`assistant: provider answered ${status ?? 'with an error'} ${f.url ?? ''} ${(f.responseBody ?? f.message ?? '').slice(0, 300)}`)
  if (status === 404) void replaceMissingModel(true)
  if (status === 401 || status === 403) return tell('Провайдер не принял ключ. Замените его в настройках, вкладка «Нейросеть»')
  if (status === 402) return tell('На счёте провайдера закончились деньги. Пополните его, и ассистент снова заработает')
  // A model set in the server's environment is the admin's to change: the app replaces only one chosen in the app.
  if (status === 404) return activeProvider(process.env) ? tell('Провайдер не нашёл модель из настроек сервера. Укажите другую в AGENT_MODEL и перезапустите сервер') : tell('Провайдер не нашёл эту модель. Мы подобрали другую, повторите вопрос')
  if (status === 400) return tell('Провайдер не принял запрос, возможно, он изменил свой API. Подробности в журнале сервера')
  if (status === 429) return tell('Провайдер просит подождать: слишком много запросов. Попробуйте через минуту')
  if (status && status >= 500) return tell('У провайдера сбой. Попробуйте через несколько минут')
  return null
}
