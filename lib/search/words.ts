// What makes two words "the same" for a person looking for a relative: case endings, sound, keyboard, nicknames.

/** Lower case, ё as е, and Latin accents dropped (García as garcia; ç stays). One letter for one, so a match is marked where it stands. */
export const normal = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[\u00e0-\u024f]/g, (c) => { const b = c.normalize('NFD').replace(/[\u0300-\u0326\u0328-\u036f]/g, ''); return b.length === 1 ? b : c })

const CASE_ENDINGS = ['ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'ами', 'ями', 'ая', 'яя', 'ую', 'юю', 'ой', 'ей', 'ий', 'ый', 'ое', 'ее', 'ые', 'ие', 'ых', 'их', 'ым', 'им', 'ам', 'ям', 'ах', 'ях', 'ом', 'ем', 'ию', 'ия', 'ии', 'ью', 'а', 'я', 'ы', 'и', 'у', 'ю', 'е', 'о', 'ь', 'й']
const MIN_STEM = 3

/** A word without its Russian case ending: Соколовой and Соколова both give соколов, Туле and Тула both тул. */
export function stem(word: string) {
  if (!/[а-я]/.test(word)) return word
  for (const end of CASE_ENDINGS) if (word.endsWith(end) && word.length - end.length >= MIN_STEM) return word.slice(0, -end.length)
  return word
}

const SOUNDS: Record<string, string> = { о: 'а', е: 'и', э: 'и', я: 'а', ю: 'у', ы: 'и', й: 'и', б: 'п', в: 'ф', г: 'к', д: 'т', ж: 'ш', з: 'с', ц: 'с', щ: 'ш', ь: '', ъ: '' }

/** How a word sounds: Саколов and Соколов, Иваноф and Иванов, Коган and Каган come out alike. */
export function sound(word: string) {
  let out = ''
  for (const ch of word) {
    const s = SOUNDS[ch] ?? ch
    if (s && !out.endsWith(s)) out += s
  }
  return out
}

const LATIN: [string, string][] = [['shch', 'щ'], ['sch', 'щ'], ['zh', 'ж'], ['kh', 'х'], ['ts', 'ц'], ['ch', 'ч'], ['sh', 'ш'], ['yu', 'ю'], ['ya', 'я'], ['yo', 'е'], ['ye', 'е'], ['ia', 'я'], ['iu', 'ю'], ['a', 'а'], ['b', 'б'], ['c', 'к'], ['d', 'д'], ['e', 'е'], ['f', 'ф'], ['g', 'г'], ['h', 'х'], ['i', 'и'], ['j', 'й'], ['k', 'к'], ['l', 'л'], ['m', 'м'], ['n', 'н'], ['o', 'о'], ['p', 'п'], ['q', 'к'], ['r', 'р'], ['s', 'с'], ['t', 'т'], ['u', 'у'], ['v', 'в'], ['w', 'в'], ['x', 'кс'], ['y', 'и'], ['z', 'з']]

/** Sokolov as Соколов. */
export function toCyrillic(word: string) {
  let out = ''
  for (let i = 0; i < word.length;) {
    const hit = LATIN.find(([l]) => word.startsWith(l, i))
    out += hit ? hit[1] : word[i]
    i += hit ? hit[0].length : 1
  }
  return out
}

const EN_KEYS = 'qwertyuiop[]asdfghjkl;\'zxcvbnm,.`'
const RU_KEYS = 'йцукенгшщзхъфывапролджэячсмитьбюе'

/** Typed with the wrong keyboard layout: bdfy is иван, and ыщлщдщм is sokolov. */
export function otherLayout(word: string) {
  const swap = (from: string, to: string) => [...word].map((c) => { const i = from.indexOf(c); return i < 0 ? c : to[i] }).join('')
  return /[а-я]/.test(word) ? swap(RU_KEYS, EN_KEYS) : swap(EN_KEYS, RU_KEYS)
}

/** Damerau-Levenshtein, giving up beyond the limit. */
export function distance(a: string, b: string, limit: number) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  let before: number[] = []
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let lowest = i
    for (let j = 1; j <= b.length; j++) {
      let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, before[j - 2] + 1)
      row[j] = d
      lowest = Math.min(lowest, d)
    }
    if (lowest > limit) return limit + 1
    before = prev
    prev = row
  }
  return prev[b.length]
}

/** The forms a name goes by. Each line is one name. */
const NAMES = `александр саша шура саня сашенька алекс
александра саша шура сашенька
алексей алеша леша алеха алексий
анастасия настя настена стася
анатолий толя
андрей андрюша
анна аня анюта нюра нюша аннушка ганна
антон антоша
валентин валя
валентина валя
варвара варя
василий вася василь
вера верочка
виктор витя
виктория вика
владимир володя вова вовка
галина галя
георгий гоша жора егор юрий
григорий гриша
дарья даша
дмитрий дима митя димитрий
евгений женя
евгения женя
екатерина катя катюша катерина
елена лена леночка аленa
елизавета лиза
иван ваня ванечка иоанн
ирина ира
константин костя
ксения ксюша аксинья
лидия лида
любовь люба
людмила люда мила
максим макс
мария маша маня машенька марья мара
марина
михаил миша
надежда надя
наталья наташа наталия
николай коля николаша
нина
ольга оля
павел паша
петр петя
раиса рая
сергей сережа
софья соня софия
станислав стас
степан степа
тамара тома
татьяна таня
тимофей тима
федор федя
юлия юля
яков яша`

/** Words people use for one thing. Not a thesaurus: only what comes up in family histories. */
const SIMILAR = `врач доктор фельдшер лекарь медсестра медик
учитель учительница педагог преподаватель преподавал
война фронт фронтовик ветеран воевал война
военный солдат офицер армия служба служил рядовой сержант
священник поп батюшка дьякон
крестьянин крестьянка земледелец
рабочий завод фабрика токарь слесарь
инженер конструктор техник
бухгалтер счетовод
портной портниха швея
свадьба венчание брак женился вышла замуж
похоронен кладбище могила захоронение
арестован репрессирован ссылка лагерь сослан
эвакуация эвакуирован
переехал переезд переселился уехал
церковь храм собор приход
дом усадьба
школа гимназия училище`

const groups = (text: string) => {
  const map = new Map<string, Set<string>>()
  for (const line of text.split('\n')) {
    const stems = new Set(line.trim().split(/\s+/).map((w) => stem(normal(w))))
    for (const s of stems) map.set(s, new Set([...(map.get(s) ?? []), ...stems]))
  }
  return map
}

export const NAME_FORMS = groups(NAMES)
export const SIMILAR_WORDS = groups(SIMILAR)
