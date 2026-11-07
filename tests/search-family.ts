// An invented family with a lot written about it, for checking the search.
import sharp from 'sharp'
import type { Actor } from '../lib/ops/core'
import { updateMedia, uploadMedia } from '../lib/ops/media'
import { createPage } from '../lib/ops/pages'
import { createPerson, linkPeople, updatePerson } from '../lib/ops/people'
import { createStory } from '../lib/ops/stories'

export const searchOwner: Actor = { userId: 'u-search-owner', name: 'Ольга', role: 'owner', personId: null }

export async function loadSearchFamily() {
  const a = searchOwner
  const add = (givenName: string, surname: string, sex: 'M' | 'F', birthDate: string, deathDate: string, birthPlace: string, more: Record<string, unknown> = {}) => {
    const person = createPerson(a, { givenName, surname, sex, birthDate, deathDate, birthPlace })
    if (Object.keys(more).length) updatePerson(a, person.id, more as never)
    return person
  }
  const p = {
    matvey: add('Матвей', 'Воронцов', 'M', '12.03.1861', '1930', 'Тула', { patronymic: 'Ильич', facts: [{ kind: 'Служба', date: '1885', place: 'Варшава', note: 'служил унтер-офицером в пехотном полку' }], tags: ['Воронцовы'] }),
    agafya: add('Агафья', 'Воронцова', 'F', '1865', '02.02.1940', 'Белёв', { maidenName: 'Кузьмина', patronymic: 'Петровна', tags: ['Воронцовы'], deathPlace: 'Тула' }),
    fyodor: add('Фёдор', 'Воронцов', 'M', '09.05.1890', '21.08.1943', 'Тула', { patronymic: 'Матвеевич', deathPlace: 'Курск', facts: [{ kind: 'Работа', date: '1912', place: 'Тула', note: 'токарь на оружейном заводе' }, { kind: 'Война', date: '1943', place: 'Курская дуга', note: 'погиб на фронте' }], sources: [{ id: 's1', title: 'Память народа', ref: 'ЦАМО, фонд 58, опись 18001, дело 1104', page: '12', url: '' }], tags: ['Воронцовы', 'Фронт'] }),
    evdokia: add('Евдокия', 'Воронцова', 'F', '~1895', '1977', 'Ефремов', { maidenName: 'Шереметева', patronymic: 'Андреевна', otherNames: 'Дуня', facts: [{ kind: 'Работа', date: '1925', place: 'Тула', note: 'портниха, шила на дому' }] }),
    pavel: add('Павел', 'Воронцов', 'M', '1921', '1999', 'Тула', { patronymic: 'Фёдорович', deathPlace: 'Ленинград', facts: [{ kind: 'Работа', date: '1950', place: 'Ленинград', note: 'главный инженер Кировского завода' }] }),
    zinaida: add('Зинаида', 'Воронцова', 'F', '15.11.1924', '2008', 'Москва', { maidenName: 'Гольдман', patronymic: 'Исааковна', deathPlace: 'Ленинград', facts: [{ kind: 'Работа', date: '1948', place: 'Ленинград', note: 'детский врач в районной поликлинике' }] }),
    maria: add('Мария', 'Лукьянец', 'F', '1919', '1983', 'Полтава', { maidenName: 'Воронцова', patronymic: 'Фёдоровна', facts: [{ kind: 'Переезд', date: '1946', place: 'Львов', note: 'переехала с семьёй после войны' }] }),
    bogdan: add('Богдан', 'Лукьянец', 'M', '1915', '1988', 'Полтава', { patronymic: 'Тарасович', facts: [{ kind: 'Работа', date: '1938', place: 'Полтава', note: 'учитель истории' }] }),
    oksana: add('Оксана', 'Лукьянец', 'F', '1948', '2019', 'Львов', { patronymic: 'Богдановна' }),
    grigory: add('Григорий', 'Шапиро', 'M', '1880', '1941', 'Витебск', { patronymic: 'Моисеевич', facts: [{ kind: 'Арест', date: '1937', place: 'Витебск', note: 'арестован, сослан в лагерь' }], sources: [{ id: 's2', title: 'Открытый список', ref: 'ГАВО, фонд 3, дело 77', page: '', url: '' }] }),
    rahil: add('Рахиль', 'Шапиро', 'F', '1884', '1962', 'Витебск', { maidenName: 'Коган', patronymic: 'Львовна' }),
    isaak: add('Исаак', 'Гольдман', 'M', '1895', '1970', 'Одесса', { patronymic: 'Наумович', facts: [{ kind: 'Служба', date: '1915', place: 'Галиция', note: 'полковой фельдшер' }] }),
    sofia: add('Софья', 'Гольдман', 'F', '1900', '1985', 'Витебск', { maidenName: 'Шапиро', patronymic: 'Григорьевна' }),
    nikolai: add('Николай', 'Воронцов', 'M', '1893', '1920', 'Тула', { patronymic: 'Матвеевич', otherNames: 'Коля', facts: [{ kind: 'Эмиграция', date: '1920', place: 'Константинополь', note: 'уехал с армией Врангеля' }] }),
    aleksandra: add('Александра', 'Белякова', 'F', '03.1952', '', 'Ленинград', { patronymic: 'Павловна', facts: [{ kind: 'Учёба', date: '1974', place: 'Ленинград', note: 'окончила консерваторию по классу скрипки' }] }),
    vasily: add('Василий', 'Беляков', 'M', '1950', '2015', 'Кострома', { patronymic: 'Степанович', facts: [{ kind: 'Работа', date: '1980', place: 'Мурманск', note: 'капитан рыболовного судна' }] }),
    tatiana: add('Татьяна', 'Морозова', 'F', '1975', '', 'Мурманск', { maidenName: 'Белякова', patronymic: 'Васильевна' }),
    john: add('John', 'Smith', 'M', '1902', '1975', 'Chicago', { otherNames: 'Иван Кузнецов', facts: [{ kind: 'Эмиграция', date: '1912', place: 'New York', note: 'приехал через остров Эллис' }] }),
    anna: add('Анна', 'Соловьёва', 'F', '1890', '1890', 'Рязань', { patronymic: 'Ивановна' }),
    annaYoung: add('Анна', 'Иванова', 'F', '1960', '', 'Рязань', { patronymic: 'Сергеевна', tags: ['Рязанская ветка'] }),
    inna: add('Инна', 'Сомова', 'F', '1961', '', 'Псков'),
    sergey: add('Сергей', 'Иванов', 'M', '1930', '1994', 'Рязань', { claims: [{ id: 'c1', field: 'birthDate', value: '1931', sourceId: null, status: 'possible', reason: 'в метрике указан другой год', at: 1 }] }),
  }
  const id = (k: keyof typeof p) => p[k].id
  linkPeople(a, 'spouse', id('matvey'), id('agafya'))
  linkPeople(a, 'son', id('matvey'), id('fyodor'), id('agafya'))
  linkPeople(a, 'son', id('matvey'), id('nikolai'), id('agafya'))
  linkPeople(a, 'spouse', id('fyodor'), id('evdokia'))
  linkPeople(a, 'son', id('fyodor'), id('pavel'), id('evdokia'))
  linkPeople(a, 'daughter', id('fyodor'), id('maria'), id('evdokia'))
  linkPeople(a, 'spouse', id('pavel'), id('zinaida'))
  linkPeople(a, 'daughter', id('pavel'), id('aleksandra'), id('zinaida'))
  linkPeople(a, 'spouse', id('maria'), id('bogdan'))
  linkPeople(a, 'daughter', id('maria'), id('oksana'), id('bogdan'))
  linkPeople(a, 'spouse', id('grigory'), id('rahil'))
  linkPeople(a, 'daughter', id('grigory'), id('sofia'), id('rahil'))
  linkPeople(a, 'spouse', id('isaak'), id('sofia'))
  linkPeople(a, 'daughter', id('isaak'), id('zinaida'), id('sofia'))
  linkPeople(a, 'spouse', id('aleksandra'), id('vasily'))
  linkPeople(a, 'daughter', id('vasily'), id('tatiana'), id('aleksandra'))
  linkPeople(a, 'son', id('annaYoung'), id('sergey'))
  const para = (text: string) => [{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }]
  createPage(a, { personId: id('agafya'), title: 'Как жили в Белёве', content: para('Держала пасеку и славилась липовым мёдом на всю округу. Пекла ржаной хлеб для соседей. https://irbis.example/cgi?C21COM=F&S21LOG=1&S21STN=7&S21STR=zzqwerty') })
  createPage(a, { personId: id('pavel'), title: 'Блокада', content: para('Всю блокаду оставался в городе, чинил станки на заводе и получил медаль за оборону Ленинграда.') })
  createStory(a, { title: 'Как бабушка пела', body: 'Евдокия пела в церковном хоре, и голос её слышали с другого берега реки.', about: [id('evdokia')], tellerName: 'Павел' } as never)
  const buf = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#b08' } }).jpeg().toBuffer()
  const photo = await uploadMedia(a, buf, 'x.jpg', id('zinaida'))
  updateMedia(a, photo.id, { caption: 'На даче в Комарово с внучкой', date: 'лето 1968', place: 'Комарово' })
  return p
}
