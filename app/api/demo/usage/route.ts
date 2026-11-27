import { tokensToday } from '@/lib/agent/limits'
import { demoOn, demoSecretMatches, switchAssistantOffFor } from '@/lib/demo-mode'

export const dynamic = 'force-dynamic'

const allowed = (req: Request) => demoOn() && demoSecretMatches(req.headers.get('x-demo-secret'))

/** For the demo router only: what this copy's assistant has spent today, so the router can keep a total across copies. */
export function GET(req: Request) {
  if (!allowed(req)) return new Response(null, { status: 404 })
  return Response.json({ tokens: tokensToday() })
}

/** For the demo router only: switches this copy's assistant off for a UTC day, because the total is used up. */
export async function POST(req: Request) {
  if (!allowed(req)) return new Response(null, { status: 404 })
  const day = ((await req.json().catch(() => null)) as { aiOffDay?: unknown } | null)?.aiOffDay
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return Response.json({ error: 'a day is required' }, { status: 400 })
  switchAssistantOffFor(day)
  return Response.json({ ok: true })
}
