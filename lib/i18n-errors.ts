// The server's short protocol errors stay in English for programs (MCP clients, tokens, tests match on them).
// A person in the app reads them in their own language: the few that reach a screen are worded here.
import type { Lang } from './types'

const ERRORS: Record<string, Partial<Record<Lang, string>>> = {
  'not found': { ru: 'Не найдено: возможно, это уже удалили', es: 'No encontrado: quizá ya se borró', ca: "No s'ha trobat: potser ja s'ha esborrat" },
  forbidden: { ru: 'У вас нет прав на это действие', es: 'No tienes permiso para esto', ca: 'No tens permís per a això' },
  'file too large': { ru: 'Файл слишком большой', es: 'El archivo es demasiado grande', ca: 'El fitxer és massa gran' },
  'already undone': { ru: 'Это уже отменено', es: 'Ya se deshizo', ca: 'Ja està desfet' },
  'changed later: undo the newer edit first': { ru: 'Это уже изменили позже. Сначала отмените более новую правку', es: 'Se cambió después: deshaz primero el cambio más reciente', ca: 'Es va canviar després: desfés primer el canvi més recent' },
  'the file is missing': { ru: 'Файл пропал с сервера', es: 'El archivo ya no está en el servidor', ca: 'El fitxer ja no és al servidor' },
  'no such attachment': { ru: 'Этого файла больше нет', es: 'Este archivo ya no existe', ca: 'Aquest fitxer ja no existeix' },
  'the file is empty': { ru: 'Файл пустой', es: 'El archivo está vacío', ca: 'El fitxer és buit' },
  'same person': { ru: 'Это один и тот же человек', es: 'Es la misma persona', ca: 'És la mateixa persona' },
  'file required': { ru: 'Выберите файл', es: 'Elige un archivo', ca: 'Tria un fitxer' },
  'could not download': { ru: 'Не удалось скачать по ссылке', es: 'No se pudo descargar del enlace', ca: "No s'ha pogut baixar de l'enllaç" },
  'address not allowed': { ru: 'Этот адрес нельзя открыть с сервера', es: 'Esta dirección no se puede abrir desde el servidor', ca: 'Aquesta adreça no es pot obrir des del servidor' },
  'no AI provider is set up': { ru: 'Нейросеть не подключена', es: 'No hay ningún servicio de IA conectado', ca: 'No hi ha cap servei d’IA connectat' },
  'draft is full, wait for review': { ru: 'Черновик заполнен: дождитесь проверки владельцем', es: 'El borrador está lleno: espera la revisión', ca: "L'esborrany és ple: espera la revisió" },
  'the story changed since this copy was read': { ru: 'Рассказ уже изменили в другом окне. Обновите страницу', es: 'El relato cambió en otra ventana. Recarga la página', ca: "El relat ha canviat en una altra finestra. Recarrega la pàgina" },
  'the page changed since this copy was read': { ru: 'Страницу уже изменили в другом окне. Обновите её', es: 'La página cambió en otra ventana. Recárgala', ca: "La pàgina ha canviat en una altra finestra. Recarrega-la" },
  'already resolved': { ru: 'Это уже решено', es: 'Ya está resuelto', ca: 'Ja està resolt' },
  'invalid JSON': { ru: 'Сервер не понял запрос. Обновите страницу', es: 'El servidor no entendió la petición. Recarga la página', ca: "El servidor no ha entès la petició. Recarrega la pàgina" },
}

/** The person's wording of a protocol error, or the error as it is when there is none. */
export const errorFor = (message: string, lang: Lang) => ERRORS[message]?.[lang] ?? message
