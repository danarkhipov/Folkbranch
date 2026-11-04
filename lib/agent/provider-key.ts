// A provider's key set from the app: checked with the provider, then kept encrypted in the database.
// A key in the server's environment comes first, so an admin's setup always wins.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { serverSecret } from '../server-secret'
import { type Actor, OpError, requireRole } from '../ops/core'
import { getSetting, say, setSetting } from '../ops/settings'
import { getDb, schema } from '../db'
import { eq } from 'drizzle-orm'
import { PRESETS, type PresetId } from './presets'
import { activeProvider, keyEnvOf } from './provider'

const box = () => createHash('sha256').update(`provider-key:${serverSecret()}`).digest()

function seal(text: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', box(), iv)
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64')).join('.')
}

/** Null when the server's secret has changed since: the person is then asked for the key again. */
function unseal(sealed: string) {
  try {
    const [iv, tag, body] = sealed.split('.').map((p) => Buffer.from(p, 'base64'))
    const decipher = createDecipheriv('aes-256-gcm', box(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

function saved() {
  const id = getSetting('agentProvider') as PresetId | null
  const sealed = getSetting('agentKey')
  const key = sealed ? unseal(sealed) : null
  return id && key ? { id, key, model: getSetting('agentModel') ?? undefined } : null
}

/** What answers now: the environment's provider, or the one set in the app. */
export function currentProvider() {
  const fromEnv = activeProvider(process.env)
  if (fromEnv) return fromEnv
  const s = saved()
  return s ? activeProvider({ AGENT_PROVIDER: s.id, [keyEnvOf(s.id)]: s.key, AGENT_MODEL: s.model }) : null
}

export function providerStatus(actor: Actor) {
  requireRole(actor, 'owner')
  const p = currentProvider()
  const fromEnv = !!activeProvider(process.env)
  return { connected: !!p, provider: p?.id ?? null, label: p?.label ?? null, model: p?.model ?? null, source: !p ? null : fromEnv ? 'server' as const : 'app' as const, keyEnding: p && !fromEnv ? p.key.slice(-4) : null }
}

const CHECKS: Record<PresetId, (key: string) => { url: string; headers: Record<string, string>; ids?: (body: any) => string[] }> = {
  // Reading the account or the list of models costs nothing, so a check never spends the person's money.
  openrouter: (key) => ({ url: 'https://openrouter.ai/api/v1/key', headers: { authorization: `Bearer ${key}` } }),
  anthropic: (key) => ({ url: 'https://api.anthropic.com/v1/models?limit=1000', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, ids: (b) => b.data.map((m: { id: string }) => m.id) }),
  openai: (key) => ({ url: 'https://api.openai.com/v1/models', headers: { authorization: `Bearer ${key}` }, ids: (b) => b.data.map((m: { id: string }) => m.id) }),
  google: (key) => ({ url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', headers: { 'x-goog-api-key': key }, ids: (b) => b.models.map((m: { name: string }) => m.name.replace(/^models\//, '')) }),
}

async function check(id: PresetId, key: string, model: string) {
  const { url, headers, ids } = CHECKS[id](key)
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) }).catch(() => null)
  if (!res) throw new OpError(502, say('Не удалось связаться с провайдером. Проверьте интернет на сервере и попробуйте ещё раз'))
  if (res.status === 400 || res.status === 401 || res.status === 403) throw new OpError(400, say('Провайдер не принял этот ключ. Проверьте, что он скопирован целиком'))
  if (res.status === 429) throw new OpError(429, say('Провайдер просит подождать. Попробуйте через минуту'))
  if (!res.ok) throw new OpError(502, `${say('Провайдер ответил ошибкой')}: ${res.status}`)
  if (ids && !ids(await res.json()).includes(model)) throw new OpError(400, `${say('Этому ключу недоступна модель')} ${model}`)
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

/** Another model for the key already saved. */
export async function chooseModel(actor: Actor, raw: unknown) {
  requireRole(actor, 'owner')
  const { model } = z.object({ model: z.string().trim().min(1).max(120) }).parse(raw)
  if (activeProvider(process.env)) throw new OpError(409, say('Модель задана в настройках сервера'))
  const s = saved()
  if (!s) throw new OpError(409, say('Сначала подключите провайдера'))
  await check(s.id, s.key, model)
  setSetting('agentModel', model)
  return providerStatus(actor)
}

export const connectInput = z.object({
  provider: z.enum(['openrouter', 'anthropic', 'openai', 'google']),
  key: z.string().trim().min(10, 'the key is too short').max(500),
  model: z.string().trim().min(1).max(120).optional(),
})

/** Nothing is stored until the provider has accepted the key. */
export async function connectProvider(actor: Actor, raw: unknown) {
  requireRole(actor, 'owner')
  const input = connectInput.parse(raw)
  const model = input.model || PRESETS.find((p) => p.id === input.provider)!.models[0].id
  await check(input.provider, input.key, model)
  setSetting('agentProvider', input.provider)
  setSetting('agentKey', seal(input.key))
  setSetting('agentModel', model)
  setSetting('assistantEnabled', '1')
  return providerStatus(actor)
}

export function disconnectProvider(actor: Actor) {
  requireRole(actor, 'owner')
  for (const key of ['agentProvider', 'agentKey', 'agentModel']) getDb().delete(schema.settings).where(eq(schema.settings.key, key)).run()
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
