import { createHash, randomBytes } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { Role } from '../types'
import { Actor, newId, OpError, requireRole } from './core'

const hash = (t: string) => createHash('sha256').update(t).digest('hex')
const TOUCH_MS = 60_000

export function createToken(actor: Actor, input: { name: string; role: 'reader' | 'editor'; review: boolean; expiresInDays?: number | null }) {
  requireRole(actor, 'owner')
  const token = `fb_${randomBytes(32).toString('base64url')}`
  const id = newId()
  getDb().insert(schema.apiTokens).values({ id, name: input.name, tokenHash: hash(token), role: input.role, review: input.review, expiresAt: input.expiresInDays ? Date.now() + input.expiresInDays * 86_400_000 : null, createdBy: actor.userId, createdAt: Date.now() }).run()
  // Shown once: only the hash is kept.
  return { id, token }
}

export function listTokens(actor: Actor) {
  requireRole(actor, 'owner')
  const t = schema.apiTokens
  return getDb().select({ id: t.id, name: t.name, role: t.role, review: t.review, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt, expiresAt: t.expiresAt, revokedAt: t.revokedAt }).from(t).orderBy(desc(t.createdAt)).all()
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
  return { userId: `token:${row.id}`, name: row.name, role: row.role as Role, personId: null, tokenId: row.id, review: row.review }
}
