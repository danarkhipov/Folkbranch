// What a kind of fact asks for besides when and where, and who can take part in an event. The words are the stored
// keys, shown translated, so an archive keeps the same fields whatever language it is read in.
import type { Fact } from './types'

/** Extra fields a kind of fact asks for: a military record names the unit and the rank. */
export const FACT_FIELDS: Record<string, string[]> = {
  'Воинская служба': ['Часть', 'Звание'],
  'Внешность': ['Рост', 'Глаза', 'Волосы', 'Приметы'],
  'Ранение': ['Какое'],
  'Плен': ['Где содержался'],
  'Награда': ['Название'],
  'Членство': ['Организация'],
}

/** Who else was there: in Russian church books mostly godparents and the priest. */
export const ROLES = ['Крёстный отец', 'Крёстная мать', 'Восприемник', 'Свидетель', 'Священник', 'Поручитель', 'Участник']

/** The role a new participant most likely has, from the kind of event. Spanish and Catalan as whole words. */
export const firstRole = (kind: string, t: (k: string) => string = (k) => k) =>
  /крещ|baptis|christen|\b(?:bautismo|bautizo|bateig)\b/i.test(kind) ? t('Крёстный отец') : /брак|венч|marri|wedding|\b(?:matrimonio?|boda|casamiento|casament|noces)\b/i.test(kind) ? t('Свидетель') : t('Участник')

/** The extra fields for a kind, whether it was written in Russian or in the archive's other language. */
export const fieldsFor = (kind: string, t: (k: string) => string = (k) => k) =>
  Object.entries(FACT_FIELDS).find(([k]) => k === kind || t(k) === kind)?.[1] ?? []

/** Everything a fact says, as one line: for search, print and files that have no place for structure. */
export const factWords = (f: Fact, t: (k: string) => string = (k) => k) => [
  f.note,
  ...Object.entries(f.fields ?? {}).filter(([, v]) => v).map(([k, v]) => `${t(k)}: ${v}`),
  ...(f.people ?? []).filter((p) => p.name).map((p) => `${p.role}: ${p.name}`),
].filter(Boolean).join('; ')
