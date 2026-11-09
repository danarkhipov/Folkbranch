// What keeps the archive sound whatever a model decides. Everything here runs with a scripted model.
import { z } from 'zod'
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'
import { readUIMessageStream, type ModelMessage, type UIMessage, type UIMessageChunk } from 'ai'
import { beforeAll, describe, expect, it } from 'vitest'
import { activeToolNames, assistantActor, buildAgent, lean, mustFinish, trimHistory } from '../lib/agent/agent'
import { saveAttachment } from '../lib/agent/attachments'
import { assistantResponse } from '../lib/agent/respond'
import { getDb, schema } from '../lib/db'
import { getGraph, getPersonRow, updatePerson } from '../lib/ops/people'
import { createInvite, ownCard, setMyPerson, setSetting } from '../lib/ops/settings'
import { CORE_TOOLS, TOOL_GROUPS, TOOLS, toolsFor } from '../lib/ops/tools'
import { editor, loadFamily, owner } from './fixture-family'

let f: Awaited<ReturnType<typeof loadFamily>>
beforeAll(async () => { f = await loadFamily() })

const run = async (name: string, args: unknown, who = editor): Promise<any> => {
  const actor = assistantActor(who)
  const def = toolsFor(actor, 'assistant').find((t) => t.name === name)!
  return def.run(actor, def.input.parse(args))
}
const history = () => getDb().select().from(schema.history).all()
const peopleCount = () => getGraph(owner).persons.length

const usage = { inputTokens: { total: 7, noCache: 7, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 3, text: 3, reasoning: 0 } }
const reply = (text: string) => ({ stream: simulateReadableStream({ chunks: [
  { type: 'stream-start', warnings: [] }, { type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: text }, { type: 'text-end', id: 't' },
  { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
] as never[] }) })
let n = 0
const calls = (...list: [string, unknown][]) => ({ stream: simulateReadableStream({ chunks: [
  { type: 'stream-start', warnings: [] },
  ...list.map(([toolName, input]) => ({ type: 'tool-call', toolCallId: `g-${++n}`, toolName, input: JSON.stringify(input) })),
  { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
] as never[] }) })
const model = (...turns: ReturnType<typeof reply>[]) => new MockLanguageModelV4({ doStream: turns as never })
const user = (text: string): UIMessage => ({ id: `gu${++n}`, role: 'user', parts: [{ type: 'text', text }] })

async function send(messages: UIMessage[], m: MockLanguageModelV4, extra: Record<string, unknown> = {}) {
  const res = await assistantResponse(editor, { messages, ...extra }, { model: m })
  const chunks: UIMessageChunk[] = (await res.text()).split('\n').filter((l) => l.startsWith('data: ') && !l.includes('[DONE]')).map((l) => JSON.parse(l.slice(6)))
  let message: UIMessage | undefined
  const stream = new ReadableStream<UIMessageChunk>({ start(c) { chunks.forEach((x) => c.enqueue(x)); c.close() } })
  for await (const x of readUIMessageStream({ stream, message: messages.at(-1)?.role === 'assistant' ? messages.at(-1) : undefined })) message = x
  return { message: message!, parts: message!.parts as any[], chunks }
}

describe('whose card is mine', () => {
  it('only a living person can be chosen, by yourself or in an invitation', () => {
    expect(() => setMyPerson(owner, f.nikolai.id)).toThrow(/живого/)
    expect(() => createInvite(owner, { name: 'Х', role: 'reader', personId: f.nikolai.id })).toThrow(/живого/)
    expect(() => setMyPerson(owner, 'nobody')).toThrow(/живого/)
    expect(() => setMyPerson(owner, f.living.id)).not.toThrow()
    expect(createInvite(owner, { name: 'Х', role: 'reader', personId: f.living.id }).token).toBeTruthy()
    expect(() => setMyPerson(owner, null)).not.toThrow()
  })
  it('the assistant cannot invite someone as a dead person either', async () => {
    await expect(run('create_invite', { name: 'Х', role: 'reader', personId: f.nikolai.id }, owner)).rejects.toThrow(/живого/)
  })
  it('a link to someone who died counts as no link, and comes back on undo', () => {
    expect(ownCard(f.living.id)).toBe(f.living.id)
    expect(ownCard(f.nikolai.id)).toBeNull()
    expect(ownCard(null)).toBeNull()
    const updated = updatePerson(owner, f.living.id, { deathDate: '2020' })
    expect(updated.living).toBe(false)
    expect(ownCard(f.living.id)).toBeNull()
    updatePerson(owner, f.living.id, { deathDate: '', living: true })
    expect(ownCard(f.living.id)).toBe(f.living.id)
  })
})

describe('adding a person', () => {
  it('adds and links with a typed short answer', async () => {
    const out = await run('create_person', { person: { givenName: 'Семён', surname: 'Соколов', birthDate: '1925', deathDate: '1990' }, relation: { type: 'son', to: f.ivan.id } })
    expect(Object.keys(out).sort()).toEqual(['birthDate', 'deathDate', 'givenName', 'id', 'living', 'surname'])
    expect(getGraph(owner).parentChild.some((l) => l.parentId === f.ivan.id && l.childId === out.id)).toBe(true)
  })
  it('refuses someone with the same name and close birth year, and names who it may be', async () => {
    const before = peopleCount()
    await expect(run('create_person', { person: { givenName: 'Иван', surname: 'Соколов', birthDate: '1891' } })).rejects.toThrow(new RegExp(`Not added.*Иван Соколов \\(1890.*${f.ivan.id}.*notDuplicate`))
    await expect(run('create_person', { person: { givenName: 'иван', surname: 'СОКОЛОВ' } })).rejects.toThrow(/Not added/)
    await expect(run('create_person', { person: { givenName: 'Мария', surname: 'Белова', birthDate: '1896', deathDate: '1970' } })).rejects.toThrow(/Not added/)
    expect(peopleCount()).toBe(before)
  })
  it('treats ё as е, and a maiden name as a surname', async () => {
    updatePerson(owner, f.maria.id, { maidenName: 'Девичья' })
    await expect(run('create_person', { person: { givenName: 'Мария', surname: 'Девичья' } })).rejects.toThrow(/Not added/)
    await expect(run('create_person', { person: { givenName: 'Петр', surname: 'Соколов' } })).rejects.toThrow(/Not added/)
  })
  it('adds the namesake once told it is someone new, or when the years are far apart', async () => {
    const asked = await run('create_person', { person: { givenName: 'Иван', surname: 'Соколов', birthDate: '1891', deathDate: '1950' }, notDuplicate: true })
    const far = await run('create_person', { person: { givenName: 'Иван', surname: 'Соколов', birthDate: '1810', deathDate: '1870' } })
    expect(asked.id).not.toBe(far.id)
  })
  it('needs a name and sound dates', async () => {
    await expect(run('create_person', { person: { birthDate: '1900' } })).rejects.toThrow(/name/)
    await expect(run('create_person', { person: { givenName: 'Х', birthDate: '1900', deathDate: '1850' } })).rejects.toThrow(/before birth/)
  })
  it('a person using the app directly is not held back by the duplicate check', async () => {
    const def = TOOLS.find((t) => t.name === 'create_person')!
    expect(((await def.run(owner, def.input.parse({ person: { givenName: 'Пётр', surname: 'Соколов', birthDate: '1925', deathDate: '2000' } }))) as any).id).toBeTruthy()
  })
})

describe('changing a person', () => {
  it('changes only what was given', async () => {
    const before = getPersonRow(f.varvara.id)
    await run('update_person', { id: f.varvara.id, patch: { deathPlace: 'Орёл' } })
    const after = getPersonRow(f.varvara.id)
    expect(after.deathPlace).toBe('Орёл')
    expect({ ...after, deathPlace: '', updatedAt: 0 }).toEqual({ ...before, deathPlace: '', updatedAt: 0 })
  })
  it('refuses an empty change, a nameless person, impossible dates and an unknown id', async () => {
    await expect(run('update_person', { id: f.varvara.id, patch: {} })).rejects.toThrow(/empty/)
    await expect(run('update_person', { id: f.varvara.id, patch: { givenName: '', surname: '' } })).rejects.toThrow(/name/)
    await expect(run('update_person', { id: f.varvara.id, patch: { deathDate: '1800' } })).rejects.toThrow(/before birth/)
    await expect(run('update_person', { id: f.varvara.id, patch: { living: true } })).rejects.toThrow(/living/)
    await expect(run('update_person', { id: 'nobody', patch: { deathPlace: 'Х' } })).rejects.toThrow(/not found/)
  })
  it('a model cannot rewrite versions or sources wholesale', async () => {
    const before = getPersonRow(f.nikolai.id)
    await run('update_person', { id: f.nikolai.id, patch: { deathPlace: 'Тула', sources: [], claims: [{ id: 'x' }] } })
    const after = getPersonRow(f.nikolai.id)
    expect(after.sources).toBe(before.sources)
    expect(after.claims).toBe(before.claims)
  })
  it('two namesakes look different on the confirmation card', async () => {
    const twin = await run('create_person', { person: { givenName: 'Николай', surname: 'Соколов', patronymic: 'Петрович', birthDate: '1861', deathDate: '1931' }, notDuplicate: true })
    const describe_ = TOOLS.find((t) => t.name === 'delete_person')!.describe!
    const [one, two] = [describe_(owner, { id: f.nikolai.id }), describe_(owner, { id: twin.id })]
    expect(one).toContain('1860')
    expect(two).toContain('Петрович')
    expect(two).toContain('1861')
    expect(one).not.toBe(two)
    // Search gives what the question to the person needs: patronymic, years, place.
    const found = await run('search_people', { query: 'Николай' })
    expect(found.length).toBe(2)
    expect(found.every((p: any) => p.years && 'place' in p)).toBe(true)
  })
})

describe('the shape of the family stays sound', () => {
  it('no cycles, no self links', async () => {
    await expect(run('add_relation', { type: 'son', to: f.pyotr.id, other: f.nikolai.id })).rejects.toThrow()
    await expect(run('add_relation', { type: 'father', to: f.nikolai.id, other: f.nikolai.id })).rejects.toThrow(/same person/)
  })
  it('no third birth parent, and no second father', async () => {
    const extra = await run('create_person', { person: { givenName: 'Третий', surname: 'Родитель', sex: 'M', birthDate: '1860', deathDate: '1930' } })
    await expect(run('add_relation', { type: 'father', to: f.ivan.id, other: extra.id })).rejects.toThrow(/two parents/)
    const orphan = await run('create_person', { person: { givenName: 'Сирота', surname: 'Новая', sex: 'F', birthDate: '1900', deathDate: '1970' } })
    await run('add_relation', { type: 'father', to: orphan.id, other: f.nikolai.id })
    await expect(run('add_relation', { type: 'father', to: orphan.id, other: extra.id })).rejects.toThrow(/already has a father/)
    await run('add_relation', { type: 'father', to: orphan.id, other: extra.id, kind: 'adopted' })
  })
  it('no parent of the wrong sex or younger than the child', async () => {
    await expect(run('add_relation', { type: 'mother', to: f.pyotr.id, other: f.nikolai.id })).rejects.toThrow(/sex/)
    const young = await run('create_person', { person: { givenName: 'Юный', surname: 'Отец', sex: 'M', birthDate: '1950', deathDate: '2000' } })
    await expect(run('add_relation', { type: 'son', to: young.id, other: f.ivan.id })).rejects.toThrow(/too young/)
  })
  it('no marriage between siblings or parent and child: a refusal, not a silent nothing', async () => {
    await expect(run('add_relation', { type: 'spouse', to: f.pyotr.id, other: f.ivan.id })).rejects.toThrow(/parent and their child/)
    const brother = await run('create_person', { person: { givenName: 'Брат', surname: 'Соколов', sex: 'M', birthDate: '1927', deathDate: '1999' }, relation: { type: 'son', to: f.ivan.id } })
    await expect(run('add_relation', { type: 'spouse', to: f.pyotr.id, other: brother.id })).rejects.toThrow(/siblings/)
  })
  it('a link is changed only in ways that make sense', async () => {
    const link = getDb().select().from(schema.parentChild).all()[0]
    await expect(run('update_relation', { type: 'parent', id: link.id, kind: 'дракон' })).rejects.toThrow(/not a kind/)
    await expect(run('update_relation', { type: 'parent', id: link.id, place: 'Тула' })).rejects.toThrow(/union/)
    await expect(run('update_relation', { type: 'parent', id: link.id })).rejects.toThrow(/nothing/)
    await expect(run('update_relation', { type: 'parent', id: 'nope', kind: 'birth' })).rejects.toThrow(/not found/)
  })
  it('a link to someone who does not exist is a plain refusal', async () => {
    await expect(run('create_person', { person: { givenName: 'Х', surname: 'Y', deathDate: '1950' }, relation: { type: 'son', to: 'nobody' } })).rejects.toThrow(/not found/)
    await expect(run('add_relation', { type: 'father', to: f.ivan.id, other: 'nobody' })).rejects.toThrow(/not found/)
  })
  it('a card names parents, children and spouses, so no extra calls are needed', async () => {
    const card = await run('get_person', { id: f.ivan.id })
    expect(card.parents.map((p: any) => p.name).sort()).toEqual(['Варвара Соколова', 'Николай Соколов'])
    expect(card.unions[0].name).toBe('Мария Белова')
    expect(card.children.every((c: any) => c.linkId && c.personId)).toBe(true)
    expect(JSON.stringify(await run('get_person', { id: f.pyotr.id }))).toContain('Живинская')
    expect(card.person).not.toHaveProperty('avatarCrop')
    expect(Array.isArray(card.person.tags)).toBe(true)
  })
})

describe('a change to many', () => {
  const targets = () => [f.nikolai.id, f.varvara.id, f.ivan.id, f.maria.id]
  it('goes through one always-asked call, with who and what on the card', async () => {
    process.env.AGENT_ALL_TOOLS = '1'
    const m = model(calls(['update_people', { changes: targets().map((id) => ({ id, patch: { deathPlace: 'Тульская губерния' } })) }]))
    const before = targets().map((id) => getPersonRow(id).deathPlace)
    const r = await send([user('Поменяй всем')], m, { trustWrites: true })
    delete process.env.AGENT_ALL_TOOLS
    const part = r.parts.find((p) => p.type === 'tool-update_people')
    expect(part.state).toBe('approval-requested')
    expect(part.approval.requestReason).toMatch(/Операций: 4/)
    expect(part.approval.requestReason).toContain('Мария Белова')
    expect(targets().map((id) => getPersonRow(id).deathPlace)).toEqual(before)
  })
  it('is one history entry, and one undo takes all of it back', async () => {
    const before = targets().map((id) => getPersonRow(id).deathPlace)
    const entries = history().length
    await run('update_people', { changes: targets().map((id) => ({ id, patch: { deathPlace: 'Тульская губерния' } })) })
    expect(history().length).toBe(entries + 1)
    const last = (await run('get_history', { limit: 1 }))[0]
    expect(last.actorName).toBe('Ассистент → Егор')
    expect(targets().every((id) => getPersonRow(id).deathPlace === 'Тульская губерния')).toBe(true)
    await run('undo', { historyId: last.id })
    expect(targets().map((id) => getPersonRow(id).deathPlace)).toEqual(before)
  })
  it('one bad line changes nothing at all', async () => {
    const before = getPersonRow(f.ivan.id).deathPlace
    await expect(run('update_people', { changes: [{ id: f.ivan.id, patch: { deathPlace: 'Х' } }, { id: 'nobody', patch: { deathPlace: 'Х' } }] })).rejects.toThrow(/not found/)
    await expect(run('update_people', { changes: [{ id: f.ivan.id, patch: { deathPlace: 'Х' } }, { id: f.ivan.id, patch: { deathPlace: 'Y' } }] })).rejects.toThrow(/twice/)
    expect(getPersonRow(f.ivan.id).deathPlace).toBe(before)
  })
  it('edits allowed for the conversation stop being silent after three in one answer', async () => {
    const m = model(calls(...[f.nikolai, f.varvara, f.ivan, f.maria, f.pyotr].map((p) => ['update_person', { id: p.id, patch: { otherNames: 'Серия' } }] as [string, unknown])), reply('Готово.'))
    const r = await send([user('Поправь всех по очереди')], m, { trustWrites: true })
    const states = r.parts.filter((p) => p.type === 'tool-update_person').map((p) => p.state)
    expect(states.filter((s) => s === 'approval-requested')).toHaveLength(2)
    expect(getPersonRow(f.pyotr.id).otherNames).not.toBe('Серия')
  })
})

describe('the history', () => {
  it('create, change and delete by the assistant are each undone exactly', async () => {
    const before = peopleCount()
    const made = await run('create_person', { person: { givenName: 'Откат', surname: 'Откатов', deathDate: '1950' } })
    await run('undo', { historyId: (await run('get_history', { limit: 1 }))[0].id })
    expect(peopleCount()).toBe(before)
    expect(() => getPersonRow(made.id)).toThrow()

    const old = getPersonRow(f.varvara.id).birthPlace
    await run('update_person', { id: f.varvara.id, patch: { birthPlace: 'Елец' } })
    await run('undo', { historyId: (await run('get_history', { limit: 1 }))[0].id })
    expect(getPersonRow(f.varvara.id).birthPlace).toBe(old)

    const gone = await run('create_person', { person: { givenName: 'Удалённый', surname: 'Вернувшийся', deathDate: '1950' }, relation: { type: 'daughter', to: f.pyotr.id } })
    await run('delete_person', { id: gone.id })
    await run('undo', { historyId: (await run('get_history', { limit: 1 }))[0].id })
    expect(getPersonRow(gone.id).givenName).toBe('Удалённый')
    expect(getGraph(owner).parentChild.some((l) => l.childId === gone.id)).toBe(true)
  })
  it('undoing the assistant’s edit leaves the person’s own earlier edit alone', async () => {
    const def = TOOLS.find((t) => t.name === 'update_person')!
    await def.run(editor, def.input.parse({ id: f.maria.id, patch: { otherNames: 'Моя правка' } }))
    await run('update_person', { id: f.maria.id, patch: { deathPlace: 'Правка ассистента' } })
    await run('undo', { historyId: (await run('get_history', { limit: 1 }))[0].id })
    const p = getPersonRow(f.maria.id)
    expect(p.otherNames).toBe('Моя правка')
    expect(p.deathPlace).not.toBe('Правка ассистента')
  })
  it('two answers are two entries, so undoing the second keeps the first', async () => {
    await run('update_person', { id: f.maria.id, patch: { birthPlace: 'Первая' } })
    await run('update_person', { id: f.maria.id, patch: { deathPlace: 'Вторая' } })
    await run('undo', { historyId: (await run('get_history', { limit: 1 }))[0].id })
    expect(getPersonRow(f.maria.id).birthPlace).toBe('Первая')
  })
  it('a newer edit is not overwritten by an undo', async () => {
    await run('update_person', { id: f.maria.id, patch: { birthPlace: 'Старая правка' } })
    const { id } = (await run('get_history', { limit: 1 }))[0]
    updatePerson(owner, f.maria.id, { birthPlace: 'Новее' })
    await expect(run('undo', { historyId: id })).rejects.toThrow()
    expect(getPersonRow(f.maria.id).birthPlace).toBe('Новее')
  })
  it('a call that changed nothing offers nothing to undo', async () => {
    const m = model(calls(['update_person', { id: f.varvara.id, patch: { birthPlace: 'Клин' } }], ['add_relation', { type: 'son', to: f.nikolai.id, other: f.ivan.id }]), reply('Готово.'))
    const r = await send([user('Свяжи')], m, { trustWrites: true })
    expect(r.parts.find((p) => p.type === 'tool-update_person').output.historyId).toBeTruthy()
    expect(r.parts.find((p) => p.type === 'tool-add_relation').output.historyId).toBeNull()
  })
  it('a refused call leaves the history as it was', async () => {
    const entries = history().length
    await run('create_person', { person: { birthDate: '1900' } }).catch(() => {})
    await run('add_relation', { type: 'father', to: f.ivan.id, other: f.ivan.id }).catch(() => {})
    expect(history().length).toBe(entries)
  })
})

describe('types of the answers', () => {
  it('every tool declares one', () => {
    for (const t of TOOLS) expect(t.output, t.name).toBeInstanceOf(z.ZodType)
  })
  it('an answer of the wrong shape is an error, not garbage for the model', async () => {
    const def = TOOLS.find((t) => t.name === 'get_settings')!
    setSetting('familyName', 'Соколовы')
    expect(Object.keys(await def.run(owner, {}) as object).sort()).toEqual(['familyName', 'language'])
    expect(def.output.safeParse({ familyName: 1 }).success).toBe(false)
  })
  it('raw database strings do not reach a model', async () => {
    const out = await run('update_person', { id: f.varvara.id, patch: { deathPlace: 'Тула' } })
    expect(JSON.stringify(out)).not.toContain('"tags"')
    expect(out).toHaveProperty('id', f.varvara.id)
  })
})

describe('building the chart from a description', () => {
  it('one import extends the chart around existing people, as one change', async () => {
    const before = history().length
    const count = peopleCount()
    const out = await run('import_text', { text: `${f.ivan.givenName} ${f.ivan.surname} id: ${f.ivan.id} + ${f.maria.givenName} ${f.maria.surname} id: ${f.maria.id}\n  Глеб Новиков b: 1925, d: 1995, sex: m\nГлеб Новиков + Зоя Тарасова b: 1928, d: 2015, sex: f, maiden: Лапина\n  Инна Новикова b: 1950, bp: Тула, d: 2020, sex: f` })
    expect(peopleCount()).toBe(count + 3)
    expect(history().length).toBe(before + 1)
    expect(out.people.map((p: any) => p.name).sort()).toEqual(['Глеб Новиков', 'Зоя Тарасова', 'Инна Новикова'])
    const inna = out.people.find((p: any) => p.name === 'Инна Новикова')
    expect(inna.parents.sort()).toEqual(['Глеб Новиков', 'Зоя Тарасова'])
    expect(out.check.unlinked).toEqual([])
    const id = (name: string) => out.people.find((p: any) => p.name === name).id
    const g = getGraph(owner)
    const parent = (a: string, b: string) => g.parentChild.some((l) => l.parentId === a && l.childId === b)
    expect(parent(f.ivan.id, id('Глеб Новиков')) && parent(f.maria.id, id('Глеб Новиков'))).toBe(true)
    expect(parent(id('Глеб Новиков'), id('Инна Новикова')) && parent(id('Зоя Тарасова'), id('Инна Новикова'))).toBe(true)
    expect(getPersonRow(id('Зоя Тарасова')).maidenName).toBe('Лапина')
    expect(getPersonRow(id('Инна Новикова')).birthPlace).toBe('Тула')
    await run('undo', { historyId: (await run('get_history', { limit: 1 }))[0].id })
    expect(peopleCount()).toBe(count)
  })
  it('the readback names who was left with no link at all', async () => {
    const out = await run('import_text', { text: 'Одинокий Человеков b: 1800, d: 1870' })
    expect(out.check.unlinked).toEqual(['Одинокий Человеков'])
    await run('undo', { historyId: (await run('get_history', { limit: 1 }))[0].id })
  })
  it('an import cannot do what a single link would be refused', async () => {
    const count = peopleCount()
    await expect(run('import_text', { text: 'Карп Юнов b: 1900, d: 1960, sex: m\n  Пимен Юнов b: 1890, d: 1950, sex: m' })).rejects.toThrow(/too young/)
    await expect(run('import_text', { text: 'Лев Датов b: 1900, d: 1850' })).rejects.toThrow(/before birth/)
    await expect(run('import_text', { text: `Третий Лишний b: 1850, d: 1920, sex: m\n  Иван Соколов id: ${f.ivan.id}` })).rejects.toThrow(/more than two/)
    expect(peopleCount()).toBe(count)
  })
  it('the format is explained in the tool itself, and the card shows what will happen', () => {
    const def = TOOLS.find((t) => t.name === 'import_text')!
    expect(def.description).toContain('id:')
    expect(def.describe!(owner, { text: 'Новый Человек b: 1800, d: 1850' })).toMatch(/Новый/)
  })
  it('old data that does not fit a type never breaks an answer', async () => {
    const def = TOOLS.find((t) => t.name === 'get_person')!
    const id = (await run('create_person', { person: { givenName: 'Старый', surname: 'Формат', deathDate: '1950' } })).id
    updatePerson(owner, id, { sources: [{ title: 'Без id' } as never], facts: [{ kind: 'Только вид' } as never] })
    expect(((await def.run(assistantActor(editor), { id })) as any).person.sources[0].title).toBe('Без id')
  })
  it('a plan is kept as given, and needs no permission', async () => {
    const out = await run('set_plan', { steps: [{ text: 'Найти Ивана' }, { text: 'Импортировать', done: true }], note: 'id ivan' })
    expect(out).toEqual({ steps: [{ text: 'Найти Ивана', done: false }, { text: 'Импортировать', done: true }], note: 'id ivan' })
    expect(TOOLS.find((t) => t.name === 'set_plan')!.risk).toBe('ui')
  })
  it('it stops at the last step, and after three failed steps in a row', () => {
    const failed = { content: [{ type: 'tool-call' }, { type: 'tool-error' }] }
    const fine = { content: [{ type: 'tool-call' }, { type: 'tool-result' }] }
    expect(mustFinish([], 24)).toBe(true)
    expect(mustFinish([], 3)).toBe(false)
    expect(mustFinish([failed, failed], 2)).toBe(false)
    expect(mustFinish([failed, failed, failed], 3)).toBe(true)
    expect(mustFinish([failed, fine, failed], 3)).toBe(false)
  })
  it('the model that keeps failing is told to stop, and pays for no more than that', async () => {
    const m = new MockLanguageModelV4({ doStream: async () => calls(['update_person', { id: 'nobody', patch: { otherNames: 'Х' } }]) as never })
    await send([user('Снова')], m, { trustWrites: true })
    expect(m.doStreamCalls.length).toBeLessThanOrEqual(4)
    expect(m.doStreamCalls.at(-1)!.toolChoice).toEqual({ type: 'none' })
  })
})

describe('tokens', () => {
  it('every tool is in the core or in exactly one group, and readers lose nothing', () => {
    const grouped = Object.values(TOOL_GROUPS).flatMap((g) => g.tools)
    expect(new Set(grouped).size).toBe(grouped.length)
    for (const t of toolsFor(assistantActor(owner), 'assistant')) expect(CORE_TOOLS.includes(t.name) || grouped.includes(t.name), t.name).toBe(true)
    for (const n of [...CORE_TOOLS, ...grouped]) expect(TOOLS.some((t) => t.name === n), n).toBe(true)
  })
  it('only the core goes along until a group is asked for, and files bring their group', async () => {
    const m = model(calls(['use_tools', { groups: ['pages'] }]), calls(['list_pages', { personId: f.ivan.id }]), reply('Да.'))
    await send([user('Покажи страницы')], m)
    const names = (i: number) => (m.doStreamCalls[i].tools ?? []).map((t) => t.name)
    expect(names(0)).toEqual(expect.arrayContaining(['get_person', 'import_text', 'use_tools']))
    expect(names(0)).not.toContain('create_page')
    expect(names(1)).toContain('create_page')
    expect(names(1)).not.toContain('save_attachment')
    expect(activeToolNames(new Set(['save_attachment', 'get_person']), [], true)).toEqual(['get_person', 'save_attachment'])
  })
  it('a tool guessed without being offered brings its group, so the next step can use it', async () => {
    const m = model(calls(['focus_person', { id: f.ivan.id }]), calls(['focus_person', { id: f.ivan.id }]), reply('Да.'))
    const r = await send([user('Покажи')], m)
    expect((m.doStreamCalls[1].tools ?? []).map((t) => t.name)).toContain('focus_person')
    expect(r.parts.filter((p) => p.type === 'tool-focus_person').at(-1).state).toBe('output-available')
  })
  it('empty fields stay away from the model, an empty answer keeps its meaning', () => {
    expect(lean({ a: '', b: null, c: [], d: 'x', e: { f: '' }, g: 0, h: false })).toEqual({ d: 'x', e: {}, g: 0, h: false })
    expect(lean({ relation: null })).toEqual({ relation: null })
    expect(lean([{ a: '' }, { a: 'x' }])).toEqual([{}, { a: 'x' }])
  })
  it('old long answers are shortened and the newest kept whole', () => {
    const long = 'х'.repeat(5000)
    const tool = (id: string): ModelMessage => ({ role: 'tool', content: [{ type: 'tool-result', toolCallId: id, toolName: 'get_person', output: { type: 'text', value: long } }] })
    const call = (id: string): ModelMessage => ({ role: 'assistant', content: [{ type: 'tool-call', toolCallId: id, toolName: 'get_person', input: {} }] })
    const out = trimHistory([{ role: 'user', content: 'x' }, call('a'), tool('a'), call('b'), tool('b'), call('c'), tool('c'), call('d'), tool('d')])
    const text = (i: number) => JSON.stringify(out[i].content)
    expect(text(2).length).toBeLessThan(1400)
    expect(text(2)).toContain('shortened')
    expect(text(8).length).toBeGreaterThan(5000)
  })
  const size = (who: typeof owner) => toolsFor(assistantActor(who), 'assistant').filter((t) => CORE_TOOLS.includes(t.name)).reduce((sum, t) => sum + t.name.length + t.description.length + JSON.stringify(z.toJSONSchema(t.input, { io: 'input' })).length, 0)
  it('tool descriptions stay within budget', () => {
    expect(size(owner), 'owner').toBeLessThan(BUDGET_OWNER)
  })
  it('a long tool answer is cut before the model sees it, and the person still gets it whole', async () => {
    process.env.AGENT_ALL_TOOLS = '1'
    const m = model(calls(['parse_table', { csv: `Имя,Фамилия\n${Array.from({ length: 6000 }, (_, i) => `Захар${i},Таблицын`).join('\n')}` }]), reply('Да.'))
    const r = await send([user('Разбери')], m)
    delete process.env.AGENT_ALL_TOOLS
    expect(r.parts.find((p) => p.type === 'tool-parse_table').output.text.length).toBeGreaterThan(60_000)
    const seen = JSON.stringify(m.doStreamCalls[1].prompt.filter((x) => x.role === 'tool'))
    expect(seen).toContain('[Cut:')
    expect(seen.length).toBeLessThan(70_000)
  })
  it('a photo from the archive reaches the model as a picture, and the chat keeps only its name', async () => {
    process.env.AGENT_ALL_TOOLS = '1'
    const m = model(calls(['view_photo', { id: f.photo.id }]), reply('Вижу.'))
    const r = await send([user('Что на фото?')], m)
    delete process.env.AGENT_ALL_TOOLS
    expect(r.parts.find((p) => p.type === 'tool-view_photo').output).toMatchObject({ id: f.photo.id, name: 'свадьба.jpg' })
    expect(JSON.stringify(r.parts)).not.toContain('base64')
    const result = m.doStreamCalls[1].prompt.flatMap((x) => (x.role === 'tool' ? x.content : [])).find((p) => p.type === 'tool-result')!
    expect(JSON.stringify(result.output)).toContain('image/jpeg')
  })
  it('tool calls from older questions are dropped, the last two stay, and no call loses its answer', () => {
    const q = (text: string): ModelMessage => ({ role: 'user', content: text })
    const asked = (id: string): ModelMessage[] => [
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: id, toolName: 'get_person', input: {} }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: id, toolName: 'get_person', output: { type: 'text', value: `ответ ${id}` } }] },
      { role: 'assistant', content: `итог ${id}` },
    ]
    const out = trimHistory([q('1'), ...asked('a'), q('2'), ...asked('b'), q('3'), ...asked('c')])
    const text = JSON.stringify(out)
    expect(text).not.toContain('ответ a')
    expect(text).toContain('итог a')
    expect(text).toContain('ответ b')
    expect(text).toContain('ответ c')
    const calls_ = out.flatMap((m) => (Array.isArray(m.content) ? (m.content as any[]) : [])).filter((p: any) => p.type === 'tool-call').map((p: any) => p.toolCallId)
    const results = out.flatMap((m) => (Array.isArray(m.content) ? (m.content as any[]) : [])).filter((p: any) => p.type === 'tool-result').map((p: any) => p.toolCallId)
    expect(calls_).toEqual(results)
    const short = [q('1'), ...asked('a'), q('2')]
    expect(trimHistory(short)).toBe(short)
  })
  it('an old attachment is not sent again', async () => {
    const att = await saveAttachment(assistantActor(editor), Buffer.from('СЕКРЕТНЫЙ ТЕКСТ ФАЙЛА'), 'старый.txt')
    const withFile: UIMessage = { id: 'old', role: 'user', parts: [{ type: 'text', text: 'Файл' }, { type: 'file', mediaType: 'text/plain', filename: att.name, url: `/api/agent/files/${att.id}` }] }
    const said = (t: string): UIMessage => ({ id: `a${++n}`, role: 'assistant', parts: [{ type: 'text', text: t }] })
    const recent = model(reply('Да.'))
    await send([withFile, said('Ок'), user('Что там?')], recent)
    expect(JSON.stringify(recent.doStreamCalls[0].prompt)).toContain('СЕКРЕТНЫЙ ТЕКСТ')
    const old = model(reply('Да.'))
    await send([withFile, said('Ок'), user('Ещё'), said('Ок'), user('И ещё')], old)
    const text = JSON.stringify(old.doStreamCalls[0].prompt)
    expect(text).not.toContain('СЕКРЕТНЫЙ ТЕКСТ')
    expect(text).toContain(att.id)
  })
  it('each answer reports the tokens it used', async () => {
    const r = await send([user('Привет')], model(reply('Здравствуйте.')))
    expect((r.message.metadata as any).usage.inputTokens).toBe(7)
    expect((r.message.metadata as any).usage.outputTokens).toBe(3)
  })
  it('the rules tell the model when to ask, and it gets them before anything else', () => {
    const rules = JSON.stringify((buildAgent(editor, { model: model(reply('')) }) as any).settings.instructions[0].content)
    expect(rules.length).toBeLessThan(2600)
    expect(rules).toContain('compare what the tool answered')
    expect(rules).toContain('If a name fits more than one person, do not choose')
    expect(rules).toContain('more than 3 people')
    expect(rules).toContain('notDuplicate')
  })
})

// Facts carry their people and extra fields: an agent that rewrites the list must see them, or it would drop them.
const BUDGET_OWNER = 11_500

describe('reasoning sent back', () => {
  const turn = (i: number) => [{ role: 'user', content: 'q' + i }, { role: 'assistant', content: [{ type: 'reasoning', text: 'think' + i }, { type: 'tool-call', toolCallId: 'c' + i, toolName: 'search', input: {} }] }, { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c' + i, toolName: 'search', output: { type: 'text', value: 'ok' } }] }] as never[]
  const kinds = (m: ReturnType<typeof trimHistory>) => m.flatMap((x) => (Array.isArray(x.content) ? x.content.map((p: { type: string }) => p.type) : []))
  it('is dropped from old answers by default and kept for services that demand it', () => {
    const m = [...turn(1), ...turn(2), ...turn(3)]
    expect(kinds(trimHistory(m))).not.toContain('reasoning')
    expect(kinds(trimHistory(m, true))).toContain('reasoning')
  })
})
