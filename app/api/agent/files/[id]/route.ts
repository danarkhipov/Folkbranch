import { headers } from 'next/headers'
import { attachmentBytes, attachmentView, getAttachment } from '@/lib/agent/attachments'
import { getActor, hasBearer } from '@/lib/api-auth'
import { OpError } from '@/lib/ops/core'

export const dynamic = 'force-dynamic'

/** Back to the person who sent it, and nobody else. Only our own copy of a picture shows inline. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const h = await headers()
  const actor = hasBearer(h) ? null : await getActor(h)
  if (!actor) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  try {
    const att = await getAttachment(actor, id)
    if (att.kind === 'image') return new Response(new Uint8Array(await attachmentView(actor, id)), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } })
    return new Response(new Uint8Array(await attachmentBytes(actor, id)), { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(att.name)}` } })
  } catch (e) {
    if (e instanceof OpError) return Response.json({ error: e.message }, { status: e.status })
    return Response.json({ error: 'not found' }, { status: 404 })
  }
}
