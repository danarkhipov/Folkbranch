// Ways into the archive besides an invitation: set by the owner, kept secret, and never a way for a stranger in.
import { createHash, createHmac } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Actor } from '../lib/ops/core'
import { checkTelegram } from '../lib/telegram-login'

const sent: { to: string; text: string }[] = []
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ verify: async () => true, sendMail: async (m: { to: string; text: string }) => { sent.push(m) } }) },
}))

const owner: Actor = { userId: 'o', name: 'Owner', role: 'owner', personId: null }
const editor: Actor = { userId: 'e', name: 'Editor', role: 'editor', personId: null }
const BOT = '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij'
const ORIGIN = 'http://localhost:3417'

function signed(data: Record<string, string | number>, token = BOT) {
  const check = Object.keys(data).sort().map((k) => `${k}=${data[k]}`).join('\n')
  const hash = createHmac('sha256', createHash('sha256').update(token).digest()).update(check).digest('hex')
  return { ...data, hash }
}

let m: typeof import('../lib/sign-in-methods')
let auth: typeof import('../lib/auth')
beforeAll(async () => {
  m = await import('../lib/sign-in-methods')
  auth = await import('../lib/auth')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

const call = (path: string, body: unknown, cookie = '') => auth.getAuth().handler(new Request(`${ORIGIN}/api/auth${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
}))
const cookieOf = (r: Response) => r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')

describe('Telegram sign-in data', () => {
  const now = Date.now()
  const data = { id: 42, first_name: 'Анна', auth_date: Math.floor(now / 1000) }
  it('takes what the bot signed', () => expect(checkTelegram(signed(data), BOT, now)).toBe('42'))
  it('refuses anything altered', () => expect(checkTelegram({ ...signed(data), id: 43 }, BOT, now)).toBeNull())
  it('refuses another bot', () => expect(checkTelegram(signed(data, '999:other-token-of-another-bot-xxxxxxxxx'), BOT, now)).toBeNull())
  it('refuses what is older than a day', () => expect(checkTelegram(signed({ ...data, auth_date: Math.floor(now / 1000) - 2 * 86400 }), BOT, now)).toBeNull())
})

describe('the owner switches ways on and off', () => {
  it('keeps keys secret: only their last characters come back', async () => {
    const s = await m.saveMethod(owner, 'google', { clientId: '1-abc.apps.googleusercontent.com', clientSecret: 'GOCSPX-very-secret-1234' })
    const g = s.methods.find((x) => x.id === 'google')!
    expect(g).toMatchObject({ on: true, source: 'app', values: { clientId: '1-abc.apps.googleusercontent.com', clientSecret: '…1234' } })
    expect(JSON.stringify(s)).not.toContain('very-secret')
    expect(g.returnAddress).toBe(`${ORIGIN}/api/auth/callback/google`)
    expect(m.signInMethods().google).toBe(true)
  })
  it('stores nothing readable in the database', async () => {
    const { getSetting } = await import('../lib/ops/settings')
    expect(getSetting('signIn:google')).not.toContain('very-secret')
  })
  it('refuses a key in the wrong shape, saying what is wrong', async () => {
    await expect(m.saveMethod(owner, 'yandex', { clientId: 'nope', clientSecret: 'x' })).rejects.toMatchObject({ status: 400 })
  })
  it('is for the owner only', async () => {
    expect(() => m.methodsStatus(editor)).toThrow()
    await expect(m.saveMethod(editor, 'vk', { clientId: '123', clientSecret: 'x' })).rejects.toBeTruthy()
  })
  it('lets the server settings win, and cannot change them', async () => {
    vi.stubEnv('VK_CLIENT_ID', '777')
    vi.stubEnv('VK_CLIENT_SECRET', 'from-env')
    expect(m.methodsStatus(owner).methods.find((x) => x.id === 'vk')).toMatchObject({ on: true, source: 'server' })
    await expect(m.saveMethod(owner, 'vk', { clientId: '123', clientSecret: 'x' })).rejects.toMatchObject({ status: 409 })
  })
  it('asks Telegram who the bot is before keeping the token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false }))))
    await expect(m.saveMethod(owner, 'telegram', { botToken: BOT })).rejects.toMatchObject({ status: 400 })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { username: 'folk_bot' } }))))
    await m.saveMethod(owner, 'telegram', { botToken: BOT })
    expect(m.signInMethods().telegram).toBe('folk_bot')
  })
  it('switches a way off', () => {
    m.removeMethod(owner, 'google')
    expect(m.signInMethods().google).toBe(false)
  })
  it('rebuilds sign-in with no restart', async () => {
    const before = m.methodsVersion()
    await m.saveMethod(owner, 'email', { host: 'smtp.example.org', port: '465', user: 'archive@example.org', password: 'app-password' })
    expect(m.methodsVersion()).toBe(before + 1)
    expect(m.signInMethods().email).toBe(true)
  })
})

describe('signing in', () => {
  let userId = ''
  beforeAll(async () => {
    const ctx = await auth.getAuth().$context
    // As the app makes them: lib/auth.ts creates users with no provisioning source.
    const create = ctx.internalAdapter.createUser as unknown as (u: object) => Promise<{ id: string }>
    userId = (await create({ name: 'Анна', email: 'anna@example.org', emailVerified: true, role: 'owner', personId: null })).id
  })

  it('by a code by mail, for an address already on an account', async () => {
    sent.length = 0
    expect((await call('/email-otp/send-verification-otp', { email: 'anna@example.org', type: 'sign-in' })).status).toBe(200)
    const code = sent.at(-1)!.text.match(/\b(\d{6})\b/)![1]
    const r = await call('/sign-in/email-otp', { email: 'anna@example.org', otp: code })
    expect(r.status).toBe(200)
    expect(cookieOf(r)).toMatch(/session_token=/)
  })
  it('not for an address nobody in the archive has', async () => {
    sent.length = 0
    await call('/email-otp/send-verification-otp', { email: 'stranger@example.org', type: 'sign-in' })
    const r = await call('/sign-in/email-otp', { email: 'stranger@example.org', otp: '000000' })
    expect(r.ok).toBe(false)
    const ctx = await auth.getAuth().$context
    expect(await ctx.internalAdapter.findUserByEmail('stranger@example.org')).toBeNull()
  })
  it('by Telegram only after the account linked it', async () => {
    const data = signed({ id: 555, first_name: 'Анна', auth_date: Math.floor(Date.now() / 1000) })
    expect((await call('/family/telegram', data)).status).toBe(403)
    const ctx = await auth.getAuth().$context
    const session = await ctx.internalAdapter.createSession(userId)
    const signedCookie = `better-auth.session_token=${encodeURIComponent(`${session.token}.${createHmac('sha256', ctx.secret).update(session.token).digest('base64')}`)}`
    expect((await call('/family/telegram/link', data, signedCookie)).status).toBe(200)
    const r = await call('/family/telegram', data)
    expect(r.status).toBe(200)
    expect(cookieOf(r)).toMatch(/session_token=/)
  })
  it('never with Telegram data someone made up', async () => {
    const forged = { ...signed({ id: 555, auth_date: Math.floor(Date.now() / 1000) }), first_name: 'Чужой' }
    expect((await call('/family/telegram', forged)).status).toBe(400)
  })
})

describe('the buttons lead to the provider, with the return address the owner was told to give it', () => {
  it.each([
    ['yandex', { clientId: '0123456789abcdef0123456789abcdef', clientSecret: 's' }, 'https://oauth.yandex'],
    ['vk', { clientId: '51234567', clientSecret: 's' }, 'https://id.vk.com/authorize'],
    ['google', { clientId: '1-abc.apps.googleusercontent.com', clientSecret: 's' }, 'https://accounts.google.com/'],
  ] as const)('%s', async (id, keys, host) => {
    await m.saveMethod(owner, id, keys)
    const r = await call('/sign-in/social', { provider: id, callbackURL: '/' })
    expect(r.status).toBe(200)
    const url = new URL((await r.json()).url)
    expect(url.href.startsWith(host)).toBe(true)
    expect(url.searchParams.get('client_id')).toBe(keys.clientId)
    expect(url.searchParams.get('redirect_uri')).toBe(m.returnAddress(id))
  })
})
