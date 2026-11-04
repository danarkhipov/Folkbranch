// A fictional family, so the app can be tried without real data.
import sharp from 'sharp'
import { Actor, mutate, newId } from './ops/core'
import { addParent, addUnion, insertPerson } from './ops/people'
import { insertPage } from './ops/pages'
import { storeUpload } from './ops/media'
import type { Sex } from './types'

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

export async function loadDemo(userId: string, name: string) {
  const actor: Actor = { userId, name, role: 'owner', personId: null }
  const group = await storeUpload(await sharp(Buffer.from(groupPhoto())).jpeg({ quality: 88 }).toBuffer(), 'семья-1978.jpg', userId)

  mutate(actor, { summary: 'Демо-семья' }, (c) => {
    const ids = new Map<string, string>()
    PEOPLE.forEach(([key, givenName, surname, sex, birthDate, deathDate, birthPlace, , maidenName = ''], i) => {
      const id = insertPerson(c, { givenName, surname, sex, birthDate, deathDate, birthPlace, maidenName, certainty: i % 7 === 3 ? 'assumed' : i % 3 ? 'family' : 'documented' })
      ids.set(key, id)
    })
    for (const [key, , , , , , , parents = []] of PEOPLE)
      for (const par of parents) addParent(c, ids.get(par)!, ids.get(key)!, key === 'nin' ? 'adopted' : 'birth', key === 'kir' ? 'assumed' : 'family')
    for (const [a, b] of UNIONS) addUnion(c, ids.get(a)!, ids.get(b)!)

    c.insert('media', { ...group, caption: 'У дома в Ярославле', date: '1978', place: 'Ярославль' })
    const tag = (k: string, x: number, y: number, w: number, h: number) => c.insert('mediaTags', { id: newId(), mediaId: group.id, personId: ids.get(k)!, x, y, w, h })
    tag('ser', 0.2, 0.22, 0.17, 0.32)
    tag('lud', 0.44, 0.26, 0.16, 0.32)
    tag('ale', 0.67, 0.42, 0.13, 0.24)

    const mention = (k: string, label: string) => ({ type: 'mention', props: { personId: ids.get(k)!, label } })
    insertPage(c, {
      personId: ids.get('ser')!, title: 'Биография', icon: '📖', content: [
        h('Детство'),
        { type: 'paragraph', content: [{ type: 'text', text: 'Родился в Ярославле, в семье инженера. Отец, ', styles: {} }, mention('iva', 'Иван Соколов'), { type: 'text', text: ', работал на судостроительном заводе.', styles: {} }] },
        { type: 'image', props: { url: `/api/v1/media/${group.id}/file?size=medium`, caption: 'У дома в Ярославле, 1978', previewWidth: 520 } },
        quote('Каждое лето мы уезжали на Волгу, и отец учил меня ставить парус.'),
        p('Этот текст и все люди в демо-семье вымышлены.'),
      ],
    })
    const war = insertPage(c, { personId: ids.get('pet')!, title: 'Война', icon: '🎖️', content: [p('Ушёл на фронт в 1941 году. Последнее письмо домой датировано весной 1943.')] })
    insertPage(c, { personId: ids.get('pet')!, parentPageId: war, title: 'Письма', icon: '✉️', content: [quote('Мама, у нас всё хорошо, не волнуйся.')] })
    insertPage(c, { personId: ids.get('nik')!, title: 'Биография', icon: '📖', content: [p('Плотник из-под Костромы, строил дома по всему уезду.')] })
  })
}
