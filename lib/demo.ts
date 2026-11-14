// A fictional family, so the app can be tried without real data.
import sharp from 'sharp'
import { Actor, mutate, newId } from './ops/core'
import { addParent, addUnion, insertPerson } from './ops/people'
import { insertPage } from './ops/pages'
import { storeUpload } from './ops/media'
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
const PLACE_EN: Record<string, string> = { Кострома: 'Salem', Вологда: 'Concord', Ярославль: 'Portland', Рыбинск: 'Bangor', Тверь: 'Augusta', Москва: 'Boston' }
const inEnglish = ([key, , surname, sex, birth, death, place, parents, maiden]: Row): Row =>
  [key, GIVEN_EN[key], SURNAME_EN[surname], sex, birth, death, PLACE_EN[place], parents, maiden && SURNAME_EN[maiden]]

const WORDS = {
  ru: {
    file: 'семья-1978.jpg', summary: 'Демо-семья', atHome: 'У дома в Ярославле', place: 'Ярославль', biography: 'Биография', childhood: 'Детство', born: 'Родился в Ярославле, в семье инженера. Отец, ', worked: ', работал на судостроительном заводе.',
    summers: 'Каждое лето мы уезжали на Волгу, и отец учил меня ставить парус.', invented: 'Этот текст и все люди в демо-семье вымышлены.', war: 'Война', front: 'Ушёл на фронт в 1941 году. Последнее письмо домой датировано весной 1943.', letters: 'Письма', dear: 'Мама, у нас всё хорошо, не волнуйся.', carpenter: 'Плотник из-под Костромы, строил дома по всему уезду.',
  },
  en: {
    file: 'family-1978.jpg', summary: 'Demo family', atHome: 'Outside the house in Portland', place: 'Portland', biography: 'Biography', childhood: 'Childhood', born: 'Born in Portland to an engineer. His father, ', worked: ', worked at the shipyard.',
    summers: 'Every summer we went to the coast, and my father taught me to set a sail.', invented: 'This text and everyone in the demo family are invented.', war: 'The war', front: 'Went to the front in 1941. His last letter home is dated spring 1943.', letters: 'Letters', dear: 'Mother, all is well here, do not worry.', carpenter: 'A carpenter from near Salem who built houses across the county.',
  },
}

const UNIONS = [['nik', 'var'], ['fed', 'olg'], ['iva', 'ann'], ['mar', 'gri'], ['ser', 'lud'], ['ser', 'gal'], ['ele', 'vik'], ['ale', 'eka'], ['iri', 'dmi']]

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
  const fullName = (key: string) => { const r = people.find((x) => x[0] === key)!; return `${r[1]} ${r[2]}` }
  const group = await storeUpload(await sharp(Buffer.from(groupPhoto())).jpeg({ quality: 88 }).toBuffer(), w.file, userId)

  mutate(actor, { summary: w.summary }, (c) => {
    const ids = new Map<string, string>()
    people.forEach(([key, givenName, surname, sex, birthDate, deathDate, birthPlace, , maidenName = ''], i) => {
      const id = insertPerson(c, { givenName, surname, sex, birthDate, deathDate, birthPlace, maidenName, certainty: i % 7 === 3 ? 'assumed' : i % 3 ? 'family' : 'documented' })
      ids.set(key, id)
    })
    for (const [key, , , , , , , parents = []] of people)
      for (const par of parents) addParent(c, ids.get(par)!, ids.get(key)!, key === 'nin' ? 'adopted' : 'birth', key === 'kir' ? 'assumed' : 'family')
    for (const [a, b] of UNIONS) addUnion(c, ids.get(a)!, ids.get(b)!)

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
