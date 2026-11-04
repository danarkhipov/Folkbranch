// Files people actually keep their family in. Everything except GEDCOM becomes the text graph
// format, so duplicates, review and undo work the same way for every source. Runs in the browser:
// the file goes no further than the person's own server, and only when they press Import.
import { serializeNameLine } from './textformat'
import { yearOf } from './types'

export type ImportKind = 'gedcom' | 'table' | 'xlsx' | 'json' | 'text'
export type ColumnField = '' | 'id' | 'name' | 'given' | 'patronymic' | 'surname' | 'maiden' | 'sex' | 'birthDate' | 'birthPlace' | 'deathDate' | 'deathPlace' | 'father' | 'mother' | 'spouse'
export type Mapping = ColumnField[]

export const COLUMN_FIELDS: [ColumnField, string][] = [
  ['', 'не загружать'], ['name', 'Имя целиком'], ['given', 'Имя'], ['patronymic', 'Отчество'], ['surname', 'Фамилия'], ['maiden', 'Девичья фамилия'], ['sex', 'Пол'],
  ['birthDate', 'Дата рождения'], ['birthPlace', 'Место рождения'], ['deathDate', 'Дата смерти'], ['deathPlace', 'Место смерти'],
  ['father', 'Отец'], ['mother', 'Мать'], ['spouse', 'Супруг'], ['id', 'Номер строки (id)'],
]

export function detectKind(fileName: string, head: string): ImportKind {
  const ext = fileName.toLowerCase().split('.').pop() ?? ''
  if (ext === 'xlsx') return 'xlsx'
  if (ext === 'ged' || ext === 'gedcom' || /^﻿?\s*0\s+HEAD/.test(head)) return 'gedcom'
  if (ext === 'json') return 'json'
  if (ext === 'csv' || ext === 'tsv') return 'table'
  if (/^﻿?\s*[[{]/.test(head)) return 'json'
  const first = head.replace(/^﻿/, '').split(/\r?\n/)[0]
  if (!/^family\b/i.test(first) && (first.split(/[;\t]/).length > 2 || first.split(',').length > 2) && !/\b(b|d|sex): /.test(first)) return 'table'
  return 'text'
}

/** Comma, semicolon (Russian Excel) or tab, whichever the first line uses most; quotes as in RFC 4180. */
export function parseCsv(source: string): string[][] {
  const text = source.replace(/^﻿/, '')
  const firstLine = text.split(/\r?\n/)[0]
  const sep = [',', ';', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0]
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"' && !cell) quoted = true
    else if (c === sep) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      rows.push(row); row = []
    } else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((x) => x.trim()))
}

const HEADERS: [ColumnField, RegExp][] = [
  ['id', /^(id|№|n|no|номер|код|ключ|person.?id)$/],
  ['father', /(отец|отца|father|dad)/],
  ['mother', /(мать|матер|mother|mom)/],
  ['spouse', /(супруг|жена|муж|spouse|wife|husband|partner)/],
  ['maiden', /(девич|maiden)/],
  ['patronymic', /(отчеств|patronym|middle)/],
  ['birthPlace', /((рожд|родил|birth|born).*(мест|plac)|(мест|plac).*(рожд|родил|birth|born))/],
  ['deathPlace', /((смерт|умер|death|died).*(мест|plac)|(мест|plac).*(смерт|умер|death|died))/],
  ['birthDate', /(рожд|родил|birth|born|^г\.?р\.?$|^dob$)/],
  ['deathDate', /(смерт|умер|death|died|^dod$)/],
  ['sex', /^(пол|sex|gender)$/],
  ['surname', /(фамил|surname|last.?name|family.?name)/],
  ['name', /^(фио|ф\.и\.о\.?|full.?name|человек|person)$/],
  ['given', /(^имя$|given|first.?name|^name$)/],
]

/** Each header takes the first field it matches, and a field is used once. */
export function guessMapping(headers: string[]): Mapping {
  const used = new Set<ColumnField>()
  return headers.map((h) => {
    const key = h.trim().toLowerCase().replace(/ё/g, 'е')
    const hit = HEADERS.find(([f, re]) => !used.has(f) && re.test(key))?.[0] ?? ''
    if (hit) used.add(hit)
    return hit
  })
}

const SEX_WORDS: Record<string, string> = { м: 'm', муж: 'm', мужской: 'm', m: 'm', male: 'm', ж: 'f', жен: 'f', женский: 'f', f: 'f', female: 'f' }
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim()
// The text format reads these as its own syntax, so they cannot stay inside a name.
const safeName = (s: string) => clean(s).replace(/:/g, ' ').replace(/ \+ /g, ' и ').replace(/^@/, '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim()
const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е')

interface Row { name: string; attrs: Record<string, string>; father: string; mother: string; spouse: string; id: string }

export interface TableResult { text: string; people: number; warnings: { key: string; detail?: string }[] }

export function rowsToText(rows: string[][], mapping: Mapping, title = ''): TableResult {
  const warnings: TableResult['warnings'] = []
  const parsed: Row[] = []
  for (const r of rows) {
    const cell = (f: ColumnField) => { const i = mapping.indexOf(f); return i < 0 ? '' : clean(r[i]) }
    const name = safeName(cell('name') || [cell('given'), cell('patronymic'), cell('surname')].filter(Boolean).join(' '))
    if (!name) continue
    const birth = cell('birthDate'), death = cell('deathDate')
    parsed.push({
      name, id: cell('id'), father: safeName(cell('father')), mother: safeName(cell('mother')), spouse: safeName(cell('spouse')),
      attrs: { b: birth, bp: cell('birthPlace'), d: death, dp: cell('deathPlace'), sex: SEX_WORDS[norm(cell('sex'))] ?? '', maiden: safeName(cell('maiden')) },
    })
  }
  // A cell may name a relative or give the number of their row.
  const byId = new Map(parsed.filter((p) => p.id).map((p) => [p.id, p.name]))
  const resolve = (v: string) => byId.get(v) ?? v
  const counts = new Map<string, number>()
  for (const p of parsed) counts.set(norm(p.name), (counts.get(norm(p.name)) ?? 0) + 1)
  const repeated = [...counts].filter(([, n]) => n > 1).length
  if (repeated) warnings.push({ key: 'Одинаковые имена в файле будут считаться одним человеком', detail: String(repeated) })

  const people = new Map<string, { name: string; attrs: Record<string, string> }>()
  const touch = (name: string, sex = '') => {
    const k = norm(name)
    const p = people.get(k) ?? { name, attrs: {} }
    if (sex && !p.attrs.sex) p.attrs.sex = sex
    people.set(k, p)
  }
  for (const p of parsed) {
    touch(p.name)
    const cur = people.get(norm(p.name))!
    for (const [k, v] of Object.entries(p.attrs)) if (v && !cur.attrs[k]) cur.attrs[k] = v
  }
  const parents = new Map<string, Set<string>>()
  const unions = new Map<string, [string, string]>()
  const single = (name: string) => !name.includes(' ')
  for (const p of parsed) {
    const father = resolve(p.father), mother = resolve(p.mother), spouse = resolve(p.spouse)
    if (father) touch(father, 'm')
    if (mother) touch(mother, 'f')
    if (spouse) touch(spouse)
    const ps = [father, mother].filter(Boolean)
    if (ps.length) parents.set(p.name, new Set([...(parents.get(p.name) ?? []), ...ps]))
    if (spouse && norm(spouse) !== norm(p.name)) unions.set([norm(p.name), norm(spouse)].sort().join('|'), [p.name, spouse])
  }
  const bad = [...people.values()].filter((p) => single(p.name)).length
  if (bad) warnings.push({ key: 'Имя без фамилии проще спутать с другим человеком', detail: String(bad) })

  const lines = [`family ${title}`.trim(), '']
  const ordered = [...people.values()].sort((a, b) => (yearOf(a.attrs.b ?? '') ?? 9999) - (yearOf(b.attrs.b ?? '') ?? 9999))
  for (const p of ordered) lines.push(serializeNameLine(p.name, p.attrs))
  lines.push('')
  const families = new Map<string, { parents: string[]; children: string[] }>()
  for (const [child, set] of parents) {
    const ps = [...set].slice(0, 2)
    const key = ps.map(norm).sort().join('|')
    const f = families.get(key) ?? { parents: ps, children: [] }
    f.children.push(child)
    families.set(key, f)
  }
  const seen = new Set<string>()
  for (const [key, pair] of unions) {
    seen.add(key)
    lines.push(`${pair[0]} + ${pair[1]}`)
    families.get(key)?.children.forEach((c) => lines.push(`  ${c}`))
  }
  for (const [key, f] of families) {
    if (seen.has(key)) continue
    lines.push(f.parents.join(' + '))
    f.children.forEach((c) => lines.push(`  ${c}`))
  }
  return { text: lines.join('\n').trimEnd() + '\n', people: people.size, warnings }
}

/** A list of records, or {persons: [...]} as this app's own API gives them. Anything else is refused. */
export function jsonToTable(source: string): { headers: string[]; rows: string[][] } | null {
  let data: unknown
  try { data = JSON.parse(source.replace(/^﻿/, '')) } catch { return null }
  const list = Array.isArray(data) ? data : (data as { persons?: unknown; people?: unknown })?.persons ?? (data as { people?: unknown })?.people
  if (!Array.isArray(list) || !list.length || typeof list[0] !== 'object') return null
  const graph = data as { parentChild?: { parentId: string; childId: string }[]; unions?: { aId: string; bId: string }[] }
  const records = (list as Record<string, unknown>[]).map((r) => ({ ...r }))
  // This app's own shape keeps links apart from people; put them back into columns.
  if (Array.isArray(graph.parentChild) || Array.isArray(graph.unions)) {
    const byId = new Map(records.map((r) => [String(r.id), r]))
    for (const l of graph.parentChild ?? []) {
      const child = byId.get(l.childId), parent = byId.get(l.parentId)
      if (!child || !parent) continue
      child[parent.sex === 'F' ? 'mother' : child.father ? 'mother' : 'father'] = l.parentId
    }
    for (const u of graph.unions ?? []) { const a = byId.get(u.aId); if (a) a.spouse = u.bId }
  }
  const headers = [...new Set(records.flatMap((r) => Object.keys(r).filter((k) => r[k] === null || typeof r[k] !== 'object')))]
  return { headers, rows: records.map((r) => headers.map((h) => clean(r[h]))) }
}

/** Excel gives dates as Date objects and numbers as numbers; the archive keeps free text. */
export function sheetCell(v: unknown): string {
  if (v instanceof Date) {
    const d = String(v.getUTCDate()).padStart(2, '0'), m = String(v.getUTCMonth() + 1).padStart(2, '0')
    return `${d}.${m}.${v.getUTCFullYear()}`
  }
  return clean(v)
}
