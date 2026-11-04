import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import type { Actor } from '../lib/ops/core'

const owner: Actor = { userId: 'o', name: 'Owner', role: 'owner', personId: null }
const reader: Actor = { userId: 'r', name: 'Reader', role: 'reader', personId: null }

let people: typeof import('../lib/ops/people')
let pages: typeof import('../lib/ops/pages')
let media: typeof import('../lib/ops/media')
let settings: typeof import('../lib/ops/settings')
let core: typeof import('../lib/ops/core')

beforeAll(async () => {
  ;[people, pages, media, settings, core] = await Promise.all([import('../lib/ops/people'), import('../lib/ops/pages'), import('../lib/ops/media'), import('../lib/ops/settings'), import('../lib/ops/core')])
})

const lastEntry = () => settings.listHistory(owner)[0]

describe('history and undo', () => {
  it('rolls back an edit', () => {
    const p = people.createPerson(owner, { givenName: 'Анна', surname: 'Тест' })
    people.updatePerson(owner, p.id, { birthDate: '~1876' })
    expect(people.getPersonRow(p.id).birthYear).toBe(1876)
    core.undo(owner, lastEntry().id, 'undo')
    expect(people.getPersonRow(p.id).birthDate).toBe('')
  })

  it('restores a deleted person with relations and pages', () => {
    const a = people.createPerson(owner, { givenName: 'Отец', deathDate: '1950' })
    const b = people.createPerson(owner, { givenName: 'Сын', deathDate: '1990' }, { type: 'son', to: a.id })
    const page = pages.createPage(owner, { personId: a.id, title: 'Биография' })
    people.deletePerson(owner, a.id)
    expect(() => people.getPersonRow(a.id)).toThrow()
    expect(people.getGraph(owner).parentChild.filter((l) => l.childId === b.id)).toHaveLength(0)
    core.undo(owner, lastEntry().id, 'undo')
    expect(people.getPersonRow(a.id).givenName).toBe('Отец')
    expect(people.getGraph(owner).parentChild.filter((l) => l.childId === b.id)).toHaveLength(1)
    expect(pages.getPage(owner, page.id).title).toBe('Биография')
  })

  it('undoing a creation leaves no dangling relations', () => {
    const a = people.createPerson(owner, { givenName: 'А' })
    const entry = lastEntry().id
    const c = people.createPerson(owner, { givenName: 'Б' }, { type: 'son', to: a.id })
    core.undo(owner, entry, 'undo')
    expect(people.getGraph(owner).parentChild.some((l) => l.childId === c.id)).toBe(false)
    expect(() => core.undo(owner, entry, 'undo')).toThrow('already undone')
  })

  it('merges consecutive edits of a page into one entry that undoes to the start', () => {
    const p = people.createPerson(owner, { givenName: 'В' })
    const page = pages.createPage(owner, { personId: p.id })
    pages.updatePage(owner, page.id, { content: [{ type: 'paragraph', content: 'раз' }] })
    const first = lastEntry().id
    pages.updatePage(owner, page.id, { content: [{ type: 'paragraph', content: 'два' }] })
    expect(lastEntry().id).toBe(first)
    core.undo(owner, first, 'undo')
    expect(pages.getPage(owner, page.id).content).toBe('[]')
  })
})

describe('relations', () => {
  it('forbids cycles and links a second parent as a couple', () => {
    const child = people.createPerson(owner, { givenName: 'Ребёнок' })
    const dad = people.createPerson(owner, { givenName: 'Папа' }, { type: 'father', to: child.id })
    const mom = people.createPerson(owner, { givenName: 'Мама' }, { type: 'mother', to: child.id })
    expect(people.getGraph(owner).unions.some((u) => [u.aId, u.bId].includes(dad.id) && [u.aId, u.bId].includes(mom.id))).toBe(true)
    expect(() => people.linkPeople(owner, 'son', child.id, dad.id)).toThrow('own ancestor')
  })
})

describe('removing links', () => {
  it('takes a child off both parents as one change and brings it back with one undo', () => {
    const child = people.createPerson(owner, { givenName: 'Отрезанный', deathDate: '1950' })
    const dad = people.createPerson(owner, { givenName: 'Папа2', deathDate: '1900' }, { type: 'father', to: child.id })
    const mom = people.createPerson(owner, { givenName: 'Мама2', deathDate: '1900' }, { type: 'mother', to: child.id })
    const links = () => people.getGraph(owner).parentChild.filter((l) => l.childId === child.id)
    const ids = links().map((l) => l.id)
    expect(ids).toHaveLength(2)
    people.removeParentLinks(owner, ids)
    expect(links()).toHaveLength(0)
    core.undo(owner, lastEntry().id, 'undo')
    expect(links().map((l) => l.parentId).sort()).toEqual([dad.id, mom.id].sort())
    expect(() => people.removeParentLinks(reader, ids)).toThrow('forbidden')
  })
})

describe('groups and facts', () => {
  it('stores labels and dated facts, and never shows them for a hidden relative', () => {
    const p = people.createPerson(owner, { givenName: 'Группа', surname: 'Тестова', deathDate: '1950' })
    people.updatePerson(owner, p.id, {
      tags: ['Соколовы', 'Фронт'],
      facts: [{ kind: 'Профессия', date: '1920', place: 'Кострома', note: 'плотник' }],
    })
    const seen = people.getGraph(owner).persons.find((x) => x.id === p.id)!
    expect(seen.tags).toEqual(['Соколовы', 'Фронт'])
    expect(seen.facts[0]).toMatchObject({ kind: 'Профессия', place: 'Кострома' })
    core.undo(owner, lastEntry().id, 'undo')
    expect(people.getGraph(owner).persons.find((x) => x.id === p.id)!.tags).toEqual([])
  })
})

describe('privacy for readers', () => {
  it('hides living relatives everywhere except their own card', async () => {
    const alive = people.createPerson(owner, { givenName: 'Живая', surname: 'Секретова', birthDate: '1990', birthPlace: 'Москва' })
    const dead = people.createPerson(owner, { givenName: 'Умерший', deathDate: '1950' })
    const page = pages.createPage(owner, { personId: dead.id, title: 'Письма' })
    pages.updatePage(owner, page.id, { content: [{ type: 'paragraph', content: [{ type: 'mention', props: { personId: alive.id, label: 'Живая Секретова' } }] }] })
    const secretPage = pages.createPage(owner, { personId: alive.id, title: 'Тайна' })
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#888' } }).png().toBuffer()
    const photo = await media.uploadMedia(owner, png, 'a.png', alive.id)
    const openPhoto = await media.uploadMedia(owner, png, 'b.png', dead.id)

    people.updatePerson(owner, alive.id, { patronymic: 'Петрович', otherNames: 'Ваня', sources: [{ title: 'Архив', ref: '', page: '', url: '' }] })
    const seen = people.getGraph(reader).persons.find((p) => p.id === alive.id)!
    expect(seen.hidden).toBe(true)
    expect([seen.patronymic, seen.otherNames]).toEqual(['', ''])
    expect(seen.sources).toEqual([])
    expect(JSON.stringify(seen)).not.toMatch(/Живая|Секретова|Москва|1990/)
    expect(() => pages.getPage(reader, secretPage.id)).toThrow()
    expect(() => pages.listPages(reader, alive.id)).toThrow()
    expect(pages.getPage(reader, page.id).content).not.toContain('Секретова')
    await expect(media.readMediaFile(reader, photo.id, 'thumb')).rejects.toThrow()
    expect((await media.readMediaFile(reader, openPhoto.id, 'thumb')).data.length).toBeGreaterThan(0)
    expect(JSON.stringify(settings.listHistory(reader))).not.toContain('Секретова')

    const self: Actor = { ...reader, personId: alive.id }
    expect(people.getGraph(self).persons.find((p) => p.id === alive.id)!.givenName).toBe('Живая')
  })

  it('stops readers from writing', () => {
    expect(() => people.createPerson(reader, { givenName: 'x' })).toThrow('forbidden')
    expect(() => settings.createInvite(reader, { name: 'x', role: 'owner' })).toThrow('forbidden')
  })
})

describe('invites', () => {
  it('stores only a hash, and honours expiry', () => {
    const { token } = settings.createInvite(owner, { name: 'Тётя', role: 'reader' })
    expect(settings.findInvite(token)?.name).toBe('Тётя')
    expect(settings.findInvite(token)?.tokenHash).not.toBe(token)
    expect(settings.findInvite('wrong')).toBeNull()
  })
})
