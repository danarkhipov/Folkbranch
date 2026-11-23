// AI providers the owner adds by hand: any service that speaks the OpenAI protocol under its own address. The address,
// name and model are kept in the settings; the key is kept like every other AI key (encrypted, in the list of keys)
// and is bound to the address it was saved with. A key is read only while the provider's address is the one it came
// with, so no settings file, restored copy or edit can send it to another server.
import { z } from 'zod'
import { customAlphabet } from 'nanoid'
import { type Actor, OpError, requireRole } from '../ops/core'
import { getSetting, setSetting, tell } from '../ops/settings'
import { vaultKey, writeKey } from './keys'
import { checkBaseUrl, keyOptional, safeFetch, type UrlProblem } from './safe-url'
import { refuseInDemo } from '../demo-mode'

export interface CustomProvider { id: string; name: string; baseUrl: string; model: string; note: string }

const SETTING = 'customProviders'
const ID = /^custom-[a-z0-9]{10}$/
const newId = () => `custom-${customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 10)()}`
export const isCustomId = (id: string | null | undefined): boolean => !!id && ID.test(id)

const stored = z.array(z.object({ id: z.string().regex(ID), name: z.string().max(80), baseUrl: z.string().max(300), model: z.string().max(200), note: z.string().max(300).default('') }))

export function readCustom(): CustomProvider[] {
  try {
    const parsed = stored.safeParse(JSON.parse(getSetting(SETTING) ?? '[]'))
    // An address that no longer passes the check (a hand-edited or restored list) is left out, never called.
    return parsed.success ? parsed.data.filter((p) => checkBaseUrl(p.baseUrl).ok) : []
  } catch {
    return []
  }
}

const writeCustom = (list: CustomProvider[]) => setSetting(SETTING, JSON.stringify(list))
export const customById = (id: string) => readCustom().find((p) => p.id === id) ?? null

/** The key, only where it was saved for this very address. Null when there is none, or it belongs to another address. */
export function customKey(p: CustomProvider): string | null {
  const entry = vaultKey(p.id)
  return entry && entry.baseUrl === p.baseUrl ? entry.key : null
}

/** Whether the provider can be called now: a key bound to its address, or no key needed on this machine or a home network. */
export const customUsable = (p: CustomProvider) => !!customKey(p) || (keyOptional(p.baseUrl) && !vaultKey(p.id))

/** What the owner sees of one: never the key, only whether there is one for this address. */
export const describe = (p: CustomProvider, activeId: string | null) => ({
  id: p.id, name: p.name, baseUrl: p.baseUrl, model: p.model, note: p.note,
  hasKey: !!customKey(p),
  // A key that was saved for another address stays unread, and the form asks for it again.
  keyNeeded: !customUsable(p),
  active: activeId === p.id,
})

export function listCustom(actor: Actor) {
  requireRole(actor, 'owner')
  const active = getSetting('agentProvider')
  return readCustom().map((p) => describe(p, active))
}

const fields = z.object({
  id: z.string().regex(ID).optional(),
  name: z.string().trim().min(1, 'name').max(60),
  baseUrl: z.string().trim().min(1).max(300),
  /** Left out when the saved key stays; sent when it is new. Never read back. */
  key: z.string().trim().max(500).optional(),
  model: z.string().trim().min(1).max(200),
  note: z.string().trim().max(300).optional(),
})

/** An address's problem in words that say what to change. */
const PROBLEM_TEXT: Record<UrlProblem, () => string> = {
  form: () => tell('That is not a web address. It looks like https://host/v1'),
  scheme: () => tell('The address must start with https://'),
  credentials: () => tell('Leave the name and password out of the address: the key has its own field'),
  insecure: () => tell('The address must start with https://. Only a server on this computer or your home network may use http://'),
  forbidden: () => tell('This address cannot be used: it leads to the machine’s own services'),
  self: () => tell('This address is this app itself'),
}

const addressOrThrow = (raw: string) => {
  const c = checkBaseUrl(raw)
  if (!c.ok) throw new OpError(400, PROBLEM_TEXT[c.problem]())
  return c.url
}

/** Adds a provider, or changes one. The address is only changed together with the key. */
export function saveCustom(actor: Actor, raw: unknown) {
  refuseInDemo()
  requireRole(actor, 'owner')
  const parsed = fields.safeParse(raw)
  if (!parsed.success) throw new OpError(400, tell('Give a name, an address and a model'))
  const b = parsed.data
  const baseUrl = addressOrThrow(b.baseUrl)
  const list = readCustom()
  const before = b.id ? list.find((p) => p.id === b.id) : null
  if (b.id && !before) throw new OpError(404, tell('This provider is not in the list'))
  if (!before && list.length >= 20) throw new OpError(400, tell('That is enough providers: remove one first'))
  const entry = before ? vaultKey(before.id) : null
  const key = b.key || undefined
  // The key was saved for the old address: it is not carried to a new one, whatever the form says.
  if (before && before.baseUrl !== baseUrl && entry && !key) throw new OpError(400, tell('The address changed: enter the key again'))
  if (!key && !keyOptional(baseUrl) && !(before && before.baseUrl === baseUrl && entry)) throw new OpError(400, tell('This provider needs a key'))
  const id = before?.id ?? newId()
  const next: CustomProvider = { id, name: b.name, baseUrl, model: b.model, note: b.note ?? '' }
  writeCustom(before ? list.map((p) => (p.id === id ? next : p)) : [...list, next])
  if (key) writeKey(id, { key, baseUrl })
  // A changed address with no key to bring along must not leave the old key behind, even unread.
  else if (before && before.baseUrl !== baseUrl) writeKey(id, null)
  return describe(next, getSetting('agentProvider'))
}

/** Removes the provider and its key. The caller switches the assistant off if it was this one. */
export function removeCustom(actor: Actor, id: string) {
  refuseInDemo()
  requireRole(actor, 'owner')
  if (!isCustomId(id) || !customById(id)) throw new OpError(404, tell('This provider is not in the list'))
  writeCustom(readCustom().filter((p) => p.id !== id))
  writeKey(id, null)
}

// ── Looking at the provider: its models and one small request ─────────────────────────────────────────

const TIMEOUT = 20_000
const join = (base: string, path: string) => `${base}${path}`

const probeInput = z.object({
  id: z.string().regex(ID).optional(),
  baseUrl: z.string().trim().max(300).optional(),
  key: z.string().trim().max(500).optional(),
  model: z.string().trim().max(200).optional(),
})

/** The address and key to use: a saved provider's own (an unchanged address only), or what the form holds. */
function target(raw: unknown) {
  const b = probeInput.safeParse(raw)
  if (!b.success) throw new OpError(400, tell('Give a name, an address and a model'))
  const saved = b.data.id ? customById(b.data.id) : null
  if (b.data.id && !saved) throw new OpError(404, tell('This provider is not in the list'))
  const baseUrl = addressOrThrow(b.data.baseUrl || saved?.baseUrl || '')
  // A saved key goes only to the address it was saved for. A different address needs its own key from the form.
  const key = b.data.key || (saved && saved.baseUrl === baseUrl ? customKey(saved) : null) || null
  return { baseUrl, key, model: b.data.model || saved?.model || '' }
}

const headersFor = (key: string | null): Record<string, string> => ({ 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) })

/** The models the server lists, so one can be picked. A failure is not an error: the name can be typed. */
export async function customModels(actor: Actor, raw: unknown): Promise<{ models: string[]; listed: boolean }> {
  refuseInDemo()
  requireRole(actor, 'owner')
  const { baseUrl, key } = target(raw)
  try {
    const res = await safeFetch(join(baseUrl, '/models'), { headers: headersFor(key), signal: AbortSignal.timeout(TIMEOUT) })
    if (!res.ok) return { models: [], listed: false }
    const body = (await res.json()) as { data?: { id?: unknown }[]; models?: { id?: unknown; name?: unknown }[] } | { id?: unknown }[]
    const rows = Array.isArray(body) ? body : (body.data ?? body.models ?? [])
    const ids = rows.map((m) => (typeof m?.id === 'string' ? m.id : typeof (m as { name?: unknown })?.name === 'string' ? (m as { name: string }).name : '')).filter(Boolean)
    return { models: [...new Set(ids)].sort().slice(0, 500), listed: true }
  } catch {
    return { models: [], listed: false }
  }
}

export type ProbeCode = 'ok' | 'wrong-key' | 'wrong-address' | 'model-missing' | 'no-answer' | 'no-tools' | 'refused'

const TEXT: Record<ProbeCode, () => string> = {
  ok: () => tell('The provider answered, and it can call tools. It is ready to use'),
  'wrong-key': () => tell('The provider did not accept the key. Check that it was copied whole'),
  'wrong-address': () => tell('Nothing answers at this address. Check the address, which usually ends in /v1'),
  'model-missing': () => tell('The provider does not know this model. Pick one from the list or check the name'),
  'no-answer': () => tell('The provider did not answer in time. Check the address and that the server is running'),
  'no-tools': () => tell('The provider answers, but it does not accept tools, which the assistant needs. Pick another model or provider'),
  refused: () => tell('The provider refused the request. Check the model name'),
}

/** One small request, and what it says in plain words. The key is only ever in the request's header. */
export async function testCustom(actor: Actor, raw: unknown): Promise<{ ok: boolean; code: ProbeCode; message: string }> {
  refuseInDemo()
  requireRole(actor, 'owner')
  const { baseUrl, key, model } = target(raw)
  if (!model) throw new OpError(400, tell('Give a name, an address and a model'))
  const ask = async (withTools: boolean) => {
    const res = await safeFetch(join(baseUrl, '/chat/completions'), {
      method: 'POST', headers: headersFor(key), signal: AbortSignal.timeout(TIMEOUT),
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with the word ok.' }], max_tokens: 64, stream: false, ...(withTools ? { tools: [{ type: 'function', function: { name: 'ping', description: 'Does nothing.', parameters: { type: 'object', properties: {} } } }] } : {}) }),
    })
    return { status: res.status, text: res.ok ? '' : await res.text().catch(() => '') }
  }
  const done = (code: ProbeCode) => ({ ok: code === 'ok', code, message: TEXT[code]() })
  try {
    const first = await ask(true)
    if (first.status >= 200 && first.status < 300) return done('ok')
    if (first.status === 401 || first.status === 403) return done('wrong-key')
    if (first.status === 404 && !/model/i.test(first.text)) return done('wrong-address')
    if (first.status === 404) return done('model-missing')
    if (first.status === 400 || first.status === 422) {
      if (/model/i.test(first.text) && /not found|does not exist|unknown|invalid|not supported/i.test(first.text) && !/tool|function/i.test(first.text)) return done('model-missing')
      // Asked again without the tool: if that works, the server just does not take tools.
      const plain = await ask(false)
      return done(plain.status >= 200 && plain.status < 300 ? 'no-tools' : 'refused')
    }
    return done(first.status >= 500 ? 'no-answer' : 'refused')
  } catch {
    // A refused address, a refused connection, a wrong certificate and a timeout all read as nothing answering there.
    return done('no-answer')
  }
}
