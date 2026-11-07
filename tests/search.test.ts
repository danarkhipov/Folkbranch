// Fifty things people type. Each says who must come first, and in which field the match must be shown.
import { defaultFilter } from 'cmdk'
import { beforeAll, describe, expect, it } from 'vitest'
import { getGraph } from '../lib/ops/people'
import { searchPeople } from '../lib/ops/people-search'
import { searchArchive } from '../lib/ops/search'
import { personName, type Person } from '../lib/types'
import { reader } from './fixture-family'
import { loadSearchFamily, searchOwner } from './search-family'

type Family = Awaited<ReturnType<typeof loadSearchFamily>>
type Who = keyof Family
/** Query; who must be first, or among the first when several are right; the field that must be shown. */
const CASES: [string, Who | Who[], string?][] = [
  // Names as written, in other cases and word orders
  ['Воронцов Фёдор', 'fyodor', 'surname'],
  ['Фёдор Матвеевич', 'fyodor', 'patronymic'],
  ['федор', 'fyodor', 'givenName'],
  ['Гольдман Исаак', 'isaak', 'surname'],
  ['Воронцовой Зинаиды', 'zinaida', 'surname'],
  ['Фёдора Воронцова', 'fyodor', 'surname'],
  ['Шапиро Рахиль', 'rahil', 'surname'],
  ['Лукьянец', ['maria', 'bogdan', 'oksana'], 'surname'],
  ['зин', 'zinaida', 'givenName'],
  ['Ивановна', 'anna', 'patronymic'],
  // Maiden and other names
  ['Шереметева', 'evdokia', 'maidenName'],
  ['Кузьмина Агафья', 'agafya', 'maidenName'],
  ['Коган', 'rahil', 'maidenName'],
  ['Иван Кузнецов', 'john', 'otherNames'],
  ['Дуня', 'evdokia', 'otherNames'],
  // Nicknames
  ['Маша Лукьянец', 'maria', 'givenName'],
  ['Коля Воронцов', 'nikolai', 'otherNames'],
  ['Саша', 'aleksandra', 'givenName'],
  ['Паша', 'pavel', 'givenName'],
  ['Соня Гольдман', 'sofia', 'givenName'],
  // Typos and similar sounds
  ['Варонцов', ['matvey', 'agafya', 'fyodor', 'evdokia', 'pavel', 'zinaida', 'nikolai'], 'surname'],
  ['Шапира', ['grigory', 'rahil'], 'surname'],
  ['Гольдмон', ['isaak', 'zinaida', 'sofia'], 'maidenName'],
  ['Агафя', 'agafya', 'givenName'],
  ['Лукянец', ['maria', 'bogdan', 'oksana'], 'surname'],
  ['Зиниада', 'zinaida', 'givenName'],
  // Latin letters and the wrong keyboard
  ['Vorontsov', ['matvey', 'fyodor', 'pavel', 'nikolai'], 'surname'],
  ['Shapiro', ['grigory', 'rahil'], 'surname'],
  ['bdfyjdf', 'annaYoung', 'surname'],
  ['Zinaida', 'zinaida', 'givenName'],
  // Dates, however they are written
  ['1921', 'pavel', 'birthDate'],
  ['09.05.1890', 'fyodor', 'birthDate'],
  ['9 мая 1890', 'fyodor', 'birthDate'],
  ['1890-05-09', 'fyodor', 'birthDate'],
  ['май 1890', 'fyodor', 'birthDate'],
  ['21 августа 1943', 'fyodor', 'deathDate'],
  ['родился в 1921', 'pavel', 'birthDate'],
  ['умер в 1999', 'pavel', 'deathDate'],
  ['умерла 1983', 'maria', 'deathDate'],
  ['1880-1885', ['grigory', 'rahil'], 'birthDate'],
  ['1860-е', ['matvey', 'agafya'], 'birthDate'],
  ['Воронцов 1893', 'nikolai', 'birthDate'],
  // Places
  ['Полтава', ['maria', 'bogdan'], 'birthPlace'],
  ['родился в Витебске', ['grigory', 'rahil', 'sofia'], 'birthPlace'],
  ['умер в Ленинграде', ['pavel', 'zinaida'], 'deathPlace'],
  ['Мурманск', ['tatiana', 'vasily']],
  // Facts, in other words
  ['врач', ['zinaida', 'isaak'], 'fact'],
  ['доктор Ленинград', 'zinaida', 'fact'],
  ['токарь', 'fyodor', 'fact'],
  ['учительница', 'bogdan', 'fact'],
  ['портная', 'evdokia', 'fact'],
  ['арест', 'grigory', 'fact'],
  ['инженер Кировский завод', 'pavel', 'fact'],
  ['Врангель', 'nikolai', 'fact'],
  // Sources and groups
  ['ЦАМО', 'fyodor', 'source'],
  ['опись 18001', 'fyodor', 'source'],
  ['Открытый список', 'grigory', 'source'],
  ['Фронт', 'fyodor', 'tags'],
  ['Рязанская ветка', 'annaYoung', 'tags'],
  // Long texts
  ['пасека', 'agafya', 'page'],
  ['медаль за оборону', 'pavel', 'page'],
  ['церковный хор', 'evdokia', 'story'],
  ['Комарово', 'zinaida', 'photo'],
  ['другой год в метрике', 'sergey', 'claim'],
  // Who is whose
  ['жена Фёдора', 'evdokia', 'relation'],
  ['дочь Павла', 'aleksandra', 'relation'],
  ['сын Матвея', ['fyodor', 'nikolai'], 'relation'],
  ['отец Оксаны', 'bogdan', 'relation'],
  ['мать Зинаиды', 'sofia', 'relation'],
  ['брат Марии Лукьянец', 'pavel', 'relation'],
]

let family: Family
beforeAll(async () => { family = await loadSearchFamily() })
const nameOf = (id: string) => Object.entries(family).find(([, p]) => p.id === id)?.[0]
const wanted = (who: Who | Who[]) => (Array.isArray(who) ? who : [who])

/** Whether the right person came first with the right thing shown. */
function passes(query: string, who: Who | Who[], field?: string) {
  const top = searchPeople(searchOwner, query)
  const ok = wanted(who)
  const first = top.slice(0, ok.length)
  if (!first.length || !first.every((r) => ok.includes(nameOf(r.personId) as Who))) return `${query}: got ${top.slice(0, 3).map((r) => nameOf(r.personId))}`
  if (field && !first.some((r) => r.matches.some((m) => m.key === field))) return `${query}: shown ${first[0].matches.map((m) => m.key)}`
  return null
}

describe('the search', () => {
  it('has at least fifty kinds of query to answer', () => expect(CASES.length).toBeGreaterThanOrEqual(50))

  it('puts the right person first and shows why', () => {
    expect(CASES.map(([q, who, field]) => passes(q, who, field)).filter(Boolean)).toEqual([])
  })

  it('marks exactly the found words', () => {
    const r = searchPeople(searchOwner, '09.05.1890')[0]
    const m = r.matches.find((x) => x.key === 'birthDate')!
    expect(m.text.slice(...m.ranges[0])).toBe('09.05.1890')
    expect(r.terms).toContain('09.05.1890')
    const place = searchPeople(searchOwner, 'родился в Витебске')[0].matches.find((x) => x.key === 'birthPlace')!
    expect(place.text.slice(...place.ranges[0])).toBe('Витебск')
  })

  it('answers who is whose without everyone of that name', () => {
    expect(searchPeople(searchOwner, 'жена Фёдора Воронцова').map((r) => nameOf(r.personId))).toEqual(['evdokia'])
    expect(searchPeople(searchOwner, 'жена Фёдора Воронцова')[0].terms).toContain('Фёдор Воронцов')
  })

  it('takes a word built on the name of a place', () => {
    expect(searchPeople(searchOwner, 'Ленинградский').map((r) => nameOf(r.personId))).toContain('pavel')
  })

  it('does not look inside web addresses', () => {
    expect(searchPeople(searchOwner, 'zzqwerty')).toEqual([])
    expect(searchPeople(searchOwner, 'S21LOG')).toEqual([])
    expect(searchPeople(searchOwner, 'пасека')[0].matches.map((m) => m.text).join()).not.toContain('irbis')
  })

  it('does not guess when something certain was found', () => {
    const found = searchPeople(searchOwner, 'Анна').map((r) => nameOf(r.personId))
    expect(found).toContain('anna')
    expect(found).not.toContain('inna')
  })

  it('answers nothing to nonsense', () => {
    expect(searchPeople(searchOwner, 'щшщшщшщ')).toEqual([])
    expect(searchPeople(searchOwner, '   ')).toEqual([])
  })

  it('says when not everything was found', () => {
    const r = searchPeople(searchOwner, 'Воронцов Марсианин')
    expect(r.length).toBeGreaterThan(0)
    expect(r.every((x) => x.partial)).toBe(true)
  })

  it('keeps long texts short around what was found', () => {
    const m = searchPeople(searchOwner, 'станки')[0].matches[0]
    expect(m.text.slice(...m.ranges[0])).toBe('станки')
    expect(m.text.length).toBeLessThanOrEqual(150)
  })

  it('shows a reader nothing about living relatives', () => {
    const living = getGraph(reader).persons.filter((p) => p.hidden).map((p) => p.id)
    const hidden = getGraph(searchOwner).persons.find((p) => living.includes(p.id) && p.surname)
    expect(hidden).toBeTruthy()
    expect(searchPeople(reader, hidden!.surname).filter((r) => living.includes(r.personId))).toEqual([])
    expect(searchPeople(reader, 'Комарово').filter((r) => living.includes(r.personId))).toEqual([])
  })

  it('shows someone with a link to one branch only that branch', () => {
    const guest = { ...reader, guest: { only: new Set([family.grigory.id]) } } as never
    expect(searchPeople(guest, 'Шапиро').map((r) => nameOf(r.personId))).toEqual(['grigory'])
    expect(searchPeople(guest, 'Комарово')).toEqual([])
  })

  it('answers quickly', () => {
    const started = performance.now()
    for (const [q] of CASES) searchPeople(searchOwner, q)
    expect((performance.now() - started) / CASES.length).toBeLessThan(50)
  })

  it.runIf(process.env.SEARCH_REPORT)('compared with the two earlier searches', () => {
    const people = getGraph(searchOwner).persons
    const value = (p: Person) => `${personName(p)} ${p.maidenName} ${p.birthYear ?? ''} ${p.tags.join(' ')} ${p.id}`
    const dialog = (q: string) => people.map((p) => [p.id, defaultFilter(value(p), q)] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([id]) => id)
    const archive = (q: string) => searchArchive(searchOwner, q, 20).results.map((r) => r.personId).filter(Boolean) as string[]
    const right = (ids: string[], who: Who | Who[]) => { const ok = wanted(who); const first = ids.slice(0, ok.length); return first.length > 0 && first.every((id) => ok.includes(nameOf(id) as Who)) }
    const count = (fn: (q: string) => string[]) => CASES.filter(([q, who]) => right(fn(q), who)).length
    console.log(`of ${CASES.length}: dialog before ${count(dialog)}, agents' search ${count(archive)}, now ${CASES.filter(([q, who]) => !passes(q, who)).length}`)
  })
})
