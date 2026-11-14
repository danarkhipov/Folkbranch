// Russian patronymics, so nobody has to type what the father's name already says.
import type { Lang, Sex } from './types'

const IRREGULAR: Record<string, [string, string]> = {
  'Илья': ['Ильич', 'Ильинична'], 'Никита': ['Никитич', 'Никитична'], 'Лука': ['Лукич', 'Лукинична'], 'Фома': ['Фомич', 'Фоминична'], 'Кузьма': ['Кузьмич', 'Кузьминична'],
  'Пётр': ['Петрович', 'Петровна'], 'Петр': ['Петрович', 'Петровна'], 'Лев': ['Львович', 'Львовна'], 'Павел': ['Павлович', 'Павловна'],
  'Юрий': ['Юрьевич', 'Юрьевна'], 'Григорий': ['Григорьевич', 'Григорьевна'], 'Яков': ['Яковлевич', 'Яковлевна'],
}

/** The patronymic for a child of this father, or '' when the name gives no safe answer. */
export function patronymicFrom(father: string, sex: Sex): string {
  const name = father.trim().split(/\s+/)[0] ?? ''
  if (sex === 'U' || !/^[А-ЯЁ][а-яё]+$/.test(name)) return ''
  const f = sex === 'F'
  if (IRREGULAR[name]) return IRREGULAR[name][f ? 1 : 0]
  if (/[ая]$/.test(name)) return ''
  if (/ий$/.test(name)) return name.slice(0, -1) + (f ? 'евна' : 'евич')
  if (/[йь]$/.test(name)) return name.slice(0, -1) + (f ? 'евна' : 'евич')
  if (/[жчшщц]$/.test(name)) return name + (f ? 'евна' : 'евич')
  return name + (f ? 'овна' : 'ович')
}

/** "Иван Петрович" from an old import becomes the name and the patronymic; "Анна Мария" stays. */
export function splitPatronymic(given: string): [string, string] {
  const parts = given.trim().split(/\s+/)
  if (parts.length === 2 && /(ович|евич|ьич|ична|овна|евна|инична)$/.test(parts[1])) return [parts[0], parts[1]]
  return [given.trim(), '']
}

/** One and many, for the languages with only these two forms. */
const OTHER: Record<Exclude<Lang, 'ru'>, { year: [string, string]; person: [string, string]; family: [string, string] }> = {
  en: { year: ['year', 'years'], person: ['person', 'people'], family: ['family', 'families'] },
  es: { year: ['año', 'años'], person: ['persona', 'personas'], family: ['familia', 'familias'] },
  ca: { year: ['any', 'anys'], person: ['persona', 'persones'], family: ['família', 'famílies'] },
}
const form = (n: number, [one, many]: [string, string]) => `${n} ${n === 1 ? one : many}`

/** "72 года" / "72 years" / "72 años" / "72 anys". */
export function ageWords(n: number, lang: Lang) {
  if (lang !== 'ru') return form(n, OTHER[lang].year)
  const a = n % 100, b = n % 10
  return `${n} ${a >= 11 && a <= 14 ? 'лет' : b === 1 ? 'год' : b >= 2 && b <= 4 ? 'года' : 'лет'}`
}

const ruForm = (n: number, one: string, few: string, many: string) => {
  const a = n % 100, b = n % 10
  return a >= 11 && a <= 14 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many
}

/** "1 человек", "3 семьи" / "1 person", "3 families" / "3 personas" / "3 famílies". */
export const peopleWords = (n: number, lang: Lang) => (lang === 'ru' ? `${n} ${ruForm(n, 'человек', 'человека', 'человек')}` : form(n, OTHER[lang].person))
export const familyWords = (n: number, lang: Lang) => (lang === 'ru' ? `${n} ${ruForm(n, 'семья', 'семьи', 'семей')}` : form(n, OTHER[lang].family))
