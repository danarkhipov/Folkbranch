import { z } from 'zod'
import { OpError } from '@/lib/ops/core'
import * as media from '@/lib/ops/media'
import * as pages from '@/lib/ops/pages'
import { queuedAudio } from '@/lib/ops/proposals'
import * as stories from '@/lib/ops/stories'
import { searchPeople } from '@/lib/ops/people-search'
import { sharedAddress } from '@/lib/public-url'
import { addStory } from '@/lib/ops/suggest'
import * as requests from '@/lib/ops/story-requests'
import { audioResponse } from '../audio'
import { dispatch } from '@/lib/ops/proposals'
import { OPS } from '@/lib/ops/registry'
import { get, human, op, open, type Route } from '../router'

export const contentRoutes: Route[] = [
  open('search', 'People by anything written about them, with where it was found', ({ actor, query }) => searchPeople(actor, (query.get('q') ?? '').slice(0, 200))),
  open('persons/:id/stories', 'Stories told about a person', ({ actor, params }) => stories.listStories(actor, params.id)),
  open('stories/:id/audio', 'The voice of a story, with seeking', ({ actor, params, req }) => audioResponse(stories.storyAudio(actor, params.id), req)),
  human('GET', 'stories/usage', 'Room taken by voices', ({ actor }) => stories.voiceUsage(actor)),
  human('POST', 'stories', 'Add a story, or suggest one', async ({ actor, req }) => {
    const form = await req.formData()
    const file = form.get('audio')
    return addStory(actor, JSON.parse(String(form.get('story') ?? '{}')), file instanceof File ? { buf: Buffer.from(await file.arrayBuffer()), name: file.name } : null)
  }),
  human('GET', 'link-address', 'The address links should lead to', () => ({ address: sharedAddress() })),
  human('GET', 'story-requests', 'Links asking someone to tell a story', ({ actor }) => requests.listRequests(actor)),
  human('POST', 'story-requests', 'Ask someone to tell a story, by a link', async ({ actor, body }) => requests.createRequest(actor, await body())),
  human('DELETE', 'story-requests/:id', 'Close such a link', ({ actor, params }) => requests.closeRequest(actor, params.id)),
  human('PATCH', 'stories/:id', 'Change a story', async ({ actor, params, body }) => stories.updateStory(actor, params.id, await body())),
  human('DELETE', 'stories/:id', 'Delete a story', ({ actor, params }) => stories.deleteStory(actor, params.id)),
  human('GET', 'proposals/:id/ops/:index/audio', 'Hear a story before accepting it', ({ actor, params, req }) => audioResponse(queuedAudio(actor, params.id, Number(params.index)), req)),

  op('POST', 'pages', 'create_page'),
  open('pages/:id', 'A page with its text', ({ actor, params }) => pages.getPage(actor, params.id)),
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
  open('media/:id', 'A photo with its tags', ({ actor, params }) => media.getMedia(actor, params.id)),
  op('PATCH', 'media/:id', 'update_photo', ({ params }, b) => ({ ...b, id: params.id })),
  op('DELETE', 'media/:id', 'delete_photo', ({ params }) => ({ id: params.id })),
  open('media/:id/file', 'The file itself; size=thumb, medium or orig', async ({ actor, params, query }) => {
    const size = z.enum(['thumb', 'medium', 'orig']).catch('medium').parse(query.get('size'))
    const f = await media.readMediaFile(actor, params.id, size)
    const headers: Record<string, string> = { 'Content-Type': f.mime, 'Cache-Control': 'private, max-age=31536000, immutable' }
    if (f.download) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`
    return new Response(new Uint8Array(f.data), { headers })
  }),
  op('POST', 'media/:id/tags', 'tag_photo', ({ params }, b) => ({ ...b, mediaId: params.id })),
  op('DELETE', 'tags/:id', 'untag_photo', ({ params }) => ({ id: params.id })),
]
