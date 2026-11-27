import pkg from '../package.json'
import { requireRole, type Actor } from './ops/core'
import { refuseInDemo } from './demo-mode'

// FOLKBRANCH_RELEASES_API points the check at another source, for a mirror or a test.
const URL = () => process.env.FOLKBRANCH_RELEASES_API ?? 'https://api.github.com/repos/danarkhipov/folkbranch/releases/latest'
const HOUR = 3_600_000
let cached: { at: number; ttl: number; release: { tag: string; url: string } | null } | null = null

/** For tests: the answer is kept in memory between calls. */
export const forgetUpdateCache = () => { cached = null }

/** The newest published release, or null when it cannot be learned. A failure is kept too, so a dead network is not asked again on every open. */
async function latestRelease() {
  if (cached && Date.now() - cached.at < cached.ttl) return cached.release
  let release: { tag: string; url: string } | null = null
  try {
    const res = await fetch(URL(), { headers: { 'User-Agent': 'folkbranch' }, signal: AbortSignal.timeout(5000) })
    if (res.ok) {
      const b = await res.json() as { tag_name?: unknown; html_url?: unknown }
      if (typeof b.tag_name === 'string' && typeof b.html_url === 'string') release = { tag: b.tag_name, url: b.html_url }
    }
  } catch { /* offline, slow or rate-limited: no answer */ }
  cached = { at: Date.now(), ttl: release ? 12 * HOUR : HOUR, release }
  return release
}

// major.minor.patch as numbers; a leading "v" and a pre-release suffix are ignored.
const parts = (v: string) => v.replace(/^v/, '').split(/[-+]/)[0].split('.').map((n) => parseInt(n, 10) || 0)
function isNewer(latest: string, current: string) {
  const a = parts(latest), b = parts(current)
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return false
}

/** Whether a newer release exists. Owner only; FOLKBRANCH_UPDATE_CHECK=off stops the call to GitHub altogether. */
export async function updateStatus(actor: Actor) {
  refuseInDemo()
  requireRole(actor, 'owner')
  const current = pkg.version
  const r = process.env.FOLKBRANCH_UPDATE_CHECK === 'off' ? null : await latestRelease()
  if (!r) return { current, latest: null, newer: false }
  return { current, latest: r.tag.replace(/^v/, ''), url: r.url, newer: isNewer(r.tag, current) }
}
