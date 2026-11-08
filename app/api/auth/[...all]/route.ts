import { toNextJsHandler } from 'better-auth/next-js'
import { getAuth } from '@/lib/auth'

const handler = async (req: Request) => {
  const res = await getAuth().handler(req)
  if (!res.ok || !new URL(req.url).pathname.endsWith('/sign-out')) return res
  // Photos seen in this session stay in the browser's cache otherwise, on a computer someone else uses next.
  const out = new Response(res.body, res)
  out.headers.set('Clear-Site-Data', '"cache"')
  return out
}
export const { GET, POST } = toNextJsHandler(handler)
