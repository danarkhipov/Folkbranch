import { createHash, randomBytes } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { Role } from '../types'
import { Actor, newId, OpError, requireRole } from './core'
import { getSetting, setSetting } from './settings'
import { refuseInDemo } from '../demo-mode'

const hash = (t: string) => createHash('sha256').update(t).digest('hex')
const TOUCH_MS = 60_000

/** Tokens the owner lets apply bulk edits at once. Kept as a list in the settings: no table to change. */
const TRUSTED = 'tokenTrustBulk'
const trusted = (): string[] => { try { return JSON.parse(getSetting(TRUSTED) ?? '[]') } catch { return [] } }
const setTrusted = (id: string, on: boolean) => setSetting(TRUSTED, JSON.stringify([...new Set([...trusted().filter((x) => x !== id), ...(on ? [id] : [])])]))

export function createToken(actor: Actor, input: { name: string; role: 'reader' | 'editor'; review: boolean; trustBulk?: boolean; expiresInDays?: number | null }) {
  refuseInDemo()
  requireRole(actor, 'owner')
  const token = `fb_${randomBytes(32).toString('base64url')}`
  const id = newId()
  getDb().insert(schema.apiTokens).values({ id, name: input.name, tokenHash: hash(token), role: input.role, review: input.review, expiresAt: input.expiresInDays ? Date.now() + input.expiresInDays * 86_400_000 : null, createdBy: actor.userId, createdAt: Date.now() }).run()
  if (input.trustBulk && !input.review && input.role === 'editor') setTrusted(id, true)
  // Shown once: only the hash is kept.
  return { id, token }
}

export function listTokens(actor: Actor) {
  requireRole(actor, 'owner')
  const t = schema.apiTokens
  const on = new Set(trusted())
  return getDb().select({ id: t.id, name: t.name, role: t.role, review: t.review, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt, expiresAt: t.expiresAt, revokedAt: t.revokedAt }).from(t).orderBy(desc(t.createdAt)).all().map((r) => ({ ...r, trustBulk: on.has(r.id) && !r.review }))
}

/** The owner's choice for one editor token whose edits apply at once: whether its bulk edits do too. */
export function setTokenTrustBulk(actor: Actor, id: string, on: boolean) {
  refuseInDemo()
  requireRole(actor, 'owner')
  const row = getDb().select().from(schema.apiTokens).where(eq(schema.apiTokens.id, id)).get()
  if (!row) throw new OpError(404, 'not found')
  if (on && (row.review || row.role !== 'editor')) throw new OpError(400, 'only an editor token whose edits apply at once can have its bulk edits apply at once')
  setTrusted(id, on)
}

export function revokeToken(actor: Actor, id: string) {
  requireRole(actor, 'owner')
  const r = getDb().update(schema.apiTokens).set({ revokedAt: Date.now() }).where(eq(schema.apiTokens.id, id)).run()
  if (!r.changes) throw new OpError(404, 'not found')
}

/** Turns "Authorization: Bearer fb_..." into an actor; null means the token is unknown or revoked. */
export function actorFromToken(token: string): Actor | null {
  const db = getDb()
  const row = db.select().from(schema.apiTokens).where(eq(schema.apiTokens.tokenHash, hash(token))).get()
  const now = Date.now()
  if (!row || row.revokedAt || (row.expiresAt && row.expiresAt < now)) return null
  if (!row.lastUsedAt || now - row.lastUsedAt > TOUCH_MS) db.update(schema.apiTokens).set({ lastUsedAt: now }).where(eq(schema.apiTokens.id, row.id)).run()
  return { userId: `token:${row.id}`, name: row.name, role: row.role as Role, personId: null, tokenId: row.id, review: row.review, trustBulk: !row.review && trusted().includes(row.id) }
}
