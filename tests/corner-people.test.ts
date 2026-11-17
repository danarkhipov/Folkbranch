import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { getDb, schema } from '../lib/db'
import type { Actor } from '../lib/ops/core'
import * as core from '../lib/ops/core'
import * as contacts from '../lib/ops/contacts'
import * as people from '../lib/ops/people'
import { mergePeople, previewMerge } from '../lib/ops/merge-people'
import { dispatch } from '../lib/ops/proposals'
import { createInvite, listHistory } from '../lib/ops/settings'
import { createRequest } from '../lib/ops/story-requests'
import { createStory } from '../lib/ops/stories'

const owner: Actor = { userId: 'o', name: 'Ольга', role: 'owner', personId: null }
const reader: Actor = { userId: 'r', name: 'Роман', role: 'reader', personId: null }
const bot: Actor = { userId: 'bot', name: 'Bot', role: 'editor', personId: null, tokenId: 'tok', review: false }

const db = () => getDb()
const make = (p: Record<string, unknown>) => people.createPerson(owner, { living: false, ...p } as never) as unknown as { id: string }
const row = (id: string) => people.getPersonRow(id)
const merge = (keepId: string, dropId: string) =>
  mergePeople(owner, { keepId, dropId, choose: {}, seen: { keep: row(keepId).updatedAt, drop: row(dropId).updatedAt } })

describe('merging two cards', () => {
  // BUG: mergePeople moves relations, pages, photos and stories but not the `contacts` row. The phone,
  // address and email of the removed card are lost, and the row stays pointing at a person who no longer exists.
  it('keeps the contact details of the card that is removed', () => {
    const keep = make({ givenName: 'Контакт', surname: 'Сохрани' }).id
    const drop = make({ givenName: 'Контакт', surname: 'Потеряй' }).id
    contacts.saveContacts(owner, drop, { phone: '+7 900 000-00-00', email: 'aunt@example.org', address: 'Тула', note: 'тётя' })
    merge(keep, drop)
    expect(contacts.getContacts(owner, keep)).toMatchObject({ phone: '+7 900 000-00-00', email: 'aunt@example.org' })
    expect(db().select().from(schema.contacts).where(eq(schema.contacts.personId, drop)).all()).toEqual([])
  })

  // BUG: the merged row is built only from MERGE_FIELDS, so card-level flags of the removed card are dropped.
  // A dead person marked keepPrivate, or one known to have had no children and never married, becomes visible
  // and loses those facts. A private card must not become public through a merge.
  it('keeps the private and "known absent" flags of the removed card', () => {
    const keep = make({ givenName: 'Флаги', surname: 'Открытый', deathDate: '1900' }).id
    const drop = make({ givenName: 'Флаги', surname: 'Скрытый', deathDate: '1900', keepPrivate: true, noChildren: true, neverMarried: true }).id
    merge(keep, drop)
    const k = row(keep)
    expect([k.keepPrivate, k.noChildren, k.neverMarried]).toEqual([true, true, true])
    expect(people.getGraph(reader).persons.find((p) => p.id === keep)!.hidden).toBe(true)
  })

  // BUG: whyNot() checks that a card would not become its own ancestor or its own spouse's ancestor, but not
  // that it would become a sibling's spouse. Direct links refuse that pairing; a merge slips around the guard.
  it('refuses a merge that would marry a person to their own sibling', () => {
    const parent = make({ givenName: 'Родитель', surname: 'Родня' }).id
    const keep = make({ givenName: 'Муж', surname: 'Родня' }).id
    const drop = make({ givenName: 'Брат', surname: 'Родня' }).id
    const sibling = make({ givenName: 'Сестра', surname: 'Родня' }).id
    people.linkPeople(owner, 'son', parent, drop)
    people.linkPeople(owner, 'son', parent, sibling)
    people.linkPeople(owner, 'spouse', keep, sibling)
    const unions = () => db().select().from(schema.unions).all()
    const before = unions().length
    people.linkPeople(owner, 'spouse', parent, sibling)
    expect(unions()).toHaveLength(before)
    expect(previewMerge(owner, keep, drop).blocked).toBeTruthy()
  })

  // BUG: storyRequests.personId is left pointing at the removed card. The link still exists but its page
  // answers nothing, and listRequests() hides the broken request from the owner, so it cannot be closed.
  it('repoints an outstanding story-request link to the card that stays', () => {
    const keep = make({ givenName: 'Просьба', surname: 'Живая', birthDate: '1950' }).id
    const drop = make({ givenName: 'Просьба', surname: 'Ушла', birthDate: '1950' }).id
    const { token } = createRequest(owner, { personId: drop, tellerName: 'Тётя merge', question: 'Расскажите', expiresInDays: 30 })
    merge(keep, drop)
    const requests = db().select().from(schema.storyRequests).all()
    expect(requests.map((r) => r.personId)).toEqual([keep])
    expect(token.length).toBeGreaterThan(0)
  })

  it('moves an account and a waiting draft to the card that stays', () => {
    const keep = make({ givenName: 'Переезд', surname: 'Аккаунта' }).id
    const drop = make({ givenName: 'Переезд', surname: 'Аккаунта' }).id
    db().insert(schema.user).values({ id: 'u-merge', name: 'Родня', email: 'u-merge@example.org', createdAt: new Date(), updatedAt: new Date(), personId: drop }).run()
    db().insert(schema.proposals).values({ id: 'p-merge', authorId: 'tok', authorName: 'Bot', status: 'pending', createdAt: Date.now(), ops: JSON.stringify([{ op: 'update_person', args: { id: drop, patch: {} } }]) }).run()
    merge(keep, drop)
    expect(db().select().from(schema.user).where(eq(schema.user.id, 'u-merge')).get()!.personId).toBe(keep)
    const ops = db().select().from(schema.proposals).where(eq(schema.proposals.id, 'p-merge')).get()!.ops
    expect(ops).toContain(keep)
    expect(ops).not.toContain(drop)
  })
})

describe('deleting a card', () => {
  it('lets accounts and invites go with the card, and closes a story link about it', () => {
    const p = make({ givenName: 'Удалённый', surname: 'Родня', living: true }).id
    db().insert(schema.user).values({ id: 'u-delete', name: 'Родня', email: 'u-delete@example.org', createdAt: new Date(), updatedAt: new Date(), personId: p }).run()
    createInvite(owner, { name: 'Приглашённый', role: 'reader', personId: p })
    createRequest(owner, { personId: p, tellerName: 'Тётя delete', question: 'Расскажите', expiresInDays: 30 })
    people.deletePerson(owner, p)
    const user = db().select().from(schema.user).where(eq(schema.user.id, 'u-delete')).get()!
    const invite = db().select().from(schema.invites).where(eq(schema.invites.name, 'Приглашённый')).get()!
    const request = db().select().from(schema.storyRequests).all().find((r) => r.tellerName === 'Тётя delete')!
    expect({ user: user.personId, invite: invite.personId }).toEqual({ user: null, invite: null })
    expect(request.revokedAt).not.toBeNull()
  })

  it('brings a story back with the card it is about', () => {
    const p = make({ givenName: 'Рассказчик', surname: 'Удалённый' }).id
    const story = createStory(owner, { about: [p], title: 'История', body: 'текст', tellerName: '', toldOn: '' }) as { id: string }
    people.deletePerson(owner, p)
    expect(db().select().from(schema.stories).all().some((s) => s.id === story.id)).toBe(false)
    core.undo(owner, listHistory(owner)[0].id, 'undo')
    expect(db().select().from(schema.stories).all().some((s) => s.id === story.id)).toBe(true)
    expect(db().select().from(schema.storyPeople).all().some((l) => l.storyId === story.id && l.personId === p)).toBe(true)
  })
})

describe('versions of a value', () => {
  // BUG: choose_version accepts a version that was explicitly rejected. claims.accept() only looks at the id,
  // so a value the family called wrong becomes the main one again, with the rejection reason still on it.
  it('refuses to choose a version that was rejected', async () => {
    const p = make({ givenName: 'Версия', surname: 'Отклонённая', birthPlace: 'Тула' }).id
    await dispatch(owner, 'add_version', { personId: p, field: 'birthPlace', value: 'Рига' })
    const accepted = (JSON.parse(row(p).claims) as { id: string; status: string }[]).find((c) => c.status === 'accepted')!
    await dispatch(owner, 'reject_version', { personId: p, field: 'birthPlace', versionId: accepted.id, reason: 'ошибка' })
    await expect(dispatch(owner, 'choose_version', { personId: p, field: 'birthPlace', versionId: accepted.id })).rejects.toThrow()
    expect(row(p).birthPlace).not.toBe('Тула')
  })
})

describe('the assistant and a token', () => {
  // BUG: an agent's plain update_person on a versioned field rewrites the accepted version in place and
  // clears its source link, so the value a document says disappears and no version keeps it. add_version
  // would have kept both; update_person silently loses the sourced value.
  it('does not destroy a documented value through a plain update', async () => {
    const p = make({ givenName: 'Документ', surname: 'Агента' }).id
    await dispatch(owner, 'add_version', { personId: p, field: 'birthPlace', value: 'Тула', source: { title: 'Метрика', reliability: 'original' } })
    await dispatch(bot, 'update_person', { id: p, patch: { birthPlace: 'Тула-2' } })
    const claims = JSON.parse(row(p).claims) as { value: string; sourceId: string | null }[]
    expect(claims.some((c) => c.value === 'Тула' && c.sourceId)).toBe(true)
  })
})

describe('hostile input', () => {
  // BUG: createPerson does not check that relation.to exists. An editor's API call with a made-up id
  // writes a parent_child row whose other end is nothing, leaving a link the chart and kinship walk cannot resolve.
  it('refuses to create a person related to an id that does not exist', () => {
    expect(() => people.createPerson(owner, { givenName: 'Сирота', surname: 'Связи' }, { type: 'father', to: 'nosuchperson' })).toThrow()
    expect(db().select().from(schema.parentChild).all().filter((l) => l.childId === 'nosuchperson')).toEqual([])
  })

  // BUG: only the agent path calls assertDates. A person saving a card through the API or the editor can
  // store a death year before the birth year; sorting, "living" and the chart then read a lie.
  it('refuses a death date before the birth date from a person too', () => {
    const p = make({ givenName: 'Даты', surname: 'Наоборот', birthDate: '1990' }).id
    expect(() => people.updatePerson(owner, p, { deathDate: '1950' })).toThrow()
  })
})

describe('a card saved with a wrong date by an older version', () => {
  it('can still have its other fields changed, while a new wrong date is refused', async () => {
    const { owner } = await import('./fixture-family')
    const people = await import('../lib/ops/people')
    const { getDb, schema } = await import('../lib/db')
    const { eq } = await import('drizzle-orm')
    const id = (people.createPerson(owner, { givenName: 'Старая', surname: 'Ошибка', birthDate: '1900' }) as { id: string }).id
    // An older version let a death before the birth through; the row is written as it was then.
    getDb().update(schema.persons).set({ deathDate: '1850' }).where(eq(schema.persons.id, id)).run()
    expect(() => people.updatePerson(owner, id, { birthPlace: 'Тула' })).not.toThrow()
    expect(() => people.updatePerson(owner, id, { deathDate: '1840' })).toThrow(/before birth/)
  })
})
