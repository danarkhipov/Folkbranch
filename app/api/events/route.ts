import { headers } from 'next/headers'
import { nanoid } from 'nanoid'
import { getActor, hasBearer } from '@/lib/api-auth'
import { isFull, join, leave, type LiveClient } from '@/lib/live'
import { canSeePerson } from '@/lib/ops/people'

export const dynamic = 'force-dynamic'

/** Pages reconnect by themselves, so a signed-out person cannot keep listening for long. */
const MAX_LIFE_MS = 10 * 60 * 1000
/** Messages waiting for a page that stopped reading. Past this it is dropped, and comes back when it can. */
const MAX_BACKLOG = 100

export async function GET(req: Request) {
  const h = await headers()
  if (hasBearer(h)) return Response.json({ error: 'not available to tokens' }, { status: 403 })
  const actor = await getActor(h)
  if (!actor) return Response.json({ error: 'unauthorized' }, { status: 401 })
  if (isFull()) return Response.json({ error: 'too many open pages' }, { status: 503, headers: { 'Retry-After': '30' } })
  const encoder = new TextEncoder()
  let client: LiveClient | undefined
  const stream = new ReadableStream({
    start(out) {
      let life: NodeJS.Timeout | undefined
      client = {
        id: nanoid(10),
        userId: actor.userId,
        name: actor.name,
        focusId: null,
        canSee: (id) => canSeePerson(actor, id),
        send: (text) => {
          if ((out.desiredSize ?? 0) < -MAX_BACKLOG) throw new Error('page stopped reading')
          out.enqueue(encoder.encode(text))
        },
        close: () => {
          clearTimeout(life)
          try {
            out.close()
          } catch {
            // Already closed by the browser leaving.
          }
        },
      }
      join(client)
      life = setTimeout(() => leave(client!), MAX_LIFE_MS).unref()
      req.signal.addEventListener('abort', () => leave(client!), { once: true })
    },
    cancel() {
      if (client) leave(client)
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' } })
}
