// What is set up and what is missing, in terms a person can act on. The app says it, so nobody has to read a manual
// to find out why sign-in fails or why the assistant is silent.
import fs from 'node:fs'
import { count, isNull } from 'drizzle-orm'
import { currentProvider } from '../agent/provider-key'
import { DATA_DIR, getDb, schema } from '../db'
import { publicOrigins } from '../public-url'
import { Actor, requireRole } from './core'
import { getSetting } from './settings'

const LOW_DISK = 1024 ** 3

/** The address the request came to. */
const reached = (h: Headers) => {
  const host = h.get('x-forwarded-host') ?? h.get('host')
  return host ? `${h.get('x-forwarded-proto') ?? (/^(localhost|127\.)/.test(host) ? 'http' : 'https')}://${host}` : null
}

/** Sign-in only works on the address the app was told about. Null when it is fine, or when none was named. */
export function addressProblem(h: Headers) {
  const known = publicOrigins()
  const here = reached(h)
  return known.length && here && !known.includes(here) ? known[0] : null
}

export function setupStatus(actor: Actor, h: Headers) {
  requireRole(actor, 'owner')
  const db = getDb()
  const n = (t: typeof schema.persons | typeof schema.user) => db.select({ n: count() }).from(t as typeof schema.persons).get()!.n
  const here = reached(h) ?? ''
  const free = (() => { try { const s = fs.statfsSync(DATA_DIR); return s.bavail * s.bsize } catch { return null } })()
  const local = /^https?:\/\/(localhost|127\.)/.test(here)
  const provider = currentProvider()
  return {
    address: here,
    addressWrong: addressProblem(h),
    insecure: !local && here.startsWith('http://'),
    dataDir: DATA_DIR,
    freeBytes: free,
    lowDisk: free !== null && free < LOW_DISK,
    people: n(schema.persons),
    users: n(schema.user),
    agents: db.select({ n: count() }).from(schema.apiTokens).where(isNull(schema.apiTokens.revokedAt)).get()!.n,
    assistant: provider ? provider.label : null,
    assistantOn: getSetting('assistantEnabled') === '1',
    google: !!process.env.GOOGLE_CLIENT_ID,
    yandex: !!process.env.YANDEX_CLIENT_ID,
    mcpUrl: `${here}/api/mcp`,
  }
}
