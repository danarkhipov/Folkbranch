import { headers } from 'next/headers'
import { z } from 'zod'
import { fromOurPages } from '@/lib/same-origin'
import { OpError } from '@/lib/ops/core'
import { openShare, SHARE_COOKIE } from '@/lib/ops/share'
import { publicUrl } from '@/lib/public-url'

export const dynamic = 'force-dynamic'

/** Opening is a button press, not the visit itself: a messenger's preview of the link gets nothing. */
export async function POST(req: Request) {
  if (!fromOurPages(await headers())) return Response.json({ error: 'bad origin' }, { status: 403 })
  try {
    const { token, password } = z.object({ token: z.string().max(100), password: z.string().max(200).optional() }).parse(await req.json())
    const { cookie, maxAge } = openShare(token, password)
    const secure = publicUrl().startsWith('https') ? '; Secure' : ''
    return Response.json({ ok: true }, { headers: { 'Set-Cookie': `${SHARE_COOKIE}=${encodeURIComponent(cookie)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}` } })
  } catch (e) {
    if (e instanceof OpError) return Response.json({ error: e.message }, { status: e.status })
    return Response.json({ error: 'bad request' }, { status: 400 })
  }
}
