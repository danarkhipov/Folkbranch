// Spanish kinship terms (Spain). The contract is lib/kinship-words.ts; tests/kinship-es-ca.test.ts says what each must answer.
//
// Ancestors: padre, abuelo, bisabuelo, tatarabuelo, then the genealogists' count with the tatarabuelo as the third:
// cuarto abuelo, quinto abuelo… décimo abuelo, 11.º abuelo. Descendants the same way: hijo, nieto, bisnieto, tataranieto,
// cuarto nieto… (chozno is right for the fourth, but few readers know it).
// Collaterals: hermano, primo hermano, primo segundo…; tío, tío abuelo, tío bisabuelo; sobrino, sobrino nieto, sobrino bisnieto;
// a cousin's line a generation away carries an ordinal: tío segundo (a parent's first cousin), sobrino segundo (a first cousin's
// child), tío abuelo segundo (a grandparent's first cousin).
// In-laws: suegro, cuñado, yerno, nuera; the uncle and nephew lines and the spouse's grandparents take "político":
// tía política (an uncle's wife), tío político (a spouse's uncle), sobrina política, abuela política, nieto político.
// A cousin's spouse and a spouse's cousin stay a phrase: esposo de la prima hermana, primo segundo de la esposa.
// Sex unknown: one neutral word where Spanish has one (progenitor, cónyuge), else both words: "abuelo o abuela".
import type { KinWords } from './kinship-words'
import type { Sex } from './types'

type MF = 'M' | 'F'

/** The man's term, the woman's, or both for a person whose sex is not known (or one neutral word when there is one). */
const both = (s: Sex, term: (x: MF) => string, neutral?: string) =>
  s === 'M' || s === 'F' ? term(s) : neutral ?? `${term('M')} o ${term('F')}`
const pick = (row: [string, string], x: MF) => row[x === 'M' ? 0 : 1]

const ORD_M = ['', 'primero', 'segundo', 'tercero', 'cuarto', 'quinto', 'sexto', 'séptimo', 'octavo', 'noveno', 'décimo']
const ORD_F = ['', 'primera', 'segunda', 'tercera', 'cuarta', 'quinta', 'sexta', 'séptima', 'octava', 'novena', 'décima']
/** Ordinals in words up to the tenth, then as figures: 11.º, 11.ª. Only "cuarto" and above go before a noun, so no "tercer". */
const ord = (n: number, x: MF) => (x === 'F' ? ORD_F[n] ?? `${n}.ª` : ORD_M[n] ?? `${n}.º`)

const UP: [string, string][] = [['', ''], ['padre', 'madre'], ['abuelo', 'abuela'], ['bisabuelo', 'bisabuela'], ['tatarabuelo', 'tatarabuela']]
const DOWN: [string, string][] = [['', ''], ['hijo', 'hija'], ['nieto', 'nieta'], ['bisnieto', 'bisnieta'], ['tataranieto', 'tataranieta']]

/** n generations up: padre, abuelo, bisabuelo, tatarabuelo, cuarto abuelo… */
const anc = (n: number, x: MF) => (UP[n] ? pick(UP[n], x) : `${ord(n - 1, x)} ${x === 'M' ? 'abuelo' : 'abuela'}`)
/** n generations down: hijo, nieto, bisnieto, tataranieto, cuarto nieto… */
const desc = (n: number, x: MF) => (DOWN[n] ? pick(DOWN[n], x) : `${ord(n - 1, x)} ${x === 'M' ? 'nieto' : 'nieta'}`)

function word(up: number, down: number, x: MF, half: boolean): string {
  if (down === 0) return anc(up, x)
  if (up === 0) return desc(down, x)
  if (up === down) {
    if (up === 1) return half ? pick(['medio hermano', 'media hermana'], x) : pick(['hermano', 'hermana'], x)
    return up === 2 ? pick(['primo hermano', 'prima hermana'], x) : `${pick(['primo', 'prima'], x)} ${ord(up - 1, x)}`
  }
  if (up > down) {
    // The uncle's line: tío, tío abuelo, tío bisabuelo…, with the cousin's ordinal when it runs through a cousin.
    const gap = up - down
    const base = gap === 1 ? pick(['tío', 'tía'], x) : `${pick(['tío', 'tía'], x)} ${anc(gap, x)}`
    return down === 1 ? base : `${base} ${ord(down, x)}`
  }
  const gap = down - up
  const base = gap === 1 ? pick(['sobrino', 'sobrina'], x) : `${pick(['sobrino', 'sobrina'], x)} ${desc(gap, x)}`
  return up === 1 ? base : `${base} ${ord(up, x)}`
}

const blood = (up: number, down: number, s: Sex, half: boolean) =>
  both(s, (x) => word(up, down, x, half), up === 1 && down === 0 ? 'progenitor' : undefined)

/** Which steps and sex a term stands for, so a phrase can be built around it ("tío segundo" → his wife is "tía segunda política"). */
let terms: Map<string, [number, number, Sex]> | null = null
const lookUp = (term: string) => {
  if (!terms) {
    terms = new Map()
    for (let up = 0; up <= 24; up++) for (let down = 0; down <= 24; down++) if (up || down)
      for (const s of ['M', 'F', 'U'] as Sex[]) for (const half of [false, true]) terms.set(blood(up, down, s, half), [up, down, s])
  }
  return terms.get(term) ?? null
}

/** Off the cousins' own generation (the uncle and nephew lines, grandparents, grandchildren) an in-law is "político": "tía política". */
const political = (term: string, s?: Sex) => {
  const at = lookUp(term)
  if (!at || at[0] === at[1]) return null
  return both(s ?? at[2], (x) => `${word(at[0], at[1], x, false)} ${x === 'M' ? 'político' : 'política'}`)
}

/** "del primo" / "de la prima" / "del primo o de la prima". */
const ofThe = (term: string) =>
  term.split(' o ').map((t) => ((lookUp(t)?.[2] ?? (/^[^ ]*[aª]( |$)/.test(t) ? 'F' : 'M')) === 'F' ? `de la ${t}` : `del ${t}`)).join(' o ')

const SPOUSE: Record<MF, string> = { M: 'esposo', F: 'esposa' }

export const ES: KinWords = {
  blood,
  adopted: (label, s) =>
    s === 'M' ? `${label} adoptivo` : s === 'F' ? `${label} adoptiva` : label.includes(' o ') ? `${label} por adopción` : `${label} adoptivo`,
  spouse: (s) => both(s, (x) => SPOUSE[x], 'cónyuge'),
  stepParent: (s) => both(s, (x) => pick(['padrastro', 'madrastra'], x)),
  stepChild: (s) => both(s, (x) => pick(['hijastro', 'hijastra'], x)),
  inLawViaSpouse(key, _me, _spouse, s) {
    if (key === '1,0') return both(s, (x) => pick(['suegro', 'suegra'], x))
    if (key === '1,1') return both(s, (x) => pick(['cuñado', 'cuñada'], x))
    return null
  },
  inLawOfKin(key, s) {
    if (key === '0,1') return both(s, (x) => pick(['yerno', 'nuera'], x))
    if (key === '1,1') return both(s, (x) => pick(['cuñado', 'cuñada'], x))
    return null
  },
  spouseKin(term, spouse) {
    // My spouse's uncle, nephew, grandparent: "tío político". Their cousin: "primo hermano de la esposa".
    return political(term) ?? `${term} ${spouse === 'M' ? 'del esposo' : spouse === 'F' ? 'de la esposa' : 'del cónyuge'}`
  },
  kinSpouse(term, s) {
    // My uncle's wife: "tía política"; my grandchild's husband: "nieto político". A grandparent's second wife stays
    // "esposa del abuelo", and a cousin's husband "esposo de la prima hermana".
    const at = lookUp(term)
    return (at && at[1] > 0 ? political(term, s) : null) ?? `${both(s, (x) => SPOUSE[x], 'cónyuge')} ${ofThe(term)}`
  },
  your(label, s) {
    // In a phrase "tu" goes on the relative nearest to the reader: "el primo hermano de tu esposa", "el esposo de tu prima".
    const through = label.match(/^(.+) (del esposo|de la esposa|del cónyuge)$/)
    if (through) {
      const who = through[2].replace(/^del? (la )?/, '')
      const term = through[1].split(' o ').map((t, i, all) => `${all.length > 1 ? (i ? 'la' : 'el') : s === 'F' ? 'la' : 'el'} ${t}`).join(' o ')
      return `${term} de tu ${who}`
    }
    const married = label.match(/^(esposo|esposa|cónyuge) (del|de la) (.+)$/)
    if (married) {
      const head = married[1] === 'esposa' ? 'la esposa' : `el ${married[1]}`
      return `${head} ${`${married[2]} ${married[3]}`.replace(/\b(del|de la) /g, 'de tu ')}`
    }
    return `tu ${label}`
  },
}
