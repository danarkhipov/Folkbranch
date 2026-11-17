// Dates that cannot be right, said where they are typed, as genealogy programs' consistency checks do: a year still to
// come, a death before the birth, an event before someone was born or long after they died. Only what is certainly
// wrong is called wrong; the person decides, and a slip of one digit gets a one-press fix.
import { yearOf } from './types'

export type DateProblemKind = 'future' | 'death-before-birth' | 'before-birth' | 'after-death' | 'too-old'
export interface DateProblem { kind: DateProblemKind; year: number; /** The date with the likely slip mended, when there is one. */ fix?: string }

/** Older than anyone has lived: an event this long after a birth is about someone else, or a slip. */
export const MAX_AGE = 120
/** Kinds that may follow a death: burial, a will, an estate, in the archive's languages. */
const AFTER_DEATH = /burial|buried|probate|will|testament|estate|похор|погреб|завещ|наслед|entierro|enterrament|sepult|sepel|testam|sucesi|herencia/i

/** The years a date names, in order: "1941–1944" gives both, "03.04.1921" gives 1921. */
const yearsIn = (date: string) => [...(date ?? '').matchAll(/(?<!\d)(\d{4})(?!\d)/g)].map((m) => Number(m[1]))

/**
 * What is wrong with one date of a life, if anything. `field` says which date it is; `born` and `died` are the life's
 * own years, when known; `what` is a fact's kind, so a burial may come after the death.
 */
export function dateProblem(date: string, field: 'birth' | 'death' | 'fact', life: { born: number | null; died: number | null; what?: string }, now = new Date().getFullYear()): DateProblem | null {
  const year = yearOf(date ?? '')
  if (year === null || year < 1000) return null
  // A year to come is a typing slip far more often than a plan: 2034 for 1934. The fix offered keeps the rest of the
  // date and goes back a century, when that lands inside the life (or the life is not known).
  const future = yearsIn(date).find((y) => y > now)
  if (future !== undefined) {
    const back = future - 100
    const fits = (life.born === null || back >= life.born) && (life.died === null || back <= life.died)
    return { kind: 'future', year: future, ...(fits ? { fix: date.replace(String(future), String(back)) } : {}) }
  }
  const { born, died } = life
  if (field === 'death' && born !== null && year < born) return { kind: 'death-before-birth', year }
  if (field === 'birth' && died !== null && year > died) return { kind: 'death-before-birth', year }
  if (field === 'fact') {
    if (born !== null && year < born) return { kind: 'before-birth', year }
    if (died !== null && year > died && !AFTER_DEATH.test(life.what ?? '')) return { kind: 'after-death', year }
  }
  if (field !== 'birth' && born !== null && year - born > MAX_AGE) return { kind: 'too-old', year }
  return null
}

/** The words for a problem, in the source language; the caller translates them. */
export const DATE_PROBLEM_TEXT: Record<DateProblemKind, string> = {
  future: 'этот год ещё не наступил',
  'death-before-birth': 'смерть раньше рождения',
  'before-birth': 'раньше рождения человека',
  'after-death': 'позже смерти человека',
  'too-old': 'человеку было бы больше 120 лет',
}
