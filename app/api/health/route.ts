import { getDb, schema } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** For Docker and hosting platforms: says whether the app can reach its data, and nothing else. */
export function GET() {
  try {
    getDb().select({ key: schema.settings.key }).from(schema.settings).limit(1).get()
    return Response.json({ ok: true })
  } catch {
    return Response.json({ ok: false }, { status: 503 })
  }
}
