import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { getDb, schema } from '../lib/db'
import type { Actor } from '../lib/ops/core'
import * as core from '../lib/ops/core'
import { dismissDuplicate, duplicateCandidates, mergePeople, previewMerge } from '../lib/ops/merge-people'
import * as people from '../lib/ops/people'
import * as pages from '../lib/ops/pages'
import * as views from '../lib/ops/views'
import { createStory } from '../lib/ops/stories'
import { getGraph } from '../lib/ops/people'

const owner: Actor = { userId: 'o', name: 'Хозяйка', role: 'owner', personId: null }
const make = (p: Record<string, unknown>) => (people.createPerson(owner, { living: false, ...p } as never) as unknown as { id: string }).id
const db = () => getDb()
const row = (id: string) => people.getPersonRow(id)
const merge = (keepId: string, dropId: string, choose = {}) => mergePeople(owner, { keepId, dropId, choose, seen: { keep: row(keepId).updatedAt, drop: row(dropId).updatedAt } })

/** Everything the history answers for, in an order that does not depend on how it got there. */
function snapshot() {
  const out: Record<string, unknown> = {}
  for (const [name, t] of Object.entries(core.TRACKED)) {
    out[name] = (db().select().from(t as typeof schema.persons).all() as Record<string, unknown>[]).map(({ updatedAt: _, ...r }) => JSON.stringify(Object.entries(r).sort())).sort()
  }
  return JSON.stringify(out)
}

describe('merging two cards', () => {
  it('moves everything, keeps the value not picked as a version, and leaves nothing pointing at the old card', async () => {
    const keep = make({ givenName: 'Иван', surname: 'Орлов', birthDate: '1890', birthPlace: 'Тула', tags: ['А'], facts: [{ kind: 'Служба', date: '1912', place: '', note: '' }], sources: [{ id: 's1', title: 'Книга', ref: '', page: '', url: '' }] })
    const drop = make({ givenName: 'Ваня', surname: 'Орлов', birthDate: '1891', deathDate: '1950', deathPlace: 'Орёл', tags: ['Б'], otherNames: 'Дед', facts: [{ kind: 'Служба', date: '1912', place: '', note: '' }, { kind: 'Переезд', date: '1930', place: '', note: '' }], sources: [{ id: 's1', title: 'Книга', ref: '', page: '', url: '' }, { id: 's2', title: 'Письмо', ref: '', page: '', url: '' }] })
    const father = make({ givenName: 'Отец', surname: 'Орлов' })
    const child = make({ givenName: 'Сын', surname: 'Орлов' })
    const wife = make({ givenName: 'Жена' })
    people.linkPeople(owner, 'father', drop, father)
    people.linkPeople(owner, 'son', drop, child)
    people.linkPeople(owner, 'spouse', drop, wife)
    const page = pages.createPage(owner, { personId: drop, title: 'О нём', content: [{ type: 'paragraph', content: [{ type: 'mention', props: { personId: drop, label: 'Ваня' } }] }] })
    const other = pages.createPage(owner, { personId: wife, title: 'О ней', content: [{ type: 'paragraph', content: [{ type: 'mention', props: { personId: drop, label: 'Ваня' } }] }] })
    createStory(owner, { about: [drop], title: 'Рассказ', body: 'Текст', tellerName: '', toldOn: '' })
    const v = views.createView(owner, { name: 'Ветка', scope: 'near', focusId: drop, collapsed: [drop], pins: { [drop]: 40 } })

    merge(keep, drop, { birthDate: 'drop' })

    expect(() => row(drop)).toThrow()
    const k = row(keep)
    expect(k.birthDate).toBe('1891')
    expect(k.birthYear).toBe(1891)
    expect(k.givenName).toBe('Иван')
    expect(k.deathDate).toBe('1950')
    expect(k.living).toBe(false)
    expect(k.otherNames).toBe('Дед')
    expect(JSON.parse(k.tags)).toEqual(['А', 'Б'])
    expect(JSON.parse(k.facts)).toHaveLength(2)
    expect(JSON.parse(k.sources).map((s: { id: string }) => s.id)).toEqual(['s1', 's2'])
    const claims = JSON.parse(k.claims) as { field: string; value: string; status: string }[]
    expect(claims.find((c) => c.field === 'birthDate' && c.value === '1890')?.status).toBe('possible')
    expect(claims.find((c) => c.field === 'birthDate' && c.value === '1891')?.status).toBe('accepted')
    expect(claims.find((c) => c.field === 'givenName' && c.value === 'Ваня')?.status).toBe('possible')
    const g = getGraph(owner)
    expect(JSON.stringify([g.parentChild, g.unions])).not.toContain(drop)
    expect(g.parentChild.filter((l) => l.childId === keep).map((l) => l.parentId)).toEqual([father])
    expect(pages.getPage(owner, (page as { id: string }).id).personId).toBe(keep)
    expect(pages.getPage(owner, (other as { id: string }).id).content).toContain(keep)
    expect(pages.getPage(owner, (other as { id: string }).id).content).not.toContain(drop)
    expect(db().select().from(schema.storyPeople).where(eq(schema.storyPeople.personId, drop)).all()).toEqual([])
    const view = views.listViews(owner).find((x) => x.id === v.id)!
    expect([view.focusId, view.collapsed, view.pins]).toEqual([keep, [keep], { [keep]: 40 }])
  })

  it('one marriage, not two, and what only the second knew stays', () => {
    const a = make({ givenName: 'А' }), b = make({ givenName: 'Б' }), w = make({ givenName: 'Ж' })
    people.linkPeople(owner, 'spouse', a, w)
    people.linkPeople(owner, 'spouse', w, b, null, { startDate: '1920', place: 'Тула' } as never)
    const u = db().select().from(schema.unions).all().find((x) => [x.aId, x.bId].includes(b))!
    db().update(schema.unions).set({ place: 'Тула', startDate: '1920' }).where(eq(schema.unions.id, u.id)).run()
    merge(a, b)
    const left = db().select().from(schema.unions).all().filter((x) => [x.aId, x.bId].includes(a))
    expect(left).toHaveLength(1)
    expect([left[0].place, left[0].startDate]).toEqual(['Тула', '1920'])
  })

  it('the same parent on both cards stays one link', () => {
    const a = make({ givenName: 'А' }), b = make({ givenName: 'Б' }), f = make({ givenName: 'Ф' })
    people.linkPeople(owner, 'father', a, f); people.linkPeople(owner, 'father', b, f)
    merge(a, b)
    expect(db().select().from(schema.parentChild).all().filter((l) => l.childId === a)).toHaveLength(1)
  })

  it('refuses what cannot be one person, and says why, before anything changes', () => {
    const father = make({ givenName: 'Отец' }), son = make({ givenName: 'Сын' }), grandson = make({ givenName: 'Внук' }), wife = make({ givenName: 'Жена' }), other = make({ givenName: 'Другой' }), niece = make({ givenName: 'Н' })
    people.linkPeople(owner, 'son', father, son); people.linkPeople(owner, 'son', son, grandson); people.linkPeople(owner, 'spouse', father, wife)
    people.linkPeople(owner, 'daughter', other, niece)
    const before = snapshot()
    expect(previewMerge(owner, father, grandson).blocked).toContain('предок')
    expect(previewMerge(owner, father, wife).blocked).toContain('супругами')
    expect(previewMerge(owner, father, father).blocked).toBeTruthy()
    expect(() => merge(father, grandson)).toThrow('предок')
    expect(snapshot()).toBe(before)
    // Married to someone who is the other card's child: a person would be married to their own child.
    const x = make({ givenName: 'Икс' }), y = make({ givenName: 'Игрек' }), kid = make({ givenName: 'Ребёнок' })
    people.linkPeople(owner, 'son', x, kid); people.linkPeople(owner, 'spouse', y, kid)
    expect(previewMerge(owner, x, y).blocked).toContain('Супругом')
  })

  it('is refused if a card changed after the comparison was shown', () => {
    const a = make({ givenName: 'А' }), b = make({ givenName: 'Б' })
    const seen = { keep: row(a).updatedAt, drop: row(b).updatedAt }
    db().update(schema.persons).set({ updatedAt: seen.drop + 5 }).where(eq(schema.persons.id, b)).run()
    expect(() => mergePeople(owner, { keepId: a, dropId: b, seen })).toThrow()
    expect(row(b)).toBeTruthy()
  })

  it('only a person, and an editor at that', () => {
    const a = make({ givenName: 'А' }), b = make({ givenName: 'Б' })
    const seen = { keep: row(a).updatedAt, drop: row(b).updatedAt }
    for (const who of [{ ...owner, role: 'reader' as const }, { ...owner, assistant: true }, { ...owner, tokenId: 't' }]) expect(() => mergePeople(who, { keepId: a, dropId: b, seen })).toThrow()
  })
})

describe('finding duplicates', () => {
  it('finds likely pairs, spares relatives, and forgets nothing it was told', () => {
    const a = make({ givenName: 'Мефодий', surname: 'Пастухов', birthDate: '1850', sex: 'M' })
    const b = make({ givenName: 'мефодий', surname: 'пастухов', birthDate: '1850', sex: 'M' })
    const son = make({ givenName: 'Мефодий', surname: 'Пастухов', birthDate: '1850', sex: 'M' })
    people.linkPeople(owner, 'son', a, son)
    const pairs = () => duplicateCandidates(owner).map((p) => [p.a, p.b].sort().join())
    expect(pairs()).toContain([a, b].sort().join())
    expect(pairs()).not.toContain([a, son].sort().join())
    const far = make({ givenName: 'Мефодий', surname: 'Пастухов', birthDate: '1920', sex: 'M' })
    const woman = make({ givenName: 'Мефодий', surname: 'Пастухов', birthDate: '1850', sex: 'F' })
    expect(pairs().filter((p) => p.includes(far) && p.includes(a))).toEqual([])
    expect(pairs().filter((p) => p.includes(woman) && p.includes(a))).toEqual([])
    dismissDuplicate(owner, a, b)
    expect(pairs()).not.toContain([a, b].sort().join())
  })
})

describe('random families', () => {
  it('500 pairs: merged, nothing lost; undone, byte for byte as before', () => {
    let seed = 7
    const rnd = (n: number) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n }
    const names = ['Иван', 'Анна', 'Пётр', 'Мария', 'Олег']
    const ids = Array.from({ length: 70 }, (_, i) => make({
      givenName: names[rnd(5)], surname: rnd(2) ? 'Рандомов' : '', patronymic: rnd(3) ? '' : 'Ильич', sex: ['M', 'F', 'U'][rnd(3)],
      birthDate: rnd(2) ? String(1850 + rnd(100)) : '', deathDate: rnd(2) ? String(1950 + rnd(50)) : '', birthPlace: rnd(3) ? '' : `Город${rnd(4)}`,
      tags: rnd(2) ? [`Г${rnd(3)}`] : [], facts: rnd(3) ? [] : [{ kind: 'Факт', date: String(rnd(3)), place: '', note: '' }], sources: rnd(3) ? [] : [{ id: `r${rnd(3)}`, title: 'Т', ref: '', page: '', url: '' }],
      claims: [], living: !rnd(4),
    }))
    for (let i = 0; i < 90; i++) {
      const a = ids[rnd(70)], b = ids[rnd(70)]
      if (a !== b) try { people.linkPeople(owner, ['father', 'mother', 'son', 'daughter', 'spouse'][rnd(5)] as never, a, b) } catch { /* a link that cannot be: skipped */ }
    }
    for (let i = 0; i < 30; i++) pages.createPage(owner, { personId: ids[rnd(70)], title: `С${i}`, content: [{ type: 'paragraph', content: [{ type: 'mention', props: { personId: ids[rnd(70)], label: 'x' } }] }] })
    for (let i = 0; i < 20; i++) createStory(owner, { about: [ids[rnd(70)], ids[rnd(70)]], tellerId: rnd(2) ? ids[rnd(70)] : null, title: `Р${i}`, body: 'т', tellerName: '', toldOn: '' })
    const tag = () => db().insert(schema.mediaTags).values({ id: core.newId(), mediaId: 'm' + rnd(5), personId: ids[rnd(70)], x: rnd(2) ? 0.1 : null, y: 0.1, w: 0.1, h: 0.1 }).run()
    for (let i = 0; i < 5; i++) db().insert(schema.media).values({ id: 'm' + i, filename: `m${i}.jpg`, mime: 'image/jpeg' }).run()
    for (let i = 0; i < 25; i++) tag()

    let merged = 0, refused = 0
    for (let i = 0; i < 500; i++) {
      const keep = ids[rnd(70)], drop = ids[rnd(70)]
      const plan = previewMerge(owner, keep, drop)
      if (plan.blocked) { refused++; continue }
      const before = snapshot()
      const k = row(keep), d = row(drop)
      const { historyId } = merge(keep, drop, Object.fromEntries(['birthDate', 'givenName', 'sex'].filter(() => rnd(2)).map((f) => [f, 'drop'])))
      merged++

      // Nothing left on the old card, and nothing thrown away.
      const after = getGraph(owner)
      expect(JSON.stringify([after.parentChild, after.unions])).not.toContain(drop)
      expect(after.parentChild.some((l) => l.parentId === l.childId)).toBe(false)
      expect(after.unions.some((u) => u.aId === u.bId)).toBe(false)
      const m = row(keep)
      for (const f of ['givenName', 'birthDate', 'birthPlace', 'deathDate', 'surname'] as const) {
        const all = [m[f], ...(JSON.parse(m.claims) as { field: string; value: string }[]).filter((c) => c.field === f).map((c) => c.value)]
        for (const v of [k[f], d[f]]) if (v) expect(all).toContain(v)
      }
      expect(JSON.parse(m.tags)).toEqual(expect.arrayContaining([...JSON.parse(k.tags), ...JSON.parse(d.tags)]))
      const kept = JSON.stringify(JSON.parse(m.facts))
      for (const f of [...JSON.parse(k.facts), ...JSON.parse(d.facts)]) expect(kept).toContain(JSON.stringify(f))

      core.undo(owner, historyId!, 'undo')
      expect(snapshot()).toBe(before)
    }
    console.log(`merged ${merged}, refused ${refused}`)
    expect(merged).toBeGreaterThan(250)
    expect(refused).toBeGreaterThan(5)
  }, 180000)
})
