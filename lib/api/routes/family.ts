import { z } from 'zod'
import { setFocus } from '@/lib/live'
import { OpError } from '@/lib/ops/core'
import * as media from '@/lib/ops/media'
import { dismissDuplicate, duplicateCandidates, mergePeople, previewMerge } from '@/lib/ops/merge-people'
import * as pages from '@/lib/ops/pages'
import * as people from '@/lib/ops/people'
import * as settings from '@/lib/ops/settings'
import * as views from '@/lib/ops/views'
import * as places from '@/lib/ops/places'
import { getContacts, saveContacts } from '@/lib/ops/contacts'
import { human, op, open, type Route } from '../router'

export const familyRoutes: Route[] = [
  open('places', 'Places with what they belong to and their other names', ({ actor }) => places.listPlaces(actor)),
  human('POST', 'places', 'Add a place', async ({ actor, body }) => places.savePlace(actor, null, await body())),
  human('PUT', 'places/:id', 'Change a place', async ({ actor, params, body }) => places.savePlace(actor, params.id, await body())),
  human('DELETE', 'places/:id', 'Delete a place; what was inside it moves up', ({ actor, params }) => places.deletePlace(actor, params.id)),
  open('repositories', 'Archives and other places sources are kept', ({ actor }) => places.listRepositories(actor)),
  human('POST', 'repositories', 'Add an archive', async ({ actor, body }) => places.saveRepository(actor, null, await body())),
  human('PUT', 'repositories/:id', 'Change an archive', async ({ actor, params, body }) => places.saveRepository(actor, params.id, await body())),
  human('DELETE', 'repositories/:id', 'Delete an archive', ({ actor, params }) => places.deleteRepository(actor, params.id)),
  human('GET', 'persons/:id/contacts', 'How to reach a living relative: editors only', ({ actor, params }) => getContacts(actor, params.id)),
  human('PUT', 'persons/:id/contacts', 'Change how to reach a living relative', async ({ actor, params, body }) => saveContacts(actor, params.id, await body())),
  open('views', 'Saved ways to look at the family', ({ actor }) => views.listViews(actor)),
  human('POST', 'views', 'Save a view', async ({ actor, body }) => views.createView(actor, await body())),
  human('DELETE', 'views/:id', 'Delete a view', ({ actor, params }) => views.deleteView(actor, params.id)),
  human('PUT', 'views/:id/pin', 'Place a card by hand, or let it go', async ({ actor, params, body }) => views.setPin(actor, params.id, await body())),
  human('DELETE', 'views/:id/pins', 'Let every card go', ({ actor, params }) => views.clearPins(actor, params.id)),
  open('me', 'Who is calling', ({ actor }) => ({ id: actor.userId, name: actor.name, role: actor.role, personId: actor.personId })),
  human('PATCH', 'me', 'Link my account to a card', async ({ actor, body }) => settings.setMyPerson(actor, z.object({ personId: z.string().nullable() }).parse(await body()).personId)),
  open('graph', 'Everyone and all links', ({ actor, req }) => {
    const page = people.graphForPage(actor)
    const tag: Record<string, string> = page.etag ? { ETag: page.etag, 'Cache-Control': 'private, no-cache' } : {}
    if (page.etag && req.headers.get('if-none-match') === page.etag) return new Response(null, { status: 304, headers: tag })
    return new Response(page.body(), { headers: { 'Content-Type': 'application/json', ...tag } })
  }),
  human('POST', 'presence', 'Which card this page has open', async ({ actor, body }) => {
    const b = z.object({ client: z.string(), focusId: z.string().nullable() }).parse(await body())
    setFocus(actor.userId, b.client, b.focusId)
    return { ok: true }
  }),

  human('GET', 'duplicates', 'People who may be the same person', ({ actor }) => duplicateCandidates(actor)),
  human('POST', 'duplicates/dismiss', 'These are two different people', async ({ actor, body }) => { const b = z.object({ a: z.string(), b: z.string() }).parse(await body()); dismissDuplicate(actor, b.a, b.b) }),
  human('GET', 'merge/preview', 'What merging two cards would do', ({ actor, query }) => previewMerge(actor, query.get('keep') ?? '', query.get('drop') ?? '')),
  human('POST', 'merge', 'Merge two cards into one', async ({ actor, body }) => mergePeople(actor, await body())),

  op('POST', 'persons', 'create_person'),
  op('PATCH', 'persons/:id', 'update_person', ({ params }, { seen, ...patch }) => ({ id: params.id, patch, seen })),
  op('DELETE', 'persons/:id', 'delete_person', ({ params }) => ({ id: params.id })),
  open('persons/:id/avatar', 'Avatar image', async ({ actor, params, req }) => {
    const p = people.getPersonRow(params.id)
    if (people.hiddenFor(actor, p) || !p.avatarMediaId) throw new OpError(404, 'no avatar')
    // Asked about each time, like photos: see media/:id/file.
    const etag = `"${p.avatarMediaId}-${p.updatedAt}"`
    if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'private, no-cache' } })
    return new Response(new Uint8Array(await media.readAvatar(p.avatarMediaId, p.avatarCrop)), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-cache', ETag: etag } })
  }),
  op('PUT', 'persons/:id/avatar', 'set_avatar', ({ params }, b) => ({ ...b, personId: params.id })),
  open('persons/:id/pages', 'Pages about a person', ({ actor, params }) => pages.listPages(actor, params.id)),
  open('persons/:id/media', 'Photos of a person', ({ actor, params }) => media.listPersonMedia(actor, params.id)),

  op('POST', 'relations', 'add_relation'),
  op('POST', 'relations/remove', 'remove_parent_links'),
  op('PATCH', 'relations/:type/:id', 'update_relation', ({ params }, b) => ({ ...b, type: params.type, id: params.id })),
  op('DELETE', 'relations/:type/:id', 'remove_relation', ({ params }) => ({ type: params.type, id: params.id })),
]
