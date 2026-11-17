// People and access: what readers, guests, invited relatives and API tokens may see and do,
// and what stays behind when a person's access is taken away.
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { getDb, schema } from '../lib/db'
import type { Actor } from '../lib/ops/core'
import * as people from '../lib/ops/people'
import * as settings from '../lib/ops/settings'
import { createShare, guestFromCookie, listShares, openShare, shareInfo } from '../lib/ops/share'
import * as tokens from '../lib/ops/tokens'
import * as views from '../lib/ops/views'

const owner: Actor = { userId: 'ca-owner', name: 'Хозяйка', role: 'owner', personId: null }
const editor: Actor = { userId: 'ca-editor', name: 'Редактор', role: 'editor', personId: null }
const reader: Actor = { userId: 'ca-reader', name: 'Читатель', role: 'reader', personId: null }

const make = (givenName: string, input: Record<string, unknown> = {}) =>
  (people.createPerson(owner, { givenName, surname: 'Доступа', ...input } as never) as unknown as { id: string }).id

let secret: string

beforeAll(() => {
  // A deliberately hidden dead relative.
  secret = make('Скрытый', { birthDate: '1920', deathDate: '1953', keepPrivate: true })
})

describe('what a reader is not told about a hidden person', () => {
  it('a private card hides the year of death as well as the date', () => {
    // maskPerson clears birthYear and every date, but not deathYear: a card the owner marked private
    // still tells a reader (and anyone with a viewing link) the exact year this person died, which
    // along with the hidden card can name them. Fix: maskPerson must also set deathYear: null.
    const card = people.getGraph(reader).persons.find((p) => p.id === secret)!
    expect(card.hidden).toBe(true)
    expect(card.givenName).toBe('')
    expect(card.birthYear).toBeNull()
    expect(card.deathYear).toBeNull()
  })
})

describe('taking a person’s access away', () => {
  function addUser(id: string, role: 'owner' | 'editor' | 'reader') {
    getDb().insert(schema.user).values({ id, name: id, email: `${id}@corner.test`, role, createdAt: new Date(), updatedAt: new Date() }).run()
  }

  it('closes the account’s own sessions and linked sign-ins', () => {
    addUser('ca-gone', 'editor')
    addUser('ca-stays', 'owner')
    getDb().insert(schema.account).values({ id: 'ca-acc', userId: 'ca-gone', accountId: 'g-1', providerId: 'google', createdAt: new Date(), updatedAt: new Date() }).run()
    getDb().insert(schema.session).values({ id: 'ca-sess', token: 'ca-token', userId: 'ca-gone', createdAt: new Date(), updatedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) }).run()

    settings.removeUser({ ...owner, userId: 'ca-stays' }, 'ca-gone')

    expect(getDb().select().from(schema.user).where(eq(schema.user.id, 'ca-gone')).get()).toBeUndefined()
    expect(getDb().select().from(schema.session).where(eq(schema.session.userId, 'ca-gone')).all()).toHaveLength(0)
    expect(getDb().select().from(schema.account).where(eq(schema.account.userId, 'ca-gone')).all()).toHaveLength(0)
  })

  it('also cuts off the API tokens they issued', () => {
    // "Закрыть доступ" promises the person can no longer act on the archive. The owner account goes,
    // but tokens it made stay valid with their old role forever, so a removed owner (or an agent
    // it handed a token to) keeps reading or editing. Fix: revoke apiTokens where createdBy = id
    // inside removeUser, and likewise end invites for that user.
    addUser('ca-tokener', 'owner')
    addUser('ca-admin', 'owner')
    const { token } = tokens.createToken({ ...owner, userId: 'ca-tokener' }, { name: 'робот', role: 'editor', review: true })
    expect(tokens.actorFromToken(token)).toBeTruthy()

    settings.removeUser({ ...owner, userId: 'ca-admin' }, 'ca-tokener')

    expect(tokens.actorFromToken(token)).toBeNull()
  })

  it('nobody removes or demotes themselves by accident', () => {
    addUser('ca-self', 'owner')
    const self = { ...owner, userId: 'ca-self' }
    expect(() => settings.removeUser(self, 'ca-self')).toThrow()
    expect(() => settings.setUserRole(self, 'ca-self', 'reader')).toThrow()
  })

  it('only an owner may list people or change a role', () => {
    addUser('ca-target', 'reader')
    expect(() => settings.listUsers(editor)).toThrow('forbidden')
    expect(() => settings.setUserRole(editor, 'ca-target', 'editor')).toThrow('forbidden')
    settings.setUserRole(owner, 'ca-target', 'editor')
    expect(settings.listUsers(owner).find((u) => u.id === 'ca-target')?.role).toBe('editor')
  })
})

describe('invitations', () => {
  it('are listed while open and gone once revoked', () => {
    const { token } = settings.createInvite(owner, { name: 'Тётя', role: 'reader' })
    const open = settings.listInvites(owner).find((i) => i.name === 'Тётя')!
    expect(open).toBeTruthy()
    expect(JSON.stringify(open)).not.toContain(token)
    settings.revokeInvite(owner, open.id)
    expect(settings.listInvites(owner).some((i) => i.name === 'Тётя')).toBe(false)
  })
})

describe('viewing links', () => {
  it('refuse a view that is not there', () => {
    expect(() => createShare(owner, { name: 'Ошибка', viewId: 'ca-missing' })).toThrow('not found')
  })

  it('count the visits they let in', () => {
    const { token } = createShare(owner, { name: 'Счётчик' })
    openShare(token, undefined)
    openShare(token, undefined)
    expect(listShares(owner).find((l) => l.name === 'Счётчик')?.opens).toBe(2)
  })

  it('stop working for cookies handed out before a password change', () => {
    const { token } = createShare(owner, { name: 'Смена пароля', expiresInDays: null })
    const { cookie } = openShare(token, undefined)
    expect(guestFromCookie(cookie)).toBeTruthy()
    const row = getDb().select().from(schema.shareLinks).where(eq(schema.shareLinks.tokenHash, createHash('sha256').update(token).digest('hex'))).get()!
    getDb().update(schema.shareLinks).set({ passwordHash: 'aa:bb' }).where(eq(schema.shareLinks.id, row.id)).run()
    expect(guestFromCookie(cookie)).toBeNull()
    expect(shareInfo(token)).toEqual({ needsPassword: true })
  })
})

describe('a link to a view', () => {
  it('cannot be made for a scope with no person to centre it on', () => {
    // peopleOf treats "scope but no focus" as no scope at all, so a view saved as "descendants"
    // with no focusId becomes a link to the whole archive. The owner (or an API client) thinks they
    // shared one branch. Fix: createView should refuse a non-'all' scope without a focusId.
    expect(() => views.createView(owner, { name: 'Ветка без центра', scope: 'descendants', focusId: null, collapsed: [] })).toThrow()
  })
})

describe('owners and roles', () => {
  const user = (id: string, role: 'owner' | 'editor' | 'reader') => getDb().insert(schema.user).values({ id, name: id, email: `${id}@corner.test`, role, createdAt: new Date(), updatedAt: new Date() }).run()

  it('the last owner cannot be removed or made an editor, so someone can always run the archive', () => {
    getDb().update(schema.user).set({ role: 'editor' }).where(eq(schema.user.role, 'owner')).run()
    user('co-a', 'owner'); user('co-b', 'owner')
    const a: Actor = { userId: 'co-a', name: 'A', role: 'owner', personId: null }
    const b: Actor = { userId: 'co-b', name: 'B', role: 'owner', personId: null }
    // Two owners at once: the first removal goes through, the second would leave nobody.
    settings.removeUser(a, 'co-b')
    user('co-b', 'owner')
    getDb().delete(schema.user).where(eq(schema.user.id, 'co-a')).run()
    expect(() => settings.removeUser(b, 'co-a')).not.toThrow()
    expect(() => settings.setUserRole({ ...a, userId: 'someone-else' }, 'co-b', 'editor')).toThrow(/владел|owner/i)
    expect(() => settings.removeUser({ ...a, userId: 'someone-else' }, 'co-b')).toThrow(/владел|owner/i)
  })

  it("a person made a reader loses their agents' right to write", () => {
    user('co-writer', 'editor')
    const { id } = tokens.createToken({ userId: 'co-writer', name: 'W', role: 'owner', personId: null }, { name: 'робот', role: 'editor', review: false })
    const { id: readId } = tokens.createToken({ userId: 'co-writer', name: 'W', role: 'owner', personId: null }, { name: 'читатель', role: 'reader', review: true })
    settings.setUserRole(owner, 'co-writer', 'reader')
    const row = (t: string) => getDb().select().from(schema.apiTokens).where(eq(schema.apiTokens.id, t)).get()!
    expect(row(id).revokedAt).not.toBeNull()
    expect(row(readId).revokedAt).toBeNull()
  })
})
