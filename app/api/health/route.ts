import { getDb, schema } from '@/lib/db'
import { demoOn } from '@/lib/demo-mode'
import { hasUsers } from '@/lib/ops/settings'

export const dynamic = 'force-dynamic'

/** For Docker and hosting platforms: says whether the app can reach its data, and nothing else. */
export function GET() {
  try {
    getDb().select({ key: schema.settings.key }).from(schema.settings).limit(1).get()
    // A demo copy is up only once its family is loaded: the router signs in the moment this answers.
    if (demoOn() && !hasUsers()) return Response.json({ ok: false }, { status: 503 })
    return Response.json({ ok: true })
  } catch {
    return Response.json({ ok: false }, { status: 503 })
  }
}
