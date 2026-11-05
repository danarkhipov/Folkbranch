import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '../lib/db'
import { mediaFile } from '../lib/storage'
import type { Actor } from '../lib/ops/core'
import * as core from '../lib/ops/core'
import * as media from '../lib/ops/media'
import * as people from '../lib/ops/people'
import { acceptProposal, listProposals, queuedAudio, rejectProposal } from '../lib/ops/proposals'
import { createShare, guestFromCookie, openShare } from '../lib/ops/share'
import * as stories from '../lib/ops/stories'
import { addStory } from '../lib/ops/suggest'
import { toolsFor } from '../lib/ops/tools'
import * as views from '../lib/ops/views'

const owner: Actor = { userId: 'o', name: 'Хозяйка', role: 'owner', personId: null }
const reader: Actor = { userId: 'r', name: 'Тётя', role: 'reader', personId: null }
const make = (givenName: string, living = false) => (people.createPerson(owner, { givenName, surname: 'Рассказов', living } as never) as unknown as { id: string }).id
const voice = () => ({ buf: Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(2000, 7)]), name: 'запись.webm' })
const about = (id: string) => ({ about: [id], title: 'Про войну', body: 'Он вернулся в сорок пятом.', toldOn: '2026' })
let dead: string, other: string, alive: string

beforeAll(() => {
  dead = make('Дед')
  other = make('Посторонний')
  alive = make('Живая', true)
})

const list = (a: Actor, id = dead) => stories.listStories(a, id)
const guest = (raw: unknown) => guestFromCookie(openShare(createShare(owner, raw).token, undefined).cookie)!

describe('stories', () => {
  it('an editor adds one, with a voice stored as it came', async () => {
    const { id } = await addStory(owner, { ...about(dead), tellerName: 'бабушка' }, voice()) as { id: string }
    const [s] = list(owner).filter((x) => x.id === id)
    expect(s).toMatchObject({ title: 'Про войну', tellerName: 'бабушка', hasAudio: true, createdBy: 'Хозяйка' })
    const a = stories.storyAudio(owner, id)
    expect(a.mime).toBe('audio/webm')
    expect(readFileSync(mediaFile(a.filename))).toEqual(voice().buf)
  })

  it('a file that is not sound is refused and leaves nothing behind', async () => {
    await expect(addStory(owner, about(dead), { buf: Buffer.from('<html><script>alert(1)</script></html>'), name: 'x.webm' })).rejects.toThrow()
    await expect(addStory(owner, { about: [dead] }, null)).rejects.toThrow()
    await expect(addStory(owner, about(dead), { buf: Buffer.alloc(media.MAX_AUDIO + 1, 0xff), name: 'x.mp3' })).rejects.toMatchObject({ status: 413 })
  })

  it('never touches the facts', async () => {
    const before = people.getPersonRow(dead)
    await addStory(owner, about(dead), null)
    const after = people.getPersonRow(dead)
    expect([after.facts, after.sources, after.birthDate, after.certainty]).toEqual([before.facts, before.sources, before.birthDate, before.certainty])
  })

  it('a change made meanwhile is not overwritten', async () => {
    const { id } = await addStory(owner, about(other), null) as { id: string }
    const [s] = list(owner, other)
    const { updatedAt } = stories.updateStory(owner, id, { ...about(other), body: 'первая', baseUpdatedAt: s.updatedAt })
    expect(() => stories.updateStory(owner, id, { ...about(other), body: 'вторая', baseUpdatedAt: s.updatedAt })).toThrow('changed')
    expect(list(owner, other).find((x) => x.id === id)?.body).toBe('первая')
    stories.updateStory(owner, id, { ...about(other), body: 'третья', baseUpdatedAt: updatedAt })
  })

  it('deleting can be undone, voice and all', async () => {
    const { id } = await addStory(owner, about(other), voice()) as { id: string }
    stories.deleteStory(owner, id)
    expect(list(owner, other).some((x) => x.id === id)).toBe(false)
    const [last] = getDb().select().from(schema.history).all().slice(-1)
    core.undo(owner, last.id, 'undo')
    expect(list(owner, other).find((x) => x.id === id)?.hasAudio).toBe(true)
    expect(stories.storyAudio(owner, id).mime).toBe('audio/webm')
  })

  it('goes when the only person it is about goes, and comes back with them', async () => {
    const lone = make('Один')
    const { id } = await addStory(owner, about(lone), voice()) as { id: string }
    people.deletePerson(owner, lone)
    expect(getDb().select().from(schema.stories).where(eq(schema.stories.id, id)).get()).toBeUndefined()
    const [last] = getDb().select().from(schema.history).all().slice(-1)
    core.undo(owner, last.id, 'undo')
    expect(list(owner, lone).find((x) => x.id === id)?.hasAudio).toBe(true)
  })

  it('a teller who is deleted leaves the story standing', async () => {
    const t = make('Рассказчик')
    const { id } = await addStory(owner, { ...about(other), tellerId: t }, null) as { id: string }
    people.deletePerson(owner, t)
    expect(list(owner, other).find((x) => x.id === id)?.tellerId).toBeNull()
  })
})

describe('who hears what', () => {
  it('a story with someone hidden in it is gone for a reader, voice included', async () => {
    const told = await addStory(owner, { ...about(dead), tellerId: alive }, voice()) as { id: string }
    const with2 = await addStory(owner, { ...about(dead), about: [dead, alive] }, voice()) as { id: string }
    const seen = list(reader).map((s) => s.id)
    expect(seen).not.toContain(told.id)
    expect(seen).not.toContain(with2.id)
    expect(() => stories.storyAudio(reader, told.id)).toThrow()
    expect(() => stories.storyAudio(reader, with2.id)).toThrow()
    expect(() => list(reader, alive)).toThrow()
    // Their own card is theirs: someone can hear what they themself told.
    expect(list({ ...reader, personId: alive }).map((s) => s.id)).toContain(told.id)
  })

  it('a voice nobody can place stays closed, and so does a name without a card', async () => {
    const { id } = await addStory(owner, { ...about(dead), tellerName: 'соседка Нина' }, voice()) as { id: string }
    const s = list(reader).find((x) => x.id === id)!
    expect(s).toMatchObject({ tellerName: '', createdBy: '', hasAudio: false })
    expect(() => stories.storyAudio(reader, id)).toThrow()
    const { mediaId } = getDb().select().from(schema.stories).where(eq(schema.stories.id, id)).get()!
    expect(media.canSeeMedia(reader, mediaId!)).toBe(false)
    await expect(media.readMediaFile(reader, mediaId!, 'orig')).rejects.toThrow()
    expect(media.listAllMedia(owner).some((m) => m.id === mediaId)).toBe(false)
    expect(() => media.deleteMedia(owner, mediaId!)).toThrow('with its story')
  })

  it('the voice of someone who has died can be heard', async () => {
    const { id } = await addStory(owner, { ...about(dead), tellerId: other }, voice()) as { id: string }
    expect(list(reader).find((x) => x.id === id)?.hasAudio).toBe(true)
    expect(stories.storyAudio(reader, id).mime).toBe('audio/webm')
  })

  it('a link hears what a reader hears, and a link to a branch only that branch', async () => {
    const { id } = await addStory(owner, { ...about(dead), tellerId: other }, voice()) as { id: string }
    const g = guest({ name: 'всем' })
    expect(stories.storyAudio(g, id).mime).toBe('audio/webm')
    const v = views.createView(owner, { name: 'д', scope: 'near', focusId: dead, collapsed: [] })
    const narrow = guest({ name: 'ветка', viewId: v.id })
    expect(list(narrow).some((s) => s.id === id)).toBe(false)
    expect(() => stories.storyAudio(narrow, id)).toThrow()
    expect(() => list(narrow, other)).toThrow()
    await expect(addStory(g, about(dead), null)).rejects.toThrow('forbidden')
  })

  it('no model and no token gets at a story or a voice', async () => {
    for (const s of ['mcp', 'assistant'] as const) expect(toolsFor(owner, s as never).map((t) => t.name)).not.toContain('create_story')
    const { id } = await addStory(owner, about(dead), voice()) as { id: string }
    expect(() => stories.storyAudio({ ...owner, assistant: true }, id)).toThrow()
    expect(() => list({ ...owner, assistant: true })).toThrow()
    expect(() => list({ ...owner, tokenId: 't' })).toThrow()
    expect(() => stories.storyAudio({ ...owner, tokenId: 't' }, id)).toThrow()
    await expect(addStory({ ...owner, tokenId: 't' }, about(dead), null)).rejects.toThrow('forbidden')
  })
})

describe('a reader telling a story', () => {
  const draft = () => listProposals(owner).find((d) => d.authorName === 'Тётя')!

  it('waits for review; the voice can be heard first; accepted, it stands under their name', async () => {
    await addStory(reader, { ...about(dead), title: 'Письмо', tellerId: other }, voice())
    expect(list(owner).some((s) => s.title === 'Письмо')).toBe(false)
    const d = draft()
    expect(d.ops[0]).toMatchObject({ audio: true })
    expect(d.ops[0].details).toContain('С записью голоса')
    expect(queuedAudio(owner, d.id, 0).mime).toBe('audio/webm')
    expect(() => queuedAudio(reader, d.id, 0)).toThrow('forbidden')
    acceptProposal(owner, d.id)
    expect(list(owner).find((s) => s.title === 'Письмо')).toMatchObject({ createdBy: 'Тётя', hasAudio: true })
  })

  it('rejected, the file is removed from the disk', async () => {
    await addStory(reader, about(dead), voice())
    const d = draft()
    const { filename } = queuedAudio(owner, d.id, 0)
    await rejectProposal(owner, d.id)
    expect(() => readFileSync(mediaFile(filename))).toThrow()
  })

  it('cannot name anyone hidden, nor fill the disk', async () => {
    await expect(addStory(reader, about(alive), null)).rejects.toThrow('not found')
    await expect(addStory(reader, { ...about(dead), tellerId: alive }, null)).rejects.toThrow('not found')
    let last: { status?: number } = {}
    for (let i = 0; i < 7; i++) await addStory(reader, about(dead), voice()).catch((e) => { last = e })
    expect(last.status).toBe(429)
    await rejectProposal(owner, draft().id)
  })
})
