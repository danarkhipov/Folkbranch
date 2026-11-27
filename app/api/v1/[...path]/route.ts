import { headers } from 'next/headers'
import { z } from 'zod'
import { fromOurPages } from '@/lib/same-origin'
import { DEMO_FULL, DEMO_REFUSAL, demoOn, demoRefusesRoute } from '@/lib/demo-mode'
import { getActor, guestActor, hasBearer } from '@/lib/api-auth'
import { match, openApi } from '@/lib/api/router'
import { accessRoutes } from '@/lib/api/routes/access'
import { contentRoutes } from '@/lib/api/routes/content'
import { speechRoutes } from '@/lib/api/routes/speech'
import { faceRoutes } from '@/lib/api/routes/faces'
import { exchangeRoutes } from '@/lib/api/routes/exchange'
import { familyRoutes } from '@/lib/api/routes/family'
import { langOfRequest, withViewerLang } from '@/lib/ops/app-config'
import { errorFor } from '@/lib/i18n-errors'
import { OpError } from '@/lib/ops/core'

export const dynamic = 'force-dynamic'

const routes = [...familyRoutes, ...contentRoutes, ...exchangeRoutes, ...accessRoutes, ...speechRoutes, ...faceRoutes]

/** The largest upload, as base64, with room for its envelope. */
const MAX_BODY = 60 * 1024 * 1024

const isDiskFull = (e: unknown) => ['ENOSPC', 'SQLITE_FULL'].includes((e as { code?: string })?.code ?? '')

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const path = (await ctx.params).path
  if (req.method === 'GET' && path.join('/') === 'openapi.json') return Response.json(openApi(routes))
  if (demoRefusesRoute(req.method, path.join('/'))) return Response.json({ error: DEMO_REFUSAL }, { status: 403 })
  const found = match(routes, req.method, path)
  if (!found) return Response.json({ error: 'not found' }, { status: 404 })
  // Before the body is read into memory.
  // A body of unstated length could be any size: it is refused rather than counted in memory.
  if (req.method !== 'GET' && req.headers.get('transfer-encoding')?.includes('chunked')) return Response.json({ error: 'length required' }, { status: 411 })
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return Response.json({ error: 'file too large' }, { status: 413 })
  try {
    const h = await headers()
    return await withViewerLang(langOfRequest(h), async () => {
      // Cookies travel on their own, so writes with a cookie must come from our own pages.
      if (!hasBearer(h) && req.method !== 'GET' && !fromOurPages(h)) return Response.json({ error: 'bad origin' }, { status: 403 })
      const actor = (await getActor(h)) ?? guestActor(h)
      if (!actor) return Response.json({ error: 'unauthorized' }, { status: 401 })
      if (actor.guest && !found.route.guest) return Response.json({ error: 'not available with a link' }, { status: 403 })
      if (actor.tokenId && found.route.human) return Response.json({ error: 'not available to tokens' }, { status: 403 })
      const result = await found.route.handler({ actor, params: found.params, req, query: new URL(req.url).searchParams, body: () => req.json() })
      if (result instanceof Response) return result
      return Response.json(result ?? { ok: true }, { status: (result as { status?: string } | null)?.status === 'pending_review' ? 202 : 200 })
    })
  } catch (e) {
    if (e instanceof OpError) {
      // A person reads the short protocol errors in their language; a program with a token keeps the English it matches on.
      const h = await headers()
      return Response.json({ error: hasBearer(h) ? e.message : errorFor(e.message, langOfRequest(h)) }, { status: e.status })
    }
    // Words for the person, the details for programs; an array in `error` showed up as "[object Object]".
    if (e instanceof z.ZodError) return Response.json({ error: e.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; '), issues: e.issues.map((i) => ({ path: i.path, code: i.code, message: i.message })) }, { status: 400 })
    if (e instanceof SyntaxError) return Response.json({ error: 'invalid JSON' }, { status: 400 })
    if (isDiskFull(e)) return Response.json({ error: demoOn() ? DEMO_FULL : 'the server disk is full' }, { status: 507 })
    console.error(e)
    return Response.json({ error: 'server error' }, { status: 500 })
  }
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE }
