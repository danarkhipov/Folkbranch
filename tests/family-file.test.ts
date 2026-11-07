// The file that leaves the archive for good: nothing about the living may be in it, and it must reach for nothing.
import { beforeAll, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import type { Actor } from '../lib/ops/core'

const owner: Actor = { userId: 'o', name: 'Owner', role: 'owner', personId: null }
const editor: Actor = { userId: 'e', name: 'Editor', role: 'editor', personId: null }

let html = ''
let stats: import('../lib/ops/family-file').FamilyFileStats
let build: typeof import('../lib/ops/family-file').buildFamilyFile

const photo = (color: string) => sharp({ create: { width: 400, height: 300, channels: 3, background: color } }).jpeg().toBuffer()

beforeAll(async () => {
  const people = await import('../lib/ops/people')
  const pages = await import('../lib/ops/pages')
  const media = await import('../lib/ops/media')
  ;({ buildFamilyFile: build } = await import('../lib/ops/family-file'))

  const grandma = people.createPerson(owner, { givenName: 'Агафья', surname: 'Покойная', sex: 'F', birthDate: '1901', birthPlace: 'Тверь', deathDate: '1980', deathPlace: 'Москва' })
  const living = people.createPerson(owner, { givenName: 'Живущая', surname: 'Секретная', maidenName: 'Девичьятайна', sex: 'F', birthDate: '1975', birthPlace: 'Секретград', living: true })
  people.createPerson(owner, { givenName: '</script><img src=x onerror=alert(1)>', surname: 'Ломаная', deathDate: '1950' })
  people.linkPeople(owner, 'daughter', grandma.id, living.id)
  people.updatePerson(owner, living.id, { facts: [{ kind: 'Работа', date: '2001', place: 'Тайноград', note: 'тайная заметка' }] })
  people.updatePerson(owner, grandma.id, { sources: [{ title: 'Метрическая книга', ref: 'ф. 1', page: 'л. 2', url: 'javascript:alert(2)' }] })

  pages.createPage(owner, { personId: living.id, title: 'Дневник живой', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'личный дневник', styles: {} }] }] })
  pages.createPage(owner, { personId: grandma.id, title: 'Биография', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Рассказ о жизни, дочь ', styles: {} }, { type: 'mention', props: { personId: living.id, label: 'Живущая Секретная' } }] },
    { type: 'image', props: { url: '/api/v1/media/abc/file', caption: 'внутренняя картинка' } },
  ] })

  // One photo of the grandmother alone, one with the living relative on it.
  const alone = await media.uploadMedia(owner, await photo('#a0522d'), 'alone.jpg', grandma.id)
  const together = await media.uploadMedia(owner, await photo('#2e8b57'), 'together.jpg', grandma.id)
  media.addTag(owner, together.id, { personId: living.id }, null)
  people.setAvatar(owner, grandma.id, alone.id, null)
  people.setAvatar(owner, living.id, together.id, null)
  ;({ html, stats } = await build(owner))
}, 30000)

describe('the file for relatives', () => {
  it('shows who has died, with their card, relatives and biography', () => {
    expect(html).toContain('Агафья')
    expect(html).toContain('Тверь')
    expect(html).toContain('Рассказ о жизни')
    expect(html).toContain('Метрическая книга')
    expect(stats.people).toBe(2)
    expect(stats.hidden).toBe(1)
  })

  it('carries nothing of the living', () => {
    for (const secret of ['Живущая', 'Секретная', 'Девичьятайна', 'Секретград', '1975', 'Тайноград', 'тайная заметка', 'Дневник живой', 'личный дневник']) expect(html, secret).not.toContain(secret)
  })

  it('keeps out a photo with a living relative on it, even as their avatar', () => {
    expect(stats.photos).toBe(1)
    expect((html.match(/data:image\/[a-z]+;base64/g) ?? []).length).toBe(2)
  })

  it('cannot be broken by what is in a name', () => {
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;/script&gt;')
    expect(html.match(/<script>/g)?.length).toBe(1)
    expect(html).not.toContain('javascript:alert')
  })

  it('reaches for nothing: no server, no other site, by the browser\'s own rule too', () => {
    expect(html).toContain("default-src 'none'")
    expect(html).not.toMatch(/\bfetch\(|XMLHttpRequest|<link\b|<iframe|\/api\//)
    expect(html.replace(/https:\/\/github\.com\/danarkhipov\/Folkbranch/g, '')).not.toMatch(/\b(src|href)="https?:/)
  })

  it('is the owner\'s to make', async () => {
    await expect(build(editor)).rejects.toThrow()
  })
})
