// Money as the providers state it: a fraction of a cent keeps its digits, a sum shows cents, in the reader's language.
import type { Lang } from '../types'

export const formatMoney = (dollars: number, lang: Lang) =>
  new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD', minimumFractionDigits: dollars > 0 && dollars < 0.01 ? 4 : 2, maximumFractionDigits: dollars > 0 && dollars < 0.01 ? 6 : 2 }).format(dollars)
