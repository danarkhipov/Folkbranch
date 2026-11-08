import { randomBytes } from 'node:crypto'
import { betterAuth, type BetterAuthPlugin } from 'better-auth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { APIError, createAuthEndpoint, sessionMiddleware } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import { emailOTP, genericOAuth } from 'better-auth/plugins'
import { yandex as yandexProvider } from 'better-auth/plugins/generic-oauth'
import { nextCookies } from 'better-auth/next-js'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from './db'
import { localLoginAllowed } from './local-login'
import { findInvite, findOwnerId, hasUsers, isRecoveryToken, setSetting } from './ops/settings'
import { loadDemo } from './demo'
import { publicOrigins, publicUrl } from './public-url'
import { serverSecret } from './server-secret'
import { setupCodeMatches } from './setup-code'
import { methodConfig, methodsVersion, sendCode } from './sign-in-methods'
import { checkTelegram } from './telegram-login'

export { signInMethods } from './sign-in-methods'

/** The Telegram user behind what the sign-in button handed over, checked against the bot's token. */
function telegramId(data: Record<string, unknown>) {
  const bot = methodConfig('telegram')
  const id = bot ? checkTelegram(data, bot.botToken) : null
  if (!id) throw new APIError('BAD_REQUEST', { message: 'telegram check failed' })
  return id
}
const telegramData = z.record(z.string(), z.union([z.string(), z.number()]))

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
        const burned = db.update(schema.invites).set({ usedAt: new Date() }).where(and(eq(schema.invites.id, invite.id), isNull(schema.invites.usedAt))).run()
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
      // Telegram's button gives no code to exchange, only signed data, so it gets its own two doors.
      telegram: createAuthEndpoint('/family/telegram', { method: 'POST', body: telegramData }, async (ctx) => {
        const found = await ctx.context.internalAdapter.findAccountOwnerByKey({ providerId: 'telegram', accountId: telegramId(ctx.body) })
        if (found?.kind !== 'owned') throw new APIError('FORBIDDEN', { message: 'not linked' })
        const session = await ctx.context.internalAdapter.createSession(found.user.id)
        await setSessionCookie(ctx, { session, user: found.user })
        return ctx.json({ ok: true })
      }),
      telegramLink: createAuthEndpoint('/family/telegram/link', { method: 'POST', body: telegramData, use: [sessionMiddleware] }, async (ctx) => {
        const accountId = telegramId(ctx.body)
        const userId = ctx.context.session.user.id
        const found = await ctx.context.internalAdapter.findAccountOwnerByKey({ providerId: 'telegram', accountId })
        if (found?.kind === 'owned' && found.user.id !== userId) throw new APIError('CONFLICT', { message: 'linked to someone else' })
        if (!found) await ctx.context.internalAdapter.linkAccount({ userId, providerId: 'telegram', accountId })
        return ctx.json({ ok: true })
      }),
      local: createAuthEndpoint('/family/local', { method: 'GET' }, async (ctx) => {
        if (!ctx.headers || !localLoginAllowed(ctx.headers)) throw new APIError('FORBIDDEN', { message: 'not on this computer' })
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
  const google = methodConfig('google'), yandex = methodConfig('yandex'), vk = methodConfig('vk'), mail = methodConfig('email')
  // Yandex is served through the same doors as Google and VK: /sign-in/social and /callback/yandex.
  const oauth = yandex
    ? [genericOAuth({ config: [yandexProvider({ clientId: yandex.clientId, clientSecret: yandex.clientSecret, scopes: ['login:info', 'login:email'], disableSignUp: true })] })]
    : []
  // A code by mail signs in only someone whose address is already on their account; they add it themselves.
  const byMail = mail
    ? [emailOTP({
        disableSignUp: true,
        expiresIn: 600,
        allowedAttempts: 5,
        storeOTP: 'hashed',
        changeEmail: { enabled: true },
        sendVerificationOTP: ({ email, otp }) => sendCode(email, otp),
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
    // Invited relatives have no real email, so Google, Yandex or VK is linked from a signed-in session.
    account: { accountLinking: { enabled: true, allowDifferentEmails: true } },
    user: {
      additionalFields: {
        role: { type: 'string', required: false, defaultValue: 'reader', input: false },
        personId: { type: 'string', required: false, input: false },
      },
    },
    // Accounts appear only through invitations. Every other way signs in people who already have one.
    socialProviders: {
      ...(google ? { google: { clientId: google.clientId, clientSecret: google.clientSecret, disableSignUp: true } } : {}),
      // VK ID gives no email to many people; the account is found by its VK id, so a stand-in will do.
      ...(vk ? { vk: { clientId: vk.clientId, clientSecret: vk.clientSecret, disableSignUp: true, mapProfileToUser: (p: any) => (p.user?.email ? {} : { email: `${p.user?.user_id}@vk.invalid` }) } } : {}),
    },
    // Codes by mail and Telegram are worth guessing at, so they are slowed down hard.
    rateLimit: {
      customRules: {
        '/email-otp/send-verification-otp': { window: 60, max: 3 },
        '/email-otp/request-email-change': { window: 60, max: 3 },
        '/sign-in/email-otp': { window: 60, max: 5 },
        '/email-otp/change-email': { window: 60, max: 5 },
        '/family/telegram': { window: 60, max: 10 },
      },
    },
    plugins: [familyAccess(), ...oauth, ...byMail, nextCookies()],
  })
}

// Built again when the owner switches a way of signing in on or off, with no restart.
const g = globalThis as unknown as { __familyAuth?: { version: number; auth: ReturnType<typeof build> } }
export function getAuth() {
  if (g.__familyAuth?.version !== methodsVersion()) g.__familyAuth = { version: methodsVersion(), auth: build() }
  return g.__familyAuth.auth
}
