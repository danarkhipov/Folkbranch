import { headers } from 'next/headers'
import { z } from 'zod'
import { fromOurPages } from '@/lib/same-origin'
import { chooseModel, connectProvider, currentProvider, disconnectProvider, providerStatus } from '@/lib/agent/provider-key'
import { getActor, hasBearer } from '@/lib/api-auth'
import { parseFamilyText, planFamilyText, serializeFamilyText } from '@/lib/textformat'
import { Actor, OpError, requireRole } from '@/lib/ops/core'
import * as people from '@/lib/ops/people'
import * as pages from '@/lib/ops/pages'
import * as media from '@/lib/ops/media'
import * as settings from '@/lib/ops/settings'
import * as gedcom from '@/lib/ops/gedcom'
import * as tokens from '@/lib/ops/tokens'
import { acceptProposal, dispatch, listProposals, myProposals, OPS, rejectProposal, removeProposalOp } from '@/lib/ops/registry'

export const dynamic = 'force-dynamic'

type Ctx = { actor: Actor; params: Record<string, string>; req: Request; query: URLSearchParams; body: () => Promise<any> }
type Handler = (c: Ctx) => unknown | Promise<unknown>
interface Route { method: string; path: string; handler: Handler; summary: string; op?: string; human?: boolean }

const role = z.enum(['owner', 'editor', 'reader'])

const get = (path: string, summary: string, handler: Handler): Route => ({ method: 'GET', path, summary, handler })
/** A write for signed-in people only; tokens are refused before it runs. */
const human = (method: string, path: string, summary: string, handler: Handler): Route => ({ method, path, summary, handler, human: true })
/** A write through the operation registry, so a token's call lands in the review queue. */
const op = (method: string, path: string, name: string, toArgs: (c: Ctx, body: any) => unknown = (_, b) => b): Route => ({
  method, path, op: name, summary: OPS[name].description,
  handler: async (c) => dispatch(c.actor, name, toArgs(c, method === 'DELETE' || path.endsWith('/undo') ? null : await c.body())),
})

const routes: Route[] = [
  get('me', 'Who is calling', ({ actor }) => ({ id: actor.userId, name: actor.name, role: actor.role, personId: actor.personId })),
  human('PATCH', 'me', 'Link my account to a card', async ({ actor, body }) => settings.setMyPerson(actor, z.object({ personId: z.string().nullable() }).parse(await body()).personId)),
  get('graph', 'Everyone and all links', ({ actor }) => people.getGraph(actor)),

  op('POST', 'persons', 'create_person'),
  op('PATCH', 'persons/:id', 'update_person', ({ params }, patch) => ({ id: params.id, patch })),
  op('DELETE', 'persons/:id', 'delete_person', ({ params }) => ({ id: params.id })),
  get('persons/:id/avatar', 'Avatar image', async ({ actor, params }) => {
    const p = people.getPersonRow(params.id)
    if (people.hiddenFor(actor, p) || !p.avatarMediaId) throw new OpError(404, 'no avatar')
    return new Response(new Uint8Array(await media.readAvatar(p.avatarMediaId, p.avatarCrop)), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=31536000, immutable' } })
  }),
  op('PUT', 'persons/:id/avatar', 'set_avatar', ({ params }, b) => ({ ...b, personId: params.id })),
  get('persons/:id/pages', 'Pages about a person', ({ actor, params }) => pages.listPages(actor, params.id)),
  get('persons/:id/media', 'Photos of a person', ({ actor, params }) => media.listPersonMedia(actor, params.id)),

  op('POST', 'relations', 'add_relation'),
  op('POST', 'relations/remove', 'remove_parent_links'),
  op('PATCH', 'relations/:type/:id', 'update_relation', ({ params }, b) => ({ ...b, type: params.type, id: params.id })),
  op('DELETE', 'relations/:type/:id', 'remove_relation', ({ params }) => ({ type: params.type, id: params.id })),

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

  get('history', 'Recent changes', ({ actor, query }) => settings.listHistory(actor, Math.min(Number(query.get('limit')) || 100, 500))),
  op('POST', 'history/:id/undo', 'undo', ({ params }) => ({ historyId: params.id })),

  get('text/export', 'The graph in the text format', ({ actor }) => new Response(serializeFamilyText(people.getGraph(actor), settings.getSetting('familyName') ?? ''), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })),
  { method: 'POST', path: 'text/preview', summary: 'What a text import would do, changing nothing', handler: async ({ actor, body }) => {
    const b = OPS.import_text.input.parse(await body()) as { text: string; resolutions?: Record<string, string> }
    const { ops, ...plan } = planFamilyText(parseFamilyText(b.text), people.getGraph(actor), b.resolutions)
    return { ...plan, operations: ops.length }
  } },
  op('POST', 'text/import', 'import_text'),

  human('POST', 'gedcom/preview', 'Count what a GEDCOM file holds', async ({ actor, req }) => gedcom.previewGedcom(actor, await req.text())),
  { method: 'POST', path: 'gedcom/import', summary: OPS.import_gedcom.description, op: 'import_gedcom', handler: async ({ actor, req }) => dispatch(actor, 'import_gedcom', { text: await req.text() }) },
  get('gedcom/export', 'The graph as GEDCOM; living=hide hides the living', ({ actor, query }) =>
    new Response(gedcom.exportGedcom(actor, query.get('living') === 'hide'), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': 'attachment; filename="family.ged"' } })),

  get('proposals', 'Drafts waiting for review (people only)', ({ actor }) => listProposals(actor)),
  get('proposals/mine', "This token's recent drafts", ({ actor }) => myProposals(actor)),
  human('POST', 'proposals/:id/accept', 'Apply a draft', ({ actor, params }) => acceptProposal(actor, params.id)),
  human('POST', 'proposals/:id/reject', 'Reject a draft', ({ actor, params }) => rejectProposal(actor, params.id)),
  human('DELETE', 'proposals/:id/ops/:index', 'Drop one line of a draft', ({ actor, params }) => removeProposalOp(actor, params.id, Number(params.index))),

  human('GET', 'tokens', 'API tokens', ({ actor }) => tokens.listTokens(actor)),
  human('POST', 'tokens', 'Issue an API token', async ({ actor, body }) => tokens.createToken(actor, z.object({ expiresInDays: z.number().int().min(1).max(3650).nullish(), name: z.string().min(1), role: z.enum(['reader', 'editor']), review: z.boolean().default(true) }).parse(await body()))),
  human('DELETE', 'tokens/:id', 'Revoke an API token', ({ actor, params }) => tokens.revokeToken(actor, params.id)),

  human('GET', 'settings', 'Archive settings', () => ({ familyName: settings.getSetting('familyName') ?? '', language: settings.getSetting('language') ?? 'ru', assistantEnabled: settings.getSetting('assistantEnabled') === '1', assistantForReaders: settings.getSetting('assistantForReaders') === '1', assistantProvider: currentProvider()?.label ?? null, assistantModel: currentProvider()?.model ?? null })),
  human('PATCH', 'settings', 'Change archive settings', async ({ actor, body }) => {
    requireRole(actor, 'owner')
    const b = z.object({ familyName: z.string().min(1), language: z.enum(['ru', 'en']), assistantEnabled: z.enum(['0', '1']), assistantForReaders: z.enum(['0', '1']), }).partial().parse(await body())
    Object.entries(b).forEach(([k, v]) => settings.setSetting(k, v!))
  }),
  human('GET', 'invites', 'Open invitations', ({ actor }) => settings.listInvites(actor)),
  human('POST', 'invites', 'Create an invitation', async ({ actor, body }) => settings.createInvite(actor, z.object({ name: z.string().min(1), role, personId: z.string().nullish(), userId: z.string().nullish() }).parse(await body()))),
  human('DELETE', 'invites/:id', 'Revoke an invitation', ({ actor, params }) => settings.revokeInvite(actor, params.id)),
  human('GET', 'users', 'People with access', ({ actor }) => settings.listUsers(actor)),
  human('GET', 'assistant/provider', 'Which AI provider is connected', ({ actor }) => providerStatus(actor)),
  human('PUT', 'assistant/provider', 'Connect an AI provider with a key', async ({ actor, body }) => connectProvider(actor, await body())),
  human('PATCH', 'assistant/provider', 'Choose another model', async ({ actor, body }) => chooseModel(actor, await body())),
  human('DELETE', 'assistant/provider', 'Remove the key set in the app', ({ actor }) => disconnectProvider(actor)),
  human('PATCH', 'users/:id', 'Change a role', async ({ actor, params, body }) => settings.setUserRole(actor, params.id, z.object({ role }).parse(await body()).role)),
  human('DELETE', 'users/:id', 'Remove access', ({ actor, params }) => settings.removeUser(actor, params.id)),
]

function openApi() {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const r of routes) {
    if (r.human) continue
    const path = `/api/v1/${r.path.replace(/:(\w+)/g, '{$1}')}`
    const parameters = [...r.path.matchAll(/:(\w+)/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }))
    const schema = r.op && r.method !== 'DELETE' ? z.toJSONSchema(OPS[r.op].input, { unrepresentable: 'any' }) : null
    ;(paths[path] ??= {})[r.method.toLowerCase()] = {
      summary: r.summary,
      ...(parameters.length ? { parameters } : {}),
      ...(schema ? { requestBody: { content: { 'application/json': { schema } } } } : {}),
      responses: { 200: { description: 'Done' }, ...(r.op ? { 202: { description: 'Queued for review: status pending_review, with a temporary id' } } : {}), 401: { description: 'No valid token' }, 403: { description: 'Not allowed' } },
    }
  }
  return {
    openapi: '3.1.0',
    info: { title: 'Family Graph API', version: '1' },
    components: { securitySchemes: { token: { type: 'http', scheme: 'bearer' } } },
    security: [{ token: [] }],
    paths,
  }
}

function match(method: string, path: string[]) {
  for (const r of routes) {
    if (r.method !== method) continue
    const parts = r.path.split('/')
    if (parts.length !== path.length) continue
    const params: Record<string, string> = {}
    if (parts.every((p, i) => (p[0] === ':' ? ((params[p.slice(1)] = path[i]), true) : p === path[i]))) return { route: r, params }
  }
  return null
}

/** The largest upload, as base64, with room for its envelope. */
const MAX_BODY = 60 * 1024 * 1024

const isDiskFull = (e: unknown) => ['ENOSPC', 'SQLITE_FULL'].includes((e as { code?: string })?.code ?? '')

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const path = (await ctx.params).path
  if (req.method === 'GET' && path.join('/') === 'openapi.json') return Response.json(openApi())
  const found = match(req.method, path)
  if (!found) return Response.json({ error: 'not found' }, { status: 404 })
  // Before the body is read into memory.
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return Response.json({ error: 'file too large' }, { status: 413 })
  try {
    const h = await headers()
    // Cookies travel on their own, so writes with a cookie must come from our own pages.
    if (!hasBearer(h) && req.method !== 'GET' && !fromOurPages(h)) return Response.json({ error: 'bad origin' }, { status: 403 })
    const actor = await getActor(h)
    if (!actor) return Response.json({ error: 'unauthorized' }, { status: 401 })
    if (actor.tokenId && found.route.human) return Response.json({ error: 'not available to tokens' }, { status: 403 })
    const result = await found.route.handler({ actor, params: found.params, req, query: new URL(req.url).searchParams, body: () => req.json() })
    if (result instanceof Response) return result
    return Response.json(result ?? { ok: true }, { status: (result as { status?: string } | null)?.status === 'pending_review' ? 202 : 200 })
  } catch (e) {
    if (e instanceof OpError) return Response.json({ error: e.message }, { status: e.status })
    if (e instanceof z.ZodError) return Response.json({ error: e.issues }, { status: 400 })
    if (e instanceof SyntaxError) return Response.json({ error: 'invalid JSON' }, { status: 400 })
    if (isDiskFull(e)) return Response.json({ error: 'the server disk is full' }, { status: 507 })
    console.error(e)
    return Response.json({ error: 'server error' }, { status: 500 })
  }
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE }
