import { headers } from 'next/headers'
import { getActor, hasBearer } from '@/lib/api-auth'
import { OpError } from '@/lib/ops/core'
import { buildFamilyFile } from '@/lib/ops/family-file'

export const dynamic = 'force-dynamic'

/** The file to send to relatives. People only: a token could otherwise carry the family away. */
export async function GET() {
  const h = await headers()
  if (hasBearer(h)) return Response.json({ error: 'not available to tokens' }, { status: 403 })
  const actor = await getActor(h)
  if (!actor) return Response.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const { html, filename, stats } = await buildFamilyFile(actor)
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'X-Family-File': JSON.stringify(stats),
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    if (e instanceof OpError) return Response.json({ error: e.message }, { status: e.status })
    console.error(e)
    return Response.json({ error: 'server error' }, { status: 500 })
  }
}
