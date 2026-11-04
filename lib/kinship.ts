// Kinship terms are computed from links and sex; nothing like "son" or "father" is ever stored.
import type { Graph, Lang, Sex } from './types'

export interface Kin {
  /** Term for `to` as seen from `from`, e.g. "дед". */
  label: string
  /** Person ids from `from` to `to`. */
  path: string[]
  blood: boolean
}

export class Family {
  parents = new Map<string, string[]>()
  children = new Map<string, string[]>()
  spouses = new Map<string, string[]>()
  sex = new Map<string, Sex>()
  private adopted = new Set<string>()
  private step = new Set<string>()

  constructor(g: Graph) {
    for (const p of g.persons) {
      this.sex.set(p.id, p.sex)
      this.parents.set(p.id, [])
      this.children.set(p.id, [])
      this.spouses.set(p.id, [])
    }
    for (const l of g.parentChild) {
      this.parents.get(l.childId)?.push(l.parentId)
      this.children.get(l.parentId)?.push(l.childId)
      if (l.kind === 'adopted') this.adopted.add(`${l.parentId}|${l.childId}`)
      if (l.kind === 'step') this.step.add(`${l.parentId}|${l.childId}`)
    }
    for (const u of g.unions) {
      this.spouses.get(u.aId)?.push(u.bId)
      this.spouses.get(u.bId)?.push(u.aId)
    }
  }

  /** Every ancestor (and the person) with distance and one upward path. */
  ancestors(id: string) {
    const out = new Map<string, string[]>([[id, [id]]])
    let level = [id]
    while (level.length) {
      const next: string[] = []
      for (const cur of level)
        for (const p of this.parents.get(cur) ?? []) {
          if (out.has(p)) continue
          out.set(p, [...out.get(cur)!, p])
          next.push(p)
        }
      level = next
    }
    return out
  }

  private blood(from: string, to: string) {
    const up = this.ancestors(from), down = this.ancestors(to)
    let best: { up: number; down: number; path: string[]; lca: string } | null = null
    for (const [anc, pa] of up) {
      const pb = down.get(anc)
      if (!pb) continue
      const score = pa.length + pb.length
      if (!best || score < best.up + best.down + 2)
        best = { up: pa.length - 1, down: pb.length - 1, lca: anc, path: [...pa, ...pb.slice(0, -1).reverse()] }
    }
    return best
  }

  /** Siblings with only one shared parent are half-siblings. */
  private isHalf(a: string, b: string) {
    const pa = this.parents.get(a) ?? [], pb = this.parents.get(b) ?? []
    return pa.filter((p) => pb.includes(p)).length === 1 && (pa.length > 1 || pb.length > 1)
  }

  private pathIsAdopted(path: string[]) {
    return path.some((id, i) => i > 0 && (this.adopted.has(`${id}|${path[i - 1]}`) || this.adopted.has(`${path[i - 1]}|${id}`)))
  }

  relation(from: string, to: string, lang: Lang = 'ru'): Kin | null {
    if (from === to) return null
    const T = lang === 'en' ? EN : RU
    const s = this.sex.get(to) ?? 'U'
    const b = this.blood(from, to)
    if (b) {
      let label = T.blood(b.up, b.down, s, b.up === 1 && b.down === 1 && this.isHalf(from, to))
      if (this.pathIsAdopted(b.path)) label = T.adopted(label, s)
      else if (this.step.has(`${to}|${from}`)) label = T.stepParent(s)
      else if (this.step.has(`${from}|${to}`)) label = T.stepChild(s)
      return { label, path: b.path, blood: true }
    }
    const spouses = this.spouses.get(from) ?? []
    if (spouses.includes(to)) return { label: T.spouse(s), path: [from, to], blood: false }

    // A parent's spouse who is not a parent: stepparent. A spouse's child: stepchild.
    for (const p of this.parents.get(from) ?? [])
      if ((this.spouses.get(p) ?? []).includes(to)) return { label: T.stepParent(s), path: [from, p, to], blood: false }
    for (const sp of spouses)
      if ((this.parents.get(to) ?? []).includes(sp)) return { label: T.stepChild(s), path: [from, sp, to], blood: false }

    // Through my spouse: their parents and siblings.
    for (const sp of spouses) {
      const via = this.blood(sp, to)
      if (!via) continue
      const key = `${via.up},${via.down}`
      const named = T.inLawViaSpouse(key, this.sex.get(from) ?? 'U', this.sex.get(sp) ?? 'U', s)
      if (named) return { label: named, path: [from, ...via.path], blood: false }
      return { label: T.spouseKin(T.blood(via.up, via.down, s, false), this.sex.get(sp) ?? 'U'), path: [from, ...via.path], blood: false }
    }
    // Through the other person's spouse: my child's or sibling's spouse.
    for (const sp of this.spouses.get(to) ?? []) {
      const via = this.blood(from, sp)
      if (!via) continue
      const named = T.inLawOfKin(`${via.up},${via.down}`, s)
      if (named) return { label: named, path: [...via.path, to], blood: false }
      return { label: T.kinSpouse(T.blood(via.up, via.down, this.sex.get(sp) ?? 'U', false), s), path: [...via.path, to], blood: false }
    }
    return null
  }

  /** Terms for everyone relative to one person. */
  relatives(from: string, lang: Lang = 'ru') {
    const out = new Map<string, Kin>()
    for (const id of this.parents.keys()) {
      const k = this.relation(from, id, lang)
      if (k) out.set(id, k)
    }
    return out
  }
}

const g = (s: Sex, m: string, f: string, n = `${m}/${f}`) => (s === 'M' ? m : s === 'F' ? f : n)
const ordinal = ['', '', 'двоюродн', 'троюродн', 'четвероюродн', 'пятиюродн', 'шестиюродн', 'семиюродн', 'восьмиюродн']
const degree = (n: number, s: Sex) => {
  const stem = ordinal[n] ?? `${n}-юродн`
  return stem + g(s, 'ый', 'ая', 'ый')
}
const pra = (n: number) => 'пра'.repeat(Math.max(0, n))

const GENITIVE: Record<string, string> = { отец: 'отца', мать: 'матери', дочь: 'дочери', ребёнок: 'ребёнка' }
/** Kin terms are a closed vocabulary, so these endings cover all of them. */
const genitiveWord = (w: string) => GENITIVE[w] ?? (
  /ый$/.test(w) ? w.replace(/ый$/, 'ого')
    : /ая$/.test(w) ? w.replace(/ая$/, 'ой')
    : /[кгхжчшщ]а$/.test(w) || /я$/.test(w) ? w.slice(0, -1) + 'и'
    : /а$/.test(w) ? w.slice(0, -1) + 'ы'
    : /ь$/.test(w) ? w.slice(0, -1) + 'я'
    : w + 'а')
export const genitive = (term: string) => term.split(/([ /])/).map((w) => (/^[ /]$/.test(w) ? w : genitiveWord(w))).join('')

const RU = {
  blood(up: number, down: number, s: Sex, half: boolean): string {
    if (down === 0) {
      if (up === 1) return g(s, 'отец', 'мать', 'родитель')
      if (up === 2) return g(s, 'дед', 'бабушка', 'дед/бабушка')
      return pra(up - 2) + g(s, 'дед', 'бабушка', 'дед/бабушка')
    }
    if (up === 0) {
      if (down === 1) return g(s, 'сын', 'дочь', 'ребёнок')
      return pra(down - 2) + g(s, 'внук', 'внучка', 'внук/внучка')
    }
    if (up === down) {
      const base = g(s, 'брат', 'сестра')
      if (up === 1) return half ? `${g(s, 'сводный', 'сводная', 'сводный')} ${base}` : base
      return `${degree(up, s)} ${base}`
    }
    if (up > down) {
      // Aunt/uncle line: the other person is older by generations.
      const gen = up - down
      if (gen === 1) return (down === 1 ? '' : `${degree(down, s)} `) + g(s, 'дядя', 'тётя')
      return `${degree(down + 1, s)} ${pra(gen - 2)}${g(s, 'дед', 'бабушка', 'дед/бабушка')}`
    }
    const gen = down - up
    if (gen === 1) return (up === 1 ? '' : `${degree(up, s)} `) + g(s, 'племянник', 'племянница')
    const prefix = up > 1 ? `${degree(up, s)} ` : ''
    return `${prefix}${pra(gen - 2)}внучат${g(s, 'ый', 'ая', 'ый')} ${g(s, 'племянник', 'племянница')}`
  },
  adopted: (label: string, s: Sex) => `${g(s, 'приёмный', 'приёмная', 'приёмный')} ${label}`,
  spouse: (s: Sex) => g(s, 'муж', 'жена', 'супруг'),
  stepParent: (s: Sex) => g(s, 'отчим', 'мачеха'),
  stepChild: (s: Sex) => g(s, 'пасынок', 'падчерица'),
  inLawViaSpouse(key: string, me: Sex, spouse: Sex, s: Sex) {
    if (key === '1,0') return spouse === 'M' ? g(s, 'свёкор', 'свекровь') : g(s, 'тесть', 'тёща')
    if (key === '1,1') return spouse === 'M' ? g(s, 'деверь', 'золовка') : g(s, 'шурин', 'свояченица')
    return null
  },
  inLawOfKin(key: string, s: Sex) {
    if (key === '0,1') return g(s, 'зять', 'невестка')
    if (key === '1,1') return g(s, 'зять', 'невестка')
    return null
  },
  spouseKin: (term: string, spouse: Sex) => `${term} ${g(spouse, 'мужа', 'жены', 'супруга')}`,
  kinSpouse: (term: string, s: Sex) => `${g(s, 'муж', 'жена', 'супруг')} ${genitive(term)}`,
}

const pick = (s: Sex, m: string, f: string, n: string) => (s === 'M' ? m : s === 'F' ? f : n)
const EN = {
  blood(up: number, down: number, s: Sex, half: boolean): string {
    const greats = (n: number) => (n > 0 ? 'great-'.repeat(n) : '')
    if (down === 0) return up === 1 ? pick(s, 'father', 'mother', 'parent') : greats(up - 2) + pick(s, 'grandfather', 'grandmother', 'grandparent')
    if (up === 0) return down === 1 ? pick(s, 'son', 'daughter', 'child') : greats(down - 2) + pick(s, 'grandson', 'granddaughter', 'grandchild')
    if (up === 1 && down === 1) return (half ? 'half-' : '') + pick(s, 'brother', 'sister', 'sibling')
    if (down === 1) return greats(up - 2) + pick(s, 'uncle', 'aunt', 'uncle/aunt')
    if (up === 1) return greats(down - 2) + pick(s, 'nephew', 'niece', 'nephew/niece')
    const deg = Math.min(up, down) - 1, removed = Math.abs(up - down)
    const ords = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth']
    return `${ords[deg] ?? `${deg}th`} cousin${removed ? ` ${removed === 1 ? 'once' : removed === 2 ? 'twice' : `${removed} times`} removed` : ''}`
  },
  adopted: (label: string) => `adoptive ${label}`,
  spouse: (s: Sex) => pick(s, 'husband', 'wife', 'spouse'),
  stepParent: (s: Sex) => pick(s, 'stepfather', 'stepmother', 'stepparent'),
  stepChild: (s: Sex) => pick(s, 'stepson', 'stepdaughter', 'stepchild'),
  inLawViaSpouse(key: string, _me: Sex, _sp: Sex, s: Sex) {
    if (key === '1,0') return pick(s, 'father-in-law', 'mother-in-law', 'parent-in-law')
    if (key === '1,1') return pick(s, 'brother-in-law', 'sister-in-law', 'sibling-in-law')
    return null
  },
  inLawOfKin(key: string, s: Sex) {
    if (key === '0,1') return pick(s, 'son-in-law', 'daughter-in-law', 'child-in-law')
    if (key === '1,1') return pick(s, 'brother-in-law', 'sister-in-law', 'sibling-in-law')
    return null
  },
  spouseKin: (term: string, spouse: Sex) => `${pick(spouse, "husband's", "wife's", "spouse's")} ${term}`,
  kinSpouse: (term: string, s: Sex) => `${term}'s ${pick(s, 'husband', 'wife', 'spouse')}`,
}

/** "ваш прадед" / "ваша бабушка". */
export function yourTerm(label: string, sex: Sex, lang: Lang) {
  if (lang === 'en') return `your ${label}`
  if (/^(муж|жена|супруг) /.test(label)) return label
  return `${sex === 'F' ? 'ваша' : 'ваш'} ${label}`
}
