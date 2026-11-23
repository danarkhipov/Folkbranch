/* eslint-disable @typescript-eslint/no-explicit-any -- tool answers are read as the JSON they are */
// What a person does on the screen, an outside agent over MCP and the built-in assistant can do too, unless it is
// listed here with the reason it must not. A new route or operation with no tool and no reason fails the last test.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import { assistantActor } from '../lib/agent/agent'
import { getDb, schema } from '../lib/db'
import { accessRoutes } from '../lib/api/routes/access'
import { contentRoutes } from '../lib/api/routes/content'
import { exchangeRoutes } from '../lib/api/routes/exchange'
import { familyRoutes } from '../lib/api/routes/family'
import { faceRoutes } from '../lib/api/routes/faces'
import { speechRoutes } from '../lib/api/routes/speech'
import { buildMcpServer } from '../lib/mcp'
import { OpError, type Actor } from '../lib/ops/core'
import { uploadMedia } from '../lib/ops/media'
import { requestInfo } from '../lib/ops/story-requests'
import { OPS } from '../lib/ops/registry'
import { TOOLS, toolsFor } from '../lib/ops/tools'
import { editor, loadFamily, owner, reader } from './fixture-family'

let f: Awaited<ReturnType<typeof loadFamily>>
beforeAll(async () => { f = await loadFamily() })

const token = (review: boolean): Actor => ({ userId: 'u-token', name: 'Агент', role: 'editor', personId: null, tokenId: review ? 't-review' : 't-direct', review })
const tool = (name: string) => TOOLS.find((t) => t.name === name)!
const run = (a: Actor, name: string, args: Record<string, unknown> = {}) => { const t = tool(name); return Promise.resolve().then(() => t.run(a, t.input.parse(args))) as Promise<any> }
const asAssistant = (a: Actor) => assistantActor(a)

describe('links that ask a relative for a story', () => {
  it('an editor token gets the link in the answer; a list never shows it', async () => {
    const made = await run(token(false), 'create_story_request', { personId: f.nikolai.id, tellerName: 'Тётя Нина', question: 'Как вы познакомились?' })
    expect(made).toMatchObject({ created: true })
    expect(made.url).toMatch(/\/tell\/[\w-]{20,}$/)
    const secret = made.url.split('/tell/')[1]
    expect(requestInfo(secret)).toMatchObject({ about: expect.stringContaining('Соколов') })
    const listed = await run(token(false), 'list_story_requests')
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ personId: f.nikolai.id, tellerName: 'Тётя Нина', waiting: 0, state: 'waiting for a recording' })
    expect(JSON.stringify(listed)).not.toContain(secret)
    expect(Object.keys(listed[0])).not.toContain('tokenHash')
  })

  it('the model of the assistant never sees the link; the person does', async () => {
    const def = tool('create_story_request')
    const out = await run(asAssistant(owner), 'create_story_request', { personId: f.ivan.id })
    expect(out.link).toMatch(/^\/tell\//)
    expect(JSON.stringify(def.forModel!(out))).not.toContain(out.link.slice(6))
    expect(def.forModel!(out)).toMatchObject({ created: true })
  })

  it('a token whose edits go to review cannot make one, and a reader cannot see or make any', async () => {
    await expect(run(token(true), 'create_story_request', { personId: f.ivan.id })).rejects.toMatchObject({ status: 403 })
    for (const name of ['list_story_requests', 'create_story_request', 'revoke_story_request']) expect(toolsFor(reader, 'mcp').map((t) => t.name), name).not.toContain(name)
    await expect(run(reader, 'list_story_requests')).rejects.toBeInstanceOf(OpError)
  })

  it('revoking closes the link, and an unknown id is an error', async () => {
    const made = await run(token(false), 'create_story_request', { personId: f.maria.id })
    const secret = made.url.split('/tell/')[1]
    const id = (await run(token(false), 'list_story_requests')).find((r: any) => r.personId === f.maria.id).id
    expect(await run(token(false), 'revoke_story_request', { id })).toMatchObject({ ok: true })
    expect(requestInfo(secret)).toBeNull()
    await expect(run(token(false), 'revoke_story_request', { id })).rejects.toMatchObject({ status: 404 })
  })
})

describe('merging', () => {
  it('shows what a merge would do and why one is refused, but a merge is still a person’s own act', async () => {
    const refused = await run(editor, 'preview_merge', { keepId: f.nikolai.id, dropId: f.ivan.id })
    expect(typeof refused.blocked).toBe('string')
    expect(refused.blocked.length).toBeGreaterThan(10)
    const { createPerson } = await import('../lib/ops/people')
    const p1 = createPerson(owner, { givenName: 'Пётр', surname: 'Сравнимов', birthDate: '1950' }), p2 = createPerson(owner, { givenName: 'Пётр', surname: 'Сравнимов', birthDate: '1951' })
    const fine = await run(editor, 'preview_merge', { keepId: p1.id, dropId: p2.id })
    expect(fine.blocked).toBeNull()
    expect(fine.fields.length).toBeGreaterThan(5)
    expect(TOOLS.some((t) => t.name === 'merge_people')).toBe(false)
    await expect(run(reader, 'preview_merge', { keepId: f.maria.id, dropId: f.varvara.id })).rejects.toBeInstanceOf(OpError)
  })

  it('finds cards that may be one person', async () => {
    const twin = (await import('../lib/ops/people')).createPerson(owner, { givenName: 'Иван', surname: 'Соколов', birthDate: '1890', birthPlace: 'Тула' })
    const found = await run(editor, 'find_duplicates')
    expect(found.some((d: any) => [d.a.id, d.b.id].includes(twin.id) && [d.a.id, d.b.id].includes(f.ivan.id))).toBe(true)
  })

  it('merges two records of one place as one history entry, and one undo brings them back', async () => {
    const places = await import('../lib/ops/places')
    const a = places.savePlace(owner, null, { name: 'Озёрки', kind: 'Деревня', lat: 55.1, lon: 37.1 })
    const b = places.savePlace(owner, null, { name: 'озерки', kind: 'Деревня' })
    const similar = await run(editor, 'list_similar_places')
    expect(similar.some((p: any) => [p.a.id, p.b.id].sort().join() === [a.id, b.id].sort().join())).toBe(true)
    const before = getDb().select().from(schema.history).all().length
    await run(asAssistant(editor), 'merge_places', { keepId: a.id, dropId: b.id })
    expect(getDb().select().from(schema.history).all().length).toBe(before + 1)
    expect(places.listPlaces(owner).some((p) => p.id === b.id)).toBe(false)
    expect(tool('merge_places')).toMatchObject({ risk: 'danger', minRole: 'editor' })
    // A token whose edits go to review only queues it.
    const c = places.savePlace(owner, null, { name: 'Берёзки' })
    const d = places.savePlace(owner, null, { name: 'берёзки' })
    expect(await run(token(true), 'merge_places', { keepId: c.id, dropId: d.id })).toMatchObject({ status: 'pending_review' })
    expect(places.listPlaces(owner).some((p) => p.id === d.id)).toBe(true)
  })
})

describe('rolling back', () => {
  it('rollback_to is the owner’s, in the chat only; undo_person is an editor’s, and both are asked for every time', () => {
    expect(tool('rollback_to')).toMatchObject({ risk: 'danger', minRole: 'owner', surfaces: ['assistant'] })
    expect(tool('undo_person')).toMatchObject({ risk: 'danger', minRole: 'editor', surfaces: ['mcp', 'assistant'] })
    expect(toolsFor(editor, 'assistant').map((t) => t.name)).not.toContain('rollback_to')
    expect(toolsFor(token(false), 'mcp').map((t) => t.name)).not.toContain('rollback_to')
    expect(toolsFor(owner, 'assistant').map((t) => t.name)).toContain('rollback_to')
  })

  it('undo_person takes back one card’s part of a change, by the token that made it', async () => {
    const t = token(false)
    const made = await run(t, 'create_person', { person: { givenName: 'Отмена', surname: 'Тестова' } })
    const id = made.id as string
    const entry = getDb().select().from(schema.history).all().filter((h) => h.tokenId === 't-direct' && h.changes.includes(id)).at(-1)!
    expect(await run(t, 'undo_person', { historyId: entry.id, personId: id })).toMatchObject({ undone: true })
    // Another token's change is not this token's to undo.
    const other = await run({ ...t, tokenId: 't-other' }, 'create_person', { person: { givenName: 'Чужой', surname: 'Тестов' } })
    const theirs = getDb().select().from(schema.history).all().filter((h) => h.tokenId === 't-other' && h.changes.includes(other.id)).at(-1)!
    await expect(run(t, 'undo_person', { historyId: theirs.id, personId: other.id })).rejects.toMatchObject({ status: 403 })
  })

  it('rollback_to takes back the owner’s chosen change and the ones after it', async () => {
    const o = asAssistant(owner)
    const first = await run(o, 'create_person', { person: { givenName: 'Первый', surname: 'Откатов' } })
    const second = await run(o, 'create_person', { person: { givenName: 'Второй', surname: 'Откатов' } })
    const entry = getDb().select().from(schema.history).all().filter((h) => !h.undoOf && h.changes.includes(first.id)).at(-1)!
    expect((await run(o, 'rollback_to', { historyId: entry.id })).count).toBeGreaterThanOrEqual(2)
    const left = (await import('../lib/ops/people')).getGraph(owner).persons.map((p) => p.id)
    expect(left).not.toContain(first.id)
    expect(left).not.toContain(second.id)
  })
})

describe('a photo over MCP', () => {
  async function client(a: Actor) {
    const [x, y] = InMemoryTransport.createLinkedPair()
    await buildMcpServer(a).connect(y)
    const c = new Client({ name: 'test', version: '1' })
    await c.connect(x)
    return c
  }

  it('comes back as the picture, small enough to send, and a living relative’s photo is refused to a reader', async () => {
    const jpeg = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#a33' } }).jpeg().toBuffer()
    const photo = await uploadMedia(owner, jpeg, 'большое.jpg', f.ivan.id)
    const c = await client(token(false))
    const res = (await c.callTool({ name: 'view_photo', arguments: { id: photo.id } })) as { content: { type: string; data?: string; mimeType?: string }[] }
    const image = res.content.find((p) => p.type === 'image')!
    expect(image.mimeType).toBe('image/jpeg')
    expect((await sharp(Buffer.from(image.data!, 'base64')).metadata()).width).toBeLessThanOrEqual(1568)
    const secret = await uploadMedia(owner, jpeg, 'живой.jpg', f.living.id)
    const readerClient = await client({ userId: 'r', name: 'Читатель', role: 'reader', personId: null, tokenId: 't-reader', review: true })
    const denied = (await readerClient.callTool({ name: 'view_photo', arguments: { id: secret.id } })) as { isError?: boolean }
    expect(denied.isError).toBe(true)
  })
})

// ── Parity ──────────────────────────────────────────────────────────────────────────────────────────────

/** Operations an agent has no tool for, and why. */
const OP_ALLOWLIST: Record<string, string> = {
  create_story: 'needs an audio recording uploaded with it, which a tool call cannot carry; a story arrives through a link (create_story_request) or the app, and waits for review',
}
/** Operations that are tools for the assistant only. */
const ASSISTANT_ONLY_OPS: Record<string, string> = {
  rollback_to: 'takes back everyone’s later changes: the owner, in the chat, asked each time; a token is never the owner',
}

/** Routes a token may call, and the tool that does the same. */
const ROUTE_TOOL: Record<string, string> = {
  'GET proposals': 'my_proposals', 'GET proposals/mine': 'my_proposals',
  'GET search': 'search_archive', 'GET gaps': 'find_gaps', 'GET history': 'get_history',
  'GET media': 'list_photos', 'GET media/:id': 'list_photos', 'GET media/:id/file': 'view_photo', 'GET persons/:id/media': 'list_photos',
  'GET text/export': 'export_text', 'POST text/preview': 'preview_text', 'GET gedcom/export': 'export_gedcom',
  'GET places': 'list_places', 'GET place-guesses': 'get_place_suggestions',
  'GET me': 'get_overview', 'GET graph': 'get_person', 'GET pages/:id': 'get_page', 'GET persons/:id/pages': 'list_pages',
  'GET persons/:id/stories': 'GAP',
  'GET persons/:id/history': 'GAP', 'GET repositories': 'GAP', 'GET views': 'GAP', 'GET persons/:id/avatar': 'GAP', 'GET stories/:id/audio': 'GAP',
}
/** The same, for what only a signed-in person may call: either a tool exists, or the reason it must not. */
const HUMAN_TOOL: Record<string, string> = {
  'GET story-requests': 'list_story_requests', 'POST story-requests': 'create_story_request', 'DELETE story-requests/:id': 'revoke_story_request',
  'GET duplicates': 'find_duplicates', 'GET merge/preview': 'preview_merge',
  'POST places': 'create_place', 'PUT places/:id': 'update_place', 'POST places/:id/merge': 'merge_places', 'POST place-guesses': 'update_place',
  'GET settings': 'get_settings', 'PATCH settings': 'update_settings', 'GET users': 'list_users', 'PATCH users/:id': 'set_user_role',
  'GET invites': 'list_invites', 'POST invites': 'create_invite', 'DELETE invites/:id': 'revoke_invite',
  'POST gedcom/preview': 'preview_gedcom', 'POST case/preview': 'import_kinship_case',
}
/** Screen-only on purpose, by the start of the path. */
const UI_ONLY: [RegExp, string][] = [
  [/^(ai\/|ai-settings|assistant\/)/, 'secrets and settings of the AI itself: a key must never pass through a model'],
  [/^(tokens|sign-in-methods|shares|update|backups|setup|users\/:id|invites)/, 'access, sign-in, sharing, updates and backups: the owner’s own screens'],
  [/^(faces|transcri)/, 'cloud services with their own keys and a person’s recordings and scans'],
  [/^(proposals\/:id|proposals\/suggest)/, 'accepting or rejecting a draft is a person’s decision; an agent’s own drafts are my_proposals'],
  [/^(persons\/:id\/contacts)/, 'how to reach a living relative: private, for editors’ eyes only'],
  [/^(presence|link-address|views|me$)/, 'what is on a person’s own screen'],
  [/^demo\/ai$/, 'the public demo’s message counter, shown in the assistant panel'],
  [/^(stories|proposals\/:id\/ops)/, 'a story is a recording: it goes through a link or the app and waits for review (see create_story)'],
  [/^(merge$|duplicates\/dismiss)/, 'merging two cards is a person’s own act (mergePeople refuses a token and the assistant); the tools only compare'],
  [/^(places\/:id$|repositories)/, 'deleting a place or an archive, and the list of archives: left to the screen, not asked for yet'],
]

const routes = [...accessRoutes, ...contentRoutes, ...exchangeRoutes, ...familyRoutes, ...Object.values({ faceRoutes }).flat(), ...Object.values({ speechRoutes }).flat()]

describe('every operation and route has a tool, or a reason', () => {
  it('every registry operation is a tool on MCP, or listed here with its reason', () => {
    const onMcp = new Set(TOOLS.filter((t) => t.surfaces.includes('mcp')).map((t) => t.name))
    const onAssistant = new Set(TOOLS.filter((t) => t.surfaces.includes('assistant')).map((t) => t.name))
    for (const name of Object.keys(OPS)) {
      if (OP_ALLOWLIST[name]) { expect(onMcp.has(name) || onAssistant.has(name), `${name} is listed as having no tool but has one`).toBe(false); continue }
      expect(onAssistant.has(name), `${name} has no tool for the assistant`).toBe(true)
      if (ASSISTANT_ONLY_OPS[name]) expect(onMcp.has(name), `${name} is listed as assistant-only`).toBe(false)
      else expect(onMcp.has(name), `${name} has no tool on MCP: add one, or list it with its reason`).toBe(true)
    }
  })

  it('every API route maps to a tool, or is screen-only for a stated reason', () => {
    const unmapped: string[] = []
    for (const r of routes as { method: string; path: string; op?: string; human?: boolean }[]) {
      if (!r?.method) continue
      const key = `${r.method} ${r.path}`
      if (r.op) { expect(TOOLS.some((t) => t.name === r.op && t.surfaces.includes('assistant')), `${key} → ${r.op}`).toBe(true); continue }
      const named = (r.human ? HUMAN_TOOL : ROUTE_TOOL)[key] ?? HUMAN_TOOL[key] ?? ROUTE_TOOL[key]
      if (named === 'GAP') continue
      if (named) { expect(TOOLS.some((t) => t.name === named), `${key} → ${named}`).toBe(true); continue }
      if (r.human && UI_ONLY.some(([re]) => re.test(r.path))) continue
      unmapped.push(key)
    }
    expect(unmapped, 'a route with no tool and no reason: add the tool, or list it with its reason').toEqual([])
  })

  it('what cannot be reached from MCP is the same short list the docs name', () => {
    expect(Object.keys(OP_ALLOWLIST).concat(Object.keys(ASSISTANT_ONLY_OPS)).sort()).toEqual(['create_story', 'rollback_to'])
    expect(Object.entries(ROUTE_TOOL).filter(([, v]) => v === 'GAP').map(([k]) => k).sort()).toEqual(['GET persons/:id/avatar', 'GET persons/:id/history', 'GET persons/:id/stories', 'GET repositories', 'GET stories/:id/audio', 'GET views'])
  })
})
