import { beforeAll, describe, expect, it } from 'vitest'
import { assistantActor, approvalFor } from '../lib/agent/agent'
import { TOOL_NAMES, toolLabel } from '../lib/agent/labels'
import { getDb, schema } from '../lib/db'
import { getPage } from '../lib/ops/pages'
import { getPersonRow } from '../lib/ops/people'
import { getSetting, setSetting } from '../lib/ops/settings'
import { TOOLS, toolsFor } from '../lib/ops/tools'
import type { Actor } from '../lib/ops/core'
import { editor, loadFamily, owner, reader, SECRETS } from './fixture-family'

let f: Awaited<ReturnType<typeof loadFamily>>
beforeAll(async () => { f = await loadFamily() })

const names = (a: Actor, s: 'assistant' | 'mcp' = 'assistant') => toolsFor(a, s).map((t) => t.name)
/** As the assistant would call it: validated input, the assistant's own view of the archive. */
async function call(person: Actor, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const actor = assistantActor(person)
  const def = toolsFor(actor, 'assistant').find((t) => t.name === name)
  if (!def) throw new Error(`no tool ${name} for ${person.role}`)
  return def.run(actor, def.input.parse(args))
}

describe('answering questions', () => {
  it('how two people are related', async () => {
    const r = await call(owner, 'how_related', { from: f.pyotr.id, to: f.nikolai.id })
    expect(r.relation).toBe('дед')
    expect(r.path).toHaveLength(3)
  })

  it('who was born in Tula before 1880', async () => {
    const r = await call(owner, 'query_people', { place: 'Тула', bornTo: 1879 })
    expect(r.people.map((p: any) => p.name).sort()).toEqual(['Варвара Соколова', 'Николай Соколов'])
  })

  it('how many, by place and by decade, without listing them', async () => {
    const r = await call(reader, 'query_people', { groupBy: 'birthPlace', limit: 0 })
    expect(r.people).toEqual([])
    expect(r.total).toBe(5)
    expect(r.groups[0]).toEqual({ key: 'Тула', count: 3 })
    expect((await call(reader, 'query_people', { groupBy: 'decade', limit: 0 })).groups).toContainEqual({ key: '1860s', count: 2 })
  })

  it('the oldest comes first, and sources can be a condition', async () => {
    expect((await call(owner, 'query_people', {})).people[0].name).toBe('Николай Соколов')
    expect((await call(reader, 'query_people', { hasSources: true })).people.map((p: any) => p.name)).toEqual(['Николай Соколов'])
    expect((await call(reader, 'query_people', { hasParents: false, sex: 'F' })).people.map((p: any) => p.name).sort()).toEqual(['Варвара Соколова', 'Мария Белова'])
  })

  it('what is unfinished', async () => {
    const gaps = await call(owner, 'find_gaps', {})
    expect(gaps.find((g: any) => g.id === f.maria.id).missing).toContain('deathPlace')
  })
})

describe('searching', () => {
  const search = async (query: string) => (await call(owner, 'search_archive', { query })).results
  it('finds a word in page text, in another form', async () => {
    const hit = (await search('кузница')).find((r: any) => r.kind === 'page')
    expect(hit.id).toBe(f.life.id)
    expect(hit.snippet).toContain('кузницу')
  })
  it('forgives a typo in a surname', async () => {
    expect((await search('Саколов')).some((r: any) => r.id === f.ivan.id)).toBe(true)
  })
  it('finds a source and a fact', async () => {
    expect((await search('Архив Тульской'))[0].id).toBe(f.nikolai.id)
    expect((await search('оружейного'))[0].id).toBe(f.nikolai.id)
  })
  it('finds a photo by its name and treats ё as е', async () => {
    expect((await search('свадьба')).some((r: any) => r.kind === 'photo' && r.id === f.photo.id)).toBe(true)
    expect((await search('Петр')).some((r: any) => r.id === f.pyotr.id)).toBe(true)
  })
  it('says nothing was found rather than guessing', async () => {
    expect(await search('Заратустра')).toEqual([])
  })
})

describe('changing the family', () => {
  it('adds a daughter with her link, and it can be taken back', async () => {
    const made = await call(editor, 'create_person', { person: { givenName: 'Мария', surname: 'Соколова', birthDate: '1905', deathDate: '1980' }, relation: { type: 'daughter', to: f.ivan.id } })
    expect(getPersonRow(made.id).sex).toBe('F')
    expect((await call(editor, 'get_relatives', { id: made.id })).find((r: any) => r.id === f.ivan.id).relation).toBe('отец')
    const [last] = await call(editor, 'get_history', { limit: 1 })
    expect(last.actorName).toBe('Ассистент → Егор')
    await call(editor, 'undo', { historyId: last.id })
    expect(() => getPersonRow(made.id)).toThrow()
  })

  it('records a dated fact with its source as a version, not over the old value', async () => {
    await call(editor, 'add_version', { personId: f.maria.id, field: 'birthDate', value: '1896', reason: 'метрика', source: { title: 'Метрическая книга', reliability: 'original' } })
    const p = getPersonRow(f.maria.id)
    expect(p.birthDate).toBe('1895')
    expect(p.claims).toContain('1896')
  })

  it('writes a page from Markdown', async () => {
    const page = await call(editor, 'create_page', { personId: f.maria.id, title: 'Детство', markdown: '# Кострома\n\nЖила у **реки**.' })
    expect(getPage(owner, page.id).content).toContain('Жила у ')
  })

  it('can put an outside picture on a page, like a person can', async () => {
    const page = await call(editor, 'create_page', { personId: f.maria.id, title: 'С картинкой', markdown: '![x](https://example.com/p.png)' })
    expect(getPage(owner, page.id).content).toContain('example.com')
  })

  it('refuses a person as their own parent', async () => {
    await expect(call(editor, 'add_relation', { type: 'son', to: f.ivan.id, other: f.ivan.id })).rejects.toThrow()
  })
})

describe('settings', () => {
  it('the owner can rename the archive', async () => {
    await call(owner, 'update_settings', { familyName: 'Соколовы' })
    expect(getSetting('familyName')).toBe('Соколовы')
    expect(await call(owner, 'get_settings')).toMatchObject({ familyName: 'Соколовы' })
  })
  it('an editor has no settings or access tools at all', () => {
    for (const t of ['update_settings', 'set_user_role', 'create_invite', 'revoke_invite', 'list_users', 'list_invites']) expect(names(editor)).not.toContain(t)
  })
  it('an invitation link stays out of what the model gets', async () => {
    const def = TOOLS.find((t) => t.name === 'create_invite')!
    const out = await call(owner, 'create_invite', { name: 'Тётя', role: 'editor' })
    expect(out.link).toMatch(/^\/invite\//)
    expect(JSON.stringify(def.forModel!(out))).not.toContain('invite/')
  })
  it('an invitation cannot make another owner, and an unknown user is an error', async () => {
    await expect(call(owner, 'create_invite', { name: 'X', role: 'owner' })).rejects.toThrow()
    await expect(call(owner, 'set_user_role', { id: 'nobody', role: 'reader' })).rejects.toThrow(/no such user/)
  })
  it('the assistant cannot change its own privacy or get a token', () => {
    const update = TOOLS.find((t) => t.name === 'update_settings')!
    expect(Object.keys(update.input.shape).sort()).toEqual(['familyName', 'language'])
    expect(names(owner).filter((n) => /token|proposal/.test(n))).toEqual([])
  })
})

describe('the screen', () => {
  it('opens and lights up people who are visible, and refuses hidden ones', async () => {
    expect(await call(owner, 'focus_person', { id: f.ivan.id })).toMatchObject({ name: 'Иван Соколов' })
    expect((await call(owner, 'show_path', { from: f.pyotr.id, to: f.nikolai.id })).relation).toBe('дед')
    expect(await call(owner, 'focus_person', { id: f.living.id })).toMatchObject({ id: f.living.id })
    await expect(call(reader, 'focus_person', { id: f.living.id })).rejects.toThrow(/not found/)
    expect(await call(reader, 'set_chart_direction', { rootsBelow: true })).toEqual({ rootsBelow: true })
  })
})

describe('who may do what', () => {
  it('every tool has a known risk, and a write can never run unasked by default', () => {
    for (const t of TOOLS) {
      expect(['read', 'ui', 'write', 'danger', 'admin'], t.name).toContain(t.risk)
      if (['write', 'danger', 'admin'].includes(t.risk)) expect(approvalFor(t.risk, false), t.name).toBe('user-approval')
    }
  })
  it('allowing edits for a conversation never covers deleting or settings', () => {
    expect(approvalFor('write', true)).toBe('not-applicable')
    for (const r of ['danger', 'admin', undefined] as const) expect(approvalFor(r, true)).toBe('user-approval')
    for (const t of ['delete_person', 'delete_page', 'remove_relation', 'import_text', 'undo']) expect(TOOLS.find((x) => x.name === t)!.risk).toBe('danger')
  })
  it('a reader gets no way to write', () => {
    expect(toolsFor(reader, 'assistant').filter((t) => !['read', 'ui'].includes(t.risk))).toEqual([])
  })
  it('the assistant has every tool a person has on the graph', () => {
    for (const t of TOOLS.filter((x) => x.surfaces.includes('mcp') && x.name !== 'my_proposals')) expect(names(owner), t.name).toContain(t.name)
  })
  it('MCP keeps every tool it had, gains search, and has no settings', () => {
    const mcp = names(editor, 'mcp')
    for (const t of ['get_overview', 'export_gedcom', 'upload_photo', 'import_gedcom', 'delete_person', 'my_proposals', 'query_people', 'search_archive']) expect(mcp).toContain(t)
    for (const t of ['update_settings', 'focus_person', 'create_invite']) expect(mcp).not.toContain(t)
  })
})

describe('labels in the chat', () => {
  it('every tool has one, and the ones that can be allowed at once are exactly the ordinary edits', () => {
    const all = [...TOOL_NAMES.read, ...TOOL_NAMES.write, ...TOOL_NAMES.careful].sort()
    expect(all).toEqual(toolsFor(owner, 'assistant').map((t) => t.name).sort())
    expect([...TOOL_NAMES.write].sort()).toEqual(toolsFor(owner, 'assistant').filter((t) => t.risk === 'write').map((t) => t.name).sort())
    expect(toolLabel('delete_person', 'en')).toBe('Delete a person')
  })
})

describe('a reader and living relatives', () => {
  const asks = (): [string, Record<string, unknown>][] => [
    ['get_overview', {}], ['find_gaps', { limit: 200 }], ['search_people', { query: '', limit: 500 }], ['search_people', { query: 'Живинская' }], ['get_person', { id: f.living.id }], ['get_person', { id: f.pyotr.id }],
    ['get_relatives', { id: f.pyotr.id }], ['how_related', { from: f.pyotr.id, to: f.living.id }], ['list_photos', {}],
    ['export_text', {}], ['get_history', { limit: 200 }], ['query_people', { limit: 500 }], ['query_people', { name: 'Живинская' }], ['query_people', { living: true }], ['query_people', { groupBy: 'surname', limit: 0 }], ['query_people', { groupBy: 'birthPlace', limit: 0 }],
    ['search_archive', { query: 'Живинская' }], ['search_archive', { query: 'Тайнопись' }], ['search_archive', { query: 'Тайноград' }], ['search_archive', { query: 'родилась поздно' }], ['focus_person', { id: f.living.id }], ['show_path', { from: f.pyotr.id, to: f.living.id }],
  ]
  it.each([['a reader', reader]] as const)('no tool shows them to the model for %s', async (_n, person) => {
    for (const [name, args] of asks()) {
      const text = await call(person, name, args).then((r) => (typeof r === 'string' ? r : JSON.stringify(r))).catch((e) => e.message)
      for (const word of SECRETS) expect(text, `${name} ${JSON.stringify(args)} shows ${word}`).not.toContain(word)
    }
  })

  it('every read tool is in that list, so a new one cannot slip past', () => {
    const covered = new Set(asks().map(([n]) => n))
    const uncheckedOnPurpose = ['use_tools', 'set_plan', 'read_attachment', 'parse_table', 'list_pages', 'preview_text', 'preview_gedcom', 'export_gedcom', 'get_settings', 'list_users', 'list_invites', 'get_page', 'set_chart_direction']
    for (const t of toolsFor(owner, 'assistant').filter((x) => x.risk === 'read' || x.risk === 'ui')) expect(covered.has(t.name) || uncheckedOnPurpose.includes(t.name), t.name).toBe(true)
  })

  it('a page that mentions them is readable with the name removed', async () => {
    const { pages } = await call(reader, 'get_person', { id: f.pyotr.id })
    const page = await call(reader, 'get_page', { id: pages[0].id, raw: true })
    expect(JSON.stringify(page)).not.toContain('Живинская')
    expect(JSON.stringify(page)).toContain('родилась поздно')
  })

  it('their own page cannot be read by id', async () => {
    const id = getDb().select().from(schema.pages).all().find((p) => p.personId === f.living.id)!.id
    await expect(call(reader, 'get_page', { id })).rejects.toThrow(/not found/)
    expect((await call(owner, 'get_page', { id })).id).toBe(id)
  })

  it('the owner and an editor see them whole', async () => {
    expect(JSON.stringify(await call(owner, 'query_people', { name: 'Живинская' }))).toContain('Живинская')
    expect((await call(editor, 'get_person', { id: f.living.id })).person.patronymic).toBe('Скрытовна')
    expect((await call(reader, 'query_people', { name: 'Живинская' })).total).toBe(0)
  })
})
