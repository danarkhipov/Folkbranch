// Ways into the archive besides an invitation link, each switched on by the owner from the app.
// Keys typed in the app are kept encrypted in the database; keys in the server's environment come first,
// so an admin's setup always wins. Nothing here lets a stranger in: every way signs in only an account
// that already exists and was linked to it by its owner.
import nodemailer from 'nodemailer'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from './db'
import { type Actor, OpError, requireRole } from './ops/core'
import { getSetting, say, setSetting } from './ops/settings'
import { publicUrl } from './public-url'
import { seal, unseal } from './sealed'

export const METHODS = ['google', 'yandex', 'vk', 'telegram', 'email'] as const
export type MethodId = (typeof METHODS)[number]

interface Field { key: string; env: string; secret?: boolean; optional?: boolean }
const FIELDS: Record<MethodId, Field[]> = {
  google: [{ key: 'clientId', env: 'GOOGLE_CLIENT_ID' }, { key: 'clientSecret', env: 'GOOGLE_CLIENT_SECRET', secret: true }],
  yandex: [{ key: 'clientId', env: 'YANDEX_CLIENT_ID' }, { key: 'clientSecret', env: 'YANDEX_CLIENT_SECRET', secret: true }],
  vk: [{ key: 'clientId', env: 'VK_CLIENT_ID' }, { key: 'clientSecret', env: 'VK_CLIENT_SECRET', secret: true }],
  telegram: [{ key: 'botToken', env: 'TELEGRAM_BOT_TOKEN', secret: true }, { key: 'botName', env: 'TELEGRAM_BOT_NAME', optional: true }],
  email: [
    { key: 'host', env: 'SMTP_HOST' }, { key: 'port', env: 'SMTP_PORT', optional: true }, { key: 'user', env: 'SMTP_USER' },
    { key: 'password', env: 'SMTP_PASSWORD', secret: true }, { key: 'from', env: 'MAIL_FROM', optional: true },
  ],
}

type Values = Record<string, string>
const settingKey = (id: MethodId) => `signIn:${id}`
const purpose = 'sign-in-method'

function fromEnv(id: MethodId): Values | null {
  const out: Values = {}
  for (const f of FIELDS[id]) {
    const v = process.env[f.env]?.trim()
    if (v) out[f.key] = v
    else if (!f.optional) return null
  }
  return out
}

function fromApp(id: MethodId): Values | null {
  const sealed = getSetting(settingKey(id))
  const text = sealed ? unseal(sealed, purpose) : null
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

/** The keys a way of signing in works with now, or null when it is off. */
export function methodConfig(id: MethodId): Values | null {
  return fromEnv(id) ?? fromApp(id)
}

// Every change makes the server build its sign-in again, with no restart.
const g = globalThis as unknown as { __signInVersion?: number }
export const methodsVersion = () => g.__signInVersion ?? 0
const changed = () => { g.__signInVersion = methodsVersion() + 1 }

/** What the sign-in page offers. The bot's name is public: Telegram shows it on its button. */
export function signInMethods() {
  const telegram = methodConfig('telegram')
  return {
    google: !!methodConfig('google'),
    yandex: !!methodConfig('yandex'),
    vk: !!methodConfig('vk'),
    telegram: telegram?.botName ?? null,
    email: !!methodConfig('email'),
  }
}
export type SignInMethods = ReturnType<typeof signInMethods>

/** The address each provider must be told to send people back to. */
export function returnAddress(id: MethodId) {
  const base = publicUrl()
  return id === 'google' || id === 'vk' || id === 'yandex' ? `${base}/api/auth/callback/${id}` : null
}

export function methodsStatus(actor: Actor) {
  requireRole(actor, 'owner')
  const base = publicUrl()
  return {
    address: base,
    domain: new URL(base).host,
    secure: base.startsWith('https://'),
    methods: METHODS.map((id) => {
      const env = fromEnv(id)
      const app = env ? null : fromApp(id)
      const values = env ?? app
      // Secrets never leave the server; their last characters say which one is set.
      const shown = values ? Object.fromEntries(FIELDS[id].filter((f) => values[f.key]).map((f) => [f.key, f.secret ? `…${values[f.key].slice(-4)}` : values[f.key]])) : {}
      return { id, on: !!values, source: env ? 'server' as const : app ? 'app' as const : null, values: shown, returnAddress: returnAddress(id), env: FIELDS[id].map((f) => f.env) }
    }),
  }
}

const text = (max: number) => z.string().trim().min(1).max(max)
const INPUT: Record<MethodId, z.ZodType<Values>> = {
  google: z.object({ clientId: text(200).regex(/\.apps\.googleusercontent\.com$/, 'Client ID ends in .apps.googleusercontent.com'), clientSecret: text(200) }),
  yandex: z.object({ clientId: text(100).regex(/^[0-9a-f]{32}$/i, 'ClientID is 32 letters and digits'), clientSecret: text(100) }),
  vk: z.object({ clientId: text(20).regex(/^\d+$/, 'the app ID is digits only'), clientSecret: text(200) }),
  telegram: z.object({ botToken: text(100).regex(/^\d+:[\w-]{30,}$/, 'the token looks like 123456:ABC…') }),
  email: z.object({
    host: text(200), port: z.string().trim().regex(/^\d{2,5}$/).default('465'), user: text(200),
    password: text(200), from: z.string().trim().max(200).optional(),
  }),
}

/** Asks Telegram who the bot is: a wrong token is refused here, not when a relative tries to sign in. */
async function telegramBot(token: string) {
  const r = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(10_000) }).catch(() => null)
  const body = r ? await r.json().catch(() => null) : null
  if (!body?.ok) throw new OpError(400, say('Telegram не узнал этот токен. Скопируйте его из @BotFather ещё раз'))
  return String(body.result.username)
}

export function mailer(v: Values) {
  const port = Number(v.port || 465)
  return nodemailer.createTransport({ host: v.host, port, secure: port === 465, auth: { user: v.user, pass: v.password }, connectionTimeout: 15_000 })
}

async function checkMail(v: Values) {
  try {
    await mailer(v).verify()
  } catch (e) {
    const { responseCode, code } = e as { responseCode?: number; code?: string }
    if (responseCode === 535 || responseCode === 534) throw new OpError(400, say('Почтовый сервер не принял логин или пароль. Нужен пароль приложения, а не пароль от почты'))
    if (code && ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'EDNS'].includes(code)) throw new OpError(400, say('Почтовый сервер не отвечает. Проверьте адрес сервера и порт'))
    throw new OpError(400, `${say('Не получилось подключиться к почтовому серверу')}: ${(e as Error).message}`)
  }
}

/** Nothing is stored until it is checked where it can be: Telegram and the mail server are asked first. */
export async function saveMethod(actor: Actor, id: MethodId, raw: unknown) {
  requireRole(actor, 'owner')
  if (fromEnv(id)) throw new OpError(409, say('Этот способ входа задан в настройках сервера'))
  const parsed = INPUT[id].safeParse(raw)
  if (!parsed.success) throw new OpError(400, parsed.error.issues.map((i) => i.message).join('; '))
  const values: Values = { ...parsed.data }
  if (id === 'telegram') values.botName = await telegramBot(values.botToken)
  if (id === 'email') {
    await checkMail(values)
    if (!values.from) values.from = values.user
  }
  setSetting(settingKey(id), seal(JSON.stringify(values), purpose))
  changed()
  return methodsStatus(actor)
}

export function removeMethod(actor: Actor, id: MethodId) {
  requireRole(actor, 'owner')
  if (fromEnv(id)) throw new OpError(409, say('Этот способ входа задан в настройках сервера'))
  getDb().delete(schema.settings).where(eq(schema.settings.key, settingKey(id))).run()
  changed()
  return methodsStatus(actor)
}

/** A sign-in code by mail, in the archive's language. */
export async function sendCode(to: string, code: string) {
  const v = methodConfig('email')
  if (!v) throw new OpError(409, say('Вход по почте не настроен'))
  const family = getSetting('familyName') || say('Семейный архив')
  await mailer(v).sendMail({
    from: v.from || v.user,
    to,
    subject: `${say('Код для входа')}: ${code}`,
    text: `${say('Код для входа в архив')} «${family}»: ${code}\n\n${say('Он действует 10 минут. Если вы не просили код, ничего делать не нужно.')}`,
  })
}
