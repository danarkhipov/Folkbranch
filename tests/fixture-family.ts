// A small invented family for checking what the assistant's tools answer.
import sharp from 'sharp'
import { uploadMedia } from '../lib/ops/media'
import type { Actor } from '../lib/ops/core'
import { createPage } from '../lib/ops/pages'
import { createPerson, linkPeople, updatePerson } from '../lib/ops/people'

export const owner: Actor = { userId: 'u-owner', name: 'Ольга', role: 'owner', personId: null }
export const editor: Actor = { userId: 'u-editor', name: 'Егор', role: 'editor', personId: null }
export const reader: Actor = { userId: 'u-reader', name: 'Роман', role: 'reader', personId: null }
export const SECRETS = ['Живинская', 'Скрытовна', 'Тайноград', 'Тайногруппа', 'Тайноисточник', 'Тайнопись']

export async function loadFamily() {
  const add = (givenName: string, surname: string, sex: 'M' | 'F', birthDate: string, deathDate: string, birthPlace: string) => createPerson(owner, { givenName, surname, sex, birthDate, deathDate, birthPlace })
  const nikolai = add('Николай', 'Соколов', 'M', '1860', '1930', 'Тула')
  const varvara = add('Варвара', 'Соколова', 'F', '1865', '1940', 'Тула')
  const ivan = add('Иван', 'Соколов', 'M', '1890', '1960', 'Тула')
  const maria = add('Мария', 'Белова', 'F', '1895', '1970', 'Кострома')
  const pyotr = add('Пётр', 'Соколов', 'M', '1925', '2000', 'Москва')
  const living = add('Анна', 'Живинская', 'F', '1990', '', 'Тайноград')
  linkPeople(owner, 'spouse', nikolai.id, varvara.id)
  linkPeople(owner, 'son', nikolai.id, ivan.id, varvara.id)
  linkPeople(owner, 'spouse', ivan.id, maria.id)
  linkPeople(owner, 'son', ivan.id, pyotr.id, maria.id)
  linkPeople(owner, 'daughter', pyotr.id, living.id)
  updatePerson(owner, nikolai.id, { sources: [{ id: 's1', title: 'Архив Тульской области', ref: 'ф. 12', page: '', url: '' }], facts: [{ kind: 'Служба', date: '1885', place: 'Тула', note: 'Мастер оружейного завода' }] })
  updatePerson(owner, living.id, { patronymic: 'Скрытовна', tags: ['Тайногруппа'], sources: [{ id: 's2', title: 'Тайноисточник', ref: '', page: '', url: '' }] })
  const life = createPage(owner, { personId: nikolai.id, title: 'Жизнь', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Служил на заводе, потом держал кузницу у реки.', styles: {} }] }] })
  createPage(owner, { personId: pyotr.id, title: 'Дети', content: [{ type: 'paragraph', content: [{ type: 'mention', props: { personId: living.id, label: 'Анна Живинская' } }, { type: 'text', text: ' родилась поздно.', styles: {} }] }] })
  createPage(owner, { personId: living.id, title: 'Тайнопись', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Тайнопись о живой.', styles: {} }] }] })
  const photo = await uploadMedia(owner, await sharp({ create: { width: 40, height: 40, channels: 3, background: '#555' } }).jpeg().toBuffer(), 'свадьба.jpg', ivan.id)
  return { nikolai, varvara, ivan, maria, pyotr, living, life, photo }
}
