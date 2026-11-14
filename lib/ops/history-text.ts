import { translate } from '../i18n'
import { LANGS } from '../languages'
import type { HistoryEntry } from '../types'
import { say } from './app-config'
import { FIELD } from './people'

type Row = Record<string, unknown>
interface Change { table: string; id: string; before: Row | null; after: Row | null }

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
const relationWords = (row: Row | null) => [KIND[String(row?.kind)], CERTAIN[String(row?.certainty)]].filter(Boolean).map((k) => say(k)).join(', ')
const isRelation = (c: Change) => c.table === 'parentChild' || c.table === 'unions'
const ends = (row: Row | null) => (row ? ('parentId' in row ? [row.parentId, row.childId] : [row.aId, row.bId]).map(String) : [])

/** The line in the history: what happened, with names, whichever way it was stored. */
export function readableSummary(summary: string, changes: Change[], nameOf: (id: string) => string, original?: string, relationEnds?: (id: string) => string[]) {
  if (original !== undefined) return `${say('Отменено')}: ${original}`
  if (words('Связь').some((w) => summary.startsWith(`${w}:`))) {
    const c = changes.find(isRelation)
    // A change keeps only the fields that moved, so the two people may have to be looked up.
    const who = c ? (ends(c.after).some((id) => id !== 'undefined') ? ends(c.after) : (relationEnds?.(c.id) ?? [])) : []
    return who.length ? `${say('Изменено родство')}: ${who.map(nameOf).join(' — ')}` : say('Изменено родство')
  }
  if (summary.includes(' — ') && changes.length > 0 && changes.every((c) => !c.before)) return `${say('Новая связь')}: ${summary}`
  for (const [command, result] of DONE) for (const w of words(command)) if (summary.startsWith(`${w}:`)) return `${say(result)}:${summary.slice(w.length + 1)}`
  return summary
}

const titles = (raw: unknown) => {
  try { return (JSON.parse(String(raw)) as { title?: string }[]).map((s) => s.title ?? '').filter(Boolean) } catch { return [] }
}

/** What exactly changed. Long texts and lists are named, not repeated: they can hold whole pages. */
export function changeDetails(changes: Change[]): NonNullable<HistoryEntry['details']> {
  const out: NonNullable<HistoryEntry['details']> = []
  for (const c of changes) {
    if (!c.before || !c.after) continue
    if (isRelation(c)) {
      const was = relationWords(c.before), now = relationWords(c.after)
      if (was !== now) out.push({ label: say('Родство'), before: was || null, after: now || null })
    }
    if (c.table !== 'persons') continue
    for (const k of Object.keys(FIELD)) {
      if (JSON.stringify(c.before[k]) === JSON.stringify(c.after[k])) continue
      if (k === 'sources') {
        // Which source was added or removed says more than that the list changed.
        const was = titles(c.before[k]), now = titles(c.after[k])
        out.push({ label: say(FIELD[k]), before: short(was.filter((x) => !now.includes(x)).join(', ')), after: short(now.filter((x) => !was.includes(x)).join(', ')) })
        continue
      }
      const plain = PLAIN.includes(k)
      out.push({ label: say(FIELD[k]), before: plain ? short(c.before[k]) : null, after: plain ? short(c.after[k]) : null })
    }
  }
  return out.slice(0, 6)
}
