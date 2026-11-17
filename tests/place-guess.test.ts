// A place with no point gets candidates from the GeoNames extract shipped with the app: any spelling of its name finds
// it, two towns of one name are told apart by what the archive says around it, and an old name counts in its years.
import { describe, expect, it } from 'vitest'
import { bareName, editDistance, guessPlace, readGazetteer, skeleton, type GazFile } from '../lib/place-guess'

const file: GazFile = {
  snapshot: '2026-11-17',
  regions: {
    'RU.77': ['Tver Oblast', 'Тверская область'], 'RU.62': ['Ryazan Oblast', 'Рязанская область'],
    'BY.06': ['Mogilev', 'Могилёвская область', 'Mahilyowskaya Voblasts’'], 'UA.12': ['Dnipropetrovsk Oblast', 'Днепропетровская область'],
    'RU.47': ['Leningrad Oblast', 'Ленинградская область'], 'RU.66': ['Saint Petersburg', 'Санкт-Петербург'],
    'FR.11': ['Île-de-France'], 'US.TX': ['Texas'], 'PL.72': ['Lower Silesia', 'Dolnośląskie'],
  },
  countries: { RU: ['Russia', 'Россия'], BY: ['Belarus', 'Беларусь', 'Белоруссия'], UA: ['Ukraine', 'Украина'], FR: ['France', 'Франция'], US: ['United States', 'США', 'Соединённые Штаты'], PL: ['Poland', 'Польша'] },
  rows: [
    [480060, 'Tver', 'Тверь', 56.8584, 35.9006, 'RU', '77', 403726, [['Kalinin', 1931, 1990], ['Калинин', 1931, 1990], 'Twer']],
    [100001, 'Ivanovka', 'Ивановка', 57.1, 35.2, 'RU', '77', 600, []],
    [100002, 'Ivanovka', 'Ивановка', 54.3, 40.1, 'RU', '62', 900, []],
    [621741, 'Shklow', 'Шклов', 54.2136, 30.2864, 'BY', '06', 15900, ['Szkłów', 'Schklow', 'Shklov', 'Шклоў']],
    [709930, 'Dnipro', 'Днепр', 48.4593, 35.0386, 'UA', '12', 968502, [['Yekaterinoslav', null, 1926], ['Екатеринослав', null, 1926], ['Dnepropetrovsk', 1926, 2016], ['Днепропетровск', 1926, 2016]]],
    [498817, 'Saint Petersburg', 'Санкт-Петербург', 59.9386, 30.3141, 'RU', '66', 5351935, [['Petrograd', 1914, 1924], ['Петроград', 1914, 1924], ['Leningrad', 1924, 1991], ['Ленинград', 1924, 1991]]],
    [2988507, 'Paris', 'Париж', 48.8534, 2.3488, 'FR', '11', 2138551, []],
    [4717560, 'Paris', '', 33.6609, -95.5555, 'US', 'TX', 24782, []],
    [3081368, 'Wrocław', 'Вроцлав', 51.1, 17.0333, 'PL', '72', 672545, [['Breslau', null, 1945], 'Wroclaw']],
    [100003, 'Leningradskaya', 'Ленинградская', 46.32, 39.39, 'RU', '47', 36000, []],
  ],
}
const gz = readGazetteer(file)
const ids = (text: string, ctx = {}) => guessPlace(text, gz, ctx).map((c) => c.id)

describe('spelling', () => {
  it('levels the transliterations of one name', () => {
    const one = skeleton('Шклов')
    expect(['Shklov', 'Szkłów', 'Schklow', 'Shklow', 'Шклоў'].map(skeleton)).toEqual(Array(5).fill(one))
    expect(skeleton('Екатеринослав')).toBe(skeleton('Yekaterinoslav'))
    expect(skeleton('Жмеринка')).toBe(skeleton('Żmerynka'))
  })
  it('finds a town written in Latin letters, with ё for е, or after "г."', () => {
    expect(ids('Shklov')[0]).toBe(621741)
    expect(ids('г. Шклов')[0]).toBe(621741)
    expect(ids('Twer')[0]).toBe(480060)
    expect(bareName('дер. Ивановка, Тверская губ.')).toBe('Ивановка')
  })
  it('forgives one typo in a long name but not in a short one, and prefers a real name to a near one', () => {
    expect(ids('Екатеринослов')[0]).toBe(709930)
    expect(editDistance('tver', 'tvar', 1)).toBe(1)
    expect(ids('Твор')).toEqual([])
    expect(ids('Шклов', {}).length).toBe(1)
  })
  it('says nothing for a village the extract does not have', () => {
    expect(ids('Верхние Мочалы')).toEqual([])
  })
})

describe('two towns of one name', () => {
  it('are told apart by the region written after a comma, in any form', () => {
    expect(ids('Ивановка, Тверская губерния')[0]).toBe(100001)
    expect(ids('Ивановка, Рязанская губ.')[0]).toBe(100002)
    expect(ids('Ivanovka, Ryazan')[0]).toBe(100002)
  })
  it('are told apart by what the place belongs to in the archive', () => {
    expect(ids('Ивановка', { hints: ['Тверская губерния', 'Россия'] })[0]).toBe(100001)
  })
  it('are told apart by where the same people lived', () => {
    expect(ids('Ивановка', { near: [{ lat: 54.6, lon: 39.7 }] })[0]).toBe(100002)
    expect(ids('Ивановка', { near: [{ lat: 56.86, lon: 35.9 }] })[0]).toBe(100001)
  })
  it('are both marked when the region written fits neither, though the country fits', () => {
    const both = guessPlace('Ивановка', gz, { hints: ['Псковская губерния', 'Россия'] })
    expect(both.map((c) => c.why)).toEqual([expect.arrayContaining(['other-region']), expect.arrayContaining(['other-region'])])
  })
  it('prefer the country written when the region fits neither', () => {
    const kg: GazFile = { ...file, countries: { ...file.countries, KG: ['Kyrgyzstan', 'Киргизия'] }, rows: [...file.rows, [1527534, 'Ivanovka', 'Ивановка', 42.88, 75.08, 'KG', '02', 17513, []]] }
    expect(guessPlace('Ивановка', readGazetteer(kg), { hints: ['Псковская губерния', 'Россия'] })[0].cc).toBe('RU')
  })
  it('still offers both when nothing tells them apart', () => {
    expect(ids('Ивановка').sort()).toEqual([100001, 100002])
  })
})

describe('renamed towns', () => {
  it('find the town by an old name, and say which name matched', () => {
    const [c] = guessPlace('Екатеринослав', gz)
    expect(c).toMatchObject({ id: 709930, matched: 'Екатеринослав' })
    expect(ids('Калинин')[0]).toBe(480060)
  })
  it('rank a name used in the event\'s years above one that was not in use then', () => {
    const in1950 = guessPlace('Ленинград', gz, { years: [1950] })[0]
    expect(in1950.why).toContain('in-years')
    const in1900 = guessPlace('Ленинград', gz, { years: [1900] })[0]
    expect(in1900.why).toContain('out-of-years')
    expect(in1950.score).toBeGreaterThan(guessPlace('Ленинград', gz)[0].score)
    expect(in1900.score).toBeLessThan(guessPlace('Ленинград', gz)[0].score)
  })
  it('still offer the one town of a name when the region written does not fit it, marked so', () => {
    const [c] = guessPlace('Шклов', gz, { hints: ['Тверская губерния'] })
    expect(c).toMatchObject({ id: 621741, why: expect.arrayContaining(['other-region']) })
  })
})

describe('the places list offers them and sets one only when pressed', () => {
  const owner = { userId: 'o', name: 'Owner', role: 'owner', personId: null } as const
  const reader = { userId: 'r', name: 'Reader', role: 'reader', personId: null } as const
  let ops: typeof import('../lib/ops/place-guesses')
  let places: typeof import('../lib/ops/places')
  let iv = ''
  it('lists places without a point with their candidates, ranked by what the place belongs to', async () => {
    ;[ops, places] = await Promise.all([import('../lib/ops/place-guesses'), import('../lib/ops/places')])
    ops.useGazetteer(gz)
    const tver = (places.savePlace(owner, null, { name: 'Тверская губерния' }) as { id: string }).id
    iv = (places.savePlace(owner, null, { name: 'Ивановка', parentId: tver }) as { id: string }).id
    const { getDb } = await import('../lib/db')
    getDb().$client.prepare("insert into persons (id, given_name, surname, birth_place, birth_date) values ('sh1', 'Лея', 'Тестова', 'г. Шклов', '1890')").run()
    const { snapshot, guesses } = ops.placePointGuesses(owner)
    expect(snapshot).toBe('2026-11-17')
    expect(guesses.find((g) => g.placeId === iv)?.candidates[0].id).toBe(100001)
    expect(guesses.find((g) => g.text === 'г. Шклов')).toMatchObject({ placeId: null, people: 1, candidates: [expect.objectContaining({ id: 621741 })] })
    // A province holds villages; it is not one point a family lived at.
    expect(guesses.some((g) => g.placeId === tver)).toBe(false)
    // Nothing was set by listing.
    expect(places.getPlace(iv).lat).toBeNull()
  })
  it('is for editors only', () => {
    expect(() => ops.placePointGuesses(reader)).toThrow(/forbidden/)
    expect(() => ops.applyPointGuess(reader, { placeId: iv, geonameId: 100001 })).toThrow(/forbidden/)
  })
  it('sets the chosen point with where it came from, and makes a record for a place written with none', () => {
    ops.applyPointGuess(owner, { placeId: iv, geonameId: 100001 })
    const p = places.getPlace(iv)
    expect([p.lat, p.lon]).toEqual([57.1, 35.2])
    expect(p.note).toContain('geonames.org/100001')
    const made = ops.applyPointGuess(owner, { text: 'г. Шклов', geonameId: 621741 }) as { id: string }
    expect(places.getPlace(made.id)).toMatchObject({ name: 'г. Шклов', lat: 54.2136, lon: 30.2864 })
    expect(ops.placePointGuesses(owner).guesses.map((g) => g.text)).not.toContain('г. Шклов')
  })
  it('refuses a candidate that is not in the extract, and a place that already has a point', () => {
    expect(() => ops.applyPointGuess(owner, { placeId: iv, geonameId: 999 })).toThrow(/no such GeoNames place/)
    expect(() => ops.applyPointGuess(owner, { placeId: iv, geonameId: 100002 })).toThrow(/already has a point/)
  })
})

describe('anywhere in the world', () => {
  it('tells a town from its namesake abroad by the state or country written', () => {
    expect(guessPlace('Paris, Texas', gz)[0].cc).toBe('US')
    expect(guessPlace('Paris, США', gz)[0].cc).toBe('US')
    expect(guessPlace('Paris', gz)[0].cc).toBe('FR')
  })
  it('finds a town by its German name, and prefers it in the years that name was used', () => {
    const [c] = guessPlace('Breslau', gz, { years: [1900] })
    expect(c).toMatchObject({ id: 3081368, matched: 'Breslau', why: expect.arrayContaining(['in-years']) })
    expect(guessPlace('Breslau', gz, { years: [1960] })[0].why).toContain('out-of-years')
  })
})
