import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { headers } from 'next/headers'
import { nanoid } from 'nanoid'
import { getActor, hasBearer } from '@/lib/api-auth'
import { DATA_DIR } from '@/lib/db'
import { archiveStream, stageRestore } from '@/lib/ops/archive'
import { OpError } from '@/lib/ops/core'
import { hasUsers } from '@/lib/ops/settings'
import { fromOurPages } from '@/lib/same-origin'
import { setupCodeMatches } from '@/lib/setup-code'

export const dynamic = 'force-dynamic'

/** Lets the reply reach the page before this process ends and its supervisor starts it again. */
const RESTART_AFTER_MS = 800

const failure = (e: unknown) => {
  if (e instanceof OpError) return Response.json({ error: e.message }, { status: e.status })
  if (['ENOSPC', 'SQLITE_FULL'].includes((e as { code?: string })?.code ?? '')) return Response.json({ error: 'the server disk is full' }, { status: 507 })
  console.error(e)
  return Response.json({ error: 'server error' }, { status: 500 })
}

/** The whole archive, to keep elsewhere. People only: a token could otherwise carry everything away. */
export async function GET() {
  const h = await headers()
  if (hasBearer(h)) return Response.json({ error: 'not available to tokens' }, { status: 403 })
  const actor = await getActor(h)
  if (!actor) return Response.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const { stream, filename } = await archiveStream(actor)
    return new Response(Readable.toWeb(stream) as ReadableStream, { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' } })
  } catch (e) {
    return failure(e)
  }
}

/** Replaces the archive with a saved copy. The owner may; on an empty install, whoever has the setup code. */
export async function POST(req: Request) {
  const h = await headers()
  if (hasBearer(h)) return Response.json({ error: 'not available to tokens' }, { status: 403 })
  if (!fromOurPages(h)) return Response.json({ error: 'bad origin' }, { status: 403 })
  if (hasUsers()) {
    const actor = await getActor(h)
    if (!actor) return Response.json({ error: 'unauthorized' }, { status: 401 })
    if (actor.role !== 'owner') return Response.json({ error: 'forbidden' }, { status: 403 })
  } else if (!setupCodeMatches(h.get('x-setup-code') ?? '')) {
    return Response.json({ error: 'wrong setup code' }, { status: 403 })
  }
  if (!req.body) return Response.json({ error: 'file required' }, { status: 400 })
  const upload = path.join(/*turbopackIgnore: true*/ DATA_DIR, `.restore-${nanoid(8)}.zip`)
  try {
    await fs.mkdir(DATA_DIR, { recursive: true })
    await pipeline(Readable.fromWeb(req.body as never), createWriteStream(upload))
    const report = await stageRestore(upload)
    setTimeout(() => process.exit(1), RESTART_AFTER_MS).unref()
    return Response.json(report)
  } catch (e) {
    return failure(e)
  } finally {
    await fs.rm(upload, { force: true })
  }
}
