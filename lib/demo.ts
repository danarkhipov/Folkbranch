// A fictional family, so the app can be tried without real data.
import sharp from 'sharp'
import { Actor, mutate, newId } from './ops/core'
import { addParent, addUnion, insertPerson } from './ops/people'
import { insertPage } from './ops/pages'
import { storeUpload } from './ops/media'
import { translate } from './i18n'
import type { Lang, Sex } from './types'

type Row = [key: string, given: string, surname: string, sex: Sex, birth: string, death: string, place: string, parents?: string[], maiden?: string]

const PEOPLE: Row[] = [
  ['nik', 'Николай', 'Соколов', 'M', '1890', '1962', 'Кострома'], ['var', 'Варвара', 'Соколова', 'F', '~1895', '1970', 'Кострома', [], 'Лебедева'],
  ['fed', 'Фёдор', 'Белов', 'M', '1888', '1941', 'Вологда'], ['olg', 'Ольга', 'Белова', 'F', '1892', '1965', 'Вологда'],
  ['iva', 'Иван', 'Соколов', 'M', '1918', '1985', 'Кострома', ['nik', 'var']], ['ann', 'Анна', 'Соколова', 'F', '1921', '1999', 'Вологда', ['fed', 'olg'], 'Белова'],
  ['pet', 'Пётр', 'Соколов', 'M', '1922', '1943', 'Кострома', ['nik', 'var']], ['mar', 'Мария', 'Орлова', 'F', '1925', '2004', 'Кострома', ['nik', 'var'], 'Соколова'],
  ['gri', 'Григорий', 'Орлов', 'M', '1920', '1990', 'Ярославль'], ['tam', 'Тамара', 'Белова', 'F', '1926', '2010', 'Вологда', ['fed', 'olg']],
  ['ser', 'Сергей', 'Соколов', 'M', '1946', '2019', 'Ярославль', ['iva', 'ann']], ['lud', 'Людмила', 'Соколова', 'F', '1948', '1980', 'Ярославль'],
  ['gal', 'Галина', 'Соколова', 'F', '1952', '', 'Рыбинск'], ['ele', 'Елена', 'Морозова', 'F', '1950', '', 'Ярославль', ['iva', 'ann'], 'Соколова'],
  ['vik', 'Виктор', 'Морозов', 'M', '1947', '2015', 'Тверь'], ['pav', 'Павел', 'Орлов', 'M', '1950', '', 'Ярославль', ['mar', 'gri']],
  ['nin', 'Нина', 'Орлова', 'F', '1953', '', 'Ярославль', ['mar', 'gri']],
  ['ale', 'Алексей', 'Соколов', 'M', '1972', '', 'Ярославль', ['ser', 'lud']], ['eka', 'Екатерина', 'Соколова', 'F', '1974', '', 'Москва'],
  ['dar', 'Дарья', 'Соколова', 'F', '1976', '', 'Ярославль', ['ser', 'lud']], ['mak', 'Максим', 'Соколов', 'M', '1985', '', 'Рыбинск', ['ser', 'gal']],
  ['iri', 'Ирина', 'Ким', 'F', '1975', '', 'Тверь', ['ele', 'vik'], 'Морозова'], ['dmi', 'Дмитрий', 'Ким', 'M', '1973', '', 'Москва'],
  ['kir', 'Кирилл', 'Орлов', 'M', '1980', '', 'Ярославль', ['pav']],
  ['ali', 'Алиса', 'Соколова', 'F', '2005', '', 'Москва', ['ale', 'eka']], ['son', 'Соня', 'Ким', 'F', '2003', '', 'Москва', ['iri', 'dmi']],
  ['tim', 'Тимур', 'Ким', 'M', '2006', '', 'Москва', ['iri', 'dmi']],
]
// The same family for an English archive: every link and date stays, only the words change.
const GIVEN_EN: Record<string, string> = {
  nik: 'Nicholas', var: 'Barbara', fed: 'Frederick', olg: 'Olive', iva: 'John', ann: 'Anne', pet: 'Peter', mar: 'Mary', gri: 'Gregory', tam: 'Tamsin', ser: 'Stephen', lud: 'Lucy', gal: 'Grace', ele: 'Helen',
  vik: 'Victor', pav: 'Paul', nin: 'Nina', ale: 'Alex', eka: 'Kate', dar: 'Dana', mak: 'Max', iri: 'Irene', dmi: 'Daniel', kir: 'Kyle', ali: 'Alice', son: 'Sonia', tim: 'Tim',
}
const SURNAME_EN: Record<string, string> = { Соколов: 'Whitlock', Соколова: 'Whitlock', Белов: 'Bell', Белова: 'Bell', Орлов: 'Harlan', Орлова: 'Harlan', Морозов: 'Frost', Морозова: 'Frost', Лебедева: 'Lowell', Ким: 'Kim' }
const PLACE_EN: Record<string, string> = { Кострома: 'Salem', Вологда: 'Concord', Ярославль: 'Portland', Рыбинск: 'Bangor', Тверь: 'Augusta', Москва: 'Boston', Ленинград: 'Cambridge', Нерехта: 'Ipswich', Калинин: 'Augusta', Владивосток: 'Seattle', Гамбург: 'Glasgow' }
const inEnglish = ([key, , surname, sex, birth, death, place, parents, maiden]: Row): Row =>
  [key, GIVEN_EN[key], SURNAME_EN[surname], sex, birth, death, PLACE_EN[place], parents, maiden && SURNAME_EN[maiden]]

// Where the family lived and moved, with a point on the map. Real towns, invented lives; a parent comes before what is inside it.
type PlaceRow = [name: string, kind: string, lat: number | null, lon: number | null, parent?: string, otherName?: [name: string, years: string]]
const PLACES: Record<'ru' | 'en', PlaceRow[]> = {
  ru: [
    ['Россия', 'Страна', null, null], ['Костромская область', 'Область', null, null, 'Россия'], ['Вологодская область', 'Область', null, null, 'Россия'],
    ['Ярославская область', 'Область', null, null, 'Россия'], ['Тверская область', 'Область', null, null, 'Россия'],
    ['Кострома', 'Город', 57.7677, 40.9264, 'Костромская область'], ['Нерехта', 'Город', 57.456, 40.573, 'Костромская область'],
    ['Вологда', 'Город', 59.2181, 39.8886, 'Вологодская область'], ['Ярославль', 'Город', 57.6261, 39.8845, 'Ярославская область'],
    ['Рыбинск', 'Город', 58.0446, 38.8426, 'Ярославская область'], ['Тверь', 'Город', 56.8587, 35.9176, 'Тверская область', ['Калинин', '1931–1990']],
    ['Москва', 'Город', 55.7558, 37.6173, 'Россия'], ['Санкт-Петербург', 'Город', 59.9386, 30.3141, 'Россия', ['Ленинград', '1924–1991']],
    ['Приморский край', 'Область', null, null, 'Россия'], ['Владивосток', 'Город', 43.1155, 131.8855, 'Приморский край'],
    ['Германия', 'Страна', null, null], ['Гамбург', 'Город', 53.5511, 9.9937, 'Германия'],
  ],
  en: [
    ['United States', 'Страна', null, null], ['Massachusetts', 'Область', null, null, 'United States'], ['New Hampshire', 'Область', null, null, 'United States'], ['Maine', 'Область', null, null, 'United States'],
    ['Salem', 'Город', 42.5195, -70.8967, 'Massachusetts'], ['Ipswich', 'Город', 42.6792, -70.8412, 'Massachusetts'], ['Boston', 'Город', 42.3601, -71.0589, 'Massachusetts'],
    ['Cambridge', 'Город', 42.3736, -71.1097, 'Massachusetts'], ['Concord', 'Город', 43.2081, -71.5376, 'New Hampshire'],
    ['Portland', 'Город', 43.6591, -70.2568, 'Maine'], ['Bangor', 'Город', 44.8012, -68.7778, 'Maine'], ['Augusta', 'Город', 44.3106, -69.7795, 'Maine'],
    ['Washington', 'Область', null, null, 'United States'], ['Seattle', 'Город', 47.6062, -122.3321, 'Washington'],
    ['United Kingdom', 'Страна', null, null], ['Scotland', 'Область', null, null, 'United Kingdom'], ['Glasgow', 'Город', 55.8642, -4.2518, 'Scotland'],
  ],
}
// Where each life went besides its birth: facts (kinds are the stored keys, notes are WORDS), and where those who died did.
type FactRow = [key: string, kind: string, date: string, place: string, note?: keyof (typeof WORDS)['ru']]
const FACTS: FactRow[] = [
  ['nik', 'Профессия', '1912', 'Нерехта', 'joiner'], ['iva', 'Образование', '1936', 'Ленинград', 'ships'], ['iva', 'Профессия', '1941', 'Ярославль', 'shipyard'],
  ['pet', 'Воинская служба', '1941', 'Ярославль', 'called'], ['ann', 'Образование', '1939', 'Ярославль'], ['ann', 'Место жительства', '1942', 'Вологда'],
  ['iva', 'Место жительства', '1946', 'Ярославль'], ['ann', 'Место жительства', '1946', 'Ярославль'],
  ['mar', 'Место жительства', '1946', 'Ярославль'], ['vik', 'Профессия', '1970', 'Ярославль'], ['vik', 'Место жительства', '1974', 'Калинин'],
  ['ser', 'Место жительства', '1982', 'Рыбинск'], ['ale', 'Образование', '1989', 'Москва'],
  // One line moves far: Stephen builds ships across the continent for a few years, Alex works abroad before he marries.
  ['ser', 'Профессия', '1968', 'Владивосток', 'yard'], ['ser', 'Место жительства', '1971', 'Ярославль'],
  ['ale', 'Профессия', '1996', 'Гамбург', 'port'], ['ale', 'Место жительства', '2001', 'Москва'],
]
const DIED: Record<string, string> = {
  nik: 'Ярославль', var: 'Ярославль', fed: 'Вологда', olg: 'Вологда', iva: 'Ярославль', ann: 'Ярославль', mar: 'Ярославль', gri: 'Ярославль',
  tam: 'Вологда', ser: 'Ярославль', lud: 'Ярославль', vik: 'Тверь',
}

const WORDS = {
  ru: {
    file: 'семья-1978.jpg', summary: 'Демо-семья', atHome: 'У дома в Ярославле', place: 'Ярославль', biography: 'Биография', childhood: 'Детство', born: 'Родился в Ярославле, в семье инженера. Отец, ', worked: ', работал на судостроительном заводе.',
    summers: 'Каждое лето мы уезжали на Волгу, и отец учил меня ставить парус.', invented: 'Этот текст и все люди в демо-семье вымышлены.', war: 'Война', front: 'Ушёл на фронт в 1941 году. Последнее письмо домой датировано весной 1943.', letters: 'Письма', dear: 'Мама, у нас всё хорошо, не волнуйся.', carpenter: 'Плотник из-под Костромы, строил дома по всему уезду.',
    joiner: 'Плотничья артель', ships: 'Кораблестроительный институт', shipyard: 'Инженер на судостроительном заводе', called: 'Призван, ушёл на фронт', yard: 'Инженер на судоверфи', port: 'Логист в порту',
  },
  en: {
    file: 'family-1978.jpg', summary: 'Demo family', atHome: 'Outside the house in Portland', place: 'Portland', biography: 'Biography', childhood: 'Childhood', born: 'Born in Portland to an engineer. His father, ', worked: ', worked at the shipyard.',
    summers: 'Every summer we went to the coast, and my father taught me to set a sail.', invented: 'This text and everyone in the demo family are invented.', war: 'The war', front: 'Went to the front in 1941. His last letter home is dated spring 1943.', letters: 'Letters', dear: 'Mother, all is well here, do not worry.', carpenter: 'A carpenter from near Salem who built houses across the county.',
    joiner: 'A crew of carpenters', ships: 'Naval architecture', shipyard: 'Engineer at the shipyard', called: 'Called up, went to the front', yard: 'Engineer at a shipyard on the Pacific', port: 'Shipping clerk at the docks',
  },
}

const UNIONS: [a: string, b: string, date?: string, place?: string][] = [
  ['nik', 'var'], ['fed', 'olg'], ['iva', 'ann', '1945', 'Вологда'], ['mar', 'gri', '1948', 'Ярославль'], ['ser', 'lud'], ['ser', 'gal'], ['ele', 'vik', '1972', 'Ярославль'], ['ale', 'eka', '2002', 'Москва'], ['iri', 'dmi'],
]

const figure = (sex: Sex, cx: number, cy: number, r: number, skin: string, cloth: string) => `
  <path d="M${cx - r * 1.9} ${cy + r * 4.4} C${cx - r * 1.9} ${cy + r * 1.7} ${cx + r * 1.9} ${cy + r * 1.7} ${cx + r * 1.9} ${cy + r * 4.4}Z" fill="${cloth}"/>
  ${sex === 'F' ? `<path d="M${cx - r * 1.12} ${cy + r * 1.1} C${cx - r * 1.3} ${cy - r * 1.5} ${cx + r * 1.3} ${cy - r * 1.5} ${cx + r * 1.12} ${cy + r * 1.1}Z" fill="${cloth}" opacity=".85"/>` : ''}
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${skin}"/>
  ${sex === 'M' ? `<path d="M${cx - r} ${cy - r * .2} C${cx - r} ${cy - r * 1.3} ${cx + r} ${cy - r * 1.3} ${cx + r} ${cy - r * .2} C${cx + r * .4} ${cy - r * .7} ${cx - r * .4} ${cy - r * .7} ${cx - r} ${cy - r * .2}Z" fill="${cloth}"/>` : ''}`

function groupPhoto() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9cdb6"/><stop offset="1" stop-color="#a99a7f"/></linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/><rect y="620" width="1200" height="180" fill="#8d8069"/>
  ${figure('M', 340, 290, 78, '#efe3cd', '#4f4739')}${figure('F', 620, 320, 72, '#efe3cd', '#6d5f4b')}${figure('M', 880, 400, 54, '#f3e9d6', '#5c6058')}</svg>`
}

const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] })
const h = (text: string) => ({ type: 'heading', props: { level: 2 }, content: [{ type: 'text', text, styles: {} }] })
const quote = (text: string) => ({ type: 'quote', content: [{ type: 'text', text, styles: {} }] })

export async function loadDemo(userId: string, name: string, lang: Lang) {
  const actor: Actor = { userId, name, role: 'owner', personId: null }
  // Spanish and Catalan archives get the English family for now.
  const demo = lang === 'ru' ? 'ru' : 'en'
  const w = WORDS[demo]
  const people = demo === 'ru' ? PEOPLE : PEOPLE.map(inEnglish)
  const where = (place: string) => (demo === 'ru' ? place : PLACE_EN[place])
  const fullName = (key: string) => { const r = people.find((x) => x[0] === key)!; return `${r[1]} ${r[2]}` }
  const group = await storeUpload(await sharp(Buffer.from(groupPhoto())).jpeg({ quality: 88 }).toBuffer(), w.file, userId)

  mutate(actor, { summary: w.summary }, (c) => {
    // Places the way the Places screen saves them, so the cards' words find their points on the map.
    const placeIds = new Map<string, string>()
    for (const [name, kind, lat, lon, parent, other] of PLACES[demo]) {
      const id = newId()
      c.insert('places', { id, name, kind, parentId: parent ? placeIds.get(parent)! : null, otherNames: JSON.stringify(other ? [{ name: other[0], years: other[1] }] : []), lat, lon, note: '', updatedAt: Date.now() })
      placeIds.set(name, id)
    }
    const ids = new Map<string, string>()
    people.forEach(([key, givenName, surname, sex, birthDate, deathDate, birthPlace, , maidenName = ''], i) => {
      const facts = FACTS.filter((f) => f[0] === key).map(([, kind, date, place, note]) => ({ kind: translate(lang, kind), date, place: where(place), note: note ? w[note] : '' }))
      const deathPlace = DIED[key] ? where(DIED[key]) : ''
      const id = insertPerson(c, { givenName, surname, sex, birthDate, deathDate, birthPlace, deathPlace, maidenName, facts, certainty: i % 7 === 3 ? 'assumed' : i % 3 ? 'family' : 'documented' })
      ids.set(key, id)
    })
    for (const [key, , , , , , , parents = []] of people)
      for (const par of parents) addParent(c, ids.get(par)!, ids.get(key)!, key === 'nin' ? 'adopted' : 'birth', key === 'kir' ? 'assumed' : 'family')
    for (const [a, b, date = '', place = ''] of UNIONS) addUnion(c, ids.get(a)!, ids.get(b)!, 'marriage', date, '', place && where(place))

    c.insert('media', { ...group, caption: w.atHome, date: '1978', place: w.place })
    const tag = (k: string, x: number, y: number, w: number, h: number) => c.insert('mediaTags', { id: newId(), mediaId: group.id, personId: ids.get(k)!, x, y, w, h })
    tag('ser', 0.2, 0.22, 0.17, 0.32)
    tag('lud', 0.44, 0.26, 0.16, 0.32)
    tag('ale', 0.67, 0.42, 0.13, 0.24)

    const mention = (k: string) => ({ type: 'mention', props: { personId: ids.get(k)!, label: fullName(k) } })
    insertPage(c, {
      personId: ids.get('ser')!, title: w.biography, icon: '📖', content: [
        h(w.childhood),
        { type: 'paragraph', content: [{ type: 'text', text: w.born, styles: {} }, mention('iva'), { type: 'text', text: w.worked, styles: {} }] },
        { type: 'image', props: { url: `/api/v1/media/${group.id}/file?size=medium`, caption: `${w.atHome}, 1978`, previewWidth: 520 } },
        quote(w.summers),
        p(w.invented),
      ],
    })
    const war = insertPage(c, { personId: ids.get('pet')!, title: w.war, icon: '🎖️', content: [p(w.front)] })
    insertPage(c, { personId: ids.get('pet')!, parentPageId: war, title: w.letters, icon: '✉️', content: [quote(w.dear)] })
    insertPage(c, { personId: ids.get('nik')!, title: w.biography, icon: '📖', content: [p(w.carpenter)] })
  })
}
