// Everything an agent should be able to do with the whole graph, with no model: every person, every
// field, every kind of link, every photo action, each one read back and undone. See docs/AGENT_TEST_PLAN.md.
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import { assistantActor, buildAgent } from '../lib/agent/agent'
import { saveAttachment } from '../lib/agent/attachments'
import { getDb, schema } from '../lib/db'
import type { Actor } from '../lib/ops/core'
import { getGraph, getPersonRow, updatePerson } from '../lib/ops/people'
import { TOOLS, toolsFor } from '../lib/ops/tools'
import { MockLanguageModelV4 } from 'ai/test'
import { editor, loadFamily, owner, reader } from './fixture-family'

let f: Awaited<ReturnType<typeof loadFamily>>
beforeAll(async () => { f = await loadFamily() })

const run = async (name: string, args: unknown, who: Actor = editor): Promise<any> => {
  const actor = assistantActor(who)
  const def = toolsFor(actor, 'assistant').find((t) => t.name === name)
  if (!def) throw new Error(`no tool ${name}`)
  return def.run(actor, def.input.parse(args))
}
let n = 0
const fresh = async (extra: Record<string, unknown> = {}) => {
  const def = TOOLS.find((t) => t.name === 'create_person')!
  return (await def.run(owner, def.input.parse({ person: { givenName: 'Тимофей', surname: `Проверкин${++n}`, sex: 'M', birthDate: '1870', birthPlace: 'Тула', deathDate: '1950', deathPlace: 'Орёл', ...extra } }))) as { id: string }
}
const card = async (id: string) => (await run('get_person', { id })).person
const lastChange = async () => (await run('get_history', { limit: 1 }))[0].id as string
const links = () => getGraph(owner)
const picture = () => sharp({ create: { width: 30, height: 30, channels: 3, background: '#864' } }).png().toBuffer()
const attachPicture = async () => saveAttachment(assistantActor(editor), await picture(), 'фото.png')

describe('1. the whole graph is visible when the owner allows it', () => {
  const all = () => getGraph(owner).persons
  it('every person, living too, comes back from each way of listing', async () => {
    const ids = all().map((p) => p.id).sort()
    expect((await run('search_people', { limit: 500 })).map((p: any) => p.id).sort()).toEqual(ids)
    expect((await run('query_people', { limit: 500 })).people.map((p: any) => p.id).sort()).toEqual(ids)
    const text = await run('export_text', {})
    for (const p of all()) expect(text, p.givenName).toContain(p.id)
    expect((await run('get_overview', {})).people).toMatchObject({ total: ids.length, hiddenFromYou: 0 })
  })
  it('every card holds every date, place, name and fact as stored', async () => {
    for (const p of all()) {
      const c = await card(p.id)
      for (const key of ['givenName', 'surname', 'patronymic', 'maidenName', 'otherNames', 'sex', 'birthDate', 'birthPlace', 'deathDate', 'deathPlace', 'living', 'certainty', 'tags', 'facts', 'sources', 'claims'] as const) expect(c[key], `${p.givenName} ${key}`).toEqual(p[key])
    }
  })
  it('every link of every person is on their card, with names', async () => {
    const g = getGraph(owner)
    for (const p of g.persons) {
      const c = await run('get_person', { id: p.id })
      expect(c.parents.map((x: any) => x.personId).sort(), p.givenName).toEqual(g.parentChild.filter((l) => l.childId === p.id).map((l) => l.parentId).sort())
      expect(c.children.map((x: any) => x.personId).sort(), p.givenName).toEqual(g.parentChild.filter((l) => l.parentId === p.id).map((l) => l.childId).sort())
      expect(c.unions.length, p.givenName).toBe(g.unions.filter((u) => u.aId === p.id || u.bId === p.id).length)
      for (const x of [...c.parents, ...c.children, ...c.unions]) expect(x.name, p.givenName).toBeTruthy()
    }
  })
  it('a living person is found like anyone else', async () => {
    const names = async (query: string) => (await run('search_people', { query })).map((p: any) => p.id)
    expect(await names('Анна Живинская')).toContain(f.living.id)
    expect((await run('query_people', { name: 'Живинская Анна' })).people[0].id).toBe(f.living.id)
    expect((await card(f.living.id)).birthDate).toBe('1990')
  })
  it('a name is found in any order, with a typo, and with ё as е', async () => {
    const names = async (query: string) => (await run('search_people', { query })).map((p: any) => p.id)
    expect(await names('Соколов Иван')).toContain(f.ivan.id)
    expect(await names('Ивна Соколов')).toContain(f.ivan.id)
    expect(await names('Пётр')).toEqual(await names('Петр'))
    expect((await names('Заратустра'))).toEqual([])
  })
})

describe('2. only a reader’s role hides living relatives', () => {
  it('the assistant is told so, and not to claim they do not exist', () => {
    const agent = buildAgent(reader, { model: new MockLanguageModelV4() }) as any
    const [rules, situation] = agent.settings.instructions.map((i: any) => i.content)
    expect(situation).toContain('reader')
    expect(rules).toContain('never say someone is not in the archive')
  })
  it('a reader’s assistant counts them without saying who, an editor’s sees them', async () => {
    const o = await run('get_overview', {}, reader)
    expect(o.people.hiddenFromYou).toBe(1)
    expect(JSON.stringify(o)).not.toContain('Живинская')
    expect(await run('search_people', { query: 'Живинская' }, reader)).toEqual([])
    expect((await run('search_people', { query: 'Живинская' }))[0].id).toBe(f.living.id)
  })
  it('a living relative can be changed like anyone', async () => {
    await run('update_person', { id: f.living.id, patch: { birthPlace: 'Рязань' } })
    expect((await card(f.living.id)).birthPlace).toBe('Рязань')
    await run('undo', { historyId: await lastChange() })
  })
})

describe('3. every field of a card changes, reads back and is undone', () => {
  const cases: [string, unknown, unknown?][] = [
    ['givenName', 'Матвей'], ['surname', 'Рощин'], ['patronymic', 'Ильич'], ['maidenName', 'Девичья'], ['otherNames', 'Кузнец'],
    ['sex', 'F'], ['birthDate', '~1871'], ['birthPlace', 'Тверь'], ['deathDate', '1941'], ['deathPlace', 'Рязань'], ['certainty', 'assumed'],
    ['tags', ['Фронт', 'Тула']],
    ['facts', [{ kind: 'Профессия', date: '1900', place: 'Тула', note: 'кузнец' }]],
  ]
  it.each(cases)('%s', async (field, value) => {
    const { id } = await fresh()
    const before = (await card(id))[field]
    await run('update_person', { id, patch: { [field]: value } })
    expect((await card(id))[field]).toEqual(value)
    await run('undo', { historyId: await lastChange() })
    expect((await card(id))[field]).toEqual(before)
  })
  it('marking someone dead and alive', async () => {
    const { id } = await fresh({ deathDate: '', deathPlace: '', living: true, birthDate: '1990' })
    expect((await card(id)).living).toBe(true)
    await run('update_person', { id, patch: { deathDate: '2020' } })
    expect((await card(id)).living).toBe(false)
    await run('update_person', { id, patch: { deathDate: '', living: true } })
    expect(await card(id)).toMatchObject({ living: true, deathDate: '' })
  })
  it('changing a value that has versions keeps card and versions together', async () => {
    const { id } = await fresh()
    await run('add_version', { personId: id, field: 'birthDate', value: '1872', source: { title: 'Письмо' } })
    await run('update_person', { id, patch: { birthDate: '1873' } })
    const c = await card(id)
    expect(c.birthDate).toBe('1873')
    expect(c.claims.find((x: any) => x.field === 'birthDate' && x.status === 'accepted').value).toBe('1873')
    expect(c.claims.some((x: any) => x.value === '1872')).toBe(true)
  })
  it('several fields at once, others untouched', async () => {
    const { id } = await fresh()
    await run('update_person', { id, patch: { deathPlace: 'Клин', otherNames: 'Дед' } })
    expect(await card(id)).toMatchObject({ deathPlace: 'Клин', otherNames: 'Дед', birthPlace: 'Тула', birthDate: '1870' })
  })
})

describe('4. sources and versions', () => {
  it('a source is added and removed, and undone', async () => {
    const { id } = await fresh()
    const { sourceId } = await run('add_source', { personId: id, title: 'Метрическая книга', ref: 'ф. 12', reliability: 'original' })
    expect((await card(id)).sources[0]).toMatchObject({ id: sourceId, title: 'Метрическая книга', ref: 'ф. 12' })
    await run('remove_source', { personId: id, sourceId })
    expect((await card(id)).sources).toEqual([])
    await run('undo', { historyId: await lastChange() })
    expect((await card(id)).sources).toHaveLength(1)
  })
  it('a source in use by a version stays', async () => {
    const { id } = await fresh()
    await run('add_version', { personId: id, field: 'birthDate', value: '1872', source: { title: 'Письмо' } })
    const c = await card(id)
    await expect(run('remove_source', { personId: id, sourceId: c.sources[0].id })).rejects.toThrow(/relies/)
    await expect(run('remove_source', { personId: id, sourceId: 'nope' })).rejects.toThrow(/not found/)
  })
  it('a version is added, chosen, rejected and brought back', async () => {
    const { id } = await fresh()
    await run('add_version', { personId: id, field: 'birthPlace', value: 'Ярославль', source: { title: 'Письмо' } })
    let c = await card(id)
    expect(c.birthPlace).toBe('Тула')
    const v = c.claims.find((x: any) => x.value === 'Ярославль')
    await run('choose_version', { personId: id, field: 'birthPlace', versionId: v.id })
    c = await card(id)
    expect(c.birthPlace).toBe('Ярославль')
    const old = c.claims.find((x: any) => x.value === 'Тула')
    await run('reject_version', { personId: id, field: 'birthPlace', versionId: old.id, reason: 'ошибка' })
    expect((await card(id)).claims.find((x: any) => x.value === 'Тула').status).toBe('rejected')
    await run('restore_version', { personId: id, field: 'birthPlace', versionId: old.id })
    expect((await card(id)).claims.find((x: any) => x.value === 'Тула').status).toBe('possible')
  })
})

describe('5. links', () => {
  const parentLink = (parentId: string, childId: string) => links().parentChild.find((l) => l.parentId === parentId && l.childId === childId)
  const union = (a: string, b: string) => links().unions.find((u) => (u.aId === a && u.bId === b) || (u.aId === b && u.bId === a))
  const pair = async () => ({ elder: (await fresh({ birthDate: '1840', deathDate: '1900' })).id, younger: (await fresh({ birthDate: '1870' })).id })

  it.each([['father', 'younger', 'elder', 'M'], ['mother', 'younger', 'elder', 'F'], ['son', 'elder', 'younger', 'M'], ['daughter', 'elder', 'younger', 'F']] as const)('%s', async (type, to, other, sex) => {
    const p = await pair()
    updatePerson(owner, p[other], { sex })
    await run('add_relation', { type, to: p[to], other: p[other] })
    expect(parentLink(p.elder, p.younger)).toBeTruthy()
    await run('undo', { historyId: await lastChange() })
    expect(parentLink(p.elder, p.younger)).toBeUndefined()
  })
  it('spouse, with dates and place, then removed and restored', async () => {
    const a = (await fresh()).id, b = (await fresh({ sex: 'F' })).id
    await run('add_relation', { type: 'spouse', to: a, other: b, startDate: '1895' })
    const u = union(a, b)!
    expect(u.startDate).toBe('1895')
    await run('update_relation', { type: 'union', id: u.id, place: 'Тула', endDate: '1920', kind: 'civil' })
    expect(union(a, b)).toMatchObject({ place: 'Тула', endDate: '1920', kind: 'civil' })
    const c = await run('get_person', { id: a })
    await run('remove_relation', { type: 'union', id: c.unions[0].linkId })
    expect(union(a, b)).toBeUndefined()
    await run('undo', { historyId: await lastChange() })
    expect(union(a, b)).toBeTruthy()
  })
  it('a parent link is removed by the id on the card, and its kind and certainty change', async () => {
    const p = await pair()
    await run('add_relation', { type: 'son', to: p.elder, other: p.younger })
    const c = await run('get_person', { id: p.younger })
    await run('update_relation', { type: 'parent', id: c.parents[0].linkId, kind: 'adopted', certainty: 'assumed' })
    expect(parentLink(p.elder, p.younger)).toMatchObject({ kind: 'adopted', certainty: 'assumed' })
    await run('remove_relation', { type: 'parent', id: c.parents[0].linkId })
    expect(parentLink(p.elder, p.younger)).toBeUndefined()
  })
  it.each(['father', 'mother', 'son', 'daughter', 'spouse'] as const)('a new relative comes with the link: %s', async (type) => {
    const { id } = await fresh({ birthDate: '1870', deathDate: '1940' })
    const year = type === 'father' || type === 'mother' ? '1840' : type === 'spouse' ? '1872' : '1900'
    const made = await run('create_person', { person: { givenName: 'Родня', surname: `Связной${type}`, birthDate: year, deathDate: '1950' }, relation: { type, to: id } })
    const g = links()
    const linked = type === 'spouse' ? union(id, made.id) : type === 'father' || type === 'mother' ? parentLink(made.id, id) : parentLink(id, made.id)
    expect(linked, type).toBeTruthy()
    expect(g.persons.find((p) => p.id === made.id)!.sex).toBe(type === 'father' || type === 'son' ? 'M' : type === 'spouse' ? 'U' : 'F')
  })
  it('a child gets both parents at once, and they become a couple', async () => {
    const dad = (await fresh({ birthDate: '1840', deathDate: '1900' })).id, mum = (await fresh({ birthDate: '1845', deathDate: '1910', sex: 'F' })).id
    const child = await run('create_person', { person: { givenName: 'Общий', surname: 'Ребёнок', birthDate: '1880', deathDate: '1950' }, relation: { type: 'son', to: dad, otherParentId: mum } })
    expect(parentLink(dad, child.id)).toBeTruthy()
    expect(parentLink(mum, child.id)).toBeTruthy()
  })
  it('deleting a person takes their links, and undo brings all back', async () => {
    const p = await pair()
    await run('add_relation', { type: 'son', to: p.elder, other: p.younger })
    await run('delete_person', { id: p.younger })
    expect(parentLink(p.elder, p.younger)).toBeUndefined()
    expect(() => getPersonRow(p.younger)).toThrow()
    await run('undo', { historyId: await lastChange() })
    expect(getPersonRow(p.younger).id).toBe(p.younger)
    expect(parentLink(p.elder, p.younger)).toBeTruthy()
  })
})

describe('6. pictures and files', () => {
  const photosOf = async (id: string) => run('list_photos', { personId: id })
  it('an attached picture goes on a person, with its caption', async () => {
    const { id } = await fresh()
    const att = await attachPicture()
    const saved = await run('save_attachment', { id: att.id, personId: id, caption: 'Открытка', date: '1905', place: 'Тула' })
    expect((await photosOf(id))[0]).toMatchObject({ id: saved.id, caption: 'Открытка', date: '1905', place: 'Тула' })
  })
  it('it becomes the avatar, is replaced, removed, and each is undone', async () => {
    const { id } = await fresh()
    const one = await run('save_attachment', { id: (await attachPicture()).id, personId: id })
    const two = await run('save_attachment', { id: (await attachPicture()).id, personId: id })
    await run('set_avatar', { personId: id, mediaId: one.id, crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } })
    expect((await card(id)).avatarMediaId).toBe(one.id)
    await run('set_avatar', { personId: id, mediaId: two.id })
    expect((await card(id)).avatarMediaId).toBe(two.id)
    await run('undo', { historyId: await lastChange() })
    expect((await card(id)).avatarMediaId).toBe(one.id)
    await run('set_avatar', { personId: id, mediaId: null })
    expect((await card(id)).avatarMediaId).toBeNull()
  })
  it('an avatar must be a picture that exists', async () => {
    const { id } = await fresh()
    await expect(run('set_avatar', { personId: id, mediaId: 'nope' })).rejects.toThrow(/not found/)
    const pdf = await saveAttachment(assistantActor(editor), Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer<<>>\n%%EOF'), 'док.pdf')
    const saved = await run('save_attachment', { id: pdf.id, personId: id })
    await expect(run('set_avatar', { personId: id, mediaId: saved.id })).rejects.toThrow(/picture/)
  })
  it('a photo is captioned, tagged with a second person, untagged, deleted, and restored', async () => {
    const a = (await fresh()).id, b = (await fresh()).id
    const { id } = await run('save_attachment', { id: (await attachPicture()).id, personId: a })
    await run('update_photo', { id, caption: 'Свадьба', date: '1900', place: 'Клин' })
    expect((await photosOf(a))[0]).toMatchObject({ caption: 'Свадьба', date: '1900', place: 'Клин' })
    await run('tag_photo', { mediaId: id, personId: b })
    const tag = (await photosOf(b))[0].tags.find((t: any) => t.personId === b)
    await run('untag_photo', { id: tag.id })
    expect(await photosOf(b)).toEqual([])
    await run('delete_photo', { id })
    expect(await photosOf(a)).toEqual([])
    await run('undo', { historyId: await lastChange() })
    expect(await photosOf(a)).toHaveLength(1)
  })
  it('a file can be named by its id, its link or its name', async () => {
    const { id } = await fresh()
    const att = await saveAttachment(assistantActor(editor), await picture(), 'письмо-деда.png')
    for (const ref of [att.id, `/api/agent/files/${att.id}`, 'письмо-деда.png']) expect((await run('save_attachment', { id: ref, personId: id })).kind, ref).toBe('image')
    await expect(run('save_attachment', { id: 'нет-такого.png', personId: id })).rejects.toThrow(/Use the id/)
    await expect(run('save_attachment', { id: '../../etc/passwd', personId: id })).rejects.toThrow(/no attachment/)
  })
  it('someone else’s attachment cannot be saved', async () => {
    const att = await attachPicture()
    await expect(run('save_attachment', { id: att.id }, owner)).rejects.toThrow()
  })
})

describe('7. pages', () => {
  it('a page is written, read, changed, deleted and restored', async () => {
    const { id } = await fresh()
    const page = await run('create_page', { personId: id, title: 'Жизнь', markdown: 'Был кузнецом.' })
    expect((await run('get_person', { id })).pages[0].title).toBe('Жизнь')
    expect((await run('get_page', { id: page.id })).markdown).toContain('кузнецом')
    await run('update_page', { id: page.id, title: 'Биография', markdown: 'Стал мастером.' })
    expect(await run('get_page', { id: page.id })).toMatchObject({ title: 'Биография', markdown: expect.stringContaining('мастером') })
    await run('delete_page', { id: page.id })
    await expect(run('get_page', { id: page.id })).rejects.toThrow()
    await run('undo', { historyId: await lastChange() })
    expect((await run('get_page', { id: page.id })).title).toBe('Биография')
  })
})

describe('8. every change is signed and in the history', () => {
  it('each write leaves one entry with the assistant’s name and the person’s id', async () => {
    const { id } = await fresh()
    const before = getDb().select().from(schema.history).all().length
    await run('update_person', { id, patch: { otherNames: 'Подпись' } })
    const rows = getDb().select().from(schema.history).all()
    expect(rows.length).toBe(before + 1)
    const [entry] = await run('get_history', { limit: 1 })
    expect(entry.actorName).toBe('Ассистент → Егор')
    expect(entry.personIds).toContain(id)
  })
})
