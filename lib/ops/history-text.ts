import { translate } from '../i18n'
import { LANGS } from '../languages'
import type { HistoryEntry } from '../types'
import { tell } from './app-config'
import { FIELD } from './people'

type Row = Record<string, unknown>
interface Change { table: string; id: string; before: Row | null; after: Row | null }
type NameOf = (id: string) => string

/** Stored as a command; read as what happened. Older entries are in the archive's language of the day, so both are matched. */
const DONE: [string, string][] = [['Добавить', 'Добавлен человек'], ['Удалить человека', 'Удалён человек'], ['Удалить связь', 'Удалена связь'], ['Удалить', 'Удалено'], ['Изменить сразу', 'Изменено сразу']]
const KIND: Record<string, string> = { birth: 'родной', adopted: 'приёмный', step: 'отчим или мачеха', marriage: 'брак', civil: 'гражданский' }
const CERTAIN: Record<string, string> = { documented: 'по документу', family: 'со слов семьи', assumed: 'предположение' }
const PLAIN = ['givenName', 'surname', 'maidenName', 'patronymic', 'birthDate', 'birthPlace', 'deathDate', 'deathPlace']
const LONGEST = 60

const words = (key: string) => [...new Set(LANGS.map((l) => translate(l, key)))]
const short = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null
  const s = String(v)
  return s.length > LONGEST ? `${s.slice(0, LONGEST)}…` : s
}
const relationWords = (row: Row | null) => [KIND[String(row?.kind)], CERTAIN[String(row?.certainty)]].filter(Boolean).map((k) => tell(k)).join(', ')
const isRelation = (c: Change) => c.table === 'parentChild' || c.table === 'unions'
const ends = (row: Row | null) => (row ? ('parentId' in row ? [row.parentId, row.childId] : 'aId' in row ? [row.aId, row.bId] : []).map(String) : [])
const rowName = (row: Row | null) => (row ? [row.givenName, row.surname].filter(Boolean).join(' ').trim() : '')

/** The line in the history: what happened, with names, whichever way it was stored. */
export function readableSummary(summary: string, changes: Change[], nameOf: NameOf, original?: string, relationEnds?: (id: string) => string[]) {
  if (original !== undefined) return `${tell('Отменено')}: ${original}`
  if (words('Связь').some((w) => summary.startsWith(`${w}:`))) {
    const c = changes.find(isRelation)
    // A change keeps only the fields that moved, so the two people may have to be looked up.
    const who = c ? (ends(c.after).some((id) => id !== 'undefined') ? ends(c.after) : (relationEnds?.(c.id) ?? [])) : []
    return who.length ? `${tell('Изменено родство')}: ${who.map(nameOf).join(' — ')}` : tell('Изменено родство')
  }
  if (summary.includes(' — ') && changes.length > 0 && changes.every((c) => !c.before)) return `${tell('Новая связь')}: ${summary}`
  for (const [command, result] of DONE) for (const w of words(command)) if (summary.startsWith(`${w}:`)) return `${tell(result)}:${summary.slice(w.length + 1)}`
  return summary
}

const titles = (raw: unknown) => {
  try { return (JSON.parse(String(raw)) as { title?: string }[]).map((s) => s.title ?? '').filter(Boolean) } catch { return [] }
}

/** The people an entry added, changed or removed, in the order they first appear. */
export function changedPeople(changes: Change[], nameOf: NameOf): NonNullable<HistoryEntry['people']> {
  const out = new Map<string, NonNullable<HistoryEntry['people']>[number]>()
  for (const c of changes) {
    if (c.table !== 'persons') continue
    const change = !c.before ? 'added' : !c.after ? 'removed' : 'updated'
    const known = out.get(c.id)
    if (known) {
      // A person touched twice in one entry is still one person; what happened to them first is the plainest word.
      if (known.change === 'updated' && change !== 'updated') known.change = change
      continue
    }
    out.set(c.id, { id: c.id, name: rowName(c.after ?? c.before) || nameOf(c.id), change })
  }
  return [...out.values()]
}

/** What exactly changed. Long texts and lists are named, not repeated: they can hold whole pages. */
export function changeDetails(changes: Change[], nameOf: NameOf = () => '', relationEnds?: (id: string) => string[]): NonNullable<HistoryEntry['details']> {
  const out: NonNullable<HistoryEntry['details']> = []
  const touched = new Set(changes.filter((c) => c.table === 'persons').map((c) => c.id))
  for (const c of changes) {
    if (isRelation(c)) {
      // A new or removed link says who it joined; an edited one keeps its before and after words.
      const was = relationWords(c.before), now = relationWords(c.after)
      const who = [...ends(c.after), ...ends(c.before)].filter((id, i, all) => id !== 'undefined' && all.indexOf(id) === i)
      const names = (who.length ? who : relationEnds?.(c.id) ?? []).map(nameOf).filter(Boolean)
      if (!c.before) out.push({ label: tell('Добавлена связь'), before: null, after: short(names.join(' — ')) })
      else if (!c.after) out.push({ label: tell('Удалена связь'), before: short(names.join(' — ')), after: null })
      else if (was !== now) out.push({ label: names.length ? `${tell('Родство')} (${names.join(' — ')})` : tell('Родство'), before: was || null, after: now || null })
      continue
    }
    if (c.table !== 'persons' || !c.before || !c.after) continue
    for (const k of Object.keys(FIELD)) {
      if (JSON.stringify(c.before[k]) === JSON.stringify(c.after[k])) continue
      // More than one card in one entry: each line says whose field it is.
      const label = touched.size > 1 ? `${nameOf(c.id)}: ${tell(FIELD[k])}` : tell(FIELD[k])
      if (k === 'sources') {
        // Which source was added or removed says more than that the list changed.
        const was = titles(c.before[k]), now = titles(c.after[k])
        out.push({ label, before: short(was.filter((x) => !now.includes(x)).join(', ')), after: short(now.filter((x) => !was.includes(x)).join(', ')) })
        continue
      }
      const plain = PLAIN.includes(k)
      out.push({ label, before: plain ? short(c.before[k]) : null, after: plain ? short(c.after[k]) : null })
    }
  }
  return out
}
