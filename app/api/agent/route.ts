import { headers } from 'next/headers'
import { fromOurPages } from '@/lib/same-origin'
import { z } from 'zod'
import { assistantRefusal } from '@/lib/agent/agent'
import { overLimit, takeRun } from '@/lib/agent/limits'
import { assistantResponse } from '@/lib/agent/respond'
import { getActor, hasBearer } from '@/lib/api-auth'
import { say } from '@/lib/ops/settings'

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
  if (refusal) return Response.json({ error: refusal, plain: true }, { status: 403 })
  const limited = overLimit(actor.userId)
  if (limited) return Response.json({ error: limited, plain: true }, { status: 429 })
  const release = takeRun(actor.userId)
  if (!release) return Response.json({ error: say('Ассистент сейчас отвечает на другой запрос. Подождите немного и повторите.'), plain: true }, { status: 429 })
  req.signal.addEventListener('abort', release, { once: true })
  try {
    const res = await assistantResponse(actor, await req.json(), { abortSignal: req.signal })
    if (!res.body) { release(); return res }
    return new Response(res.body.pipeThrough(new TransformStream({ flush: release })), res)
  } catch (e) {
    release()
    if (e instanceof z.ZodError || e instanceof SyntaxError) return Response.json({ error: 'bad request' }, { status: 400 })
    console.error(e)
    return Response.json({ error: 'server error' }, { status: 500 })
  }
}
