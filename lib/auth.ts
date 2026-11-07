import { randomBytes } from 'node:crypto'
import { betterAuth, type BetterAuthPlugin } from 'better-auth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { APIError, createAuthEndpoint } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import { genericOAuth } from 'better-auth/plugins'
import { nextCookies } from 'better-auth/next-js'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from './db'
import { localLoginAllowed } from './local-login'
import { findInvite, findOwnerId, hasUsers, isRecoveryToken, setSetting } from './ops/settings'
import { loadDemo } from './demo'
import { publicOrigins, publicUrl } from './public-url'
import { serverSecret } from './server-secret'
import { setupCodeMatches } from './setup-code'

export const providers = () => ({
  google: !!process.env.GOOGLE_CLIENT_ID,
  yandex: !!process.env.YANDEX_CLIENT_ID,
})

/** Passwordless entry: first-run setup and one-time invitation links. */
const familyAccess = () =>
  ({
    id: 'family-access',
    endpoints: {
      setup: createAuthEndpoint('/family/setup', {
        method: 'POST',
        body: z.object({
          name: z.string().min(1),
          familyName: z.string().min(1),
          language: z.enum(['ru', 'en']),
          demo: z.boolean().optional(),
          code: z.string().optional(),
        }),
      }, async (ctx) => {
        if (hasUsers()) throw new APIError('FORBIDDEN', { message: 'already set up' })
        // On a public host, SETUP_TOKEN stops a stranger from claiming the empty instance.
        if (!setupCodeMatches(ctx.body.code)) throw new APIError('FORBIDDEN', { message: 'wrong setup code' })
        const u = await createFamilyUser(ctx, ctx.body.name, 'owner', null)
        setSetting('familyName', ctx.body.familyName)
        setSetting('language', ctx.body.language)
        if (ctx.body.demo) await loadDemo(u.id, ctx.body.name, ctx.body.language)
        return ctx.json({ ok: true })
      }),
      accept: createAuthEndpoint('/family/accept', {
        method: 'POST',
        body: z.object({ token: z.string() }),
      }, async (ctx) => {
        if (isRecoveryToken(ctx.body.token)) {
          const owner = await ctx.context.internalAdapter.findUserById(findOwnerId() ?? '')
          if (!owner) throw new APIError('BAD_REQUEST', { message: 'invalid invite' })
          const session = await ctx.context.internalAdapter.createSession(owner.id)
          await setSessionCookie(ctx, { session, user: owner })
          return ctx.json({ ok: true })
        }
        const invite = findInvite(ctx.body.token)
        if (!invite) throw new APIError('BAD_REQUEST', { message: 'invalid invite' })
        const db = getDb()
        // Burn the link first, so a concurrent request cannot use it twice.
        const burned = db.update(schema.invites).set({ usedAt: new Date() }).where(eq(schema.invites.id, invite.id)).run()
        if (!burned.changes) throw new APIError('BAD_REQUEST', { message: 'invalid invite' })
        if (invite.userId) {
          const existing = await ctx.context.internalAdapter.findUserById(invite.userId)
          if (!existing) throw new APIError('BAD_REQUEST', { message: 'invalid invite' })
          const session = await ctx.context.internalAdapter.createSession(existing.id)
          await setSessionCookie(ctx, { session, user: existing })
        } else {
          await createFamilyUser(ctx, invite.name, invite.role, invite.personId)
        }
        return ctx.json({ ok: true })
      }),
      local: createAuthEndpoint('/family/local', { method: 'GET' }, async (ctx) => {
        if (!localLoginAllowed(ctx.headers?.get('host'))) throw new APIError('FORBIDDEN', { message: 'not on this computer' })
        const owner = await ctx.context.internalAdapter.findUserById(findOwnerId() ?? '')
        if (!owner) throw ctx.redirect('/setup')
        const session = await ctx.context.internalAdapter.createSession(owner.id)
        await setSessionCookie(ctx, { session, user: owner })
        throw ctx.redirect('/')
      }),
    },
  }) satisfies BetterAuthPlugin

async function createFamilyUser(ctx: any, name: string, role: string, personId: string | null) {
  // Better Auth requires an email; invited relatives may not have one.
  const email = `${randomBytes(9).toString('hex')}@invite.invalid`
  const created = await ctx.context.internalAdapter.createUser({ name, email, emailVerified: false, role, personId })
  const session = await ctx.context.internalAdapter.createSession(created.id)
  await setSessionCookie(ctx, { session, user: created })
  return created
}

function build() {
  const yandex = process.env.YANDEX_CLIENT_ID
    ? [genericOAuth({
        config: [{
          providerId: 'yandex',
          clientId: process.env.YANDEX_CLIENT_ID,
          clientSecret: process.env.YANDEX_CLIENT_SECRET!,
          authorizationUrl: 'https://oauth.yandex.ru/authorize',
          tokenUrl: 'https://oauth.yandex.ru/token',
          userInfoUrl: 'https://login.yandex.ru/info?format=json',
          disableSignUp: true,
          mapProfileToUser: (p: Record<string, any>) => ({ email: p.default_email, name: p.real_name || p.display_name, emailVerified: true }),
        }],
      })]
    : []
  return betterAuth({
    secret: serverSecret(),
    baseURL: publicUrl(),
    trustedOrigins: publicOrigins(),
    // X-Real-IP is set by the platform's edge; the first entry of X-Forwarded-For can be typed by anyone.
    advanced: { ipAddress: { ipAddressHeaders: ['x-real-ip', 'x-forwarded-for'] } },
    database: drizzleAdapter(getDb(), { provider: 'sqlite', schema }),
    // Stays alive while in use; a lost phone stops working after three months without it.
    session: { expiresIn: 90 * 24 * 3600, updateAge: 24 * 3600 },
    // Invited relatives have no real email, so Google or Yandex is linked from a signed-in session.
    account: { accountLinking: { enabled: true, allowDifferentEmails: true } },
    user: {
      additionalFields: {
        role: { type: 'string', required: false, defaultValue: 'reader', input: false },
        personId: { type: 'string', required: false, input: false },
      },
    },
    // Accounts appear only through invitations. Google and Yandex sign in people who already have one.
    socialProviders: process.env.GOOGLE_CLIENT_ID
      ? { google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET!, disableSignUp: true } }
      : {},
    plugins: [familyAccess(), ...yandex, nextCookies()],
  })
}

const g = globalThis as unknown as { __familyAuth?: ReturnType<typeof build> }
export const getAuth = () => (g.__familyAuth ??= build())
