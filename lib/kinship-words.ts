// What a language needs to name a relative. lib/kinship.ts works out the steps between two people; a language only names them.
// Russian and English are in lib/kinship.ts. Spanish and Catalan each fill one of these in lib/kinship-es.ts and lib/kinship-ca.ts,
// and tests/kinship-es-ca.test.ts says what each must answer.
import type { Sex } from './types'

export interface KinWords {
  /**
   * A blood relative `up` generations above the shared ancestor from me and `down` below it to them, of sex `s`.
   * (1,0) parent, (2,0) grandparent, (0,1) child, (1,1) sibling (`half` when only one parent is shared),
   * (2,1) uncle or aunt, (1,2) nephew or niece, (2,2) first cousin, (3,2) a parent's first cousin, (2,3) a first cousin's child.
   */
  blood(up: number, down: number, s: Sex, half: boolean): string
  /** An adopted relative: `label` is the blood term already made for sex `s`. */
  adopted(label: string, s: Sex): string
  spouse(s: Sex): string
  stepParent(s: Sex): string
  stepChild(s: Sex): string
  /** A spouse's parent ('1,0') or sibling ('1,1'), if the language has its own word; null makes a phrase with spouseKin. */
  inLawViaSpouse(key: string, me: Sex, spouse: Sex, s: Sex): string | null
  /** A child's spouse ('0,1') or a sibling's spouse ('1,1'), if the language has its own word; null makes a phrase with kinSpouse. */
  inLawOfKin(key: string, s: Sex): string | null
  /** A spouse's relative: `term` is that relative's blood term, `spouse` the sex of my husband or wife. "wife's cousin". */
  spouseKin(term: string, spouse: Sex): string
  /** A relative's spouse, of sex `s`: `term` is the relative's blood term, `via` the relative's sex. "cousin's husband". */
  kinSpouse(term: string, s: Sex, via: Sex): string
  /** "your grandmother": what the chart writes on a card about the person reading it. */
  your(label: string, s: Sex): string
}

/** The man's word, the woman's, or the one for a person whose sex is not known. */
export const bySex = (s: Sex, m: string, f: string, n = `${m}/${f}`) => (s === 'M' ? m : s === 'F' ? f : n)
