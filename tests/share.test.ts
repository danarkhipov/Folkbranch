import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { getDb, schema } from '../lib/db'
import type { Actor } from '../lib/ops/core'
import * as media from '../lib/ops/media'
import * as pages from '../lib/ops/pages'
import * as people from '../lib/ops/people'
import { acceptProposal, listProposals, myProposals, rejectProposal } from '../lib/ops/proposals'
import { createShare, guestFromCookie, listShares, openShare, revokeShare, shareInfo } from '../lib/ops/share'
import { suggest } from '../lib/ops/suggest'
import * as tokens from '../lib/ops/tokens'
import * as views from '../lib/ops/views'
import sharp from 'sharp'

const owner: Actor = { userId: 'o', name: 'Хозяйка', role: 'owner', personId: null }
const editor: Actor = { userId: 'e', name: 'Редактор', role: 'editor', personId: null }
const reader: Actor = { userId: 'r', name: 'Тётя', role: 'reader', personId: null }
const make = (givenName: string, living = false) => (people.createPerson(owner, { givenName, surname: 'Тестов', living } as never) as unknown as { id: string }).id
const guestOf = (token: string, password?: string) => guestFromCookie(openShare(token, password).cookie)!
let dad: string, son: string, stranger: string, alive: string

beforeAll(() => {
  dad = make('Отец')
  son = make('Сын')
  stranger = make('Чужой')
  alive = make('Живая', true)
  people.linkPeople(owner, 'son', dad, son)
  people.linkPeople(owner, 'daughter', dad, alive)
})

describe('who a route lets in with a link', () => {
  it('is an explicit short list, and all of it reads', () => {
    const open = ['family', 'content', 'exchange', 'access'].flatMap((f) => [...readFileSync(`lib/api/routes/${f}.ts`, 'utf8').matchAll(/\bopen\('([^']+)'/g)].map((m) => m[1]))
    expect(open.sort()).toEqual(['graph', 'me', 'media/:id', 'media/:id/file', 'pages/:id', 'persons/:id/avatar', 'persons/:id/media', 'persons/:id/pages', 'persons/:id/stories', 'places', 'repositories', 'search', 'stories/:id/audio', 'views'])
    expect(readFileSync('lib/api/router.ts', 'utf8')).toMatch(/export const open = \(path: string, summary: string, handler: Handler\): Route => \(\{ \.\.\.get\(/)
  })
})

describe('links for viewing', () => {
  it('only the owner makes them, and the link itself is not stored', () => {
    expect(() => createShare(editor, { name: 'x' })).toThrow('forbidden')
    expect(() => createShare(reader, { name: 'x' })).toThrow('forbidden')
    const { token } = createShare(owner, { name: 'Кузен' })
    expect(JSON.stringify(getDb().select().from(schema.shareLinks).all())).not.toContain(token)
    expect(shareInfo(token)).toEqual({ needsPassword: false })
    expect(listShares(owner).some((l) => l.name === 'Кузен')).toBe(true)
  })

  it('a guest sees what a reader sees: the living are masked', () => {
    const g = guestOf(createShare(owner, { name: 'a' }).token)
    expect(g.role).toBe('reader')
    const p = people.getGraph(g).persons
    expect(p.find((x) => x.id === alive)).toMatchObject({ hidden: true, givenName: '' })
    expect(p.find((x) => x.id === dad)?.givenName).toBe('Отец')
    expect(() => pages.listPages(g, alive)).toThrow()
  })

  it('a link to a view holds only that view: the rest is gone, not masked', async () => {
    const { id } = views.createView(owner, { name: 'Ветка отца', scope: 'descendants', focusId: dad, collapsed: [] })
    const g = guestOf(createShare(owner, { name: 'b', viewId: id }).token)
    const ids = people.getGraph(g).persons.map((x) => x.id)
    expect(ids).toEqual(expect.arrayContaining([dad, son, alive]))
    expect(ids).not.toContain(stranger)
    expect(() => pages.listPages(g, stranger)).toThrow()
    expect(views.listViews(g).every((v) => !v.name)).toBe(true)
    // A photo of someone outside the view, and one with nobody marked on it, stay out too.
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#888' } }).png().toBuffer()
    const theirs = (await media.uploadMedia(owner, png, 'a.png', stranger)).id
    const nobody = (await media.uploadMedia(owner, png, 'b.png', null)).id
    const ours = (await media.uploadMedia(owner, png, 'c.png', son)).id
    expect(media.canSeeMedia(g, theirs)).toBe(false)
    expect(media.canSeeMedia(g, nobody)).toBe(false)
    expect(media.canSeeMedia(g, ours)).toBe(true)
    expect(media.listAllMedia(g).map((m) => m.id)).toEqual([ours])
  })

  it('stops working when closed, when expired, and when its view is deleted', () => {
    const a = createShare(owner, { name: 'c' })
    const { cookie } = openShare(a.token, undefined)
    expect(guestFromCookie(cookie)).toBeTruthy()
    revokeShare(owner, listShares(owner).find((l) => l.name === 'c')!.id)
    expect(guestFromCookie(cookie)).toBeNull()
    expect(shareInfo(a.token)).toBeNull()
    expect(() => openShare(a.token, undefined)).toThrow()

    const b = createShare(owner, { name: 'd', expiresInDays: 1 })
    const late = openShare(b.token, undefined).cookie
    getDb().update(schema.shareLinks).set({ expiresAt: Date.now() - 1 }).run()
    expect(guestFromCookie(late)).toBeNull()

    const { id } = views.createView(owner, { name: 'Уйдёт', scope: 'near', focusId: dad, collapsed: [] })
    const c = openShare(createShare(owner, { name: 'e', viewId: id }).token, undefined).cookie
    expect(guestFromCookie(c)).toBeTruthy()
    views.deleteView(owner, id)
    expect(guestFromCookie(c)).toBeNull()
  })

  it('a forged cookie gets nothing', () => {
    const { cookie } = openShare(createShare(owner, { name: 'f' }).token, undefined)
    expect(guestFromCookie(cookie.slice(0, -1) + (cookie.endsWith('0') ? '1' : '0'))).toBeNull()
    expect(guestFromCookie(cookie.split('.')[0])).toBeNull()
    expect(guestFromCookie('')).toBeNull()
    expect(guestFromCookie(undefined)).toBeNull()
  })

  it('a password is checked, and guessing runs out', () => {
    const { token } = createShare(owner, { name: 'g', password: 'тайна' })
    expect(shareInfo(token)).toEqual({ needsPassword: true })
    expect(() => openShare(token, undefined)).toThrow()
    expect(() => openShare(token, 'нет')).toThrow()
    expect(guestOf(token, 'тайна')).toBeTruthy()
    let last: { status?: number } = {}
    for (let i = 0; i < 9; i++) try { openShare(token, 'нет') } catch (e) { last = e as { status: number } }
    expect(last.status).toBe(429)
    expect(() => openShare(token, 'тайна')).toThrow()
  })
})

describe('a reader suggesting a correction', () => {
  it('changes nothing until someone accepts, and the owner sees old and new', () => {
    suggest(reader, { personId: dad, patch: { birthPlace: 'Тула' }, note: 'со слов тёти' })
    expect(people.getPersonRow(dad).birthPlace).toBe('')
    const draft = listProposals(owner).find((d) => d.authorName === 'Тётя')!
    expect(draft.authorKind).toBe('person')
    expect(draft.ops[0].details).toEqual(expect.arrayContaining(['Место рождения:  → Тула', 'Откуда это известно: со слов тёти']))
    expect(myProposals(reader)[0].status).toBe('pending')
    acceptProposal(owner, draft.id)
    expect(people.getPersonRow(dad).birthPlace).toBe('Тула')
    expect(myProposals(reader)[0].status).toBe('applied')
  })

  it('free text becomes a page, as plain text, once accepted', () => {
    suggest(reader, { personId: son, text: '**Служил** на флоте.\n\n![](/api/v1/media/x/file)' })
    const draft = listProposals(owner).find((d) => d.authorName === 'Тётя')!
    expect(draft.ops[0].details).toContain('**Служил** на флоте.\n\n![](/api/v1/media/x/file)')
    acceptProposal(owner, draft.id)
    const [page] = pages.listPages(owner, son)
    const body = JSON.stringify(pages.getPage(owner, page.id).content)
    expect(body).toContain('**Служил** на флоте.')
    expect(body).not.toContain('"image"')
  })

  it('a rejected one leaves no trace in the archive', () => {
    suggest(reader, { personId: son, patch: { deathPlace: 'Нигде' } })
    rejectProposal(owner, listProposals(owner).find((d) => d.authorName === 'Тётя')!.id)
    expect(people.getPersonRow(son).deathPlace).toBe('')
  })

  it('what someone wrote in between is not overwritten', () => {
    suggest(reader, { personId: son, patch: { birthPlace: 'Орёл' } })
    people.updatePerson(owner, son, { birthPlace: 'Курск' } as never)
    const draft = listProposals(owner).find((d) => d.authorName === 'Тётя')!
    expect(() => acceptProposal(owner, draft.id)).toThrow()
    expect(people.getPersonRow(son).birthPlace).toBe('Курск')
    expect(listProposals(owner).find((d) => d.id === draft.id)?.error).toBeTruthy()
    rejectProposal(owner, draft.id)
  })

  it('nobody hidden, nobody else, no empty suggestions, no flood', () => {
    expect(() => suggest(reader, { personId: alive, patch: { givenName: 'Х' } })).toThrow('not found')
    expect(() => suggest(editor, { personId: dad, patch: { givenName: 'Х' } })).toThrow('forbidden')
    expect(() => suggest({ ...reader, tokenId: 't' }, { personId: dad, patch: { givenName: 'Х' } })).toThrow('forbidden')
    expect(() => suggest({ ...reader, assistant: true }, { personId: dad, patch: { givenName: 'Х' } })).toThrow('forbidden')
    expect(() => suggest(guestOf(createShare(owner, { name: 'h' }).token), { personId: dad, patch: { givenName: 'Х' } })).toThrow('forbidden')
    expect(() => suggest(reader, { personId: dad, patch: { givenName: 'Отец' } })).toThrow()
    // Only the fields of the form: nobody marks a person dead or alive, or changes groups, this way.
    suggest(reader, { personId: dad, patch: { deathPlace: 'Ока', living: true, tags: ['x'] } })
    const draft = listProposals(owner).find((d) => d.authorName === 'Тётя')!
    expect(draft.ops[0].details?.join()).not.toContain('Жив')
    let last: { status?: number } = {}
    for (let i = 0; i < 40; i++) try { suggest(reader, { personId: dad, text: `строка ${i}` }) } catch (e) { last = e as { status: number } }
    expect(last.status).toBe(429)
    rejectProposal(owner, draft.id)
  })

  it('tokens still queue under their own name', async () => {
    const { token } = tokens.createToken(owner, { name: 'робот', role: 'editor', review: true })
    const { dispatch } = await import('../lib/ops/proposals')
    await dispatch(tokens.actorFromToken(token)!, 'update_person', { id: dad, patch: { deathPlace: 'Дон' } })
    expect(listProposals(owner).find((d) => d.authorName === 'робот')?.authorKind).toBe('token')
  })
})
