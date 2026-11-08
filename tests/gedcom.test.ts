import { describe, expect, it } from 'vitest'
import { fromGedDate, parseGedcom, toGedDate, writeGedcom } from '../lib/gedcom'
import type { Graph } from '../lib/types'

const SAMPLE = `0 HEAD
1 GEDC
2 VERS 7.0
0 @N1@ SNOTE Общая заметка
0 @S1@ SOUR
1 TITL Метрическая книга
0 @I1@ INDI
1 NAME Пётр /Иванов/
1 SEX M
1 BIRT
2 DATE ABT 1880
2 PLAC Кострома
1 DEAT
2 DATE 3 FEB 1950
1 SNOTE @N1@
1 SOUR @S1@
1 FAMS @F1@
0 @I2@ INDI
1 NAME Анна /Иванова/
1 NAME Анна /Смирнова/
2 TYPE maiden
1 SEX F
1 FAMS @F1@
0 @I3@ INDI
1 NAME Мария /Иванова/
1 SEX F
1 FAMC @F1@
2 PEDI adopted
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
1 MARR
2 DATE 1905
0 TRLR
`

describe('gedcom', () => {
  it('reads 7.0: names, dates, notes, sources, adoption', () => {
    const g = parseGedcom(SAMPLE)
    expect(g.version).toBe('7.0')
    expect(g.persons).toHaveLength(3)
    const [p, a] = g.persons
    expect(p).toMatchObject({ givenName: 'Пётр', surname: 'Иванов', sex: 'M', birthDate: '~1880', birthPlace: 'Кострома', deathDate: '03.02.1950', dead: true })
    expect(p.notes).toEqual(['Общая заметка'])
    expect(p.sources.map((x) => x.title)).toEqual(['Метрическая книга'])
    expect(a.maidenName).toBe('Смирнова')
    expect(g.families[0].children[0].adopted).toBe(true)
  })

  it('converts dates both ways', () => {
    expect(fromGedDate('12 MAR 1890')).toBe('12.03.1890')
    expect(toGedDate('12.03.1890')).toBe('12 MAR 1890')
    expect(toGedDate('~1876')).toBe('ABT 1876')
    expect(fromGedDate('BET 1880 AND 1890')).toBe('1880–1890')
    expect(fromGedDate('BET 3 FEB 1880 AND ABT 1890')).toBe('03.02.1880–~1890')
    expect(toGedDate('1880–1890')).toBe('BET 1880 AND 1890')
    expect(fromGedDate('BEF 1900')).toBe('<1900')
    expect(toGedDate('>1900')).toBe('AFT 1900')
    expect(toGedDate('1883 или 1886')).toBe('(1883 или 1886)')
  })

  it('takes certainty from QUAY and does not call a couple civil for lack of MARR', () => {
    const g = parseGedcom(`0 HEAD
0 @I1@ INDI
1 NAME А /Б/
1 BIRT
2 SOUR @S1@
3 QUAY 1
1 DEAT
2 SOUR @S1@
3 QUAY 3
1 EVEN x
2 SOUR @S1@
3 QUAY 0
0 @I2@ INDI
1 NAME В /Г/
1 EVEN y
2 SOUR @S1@
3 QUAY 3
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
0 TRLR
`)
    expect(g.persons[0].quality).toBe(3)
    expect(g.persons[1].quality).toBeNull()
    expect(g.families[0].kind).toBe('marriage')
  })

  const graph = {
    persons: [
      { facts: [], sources: [], id: 'a', givenName: 'Пётр', surname: 'Иванов', maidenName: '', sex: 'M', birthDate: '1880', birthPlace: '', deathDate: '1950', deathPlace: '', living: false },
      { facts: [], sources: [], id: 'b', givenName: 'Анна', surname: 'Жива', maidenName: '', sex: 'F', birthDate: '1990', birthPlace: 'Москва', deathDate: '', deathPlace: '', living: true },
    ],
    parentChild: [{ id: '1', parentId: 'a', childId: 'b', kind: 'birth', certainty: 'family' }],
    unions: [],
  } as unknown as Graph

  it('round-trips the structure and hides the living on request', () => {
    const open = parseGedcom(writeGedcom(graph, { hideLiving: false, source: 't' }))
    expect(open.persons.map((p) => p.givenName)).toEqual(['Пётр', 'Анна'])
    expect(open.families[0].children).toHaveLength(1)
    const hidden = writeGedcom(graph, { hideLiving: true, source: 't' })
    expect(hidden).not.toContain('Анна')
    expect(hidden).not.toContain('Москва')
    expect(hidden).toContain('Пётр')
  })
})

describe('person fields in GEDCOM', () => {
  const person = { id: 'a', givenName: 'Иван', patronymic: 'Петрович', surname: 'Белов', maidenName: '', otherNames: 'Ваня', sex: 'M', sources: [{ title: 'ГАПК', ref: 'ф. 1, оп. 2, д. 3', page: '12', url: 'https://example.org/a' }], birthDate: '~1890', birthYear: 1890, birthPlace: '', deathDate: '', deathYear: null, deathPlace: '', living: false, certainty: 'family', avatarMediaId: null, avatarCrop: null, updatedAt: 0, tags: [],
    facts: [{ kind: 'Профессия', date: '1912', place: 'Пермь', note: 'Столяр', source: 'Метрика' }, { kind: 'Служба', date: '', place: '', note: 'Флот', source: '' }] }
  const out = writeGedcom({ persons: [person, { ...person, id: 'b', givenName: 'Анна', patronymic: '', otherNames: '', facts: [], sources: [] }], parentChild: [], unions: [{ id: 'u', aId: 'a', bId: 'b', kind: 'marriage', startDate: '1915', endDate: '', place: 'Пермь', certainty: 'family' }] } as unknown as Graph, { hideLiving: false, source: 't' })

  it('writes facts, the patronymic, other names and the marriage place', () => {
    expect(out).toContain('1 OCCU Столяр\n2 DATE 1912\n2 PLAC Пермь\n2 SOUR Метрика')
    expect(out).toContain('1 EVEN Флот\n2 TYPE Служба')
    expect(out).toContain('2 GIVN Иван Петрович')
    expect(out).toContain('2 NICK Ваня')
    expect(out).toContain('1 MARR\n2 DATE 1915\n2 PLAC Пермь')
    expect(out).toContain('2 DATE ABT 1890')
  })
  it('reads them back into the same fields', () => {
    const g = parseGedcom(out)
    const p = g.persons[0]
    expect([p.givenName, p.patronymic, p.otherNames, p.birthDate]).toEqual(['Иван', 'Петрович', 'Ваня', '~1890'])
    expect(p.facts).toEqual(person.facts)
    expect(p.sources).toEqual(person.sources)
    expect(g.families[0].place).toBe('Пермь')
  })
  it('hides the facts and names of the living', () => {
    const hidden = writeGedcom({ persons: [{ ...person, living: true }], parentChild: [], unions: [] } as unknown as Graph, { hideLiving: true, source: 't' })
    for (const secret of ['Столяр', 'Петрович', 'Ваня', 'Метрика', 'ГАПК']) expect(hidden).not.toContain(secret)
  })
  it('keeps an ended union, with or without a date', () => {
    const two = (endDate: string) => writeGedcom({ persons: [person, { ...person, id: 'b', facts: [], sources: [] }], parentChild: [], unions: [{ id: 'u', aId: 'a', bId: 'b', kind: 'marriage', startDate: '', endDate, place: '', certainty: 'family' }] } as unknown as Graph, { hideLiving: false, source: 't' })
    expect(parseGedcom(two('?')).families[0].end).toBe('?')
    expect(parseGedcom(two('1960')).families[0].end).toBe('1960')
    expect(parseGedcom(two('')).families[0].end).toBe('')
  })
  it('keeps approximate full dates, and before and after', () => {
    expect(toGedDate('~12.03.1890')).toBe('ABT 12 MAR 1890')
    expect(toGedDate('<1890')).toBe('BEF 1890')
    expect(toGedDate('>1890')).toBe('AFT 1890')
  })
})

describe('what will not come across', () => {
  it('names what the importer does not read, and not what it does', async () => {
    const { unreadTags } = await import('../lib/gedcom')
    const text = '0 HEAD\n0 @I1@ INDI\n1 NAME Анна /Лес/\n1 BIRT\n2 DATE 1900\n1 OBJE @M1@\n1 OBJE @M2@\n1 _WEIRD x\n1 CHAN\n0 @F1@ FAM\n1 HUSB @I1@\n0 TRLR'
    expect(unreadTags(text)).toEqual([{ tag: 'OBJE', count: 2 }, { tag: '_WEIRD', count: 1 }])
  })

  it('reads an event, a source and a page that run over several lines, with the spaces at the joins', () => {
    const text = `0 HEAD
0 @I1@ INDI
1 NAME Клавдия /Волынкина/
1 EVEN Первая строка, потом
2 CONT вторая строка и
2 CONC  склеенная часть для
2 CONC  Клавдии
2 TYPE Рассказ
2 DATE 1930
2 SOUR Метрическая книга
3 CONT церкви села Ивановки
3 PAGE ф. 12, оп. 3,
4 CONT д. 45, л. 7
1 SOUR Ревизская сказка
2 PAGE строка один
3 CONT строка два
0 TRLR`
    const [p] = parseGedcom(text).persons
    expect(p.facts[0].note).toBe('Первая строка, потом\nвторая строка и склеенная часть для Клавдии')
    expect(p.facts[0].source).toBe('Метрическая книга\nцеркви села Ивановки')
    expect(p.sources.map((s) => s.title)).toContain('Ревизская сказка')
    expect(p.sources.find((s) => s.title === 'Ревизская сказка')).toMatchObject({ ref: 'строка один\nстрока два' })
  })

  it('writes a long text over lines again, so a round trip keeps all of it', () => {
    const g = parseGedcom('0 HEAD\n0 @I1@ INDI\n1 NAME А /Б/\n1 EVEN раз\n2 CONT два\n2 TYPE Рассказ\n2 SOUR Книга\n3 CONT вторая\n0 TRLR')
    const person = { id: 'a', givenName: 'А', surname: 'Б', patronymic: '', maidenName: '', otherNames: '', sex: 'U', living: true, birthDate: '', birthPlace: '', deathDate: '', deathPlace: '', tags: [], facts: g.persons[0].facts, sources: [], claims: [] }
    const out = writeGedcom({ persons: [person], parentChild: [], unions: [] } as never, { hideLiving: false, source: 'T' })
    const [back] = parseGedcom(out).persons
    expect(back.facts[0]).toMatchObject({ note: 'раз\nдва', source: 'Книга\nвторая' })
  })

  it('reads the files a person is linked to, inline or through a record of their own', () => {
    const g = parseGedcom(`0 HEAD
0 @O1@ OBJE
1 FILE scans\\wedding.jpg
2 TITL Свадьба
0 @I1@ INDI
1 NAME Иван /Петров/
1 OBJE
2 FILE portrait.jpg
3 FORM jpg
2 TITL Портрет
1 OBJE @O1@
0 @I2@ INDI
1 NAME Анна /Петрова/
1 OBJE @O1@
0 TRLR`)
    expect(g.persons[0].media).toEqual([{ file: 'portrait.jpg', title: 'Портрет' }, { file: 'scans\\wedding.jpg', title: 'Свадьба' }])
    expect(g.persons[1].media).toEqual([{ file: 'scans\\wedding.jpg', title: 'Свадьба' }])
  })
})
