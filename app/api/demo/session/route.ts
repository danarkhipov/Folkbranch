import { getAuth } from '@/lib/auth'
import { demoOn, demoSecretMatches } from '@/lib/demo-mode'

export const dynamic = 'force-dynamic'

/** For the demo router only: signs the demo owner in and hands back the session cookie. Not there outside the demo. */
export async function POST(req: Request) {
  if (!demoOn()) return new Response(null, { status: 404 })
  if (!demoSecretMatches(req.headers.get('x-demo-secret'))) return new Response(null, { status: 404 })
  try {
    return await getAuth().api.demoSession({ headers: req.headers, asResponse: true })
  } catch (e) {
    console.error(e)
    return Response.json({ error: 'not ready' }, { status: 503 })
  }
}
