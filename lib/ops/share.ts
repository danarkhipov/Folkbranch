// A link to look at the family without an account. It gives what a reader gets and nothing else; every API route has
// to say that it lets such a visitor in, and only reads do.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { desc, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '../db'
import { hiddenByCollapse, peopleInScope, type Scope } from '../graph/select'
import { Family } from '../kinship'
import type { Graph } from '../types'
import { Actor, newId, OpError, requireRole } from './core'
import { getGraph } from './people'
import { say } from './app-config'

export const SHARE_COOKIE = 'fb_view'
const DAY = 24 * 3600 * 1000
const COOKIE_DAYS = 30
const MAX_TRIES = 8
const TRY_WINDOW = 15 * 60 * 1000

type Link = typeof schema.shareLinks.$inferSelect

const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const live = (r: Link | undefined): r is Link => !!r && !r.revokedAt && (!r.expiresAt || r.expiresAt > Date.now())

const seal = (password: string) => {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`
}
const opens = (stored: string, password: string) => {
  const [salt, key] = stored.split(':')
  return timingSafeEqual(scryptSync(password, salt, 32), Buffer.from(key, 'hex'))
}

const input = z.object({
  name: z.string().trim().min(1).max(80),
  viewId: z.string().max(40).nullable().default(null),
  password: z.string().min(4).max(200).nullish(),
  expiresInDays: z.number().int().min(1).max(3650).nullable().default(30),
})

export function createShare(actor: Actor, raw: unknown) {
  requireRole(actor, 'owner')
  const v = input.parse(raw)
  if (v.viewId && !getDb().select({ id: schema.views.id }).from(schema.views).where(eq(schema.views.id, v.viewId)).get()) throw new OpError(404, 'not found')
  const token = randomBytes(24).toString('base64url')
  const now = Date.now()
  getDb().insert(schema.shareLinks).values({ id: newId(), tokenHash: hash(token), name: v.name, viewId: v.viewId, passwordHash: v.password ? seal(v.password) : null, createdBy: actor.userId, createdAt: now, expiresAt: v.expiresInDays ? now + v.expiresInDays * DAY : null }).run()
  return { token }
}

export function listShares(actor: Actor) {
  requireRole(actor, 'owner')
  const l = schema.shareLinks
  return getDb().select().from(l).where(isNull(l.revokedAt)).orderBy(desc(l.createdAt)).all().filter(live).map((r) => ({ id: r.id, name: r.name, viewId: r.viewId, hasPassword: !!r.passwordHash, expiresAt: r.expiresAt, opens: r.opens }))
}

export function revokeShare(actor: Actor, id: string) {
  requireRole(actor, 'owner')
  getDb().update(schema.shareLinks).set({ revokedAt: Date.now() }).where(eq(schema.shareLinks.id, id)).run()
}

const byToken = (token: string) => getDb().select().from(schema.shareLinks).where(eq(schema.shareLinks.tokenHash, hash(token))).get()

/** What the first screen may know: whether the link works and whether it wants a password. Previews see no more. */
export function shareInfo(token: string) {
  const r = byToken(token)
  return live(r) ? { needsPassword: !!r.passwordHash } : null
}

const tries = new Map<string, { failed: number; since: number }>()

/** Changing the password, or closing the link, ends every visit made with it. */
const cookieFor = (r: Link) => `${r.id}.${hash(`${r.tokenHash}:${r.passwordHash ?? ''}`)}`

export function openShare(token: string, password: string | undefined) {
  const r = byToken(token)
  if (!live(r)) throw new OpError(404, say('Ссылка недействительна'))
  if (r.passwordHash) {
    const t = tries.get(r.id)
    if (t && Date.now() - t.since > TRY_WINDOW) tries.delete(r.id)
    if ((tries.get(r.id)?.failed ?? 0) >= MAX_TRIES) throw new OpError(429, say('Слишком много попыток. Попробуйте позже.'))
    if (!password || !opens(r.passwordHash, password)) {
      const now = tries.get(r.id) ?? { failed: 0, since: Date.now() }
      tries.set(r.id, { ...now, failed: now.failed + 1 })
      throw new OpError(403, say('Неверный пароль'))
    }
    tries.delete(r.id)
  }
  getDb().update(schema.shareLinks).set({ opens: sql`${schema.shareLinks.opens} + 1` }).where(eq(schema.shareLinks.id, r.id)).run()
  const left = r.expiresAt ? Math.ceil((r.expiresAt - Date.now()) / 1000) : Infinity
  return { cookie: cookieFor(r), maxAge: Math.min(left, COOKIE_DAYS * 24 * 3600) }
}

const everyone: Actor = { userId: '', name: '', role: 'owner', personId: null }
/** Photos and portraits ask one by one, so the people of a view are worked out once per state of the family. */
const peopleCache = new WeakMap<Graph, Map<string, Set<string>>>()

function peopleOf(view: typeof schema.views.$inferSelect) {
  const g = getGraph(everyone)
  const known = peopleCache.get(g) ?? new Map<string, Set<string>>()
  peopleCache.set(g, known)
  const key = `${view.id}.${view.updatedAt}`
  const ready = known.get(key)
  if (ready) return ready
  const family = new Family(g)
  const inScope = view.scope !== 'all' && view.focusId ? peopleInScope(family, view.scope as Exclude<Scope, 'all'>, view.focusId) : null
  const gone = hiddenByCollapse(family, JSON.parse(view.collapsed) as string[])
  const out = new Set(g.persons.filter((p) => (!inScope || inScope.has(p.id)) && !gone.has(p.id)).map((p) => p.id))
  known.set(key, out)
  return out
}

/** Who a cookie stands for, or nobody. A link to a view that was deleted shows nothing rather than everything. */
export function guestFromCookie(value: string | undefined): Actor | null {
  const [id, mac] = (value ?? '').split('.')
  if (!id || !mac) return null
  const r = getDb().select().from(schema.shareLinks).where(eq(schema.shareLinks.id, id)).get()
  if (!live(r)) return null
  const want = Buffer.from(cookieFor(r))
  const got = Buffer.from(value!)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  let only: Set<string> | null = null
  if (r.viewId) {
    const view = getDb().select().from(schema.views).where(eq(schema.views.id, r.viewId)).get()
    if (!view) return null
    only = peopleOf(view)
  }
  return { userId: `guest:${r.id}`, name: say('Гость'), role: 'reader', personId: null, guest: { viewId: r.viewId, only } }
}
