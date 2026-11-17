// History and review corners: what an undo, a rollback, a merge or a queued draft can leave behind.
// A failing case here is a found bug: it is kept as `it.fails`, with the reason in a comment.
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { getDb, schema } from '../lib/db'
import type { Actor } from '../lib/ops/core'
import { rollbackTo, undo, undoPart } from '../lib/ops/core'
import { importGedcom } from '../lib/ops/gedcom'
import { mergePeople } from '../lib/ops/merge-people'
import * as pages from '../lib/ops/pages'
import * as people from '../lib/ops/people'
import * as proposals from '../lib/ops/proposals'
import { listHistory } from '../lib/ops/settings'
import * as tokens from '../lib/ops/tokens'

const owner: Actor = { userId: 'o', name: 'Owner', role: 'owner', personId: null }
const editor: Actor = { userId: 'e', name: 'Editor', role: 'editor', personId: null }

const lastId = () => listHistory(owner)[0].id
const exists = (id: string) => {
  try {
    people.getPersonRow(id)
    return true
  } catch {
    return false
  }
}
const row = (id: string) => people.getPersonRow(id)
const historyRow = (id: string) => getDb().select().from(schema.history).where(eq(schema.history.id, id)).get()!

function bot(review: boolean) {
  const { token } = tokens.createToken(owner, { name: `bot-${review}`, role: 'editor', review })
  return tokens.actorFromToken(token)!
}

/** Pages a person's card can actually show: a page is shown only if its parent chain starts at the top level. */
function reachable(personId: string) {
  const list = pages.listPages(owner, personId)
  const seen = new Set<string>()
  const walk = (parent: string | null) => {
    for (const p of list) {
      if ((p.parentPageId ?? null) !== parent || seen.has(p.id)) continue
      seen.add(p.id)
      walk(p.id)
    }
  }
  walk(null)
  return seen
}

describe('undo across later work', () => {
  it('BROKEN: undoing "new page" hides subpages added after it', () => {
    // pages.parentPageId is not in REFERENCES, so purgeOrphans never repairs it. The undo of a creation
    // removes only that row; the child stays, pointing at a page that no longer exists, and the page
    // tree renders from parentPageId === null, so the child can no longer be found in the UI at all.
    const p = people.createPerson(owner, { givenName: 'Страничный' })
    const root = pages.createPage(owner, { personId: p.id, title: 'Корень' })
    const rootEntry = lastId()
    const child = pages.createPage(owner, { personId: p.id, title: 'Ребёнок', parentPageId: root.id })
    undo(owner, rootEntry, 'undo')
    // Right behaviour: the child is either taken with the page or put back at the top level, never hidden.
    const after = pages.listPages(owner, p.id).find((x) => x.id === child.id)
    expect(after === undefined || after.parentPageId === null).toBe(true)
  })

  it('BROKEN: undo of an entry whose row is gone says nothing and marks it undone for good', () => {
    // revertChanges skips a row that no longer exists (`if (!now) continue`) without a word, then the
    // entry is marked undone anyway. The person sees "Отменено" while nothing came back, and the entry
    // can never be undone again, so the only route back (undo the deletion first) is closed silently.
    const p = people.createPerson(owner, { givenName: 'Пропавший' })
    people.updatePerson(owner, p.id, { birthPlace: 'Тула' })
    const entry = lastId()
    people.deletePerson(owner, p.id)
    expect(() => undo(owner, entry, 'undo')).toThrow(/changed later/)
    expect(historyRow(entry).undoneAt).toBeNull()
    expect(exists(p.id)).toBe(false)
  })
})

describe('merging two cards and taking it back', () => {
  it.fails('BROKEN: undo of a merge leaves an account pointing at the kept card', async () => {
    // moveOutsideHistory writes user/invite/view/proposal rows outside the history, and its comment says
    // they "stay valid after an undo". They stay moved: after undo the dropped card is back, but the
    // relative's account now names the other person, so their session shows someone else's card.
    const keep = people.createPerson(owner, { givenName: 'Оставшийся', surname: 'Слиянов' })
    const drop = people.createPerson(owner, { givenName: 'Ушедший', surname: 'Слиянов' })
    getDb().insert(schema.user).values({ id: 'u-dupe', name: 'Дубль', email: 'dupe@corner.test', role: 'reader', personId: drop.id, createdAt: new Date(), updatedAt: new Date() }).run()
    const { historyId } = mergePeople(owner, { keepId: keep.id, dropId: drop.id, choose: {}, seen: { keep: row(keep.id).updatedAt, drop: row(drop.id).updatedAt } })
    undo(owner, historyId!, 'undo')
    const account = getDb().select().from(schema.user).where(eq(schema.user.id, 'u-dupe')).get()!
    expect(account.personId).toBe(drop.id)
  })

  it.fails('BROKEN: undo of a merge leaves a waiting draft addressed to the kept card', async () => {
    // Same hole: pending proposals have their ops rewritten with a plain string replace of the old id.
    // After undo the old card exists again, but the draft a reader or token wrote about it now edits the
    // kept person instead, so accepting it puts the correction on the wrong card.
    const keep = people.createPerson(owner, { givenName: 'Оставшийся2', surname: 'Черновиков' })
    const drop = people.createPerson(owner, { givenName: 'Ушедший2', surname: 'Черновиков' })
    const b = bot(true)
    const queued = await proposals.dispatch(b, 'update_person', { id: drop.id, patch: { birthPlace: 'Омск' } })
    expect(queued.status).toBe('pending_review')
    const draftId = queued.proposalId!
    const { historyId } = mergePeople(owner, { keepId: keep.id, dropId: drop.id, choose: {}, seen: { keep: row(keep.id).updatedAt, drop: row(drop.id).updatedAt } })
    undo(owner, historyId!, 'undo')
    const draft = getDb().select().from(schema.proposals).where(eq(schema.proposals.id, draftId)).get()!
    const ops = JSON.parse(draft.ops) as { args: { id: string } }[]
    expect(ops[0].args.id).toBe(drop.id)
  })
})

describe('a page and the people it belongs to', () => {
  it('a page cannot be moved under another person\'s page, where it would disappear', async () => {
    // listPages(person) returns only that person's pages, and the tree starts at parentPageId === null.
    // move_page accepts any existing page as the new parent, so one call hides the page and its subpages
    // from the archive: nothing lists it, and the only way back is to know its id.
    const a = people.createPerson(owner, { givenName: 'Хозяин' })
    const b = people.createPerson(owner, { givenName: 'Сосед' })
    const parent = pages.createPage(owner, { personId: a.id, title: 'Чужая' })
    const mine = pages.createPage(owner, { personId: b.id, title: 'Моя' })
    await expect(proposals.dispatch(owner, 'move_page', { id: mine.id, parentPageId: parent.id })).rejects.toMatchObject({ status: 400 })
    const seen = reachable(b.id)
    expect(seen.has(mine.id)).toBe(true)
  })
})

describe('a draft that waited while the archive moved', () => {
  it('BROKEN: an accepted delete_page destroys subpages made after the draft', async () => {
    // The reviewer saw "Удалить: «Старое»" and nothing else: the draft records no version of the page it
    // would delete, so accepting it later also deletes pages written in the meantime. Unlike update_person
    // (which refuses a value changed since), delete_person/delete_page have no `seen` check at all.
    const b = bot(true)
    const p = people.createPerson(owner, { givenName: 'Удаляемый', deathDate: '1950' })
    const page = pages.createPage(owner, { personId: p.id, title: 'Старое' })
    const queued = await proposals.dispatch(b, 'delete_page', { id: page.id })
    expect(queued.status).toBe('pending_review')
    const later = pages.createPage(owner, { personId: p.id, title: 'Написано позже', parentPageId: page.id })
    proposals.acceptProposal(owner, queued.proposalId!)
    // Right behaviour: refuse the accept, or keep what was written after the draft was made.
    const left = pages.listPages(owner, p.id).find((x) => x.id === later.id)
    expect(left).toBeDefined()
  })
})

describe('a draft about someone who is gone', () => {
  it('BROKEN: accepting a queued upload tags a deleted person, leaving a dangling mark', async () => {
    // refs are checked when the draft is queued, not when it is applied, and commitUpload inserts the
    // tag without looking the person up. A photo accepted after the card was deleted keeps a mediaTags
    // row that points at nobody: the mark shows on the photo with no name, until some unrelated undo
    // happens to run purgeOrphans.
    const b = bot(true)
    const p = people.createPerson(owner, { givenName: 'Сфотографированный', deathDate: '1950' })
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#888' } }).png().toBuffer()
    const queued = await proposals.dispatch(b, 'upload_photo', { base64: png.toString('base64'), filename: 'x.png', personId: p.id })
    expect(queued.status).toBe('pending_review')
    people.deletePerson(owner, p.id)
    expect(() => proposals.acceptProposal(owner, queued.proposalId!)).toThrow(/not found/)
    const known = new Set(people.getGraph(owner).persons.map((x) => x.id))
    const dangling = getDb().select().from(schema.mediaTags).all().filter((t) => t.personId && !known.has(t.personId))
    expect(dangling).toEqual([])
  })

  it('BROKEN: a photo can be tagged with a person id that nobody has', async () => {
    // addTag looks up the photo but never the person: `refs` is only checked when a token's call is
    // queued, so a typo or a stale id in a human's call makes a mark that names nobody. It shows on the
    // photo with no name and is only cleared when some later undo happens to run purgeOrphans.
    getDb().insert(schema.media).values({ id: 'm-bad-tag', filename: 'm-bad-tag.jpg', mime: 'image/jpeg' }).run()
    await expect(proposals.dispatch(owner, 'tag_photo', { mediaId: 'm-bad-tag', personId: 'no-such-person', box: { x: 0, y: 0, w: 0.2, h: 0.2 } })).rejects.toThrow(/not found/)
    const tag = getDb().select().from(schema.mediaTags).where(eq(schema.mediaTags.mediaId, 'm-bad-tag')).get()
    expect(tag).toBeUndefined()
  })
})

describe('rollback and partial undo', () => {  it('rollback counts only the entries with an effect left, skipping undone ones', () => {
    const a = people.createPerson(owner, { givenName: 'Точка' })
    const point = lastId()
    const b = people.createPerson(owner, { givenName: 'Отменённый' })
    undo(owner, lastId(), 'undo')
    expect(exists(b.id)).toBe(false)
    const { count } = rollbackTo(owner, point, 'rollback')
    // Only the creation of `a` was still in force; its undo line and the already-undone entry are skipped.
    expect(count).toBe(1)
    expect(exists(a.id)).toBe(false)
    expect(exists(b.id)).toBe(false)
  })

  it('a token cannot roll the whole archive back, even though the operation is reachable', async () => {
    people.createPerson(owner, { givenName: 'Чужое' })
    const b = bot(false)
    await expect(proposals.dispatch(b, 'rollback_to', { historyId: lastId() })).rejects.toThrow(/owner/)
  })

  it('a partial undo refuses the person somebody changed after, and still takes back the other', () => {
    const ged = '0 HEAD\n0 @I1@ INDI\n1 NAME Первый /Частичный/\n0 @I2@ INDI\n1 NAME Второй /Частичный/\n0 TRLR\n'
    importGedcom(owner, ged, 'add')
    const entry = listHistory(owner)[0]
    expect(entry.personIds).toHaveLength(2)
    const [first, second] = entry.personIds
    people.updatePerson(editor, first, { birthPlace: 'Омск' })
    expect(() => undoPart(owner, entry.id, first, 'part')).toThrow(/changed later/)
    const res = undoPart(owner, entry.id, second, 'part')
    expect(res.undone).toBe(false)
    expect(exists(second)).toBe(false)
    expect(exists(first)).toBe(true)
  })
})

describe('history ids and what a reader may read there', () => {
  it('an id nobody made is refused, and nothing changes', () => {
    const count = () => getDb().select().from(schema.persons).all().length
    people.createPerson(owner, { givenName: 'Счёт' })
    const before = count()
    expect(() => undo(owner, 'no-such-entry', 'undo')).toThrow(/not found/)
    expect(() => rollbackTo(owner, 'no-such-entry', 'rollback')).toThrow(/not found/)
    expect(() => undoPart(owner, 'no-such-entry', 'someone', 'part')).toThrow(/not found/)
    expect(count()).toBe(before)
  })

  it('a reader sees no entry about a living relative, and no value from one', () => {
    const reader: Actor = { userId: 'r', name: 'Читатель', role: 'reader', personId: null }
    const dead = people.createPerson(owner, { givenName: 'Предок', surname: 'Видимый', deathDate: '1950' })
    const alive = people.createPerson(owner, { givenName: 'Живой', surname: 'Скрытный', birthDate: '1990' })
    people.linkPeople(owner, 'daughter', dead.id, alive.id)
    people.updatePerson(owner, alive.id, { birthPlace: 'Тайный Город' })
    const seen = listHistory(reader, 500)
    expect(JSON.stringify(seen)).not.toContain('Скрытный')
    expect(JSON.stringify(seen)).not.toContain('Тайный Город')
    // The link entry names both people, so a reader gets neither it nor the living one's own edit.
    expect(seen.some((e) => e.personIds.includes(alive.id))).toBe(false)
    // But an entry about someone the reader may see is still there.
    expect(seen.some((e) => e.personIds.includes(dead.id))).toBe(true)
  })
})

describe('replacing the whole tree and taking it back', () => {
  // Runs last on purpose: it empties the archive and puts it back.
  const ged = '0 HEAD\n0 @I9@ INDI\n1 NAME Новый /Файл/\n0 TRLR\n'

  it('an undo brings back every card and its pages', () => {
    const p = people.createPerson(owner, { givenName: 'До Замены', deathDate: '1950' })
    const page = pages.createPage(owner, { personId: p.id, title: 'Биография' })
    importGedcom(owner, ged, 'replace')
    expect(exists(p.id)).toBe(false)
    expect(people.getGraph(owner).persons.map((x) => x.givenName)).toEqual(['Новый'])
    undo(owner, lastId(), 'undo')
    expect(exists(p.id)).toBe(true)
    expect(pages.getPage(owner, page.id).title).toBe('Биография')
  })

  it('an undo of the replacement gives every account and invitation its card back', () => {
    // accountsLetGo() runs inside the import but writes outside the history, so the replace entry never
    // records it. Every reader's sign-in, invitation and saved view loses the person it pointed at, and
    // after undo the cards are back while the family must be re-linked to them by hand.
    const p = people.createPerson(owner, { givenName: 'Чья-то Карточка', deathDate: '1950' })
    getDb().insert(schema.user).values({ id: 'u-replace', name: 'Родня', email: 'replace@corner.test', role: 'reader', personId: p.id, createdAt: new Date(), updatedAt: new Date() }).run()
    importGedcom(owner, ged, 'replace')
    undo(owner, lastId(), 'undo')
    expect(exists(p.id)).toBe(true)
    expect(getDb().select().from(schema.user).where(eq(schema.user.id, 'u-replace')).get()!.personId).toBe(p.id)
  })
})
