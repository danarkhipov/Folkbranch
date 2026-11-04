import { headers } from 'next/headers'
import { fromOurPages } from '@/lib/same-origin'
import { z } from 'zod'
import { assistantRefusal } from '@/lib/agent/agent'
import { overLimit } from '@/lib/agent/limits'
import { assistantResponse } from '@/lib/agent/respond'
import { getActor, hasBearer } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

const MAX_BODY = 4 * 1024 * 1024

/** For people in the app only. Agents with tokens bring their own model and use /api/mcp. */
export async function POST(req: Request) {
  const h = await headers()
  if (hasBearer(h)) return Response.json({ error: 'not available to tokens' }, { status: 403 })
  if (!fromOurPages(h)) return Response.json({ error: 'bad origin' }, { status: 403 })
  if (Number(h.get('content-length') ?? 0) > MAX_BODY) return Response.json({ error: 'conversation too long' }, { status: 413 })
  const actor = await getActor(h)
  if (!actor) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const refusal = assistantRefusal(actor)
  if (refusal) return Response.json({ error: refusal }, { status: 403 })
  const limited = overLimit(actor.userId)
  if (limited) return Response.json({ error: limited }, { status: 429 })
  try {
    return await assistantResponse(actor, await req.json(), { abortSignal: req.signal })
  } catch (e) {
    if (e instanceof z.ZodError || e instanceof SyntaxError) return Response.json({ error: 'bad request' }, { status: 400 })
    console.error(e)
    return Response.json({ error: 'server error' }, { status: 500 })
  }
}
