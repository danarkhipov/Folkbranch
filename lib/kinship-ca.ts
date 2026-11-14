// Catalan kinship terms (central standard, IEC spelling: net, besnet without the old accent).
// The contract is lib/kinship-words.ts; tests/kinship-es-ca.test.ts says what each must answer.
//
// The words are the DIEC's (dlc.iec.cat). Ancestors: pare, avi, besavi, rebesavi, quadravi, then a count with the quadravi
// as the fourth: cinquè avi… desè avi, 11è avi. Descendants the same way: fill, net, besnet, rebesnet, quadrinet, cinquè net…
// Collaterals: germà, germanastre (one parent shared: the DIEC's first sense), cosí germà, cosí segon…; oncle, besoncle,
// rebesoncle (a great-grandparent's brother), then "germà del rebesavi"; nebot, besnebot (= renebot), rebesnebot, then
// "rebesnet del germà". A cousin a generation away carries the cousin's ordinal: oncle segon (a parent's first cousin),
// nebot segon (a first cousin's child).
import type { KinWords } from './kinship-words'
import type { Sex } from './types'

type MF = 'M' | 'F'

/** The man's term, the woman's, or both for a person whose sex is not known (or one neutral word when there is one). */
const both = (s: Sex, term: (x: MF) => string, neutral?: string) =>
  s === 'M' || s === 'F' ? term(s) : neutral ?? `${term('M')}/${term('F')}`

const ORD_M = ['', 'primer', 'segon', 'tercer', 'quart', 'cinquè', 'sisè', 'setè', 'vuitè', 'novè', 'desè']
const ORD_F = ['', 'primera', 'segona', 'tercera', 'quarta', 'cinquena', 'sisena', 'setena', 'vuitena', 'novena', 'desena']
/** Ordinals in words up to the tenth, then as figures: 11è, 11a. */
const ord = (n: number, x: MF) => (x === 'F' ? ORD_F[n] ?? `${n}a` : ORD_M[n] ?? `${n}è`)

const UP: [string, string][] = [['', ''], ['pare', 'mare'], ['avi', 'àvia'], ['besavi', 'besàvia'], ['rebesavi', 'rebesàvia'], ['quadravi', 'quadràvia']]
const DOWN: [string, string][] = [['', ''], ['fill', 'filla'], ['net', 'neta'], ['besnet', 'besneta'], ['rebesnet', 'rebesneta'], ['quadrinet', 'quadrineta']]
const UNCLE: [string, string][] = [['', ''], ['oncle', 'tia'], ['besoncle', 'bestia'], ['rebesoncle', 'rebestia']]
const NEPHEW: [string, string][] = [['', ''], ['nebot', 'neboda'], ['besnebot', 'besneboda'], ['rebesnebot', 'rebesneboda']]
const pick = (row: [string, string], x: MF) => row[x === 'M' ? 0 : 1]

/** n generations up: pare, avi, besavi, rebesavi, quadravi, cinquè avi… */
const anc = (n: number, x: MF) => (UP[n] ? pick(UP[n], x) : `${ord(n - 1, x)} ${x === 'M' ? 'avi' : 'àvia'}`)
/** n generations down: fill, net, besnet, rebesnet, quadrinet, cinquè net… */
const desc = (n: number, x: MF) => (DOWN[n] ? pick(DOWN[n], x) : `${ord(n - 1, x)} ${x === 'M' ? 'net' : 'neta'}`)
/** Same generation, sharing an ancestor c generations up: germà, cosí germà, cosí segon… */
const kin = (c: number, x: MF) => (c === 1 ? pick(['germà', 'germana'], x) : c === 2 ? pick(['cosí germà', 'cosina germana'], x) : `${pick(['cosí', 'cosina'], x)} ${ord(c - 1, x)}`)

/** Starts with a vowel sound, so "el", "la" and "de" take an apostrophe: l'oncle, de l'àvia, de l'11è avi (onzè). */
const vowel = (w: string) => /^(?:[aeiouàèéíïòóúü]|h[aeiouàèéíòóú]|11(?!\d))/i.test(w)
/** "del cosí", "de la cosina", "de l'oncle", "de l'esposa". */
const de = (x: MF, w: string) => (vowel(w) ? `de l'${w}` : x === 'M' ? `del ${w}` : `de la ${w}`)
/** "el cosí", "la cosina", "l'oncle". */
const the = (x: MF, w: string) => (vowel(w) ? `l'${w}` : x === 'M' ? `el ${w}` : `la ${w}`)

export const CA: KinWords = {
  blood(up, down, s, half) {
    const term = (x: MF): string => {
      if (down === 0) return anc(up, x)
      if (up === 0) return desc(down, x)
      if (up === 1 && down === 1 && half) return pick(['germanastre', 'germanastra'], x)
      if (up === down) return kin(up, x)
      if (up > down) {
        // The sibling or cousin of my ancestor `k` generations up.
        const k = up - down
        if (UNCLE[k]) return down === 1 ? pick(UNCLE[k], x) : `${pick(UNCLE[k], x)} ${ord(down, x)}`
        return `${kin(down, x)} ${de('M', anc(k, 'M'))}`
      }
      // The descendant, `k` generations down, of my sibling or cousin.
      const k = down - up
      if (NEPHEW[k]) return up === 1 ? pick(NEPHEW[k], x) : `${pick(NEPHEW[k], x)} ${ord(up, x)}`
      return `${desc(k, x)} ${de('M', kin(up, 'M'))}`
    }
    return both(s, term, down === 0 && up === 1 ? 'progenitor' : undefined)
  },
  adopted(label, s) {
    const parts = label.split('/')
    if (s !== 'M' && s !== 'F' && parts.length === 2) return `${parts[0]} adoptiu/${parts[1]} adoptiva`
    return `${label} ${s === 'F' ? 'adoptiva' : 'adoptiu'}`
  },
  spouse: (s) => both(s, (x) => pick(['espòs', 'esposa'], x), 'cònjuge'),
  stepParent: (s) => both(s, (x) => pick(['padrastre', 'madrastra'], x)),
  stepChild: (s) => both(s, (x) => pick(['fillastre', 'fillastra'], x)),
  inLawViaSpouse(key, _me, _spouse, s) {
    if (key === '1,0') return both(s, (x) => pick(['sogre', 'sogra'], x))
    if (key === '1,1') return both(s, (x) => pick(['cunyat', 'cunyada'], x))
    return null
  },
  inLawOfKin(key, s) {
    if (key === '0,1') return both(s, (x) => pick(['gendre', 'nora'], x))
    if (key === '1,1') return both(s, (x) => pick(['cunyat', 'cunyada'], x))
    return null
  },
  // A relative of unknown sex comes as "cosí/cosina": each half gets the whole phrase, so your() can split it again.
  spouseKin: (term, spouse) => term.split('/').map((t) => `${t} ${spouse === 'M' ? de('M', 'espòs') : spouse === 'F' ? de('F', 'esposa') : de('M', 'cònjuge')}`).join('/'),
  kinSpouse(term, s, via) {
    const parts = term.split('/')
    const who = both(s, (x) => pick(['espòs', 'esposa'], x), 'cònjuge')
    if (parts.length === 2 && via !== 'M' && via !== 'F') return `${who} ${de('M', parts[0])}/${who} ${de('F', parts[1])}`
    return `${who} ${de(via === 'F' ? 'F' : 'M', term)}`
  },
  your(label, s): string {
    // "avi/àvia" (sex not known) or "esposa del cosí/esposa de la cosina" (the relative's sex not known): each half takes
    // its own possessive, "el teu avi/la teva àvia". A neutral word (cònjuge, progenitor) keeps "el".
    const parts = label.split('/')
    if (parts.length === 2) {
      const sexOf = (i: number, p: string): Sex => (s === 'M' || s === 'F' ? s : /^(cònjuge|progenitor)\b/.test(p) ? 'M' : i === 0 ? 'M' : 'F')
      return parts.map((p, i) => CA.your(p, sexOf(i, p))).join('/')
    }
    // A phrase ("esposa de l'oncle", "cosí germà de l'esposa"): the possessive goes on the last relative, the one nearest
    // to the reader, and the first takes the article: "l'esposa del teu oncle", "el cosí germà de la teva esposa".
    const m = /^(.*) (del |de la |de l')(.+)$/.exec(label)
    if (m) {
      const [, head, link, tail] = m
      const tailF = link === 'de la ' || (link === "de l'" && /a$/.test(tail.split(' ')[0]))
      return `${the(s === 'F' ? 'F' : 'M', head)} ${tailF ? 'de la teva' : 'del teu'} ${tail}`
    }
    return `${s === 'F' ? 'la teva' : 'el teu'} ${label}`
  },
}
