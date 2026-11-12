// The owner's own address, from the server's environment. With it on the owner's account, "Sign in with
// Google" (or a code by mail) finds that account with no link to open first. The account is still the only
// one that address opens: nobody new is made, and the provider has to vouch for the address at every sign-in.
import { eq } from 'drizzle-orm'
import { getDb, schema } from './db'
import { findOwnerId } from './ops/settings'

export function ownerEmail() {
  const v = process.env.OWNER_EMAIL?.trim().toLowerCase()
  return v && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : null
}

/** Puts OWNER_EMAIL on the owner's account, as confirmed: the server's own setting wins over what was there. */
export function applyOwnerEmail() {
  const email = ownerEmail()
  const id = findOwnerId()
  if (!email || !id) return
  const db = getDb()
  const owner = db.select({ email: schema.user.email, verified: schema.user.emailVerified }).from(schema.user).where(eq(schema.user.id, id)).get()
  if (!owner || (owner.email === email && owner.verified)) return
  const taken = db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, email)).get()
  if (taken && taken.id !== id) return console.error('OWNER_EMAIL is already the address of another account; the owner keeps theirs')
  db.update(schema.user).set({ email, emailVerified: true, updatedAt: new Date() }).where(eq(schema.user.id, id)).run()
}
