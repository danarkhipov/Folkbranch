// Where the content half of the archive can break or lose something: pages, stories,
// photos, face tags and the files the assistant is given. Each case below guards a defect
// that was fixed; the comments say what used to go wrong.
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { getDb, schema } from '../lib/db'
import type { Actor } from '../lib/ops/core'
import * as core from '../lib/ops/core'
import * as media from '../lib/ops/media'
import * as pages from '../lib/ops/pages'
import * as people from '../lib/ops/people'
import * as proposals from '../lib/ops/proposals'
import { listHistory } from '../lib/ops/settings'
import * as stories from '../lib/ops/stories'
import * as requests from '../lib/ops/story-requests'
import { addStory } from '../lib/ops/suggest'

const owner: Actor = { userId: 'content-owner', name: 'Хозяйка', role: 'owner', personId: null }
const reader: Actor = { userId: 'content-reader', name: 'Читатель', role: 'reader', personId: null }

const SOUND = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(200)])
const jpeg = () => sharp({ create: { width: 40, height: 40, channels: 3, background: '#654' } }).jpeg().toBuffer()
const person = (givenName: string, extra: Record<string, unknown> = {}) =>
  people.createPerson(owner, { givenName, surname: 'Угловой', birthDate: '1900', deathDate: '1950', ...extra } as never)

/** The story one link made: the draft is known by its teller, and stories by theirs. */
async function storyFromLink(aboutId: string, question: string, seconds: number | null, teller: string) {
  const { token } = requests.createRequest(owner, { personId: aboutId, tellerName: teller, question })
  await requests.submitRecording(token, { buf: SOUND, name: 'voice.ogg' }, seconds)
  const draft = proposals.listProposals(owner).find((d) => d.authorName === teller)!
  proposals.acceptProposal(owner, draft.id)
  return stories.listStories(owner, aboutId).find((s) => s.tellerName === teller)!
}

describe('pages belong to one person', () => {
  it('a page may only be nested under a page of the same person', () => {
    // Both entry points must refuse a parent page of another person. Such a page is not
    // merely shown in the wrong tree: deletePage() walks children by parentPageId alone,
    // so deleting one person's page would delete the other person's page too.
    const anna = person('Анна')
    const boris = person('Борис')
    const annaPage = pages.createPage(owner, { personId: anna.id, title: 'Анна' })
    const borisPage = pages.createPage(owner, { personId: boris.id, title: 'Борис' })
    const refused = (fn: () => unknown) => { try { fn(); return false } catch { return true } }
    expect({
      created: refused(() => pages.createPage(owner, { personId: boris.id, title: 'Под чужой', parentPageId: annaPage.id })),
      moved: refused(() => pages.updatePage(owner, borisPage.id, { parentPageId: annaPage.id })),
    }).toEqual({ created: true, moved: true })
  })

  it('deleting a page does not take another person\'s page with it', () => {
    // Older versions allowed such a row, so it may already be in an archive. Creating it
    // directly stands in for that data; the deletion must not carry it off.
    const anna = person('Анна')
    const boris = person('Борис')
    const annaPage = pages.createPage(owner, { personId: anna.id, title: 'Анна' })
    const borisPage = pages.createPage(owner, { personId: boris.id, title: 'Детство' })
    getDb().update(schema.pages).set({ parentPageId: annaPage.id }).where(eq(schema.pages.id, borisPage.id)).run()
    pages.deletePage(owner, annaPage.id)
    expect(pages.listPages(owner, boris.id).some((p) => p.id === borisPage.id)).toBe(true)
    expect(pages.getPage(owner, borisPage.id).parentPageId).toBeNull()
  })

  it('a page moved inside the same person comes back on undo', () => {
    const p = person('Пётр')
    const a = pages.createPage(owner, { personId: p.id, title: 'А' })
    const b = pages.createPage(owner, { personId: p.id, title: 'Б' })
    pages.updatePage(owner, b.id, { parentPageId: a.id })
    expect(pages.getPage(owner, b.id).parentPageId).toBe(a.id)
    core.undo(owner, listHistory(owner)[0].id, 'undo')
    expect(pages.getPage(owner, b.id).parentPageId).toBeNull()
  })
})

describe('stories', () => {
  it('a partial change keeps the fields it does not mention', async () => {
    // PATCH is used by the API. The schema used to give every missing field a default of '',
    // so a caller that fixed a typo in `about` without resending the text erased the words.
    const p = person('Слова')
    const teller = person('Тётя')
    await addStory(owner, { about: [p.id], tellerId: teller.id, title: 'Письмо', body: 'Дорогие мои, я жив.', toldOn: '1945' }, null)
    const s = stories.listStories(owner, p.id).find((x) => x.title === 'Письмо')!
    stories.updateStory(owner, s.id, { about: [p.id], baseUpdatedAt: s.updatedAt })
    const after = stories.listStories(owner, p.id).find((x) => x.id === s.id)!
    expect(after.body).toBe('Дорогие мои, я жив.')
    expect(after.tellerId).toBe(teller.id)
  })

  it('a story asked for by a link is saved within the story limits, so it can be edited again', async () => {
    // The question on a link may be 1200 characters, but a story title is capped at 200
    // by the only editor that exists. The link path must cut the title to that limit, or
    // every later PATCH with the story's own title is refused.
    const p = person('Ссылка')
    const question = `Почему ${'очень длинный вопрос '.repeat(15)}`
    expect(question.length).toBeGreaterThan(200)
    const s = await storyFromLink(p.id, question, null, 'Тётя Люба')
    expect(() =>
      stories.updateStory(owner, s.id, { about: [p.id], title: s.title, body: s.body, tellerName: s.tellerName, toldOn: s.toldOn, durationSec: s.durationSec, baseUpdatedAt: s.updatedAt }),
    ).not.toThrow()
  })

  it('a link cannot give a story a duration outside what a story allows', async () => {
    // newStory caps durationSec at one day; the link path must not store a value outside
    // that, since the same value would then fail updateStory()'s validation.
    const p = person('Длина')
    const s = await storyFromLink(p.id, 'Сколько это длилось?', 10 ** 9, 'Дядя Фёдор')
    expect(s.durationSec).toBeNull()
  })
})

describe('photos and the things that point at them', () => {
  it('deleting a photo a page still shows is refused', async () => {
    // A biography block keeps /api/v1/media/<id>/file. deleteMedia() must not remove the row
    // and the tags while the page still shows the photo, leaving a broken picture behind.
    const p = person('Фотограф')
    const m = await media.uploadMedia(owner, await jpeg(), 'портрет.jpg', p.id)
    const page = pages.createPage(owner, {
      personId: p.id,
      title: 'С фотографией',
      content: [{ type: 'image', props: { url: `/api/v1/media/${m.id}/file?size=medium`, caption: 'Портрет' } }],
    })
    expect(pages.getPage(owner, page.id).content).toContain(m.id)
    expect(() => media.deleteMedia(owner, m.id)).toThrow()
  })

  it('a photo is not filed under a person who does not exist', async () => {
    // The multipart upload route calls uploadMedia() directly, not the validated
    // upload_photo op, so the commit itself must refuse a stale form field that names a
    // person who no longer exists rather than create a media tags row pointing nowhere.
    const stored = await media.storeUpload(await jpeg(), 'сирота.jpg', owner.userId)
    expect(() => media.commitUpload(owner, stored, 'no-such-person')).toThrow()
  })

  it('deleting a photo used as an avatar clears the portrait, and undo brings both back', async () => {
    const p = person('Аватар')
    const m = await media.uploadMedia(owner, await jpeg(), 'лицо.jpg', p.id)
    people.setAvatar(owner, p.id, m.id, { x: 0, y: 0, w: 1, h: 1 })
    media.deleteMedia(owner, m.id)
    expect(people.getGraph(owner).persons.find((x) => x.id === p.id)!.avatarMediaId).toBeNull()
    core.undo(owner, listHistory(owner)[0].id, 'undo')
    const restored = people.getPersonRow(p.id)
    expect(restored.avatarMediaId).toBe(m.id)
    expect((await media.readAvatar(m.id, restored.avatarCrop)).length).toBeGreaterThan(0)
  })

  it('a reader is never shown a living person\'s photo by id or in a list', async () => {
    const alive = person('Живая', { living: true, deathDate: '' })
    const m = await media.uploadMedia(owner, await jpeg(), 'живая.jpg', alive.id)
    expect(media.listPersonMedia(reader, alive.id)).toEqual([])
    expect(media.listAllMedia(reader).some((x) => x.id === m.id)).toBe(false)
    expect(() => media.getMedia(reader, m.id)).toThrow()
    expect(media.listPersonMedia(owner, alive.id).map((x) => x.id)).toContain(m.id)
  })
})
