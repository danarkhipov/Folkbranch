import { headers } from 'next/headers'
import { fromOurPages } from '@/lib/same-origin'
import { assistantRefusal } from '@/lib/agent/agent'
import { saveAttachment } from '@/lib/agent/attachments'
import { getActor, hasBearer } from '@/lib/api-auth'
import { OpError } from '@/lib/ops/core'

export const dynamic = 'force-dynamic'

/** A file for the assistant's conversation. It stays with this person until they save it to the archive. */
export async function POST(req: Request) {
  const h = await headers()
  if (hasBearer(h)) return Response.json({ error: 'not available to tokens' }, { status: 403 })
  if (!fromOurPages(h)) return Response.json({ error: 'bad origin' }, { status: 403 })
  if (Number(h.get('content-length') ?? 0) > 41 * 1024 * 1024) return Response.json({ error: 'file too large' }, { status: 413 })
  const actor = await getActor(h)
  if (!actor) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const refusal = assistantRefusal(actor)
  if (refusal) return Response.json({ error: refusal }, { status: 403 })
  try {
    const file = (await req.formData()).get('file')
    if (!(file instanceof File)) return Response.json({ error: 'file required' }, { status: 400 })
    const att = await saveAttachment(actor, Buffer.from(await file.arrayBuffer()), file.name)
    return Response.json({ ...att, url: `/api/agent/files/${att.id}` })
  } catch (e) {
    if (e instanceof OpError) return Response.json({ error: e.message }, { status: e.status })
    console.error(e)
    return Response.json({ error: 'server error' }, { status: 500 })
  }
}
