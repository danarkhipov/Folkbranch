// One person on paper: what the card holds, and nothing typed into it can break out of the page.
import { describe, expect, it } from 'vitest'
import { personSheet } from '../lib/person-sheet'
import type { Graph, Person } from '../lib/types'

const person = (id: string, extra: Partial<Person> = {}): Person => ({ id, givenName: id, surname: 'Лис', maidenName: '', patronymic: '', otherNames: '', sex: 'U', birthDate: '', birthYear: null, birthPlace: '', deathDate: '', deathYear: null, deathPlace: '', living: false, certainty: 'documented', avatarMediaId: null, avatarCrop: null, updatedAt: 0, tags: [], facts: [], sources: [], claims: [], ...extra })
const t = (k: string) => k
const me = person('Иван', { birthDate: '1890', birthYear: 1890, deathDate: '1960', deathYear: 1960, birthPlace: 'Тверь', facts: [{ kind: 'Служба', date: '1914', place: 'Рига', note: '<script>alert(1)</script>' }], sources: [{ title: 'Метрика', ref: 'ф. 1', page: 'л. 2', url: '' }] })
const graph: Graph = {
  persons: [me, person('Отец', { birthYear: 1860 }), person('Скрытая', { hidden: true, living: true })],
  parentChild: [{ id: '1', parentId: 'Отец', childId: 'Иван', kind: 'birth', certainty: 'documented' }, { id: '2', parentId: 'Иван', childId: 'Скрытая', kind: 'birth', certainty: 'documented' }],
  unions: [],
}

describe('a person on paper', () => {
  const html = personSheet({ person: me, graph, t, lang: 'ru', avatar: null,
    pages: [{ title: 'Жизнь', content: [{ type: 'heading', content: [{ type: 'text', text: 'Детство' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Рос в <b>Твери</b>' }] }, { type: 'image', props: { url: 'https://evil.example/x.png' } }] }],
    stories: [{ id: 's', title: 'Как жили', body: 'Тихо', tellerId: null, tellerName: '', toldOn: '', about: ['Иван'], hasAudio: false, durationSec: null, createdBy: '', createdAt: 0, updatedAt: 0 }] })
  it('holds the life, the family, the facts, the pages, the stories and the sources', () => {
    for (const s of ['1890', 'Рождение', 'Служба', 'Отец', 'Детство', 'Как жили', 'Метрика', 'Тверь']) expect(html).toContain(s)
  })
  it('escapes what people typed, and reaches for no outside picture', () => {
    expect(html).not.toContain('<script>alert')
    expect(html).toContain('&lt;b&gt;Твери')
    expect(html).not.toContain('evil.example')
  })
  it('leaves out a relative hidden from this reader', () => {
    expect(html).not.toContain('Скрытая')
  })
})
