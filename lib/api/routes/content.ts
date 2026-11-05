import { z } from 'zod'
import { OpError } from '@/lib/ops/core'
import * as media from '@/lib/ops/media'
import * as pages from '@/lib/ops/pages'
import { dispatch } from '@/lib/ops/proposals'
import { OPS } from '@/lib/ops/registry'
import { get, op, type Route } from '../router'

export const contentRoutes: Route[] = [
  op('POST', 'pages', 'create_page'),
  get('pages/:id', 'A page with its text', ({ actor, params }) => pages.getPage(actor, params.id)),
  op('PATCH', 'pages/:id', 'update_page', ({ params }, b) => ({ ...b, id: params.id })),
  op('POST', 'pages/:id/move', 'move_page', ({ params }, b) => ({ ...b, id: params.id })),
  op('DELETE', 'pages/:id', 'delete_page', ({ params }) => ({ id: params.id })),

  { method: 'POST', path: 'media', summary: OPS.upload_photo.description, op: 'upload_photo', handler: async ({ actor, req }) => {
    if (!req.headers.get('content-type')?.includes('multipart/form-data')) return dispatch(actor, 'upload_photo', await req.json())
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) throw new OpError(400, 'file required')
    const buf = Buffer.from(await file.arrayBuffer())
    const personId = form.get('personId')?.toString() || null
    return actor.tokenId
      ? dispatch(actor, 'upload_photo', { base64: buf.toString('base64'), filename: file.name, personId })
      : media.uploadMedia(actor, buf, file.name, personId)
  } },
  get('media', 'All photos', ({ actor }) => media.listAllMedia(actor)),
  get('media/:id', 'A photo with its tags', ({ actor, params }) => media.getMedia(actor, params.id)),
  op('PATCH', 'media/:id', 'update_photo', ({ params }, b) => ({ ...b, id: params.id })),
  op('DELETE', 'media/:id', 'delete_photo', ({ params }) => ({ id: params.id })),
  get('media/:id/file', 'The file itself; size=thumb, medium or orig', async ({ actor, params, query }) => {
    const size = z.enum(['thumb', 'medium', 'orig']).catch('medium').parse(query.get('size'))
    const f = await media.readMediaFile(actor, params.id, size)
    const headers: Record<string, string> = { 'Content-Type': f.mime, 'Cache-Control': 'private, max-age=31536000, immutable' }
    if (f.download) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`
    return new Response(new Uint8Array(f.data), { headers })
  }),
  op('POST', 'media/:id/tags', 'tag_photo', ({ params }, b) => ({ ...b, mediaId: params.id })),
  op('DELETE', 'tags/:id', 'untag_photo', ({ params }) => ({ id: params.id })),
]
