// OWNER_EMAIL lets the owner in with Google at once, and lets nobody else in.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Actor } from '../lib/ops/core'

const ORIGIN = 'http://localhost:3417'
const owner: Actor = { userId: 'o', name: 'Owner', role: 'owner', personId: null }
const KEYS = { clientId: '1-abc.apps.googleusercontent.com', clientSecret: 'GOCSPX-test' }

let auth: typeof import('../lib/auth')
let methods: typeof import('../lib/sign-in-methods')
let settings: typeof import('../lib/ops/settings')
beforeAll(async () => {
  auth = await import('../lib/auth')
  methods = await import('../lib/sign-in-methods')
  settings = await import('../lib/ops/settings')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const cookieOf = (r: Response) => r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')

/** The whole round trip, with Google's answer made up: who Google says is signing in. */
async function signInWithGoogle(email: string, verified = true) {
  const a = auth.getAuth()
  const start = await a.handler(new Request(`${ORIGIN}/api/auth/sign-in/social`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ provider: 'google', callbackURL: '/', errorCallbackURL: '/login' }),
  }))
  const state = new URL((await start.json()).url).searchParams.get('state')!
  const idToken = `${b64({ alg: 'none' })}.${b64({ iss: 'https://accounts.google.com', aud: KEYS.clientId, sub: `g-${email}-${verified}`, email, email_verified: verified, name: 'Someone' })}.x`
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'a', id_token: idToken, token_type: 'Bearer', expires_in: 3600 }), { headers: { 'content-type': 'application/json' } })
    throw new Error(`unexpected request to ${String(url)}`)
  }))
  const back = await a.handler(new Request(`${ORIGIN}/api/auth/callback/google?code=c&state=${state}`, { headers: { cookie: cookieOf(start), origin: ORIGIN } }))
  return { signedIn: /session_token=/.test(cookieOf(back)), to: back.headers.get('location') ?? '' }
}

describe('Google, with the owner\'s address set on the server', () => {
  beforeAll(async () => {
    await methods.saveMethod(owner, 'google', KEYS)
    // The owner as setup makes them: a stand-in address, because a first visit asks for none.
    const r = await auth.getAuth().handler(new Request(`${ORIGIN}/api/auth/family/setup`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ name: 'Даниил', familyName: 'Тест', language: 'ru' }),
    }))
    expect(r.status).toBe(200)
  })

  it('does not know the owner\'s Google until the address is set', async () => {
    const r = await signInWithGoogle('daniel@example.org')
    expect(r.signedIn).toBe(false)
    expect(r.to).toContain('/login')
  })

  it('lets the owner in with that address, with no link opened first', async () => {
    vi.stubEnv('OWNER_EMAIL', ' Daniel@Example.org ')
    await methods.saveMethod(owner, 'google', { ...KEYS, clientSecret: 'GOCSPX-test-2' }) // the server builds sign-in again
    const r = await signInWithGoogle('daniel@example.org')
    expect(r.signedIn).toBe(true)
    expect(r.to).not.toContain('error')
    const ctx = await auth.getAuth().$context
    const me = await ctx.internalAdapter.findUserByEmail('daniel@example.org')
    expect(me?.user.id).toBe(settings.findOwnerId())
    expect((me?.user as { role?: string } | undefined)?.role).toBe('owner')
  })

  it('makes nobody new for another Google address', async () => {
    const r = await signInWithGoogle('stranger@example.org')
    expect(r.signedIn).toBe(false)
    const ctx = await auth.getAuth().$context
    expect(await ctx.internalAdapter.findUserByEmail('stranger@example.org')).toBeNull()
  })

  it('does not take an address Google has not confirmed', async () => {
    const r = await signInWithGoogle('daniel@example.org', false)
    expect(r.signedIn).toBe(false)
  })

  it('leaves the owner their address when it already belongs to another account', async () => {
    const ctx = await auth.getAuth().$context
    const create = ctx.internalAdapter.createUser as unknown as (u: object) => Promise<{ id: string }>
    await create({ name: 'Анна', email: 'anna@example.org', emailVerified: true, role: 'reader', personId: null })
    vi.stubEnv('OWNER_EMAIL', 'anna@example.org')
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { applyOwnerEmail } = await import('../lib/owner-email')
    applyOwnerEmail()
    expect(err).toHaveBeenCalled()
    expect(((await ctx.internalAdapter.findUserByEmail('anna@example.org'))?.user as { role?: string } | undefined)?.role).toBe('reader')
    err.mockRestore()
  })
})
