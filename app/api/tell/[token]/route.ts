import { headers } from 'next/headers'
import { OpError } from '@/lib/ops/core'
import { submitRecording } from '@/lib/ops/story-requests'
import { fromOurPages } from '@/lib/same-origin'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 50 * 1024 * 1024

/** One recording from someone asked for it by a link. No account: the token is the permission, and it only lets this in. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const h = await headers()
  if (!fromOurPages(h)) return Response.json({ error: 'bad origin' }, { status: 403 })
  if (Number(h.get('content-length') ?? 0) > MAX_BYTES + 1024 * 1024) return Response.json({ error: 'too large' }, { status: 413 })
  const { token } = await params
  try {
    const form = await req.formData()
    const file = form.get('audio')
    if (!(file instanceof File)) return Response.json({ error: 'file required' }, { status: 400 })
    const seconds = Number(form.get('seconds'))
    return Response.json(await submitRecording(token, { buf: Buffer.from(await file.arrayBuffer()), name: file.name }, Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null))
  } catch (e) {
    if (e instanceof OpError) return Response.json({ error: e.message }, { status: e.status })
    console.error(e)
    return Response.json({ error: 'server error' }, { status: 500 })
  }
}
