import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { beforeAll, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { blocksToMarkdown, markdownToBlocks } from '../lib/markdown'
import { buildMcpServer } from '../lib/mcp'
import { parseFamilyText, planFamilyText, serializeFamilyText } from '../lib/textformat'
import type { Actor } from '../lib/ops/core'

const owner: Actor = { userId: 'o', name: 'Owner', role: 'owner', personId: null }

let people: typeof import('../lib/ops/people')
let pages: typeof import('../lib/ops/pages')
let media: typeof import('../lib/ops/media')
let tokens: typeof import('../lib/ops/tokens')
let reg: typeof import('../lib/ops/registry')
let core: typeof import('../lib/ops/core')
let settings: typeof import('../lib/ops/settings')
let db: typeof import('../lib/db')

beforeAll(async () => {
  ;[people, pages, media, tokens, reg, core, settings, db] = await Promise.all([import('../lib/ops/people'), import('../lib/ops/pages'), import('../lib/ops/media'), import('../lib/ops/tokens'), import('../lib/ops/registry'), import('../lib/ops/core'), import('../lib/ops/settings'), import('../lib/db')])
})

function issue(role: 'reader' | 'editor', review = true) {
  const { token } = tokens.createToken(owner, { name: `bot-${role}-${review}`, role, review })
  return tokens.actorFromToken(token)!
}

describe('tokens', () => {
  it('are stored hashed, stop working when revoked, and never become owners', () => {
    const { id, token } = tokens.createToken(owner, { name: 'x', role: 'editor', review: true })
    expect(token.startsWith('fg_')).toBe(true)
    expect(JSON.stringify(db.getDb().select().from(db.schema.apiTokens).all())).not.toContain(token)
    const actor = tokens.actorFromToken(token)!
    expect(actor.role).toBe('editor')
    expect(() => settings.createInvite(actor, { name: 'z', role: 'owner' })).toThrow('forbidden')
    expect(() => tokens.createToken(actor, { name: 'z', role: 'editor', review: false })).toThrow('forbidden')
    tokens.revokeToken(owner, id)
    expect(tokens.actorFromToken(token)).toBeNull()
    expect(tokens.actorFromToken('fg_wrong')).toBeNull()
  })

  it('read-only ones cannot write and do not see the living', async () => {
    const alive = people.createPerson(owner, { givenName: 'Живая', surname: 'Тайнова', birthDate: '1990' })
    const bot = issue('reader')
    await expect(reg.dispatch(bot, 'create_person', { person: { givenName: 'x' } })).rejects.toThrow('forbidden')
    expect(JSON.stringify(people.getGraph(bot))).not.toContain('Тайнова')
    expect(serializeFamilyText(people.getGraph(bot))).not.toContain('Тайнова')
    expect(alive.id).toBeTruthy()
  })
})

describe('review queue', () => {
  it('holds writes, links them by temporary ids, and applies them as one undoable change', async () => {
    const bot = issue('editor')
    const before = people.getGraph(owner).persons.length
    const dad = await reg.dispatch(bot, 'create_person', { person: { givenName: 'Отец', surname: 'Очередной', deathDate: '1950' } })
    expect(dad.status).toBe('pending_review')
    const son = await reg.dispatch(bot, 'create_person', { person: { givenName: 'Сын', surname: 'Очередной', deathDate: '1990' }, relation: { type: 'son', to: dad.tempId } })
    const page = await reg.dispatch(bot, 'create_page', { personId: dad.tempId, title: 'Биография', markdown: `# Жизнь\nОтец [@Сын](person:${son.tempId})` })
    expect(people.getGraph(owner).persons.length).toBe(before)

    const [draft] = reg.listProposals(owner).filter((p) => p.tokenName === 'bot-editor-true')
    expect(draft.ops.map((o) => o.op)).toEqual(['create_person', 'create_person', 'create_page'])
    expect(draft.ops[1].details?.join()).toContain('Отец Очередной')

    const res = reg.acceptProposal(owner, draft.id)
    const g = people.getGraph(owner)
    const realDad = g.persons.find((p) => p.surname === 'Очередной' && p.givenName === 'Отец')!
    const realSon = g.persons.find((p) => p.surname === 'Очередной' && p.givenName === 'Сын')!
    expect(g.parentChild.some((l) => l.parentId === realDad.id && l.childId === realSon.id)).toBe(true)
    const p = pages.listPages(owner, realDad.id)[0]
    const stored = pages.getPage(owner, p.id).content
    expect(stored).toContain(realSon.id)
    expect(stored).not.toContain('tmp_')
    expect(page.status).toBe('pending_review')

    // After acceptance the model's old temporary id still points at the right person.
    const later = await reg.dispatch(bot, 'update_person', { id: dad.tempId, patch: { birthPlace: 'Кострома' } })
    expect(later.status).toBe('pending_review')
    const next = reg.listProposals(owner).find((d) => d.tokenName === 'bot-editor-true')!
    expect(next.ops[0].text).toContain('Отец Очередной')
    await reg.rejectProposal(owner, next.id)
    expect(people.getPersonRow(realDad.id).birthPlace).toBe('')

    // One click rolls the whole draft back, and the entry is marked with the token.
    core.undo(owner, res.historyId!, 'undo')
    expect(people.getGraph(owner).persons.some((x) => x.surname === 'Очередной')).toBe(false)
  })

  it('a token cannot review or undo a person’s change', async () => {
    const bot = issue('editor', false)
    expect(() => reg.listProposals(bot)).toThrow('cannot review')
    expect(() => reg.acceptProposal(bot, 'x')).toThrow('cannot review')
    people.createPerson(owner, { givenName: 'Человек' })
    const entry = settings.listHistory(owner)[0]
    await expect(reg.dispatch(bot, 'undo', { historyId: entry.id })).rejects.toThrow('only its own')
  })

  it('a direct token writes at once and can undo itself; mass changes still wait', async () => {
    const bot = issue('editor', false)
    const p = await reg.dispatch(bot, 'create_person', { person: { givenName: 'Прямой', deathDate: '1900' } })
    expect(people.getPersonRow(p.id).givenName).toBe('Прямой')
    const entry = settings.listHistory(owner).find((h) => h.summary.includes('Прямой'))!
    await reg.dispatch(bot, 'undo', { historyId: entry.id })
    expect(() => people.getPersonRow(p.id)).toThrow()
    const bulk = await reg.dispatch(bot, 'import_text', { text: 'Массовый Импорт b: 1900\n' })
    expect(bulk.status).toBe('pending_review')
    await reg.rejectProposal(owner, bulk.proposalId)
  })

  it('reports bad references at once and keeps a failed draft intact', async () => {
    const bot = issue('editor')
    await expect(reg.dispatch(bot, 'update_person', { id: 'nope', patch: { surname: 'x' } })).rejects.toThrow('not found')
    await expect(reg.dispatch(bot, 'update_person', { id: 'tmp_unknown', patch: { surname: 'x' } })).rejects.toThrow('unknown temporary id')
    const a = await reg.dispatch(bot, 'create_person', { person: { givenName: 'Сбой' } })
    await reg.dispatch(bot, 'add_relation', { type: 'son', to: a.tempId, other: a.tempId })
    const draft = reg.listProposals(owner).find((d) => d.id === a.proposalId)!
    expect(() => reg.acceptProposal(owner, draft.id)).toThrow('same person')
    const after = reg.listProposals(owner).find((d) => d.id === draft.id)!
    expect(after.error).toContain('same person')
    expect(people.getGraph(owner).persons.some((p) => p.givenName === 'Сбой')).toBe(false)
    await reg.removeProposalOp(owner, draft.id, 1)
    reg.acceptProposal(owner, draft.id)
    expect(people.getGraph(owner).persons.some((p) => p.givenName === 'Сбой')).toBe(true)
  })

  it('a queued upload leaves no files behind when rejected', async () => {
    const bot = issue('editor')
    const png = await sharp({ create: { width: 30, height: 30, channels: 3, background: '#777' } }).png().toBuffer()
    const r = await reg.dispatch(bot, 'upload_photo', { base64: png.toString('base64'), filename: 'a.png' })
    const dir = path.join(process.env.DATA_DIR!, 'media')
    const count = () => fs.readdirSync(dir).length
    const withFiles = count()
    await reg.rejectProposal(owner, r.proposalId)
    expect(count()).toBeLessThan(withFiles)
  })

  it('refuses outside images and script links from a token', async () => {
    const bot = issue('editor', false)
    const p = people.createPerson(owner, { givenName: 'Страничный' })
    await expect(reg.dispatch(bot, 'create_page', { personId: p.id, markdown: '![x](https://evil.example/pixel.png)' })).rejects.toThrow('uploaded')
    await expect(reg.dispatch(bot, 'create_page', { personId: p.id, content: [{ type: 'paragraph', content: [{ type: 'link', href: 'javascript:alert(1)', content: [] }] }] })).rejects.toThrow('not allowed')
  })

  it('upload by link refuses inner addresses', async () => {
    const bot = issue('editor', false)
    await expect(reg.dispatch(bot, 'upload_photo', { url: 'http://127.0.0.1:3417/robots.txt' })).rejects.toThrow('not allowed')
    await expect(reg.dispatch(bot, 'upload_photo', { url: 'http://169.254.169.254/latest/meta-data' })).rejects.toThrow('not allowed')
    for (const ip of ['10.0.0.1', '172.16.0.1', '192.168.1.1', '::1', 'fd00::1', '::ffff:127.0.0.1']) expect(media.isPrivateAddress(ip)).toBe(true)
    expect(media.isPrivateAddress('93.184.216.34')).toBe(false)
  })
})

describe('text format', () => {
  const SAMPLE = `family Род Ивановых
Пётр Иванов b: 1880, d: 1950, sex: m
Анна Смирнова b: 1885, sex: f
Пётр Иванов + Анна Смирнова m: 1905
  Мария Иванова b: 1906, sex: f
  Сергей Иванов b: ~1910, sex: m
    Ольга Иванова kind: adopted, c: assumed
`
  it('reads the documented example', () => {
    const p = parseFamilyText(SAMPLE)
    expect(p.errors).toEqual([])
    expect(p.title).toBe('Род Ивановых')
    expect(p.people.size).toBe(5)
    expect(p.unions[0].attrs.m).toBe('1905')
    expect(p.parents.filter((l) => l.parent === '~петр иванов')).toHaveLength(2)
    const olga = p.parents.find((l) => l.child === '~ольга иванова')!
    expect(olga).toMatchObject({ parent: '~сергей иванов', kind: 'adopted', certainty: 'assumed' })
    expect(p.people.get('~сергей иванов')!.attrs.b).toBe('~1910')
    expect(p.people.get('~ольга иванова')!.attrs.c).toBeUndefined()
  })

  it('imports through the queue, and exporting then re-reading changes nothing', async () => {
    await reg.dispatch(owner, 'import_text', { text: SAMPLE })
    const g = people.getGraph(owner)
    const olga = g.persons.find((x) => x.givenName === 'Ольга')!
    expect(g.parentChild.find((l) => l.childId === olga.id)?.kind).toBe('adopted')
    expect(g.unions.find((u) => u.startDate === '1905')).toBeTruthy()
    const text = serializeFamilyText(g, 'x')
    const plan = planFamilyText(parseFamilyText(text), g)
    expect(plan.errors).toEqual([])
    expect(plan.ambiguous).toEqual([])
    expect(plan.ops).toEqual([])
  })

  it('matches existing people, updates fields, and asks when a name is ambiguous', () => {
    const g = people.getGraph(owner)
    const upd = planFamilyText(parseFamilyText('Пётр Иванов bp: Кострома\n'), g)
    expect(upd.creates).toEqual([])
    expect(upd.ops[0]).toMatchObject({ op: 'update_person', args: { patch: { birthPlace: 'Кострома' } } })
    const other = planFamilyText(parseFamilyText('Пётр Иванов b: 1999\n'), g)
    expect(other.creates).toEqual(['Пётр Иванов'])
    people.createPerson(owner, { givenName: 'Близнец', surname: 'Тот' })
    people.createPerson(owner, { givenName: 'Близнец', surname: 'Тот' })
    const amb = planFamilyText(parseFamilyText('Близнец Тот\n'), people.getGraph(owner))
    expect(amb.ambiguous[0].candidates).toHaveLength(2)
    const solved = planFamilyText(parseFamilyText('Близнец Тот\n'), people.getGraph(owner), { '~близнец тот': 'new' })
    expect(solved.ambiguous).toEqual([])
    expect(solved.creates).toEqual(['Близнец Тот'])
  })

  it('never plans a deletion, and reports errors with the line', () => {
    const g = people.getGraph(owner)
    expect(planFamilyText(parseFamilyText('family Пусто\n'), g).ops).toEqual([])
    const bad = parseFamilyText('Иван Иванов sex: q\nА + Б + В\n')
    expect(bad.errors.map((e) => e.line)).toEqual([1, 2])
  })
})

describe('markdown', () => {
  it('keeps a #tag in the text', () => {
    const md = 'Служил на флоте [#Флот](tag:)'
    const inline = markdownToBlocks(md)[0].content as { type: string; props?: Record<string, string> }[]
    expect(inline[1]).toEqual({ type: 'tag', props: { name: 'Флот' } })
    expect(blocksToMarkdown(markdownToBlocks(md))).toBe(md)
  })
  it('keeps paragraph marks: not checked, and a link to a source', () => {
    const md = 'Родился в Перми. [не проверено](unverified:) [Метрика](source:abc)'
    const inline = markdownToBlocks(md)[0].content as { type: string; props?: Record<string, string> }[]
    expect(inline.map((c) => c.type)).toEqual(['text', 'unverified', 'text', 'citation'])
    expect(inline[3].props).toEqual({ sourceId: 'abc', label: 'Метрика' })
    expect(blocksToMarkdown(markdownToBlocks(md))).toBe(md)
  })
  it('round-trips the blocks a model uses', () => {
    const md = '# Заголовок\nТекст **жирный** и *курсив*, [@Иван](person:abc) и [ссылка](https://e.org)\n- пункт\n1. раз\n2. два\n> цитата\n---\n![подпись](/api/v1/media/x/file)'
    const blocks = markdownToBlocks(md)
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'bulletListItem', 'numberedListItem', 'numberedListItem', 'quote', 'divider', 'image'])
    expect(blocks[1].content.find((c: any) => c.type === 'mention').props).toEqual({ personId: 'abc', label: 'Иван' })
    expect(blocksToMarkdown(blocks)).toBe(md)
  })
})

describe('agents over MCP', () => {
  const connect = async (actor: Actor) => {
    const [a, b] = InMemoryTransport.createLinkedPair()
    await buildMcpServer(actor).connect(a)
    const client = new Client({ name: 'test', version: '1' })
    await client.connect(b)
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean }
      if (r.isError) throw new Error(r.content[0].text)
      try { return JSON.parse(r.content[0].text) } catch { return r.content[0].text }
    }
    return { client, call }
  }

  it('gives a reader the overview and the gaps, but no writing tools or hidden people', async () => {
    people.createPerson(owner, { givenName: 'Живой', surname: 'Скрытов', birthDate: '1990' })
    const { client, call } = await connect(issue('reader'))
    const names = (await client.listTools()).tools.map((t: { name: string }) => t.name)
    expect(names).toEqual(expect.arrayContaining(['get_overview', 'find_gaps', 'parse_table', 'search_people']))
    expect(names).not.toContain('add_version')
    const o = await call('get_overview')
    expect(o.you.writes).toBe('not allowed')
    expect(o.people.hiddenFromYou).toBeGreaterThan(0)
    expect(JSON.stringify(await call('find_gaps', { limit: 200 }))).not.toContain('Скрытов')
  })

  it('records a found value as a version with its source, keeping what was there', async () => {
    const p = people.createPerson(owner, { givenName: 'Версия', surname: 'Проверкина', birthDate: '1923', deathDate: '1990' })
    const bot = issue('editor', false)
    const { call } = await connect(bot)
    await call('add_version', { personId: p.id, field: 'birthDate', value: '1925', source: { title: 'Метрика', ref: 'ф. 1', reliability: 'original' } })
    const after = (await call('get_person', { id: p.id })).person
    expect(after.birthDate).toBe('1923')
    expect(after.claims.map((c: { value: string; status: string }) => [c.value, c.status])).toEqual([['1923', 'accepted'], ['1925', 'possible']])
    expect(after.sources[0]).toMatchObject({ title: 'Метрика', reliability: 'original' })
    const gaps = await call('find_gaps', { onlyConflicts: true, limit: 200 })
    expect(gaps.find((g: { id: string }) => g.id === p.id).conflicts).toEqual(['birthDate'])
    const v1925 = after.claims[1].id
    await call('choose_version', { personId: p.id, field: 'birthDate', versionId: v1925 })
    expect((await call('get_person', { id: p.id })).person.birthDate).toBe('1925')
    const v1923 = after.claims[0].id
    await call('reject_version', { personId: p.id, field: 'birthDate', versionId: v1923, reason: 'другой человек' })
    const last = (await call('get_person', { id: p.id })).person
    expect(last.claims.find((c: { id: string }) => c.id === v1923)).toMatchObject({ status: 'rejected', reason: 'другой человек' })
    await expect(call('choose_version', { personId: p.id, field: 'birthDate', versionId: 'nope' })).rejects.toThrow('not found')
  })

  it('holds a version for review when the token must ask first', async () => {
    const p = people.createPerson(owner, { givenName: 'Очередь', surname: 'Версий', deathDate: '1990' })
    const { call } = await connect(issue('editor'))
    const r = await call('add_version', { personId: p.id, field: 'birthPlace', value: 'Пермь' })
    expect(r.status).toBe('pending_review')
    expect(people.getGraph(owner).persons.find((x) => x.id === p.id)!.birthPlace).toBe('')
  })

  it('turns a table into text an import accepts', async () => {
    const { call } = await connect(issue('editor'))
    const r = await call('parse_table', { csv: 'ФИО;Родился;Отец\nТабличный Сын;1950;Табличный Отец\n' })
    expect(r.columns).toEqual({ ФИО: 'name', Родился: 'birthDate', Отец: 'father' })
    const plan = await call('preview_text', { text: r.text })
    expect(plan.errors).toEqual([])
    expect(plan.creates).toEqual(expect.arrayContaining(['Табличный Сын', 'Табличный Отец']))
    await expect(call('parse_table', { csv: 'a;b\n1;2\n' })).rejects.toThrow('no name column')
  })

  it('offers ready prompts, and reads the notes as data', async () => {
    const { client } = await connect(issue('editor'))
    expect((await client.listPrompts()).prompts.map((p: { name: string }) => p.name)).toEqual(['research_person', 'fill_gaps', 'import_notes'])
    const m = await client.getPrompt({ name: 'import_notes', arguments: { notes: 'Анна Белова' } })
    expect((m.messages[0].content as { text: string }).text).toContain('<notes>')
  })
})
