// What people see in the chat for each tool. Plain data, so the browser can use it without the
// server's code. A test checks this list against the real tools.
import type { Lang } from '../types'

const READ: Record<string, [string, string]> = {
  get_overview: ['Смотрит обзор архива', 'Looking at the overview'],
  find_gaps: ['Ищет, что не заполнено', 'Looking for gaps'],
  parse_table: ['Разбирает таблицу', 'Reading the table'],
  search_people: ['Ищет людей', 'Searching people'],
  query_people: ['Ищет людей', 'Selecting people'],
  search_archive: ['Ищет по всему архиву', 'Searching the archive'],
  get_person: ['Читает карточку', 'Reading a card'],
  get_relatives: ['Смотрит родню', 'Looking at relatives'],
  how_related: ['Считает родство', 'Working out the relation'],
  list_pages: ['Смотрит список страниц', 'Listing pages'],
  get_page: ['Читает страницу', 'Reading a page'],
  list_photos: ['Смотрит фото', 'Looking at photos'],
  export_text: ['Читает всё дерево', 'Reading the whole tree'],
  preview_text: ['Проверяет, что изменится', 'Checking what would change'],
  export_gedcom: ['Выгружает GEDCOM', 'Exporting GEDCOM'],
  preview_gedcom: ['Смотрит файл GEDCOM', 'Looking at a GEDCOM file'],
  get_history: ['Смотрит историю', 'Looking at history'],
  read_attachment: ['Читает файл', 'Reading the file'],
  get_settings: ['Смотрит настройки', 'Looking at settings'],
  list_users: ['Смотрит, у кого есть доступ', 'Looking at who has access'],
  list_invites: ['Смотрит приглашения', 'Looking at invitations'],
  set_plan: ['Составляет план', 'Making a plan'],
  use_tools: ['Берёт нужные инструменты', 'Getting the tools it needs'],
  focus_person: ['Открывает человека на схеме', 'Opening a person on the chart'],
  show_path: ['Показывает путь на схеме', 'Showing the path on the chart'],
  set_chart_direction: ['Меняет направление схемы', 'Changing the chart direction'],
}
/** Ordinary edits: these can be allowed for a whole conversation. */
const WRITE: Record<string, [string, string]> = {
  save_attachment: ['Сохранить файл в архив', 'Save the file to the archive'],
  create_person: ['Добавить человека', 'Add a person'],
  update_person: ['Изменить карточку', 'Change a card'],
  add_relation: ['Добавить связь', 'Add a link'],
  update_relation: ['Изменить связь', 'Change a link'],
  create_page: ['Создать страницу', 'Create a page'],
  update_page: ['Изменить страницу', 'Change a page'],
  move_page: ['Переместить страницу', 'Move a page'],
  upload_photo: ['Загрузить фото', 'Upload a photo'],
  update_photo: ['Изменить подпись фото', 'Change a photo caption'],
  tag_photo: ['Отметить человека на фото', 'Tag a person in a photo'],
  set_avatar: ['Сменить аватарку', 'Change an avatar'],
  add_version: ['Добавить версию факта', 'Add a version of a fact'],
  choose_version: ['Выбрать версию факта', 'Choose a version of a fact'],
  restore_version: ['Вернуть версию факта', 'Bring back a version of a fact'],
  add_source: ['Добавить источник', 'Add a source'],
}
/** Always asked. */
const CAREFUL: Record<string, [string, string]> = {
  delete_person: ['Удалить человека', 'Delete a person'],
  update_people: ['Изменить сразу нескольких', 'Change several people'],
  remove_relation: ['Удалить связь', 'Delete a link'],
  remove_parent_links: ['Удалить связи', 'Delete links'],
  import_gedcom: ['Импортировать GEDCOM', 'Import GEDCOM'],
  delete_page: ['Удалить страницу', 'Delete a page'],
  delete_photo: ['Удалить фото', 'Delete a photo'],
  untag_photo: ['Снять отметку с фото', 'Remove a photo tag'],
  reject_version: ['Отклонить версию факта', 'Reject a version of a fact'],
  remove_source: ['Удалить источник', 'Remove a source'],
  import_gedcom_attachment: ['Импортировать файл GEDCOM', 'Import a GEDCOM file'],
  import_text: ['Импортировать данные', 'Import data'],
  undo: ['Отменить правку', 'Undo a change'],
  update_settings: ['Изменить настройки', 'Change settings'],
  set_user_role: ['Изменить роль', 'Change a role'],
  create_invite: ['Создать приглашение', 'Create an invitation'],
  revoke_invite: ['Отменить приглашение', 'Cancel an invitation'],
}

export const TOOL_NAMES = { read: Object.keys(READ), write: Object.keys(WRITE), careful: Object.keys(CAREFUL) }
export const isOrdinaryEdit = (name: string) => name in WRITE
/** Whether finishing this tool may have changed what is on screen. */
export const changesData = (name: string) => name in WRITE || name in CAREFUL
export const toolLabel = (name: string, lang: Lang) => (READ[name] ?? WRITE[name] ?? CAREFUL[name])?.[lang === 'en' ? 1 : 0] ?? name
