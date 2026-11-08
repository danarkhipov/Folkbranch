// A person who died, or one story, kept from readers on purpose: every way out stays shut, as for the living.
import { beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../lib/ops/core'

const owner: Actor = { userId: 'o', name: 'Owner', role: 'owner', personId: null }
const reader: Actor = { userId: 'r', name: 'Reader', role: 'reader', personId: null }

let people: typeof import('../lib/ops/people')
let pages: typeof import('../lib/ops/pages')
let stories: typeof import('../lib/ops/stories')
let gedcom: typeof import('../lib/ops/gedcom')
let file: typeof import('../lib/ops/family-file')
let search: typeof import('../lib/ops/search')
const ids = { secret: '', open: '' }
const storyIds = { kept: '', shown: '' }

beforeAll(async () => {
  people = await import('../lib/ops/people')
  pages = await import('../lib/ops/pages')
  stories = await import('../lib/ops/stories')
  gedcom = await import('../lib/ops/gedcom')
  file = await import('../lib/ops/family-file')
  search = await import('../lib/ops/search')
  ids.secret = people.createPerson(owner, { givenName: 'Тихон', surname: 'Тайнов', birthDate: '1890', deathDate: '1950', living: false }).id
  ids.open = people.createPerson(owner, { givenName: 'Ольга', surname: 'Открытова', birthDate: '1892', deathDate: '1960', living: false }).id
  people.updatePerson(owner, ids.secret, { keepPrivate: true })
  pages.createPage(owner, { personId: ids.secret, title: 'Тайная биография', content: [] })
  storyIds.kept = stories.createStory(owner, { about: [ids.open], title: 'Семейная тайна', body: 'никому', tellerName: '', toldOn: '', keepPrivate: true }).id
  storyIds.shown = stories.createStory(owner, { about: [ids.open], title: 'Как жили', body: 'всем', tellerName: '', toldOn: '' }).id
})

describe('a person kept private', () => {
  it('stays an unnamed card for a reader, and whole for the family', () => {
    expect(people.getGraph(reader).persons.find((p) => p.id === ids.secret)).toMatchObject({ givenName: '', surname: '', deathDate: '' })
    expect(people.getGraph(owner).persons.find((p) => p.id === ids.secret)).toMatchObject({ givenName: 'Тихон', keepPrivate: true })
    expect(people.getGraph(reader).persons.find((p) => p.id === ids.open)?.givenName).toBe('Ольга')
  })
  it('keeps their pages from a reader', () => {
    expect(() => pages.listPages(reader, ids.secret)).toThrow()
  })
  it('leaves them out of a reader\'s export and of the file for relatives', async () => {
    expect(gedcom.exportGedcom(reader, false)).not.toContain('Тайнов')
    expect(gedcom.exportGedcom(owner, true)).not.toContain('Тайнов')
    expect(gedcom.exportGedcom(owner, false)).toContain('Тайнов')
    const { html } = await file.buildFamilyFile(owner)
    expect(html).not.toContain('Тайнов')
    expect(html).toContain('Открытова')
  })
  it('is not found by a reader\'s search', () => {
    expect(JSON.stringify([search.searchArchive(reader, 'Тайнов'), search.findPeople(reader, 'Тайнов', 10)])).not.toContain(ids.secret)
  })
})

describe('a story kept private', () => {
  it('reaches the family, and not a reader', () => {
    expect(stories.listStories(owner, ids.open).map((s) => s.id).sort()).toEqual([storyIds.kept, storyIds.shown].sort())
    expect(stories.listStories(reader, ids.open).map((s) => s.id)).toEqual([storyIds.shown])
    expect(() => stories.storyAudio(reader, storyIds.kept)).toThrow()
  })
  it('changes back, and stays when edited without a word about it', () => {
    const s = stories.listStories(owner, ids.open).find((x) => x.id === storyIds.kept)!
    const { updatedAt } = stories.updateStory(owner, s.id, { ...s, keepPrivate: false, baseUpdatedAt: s.updatedAt })
    expect(stories.listStories(reader, ids.open).map((x) => x.id)).toContain(storyIds.kept)
    stories.updateStory(owner, s.id, { title: 'Семейная тайна', body: 'никому', tellerName: '', toldOn: '', about: [ids.open], keepPrivate: true, baseUpdatedAt: updatedAt })
    const again = stories.listStories(owner, ids.open).find((x) => x.id === storyIds.kept)!
    stories.updateStory(owner, s.id, { title: 'Новое имя', body: 'никому', tellerName: '', toldOn: '', about: [ids.open], baseUpdatedAt: again.updatedAt })
    expect(stories.listStories(reader, ids.open).map((x) => x.id)).not.toContain(storyIds.kept)
  })
})
