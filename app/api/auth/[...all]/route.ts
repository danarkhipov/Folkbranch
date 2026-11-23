import { toNextJsHandler } from 'better-auth/next-js'
import { getAuth } from '@/lib/auth'
import { langOfRequest, withViewerLang } from '@/lib/ops/app-config'
import { DEMO_REFUSAL, demoOn } from '@/lib/demo-mode'

/** In the demo only reading the session and signing out are open: every other way in, and every way to make an account, is shut. */
const DEMO_OPEN = ['/get-session', '/sign-out', '/ok', '/error']
const inDemoOpen = (req: Request) => DEMO_OPEN.includes(new URL(req.url).pathname.replace(/^\/api\/auth/, '').replace(/\/$/, ''))

const handler = async (req: Request) => {
  if (demoOn() && !inDemoOpen(req)) return Response.json({ error: DEMO_REFUSAL }, { status: 403 })
  const res = await withViewerLang(langOfRequest(req.headers), () => getAuth().handler(req))
  if (!res.ok || !new URL(req.url).pathname.endsWith('/sign-out')) return res
  // Photos seen in this session stay in the browser's cache otherwise, on a computer someone else uses next.
  const out = new Response(res.body, res)
  out.headers.set('Clear-Site-Data', '"cache"')
  return out
}
export const { GET, POST } = toNextJsHandler(handler)
