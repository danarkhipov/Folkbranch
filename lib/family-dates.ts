// What a family's dates add up to: what is coming up, a life in order, the family in numbers. Dates are free text here,
// so only one written down to the day can come round again.
import { datesIn } from './search/dates'
import { personName, yearOf, type Graph, type Person } from './types'

export type DayKind = 'birthday' | 'birth-memory' | 'death-memory' | 'wedding' | 'wedding-memory'
export interface ComingDay { kind: DayKind; personIds: string[]; month: number; day: number; daysAway: number; years: number }

const DAY = 86_400_000
const shown = (p: Person) => !p.hidden
const fullDate = (text: string) => { const d = datesIn(text).find((x) => x.month && x.day); return d ? { year: d.year, month: d.month!, day: d.day! } : null }

function next(date: { year: number; month: number; day: number }, today: Date) {
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  let year = today.getFullYear()
  let at = Date.UTC(year, date.month - 1, date.day)
  if (at < start) { year += 1; at = Date.UTC(year, date.month - 1, date.day) }
  return { daysAway: Math.round((at - start) / DAY), years: year - date.year }
}

/** The days to remember in the coming weeks, soonest first. Round years are for the reader to notice in the text. */
export function comingDays(graph: Graph, today = new Date(), within = 60): ComingDay[] {
  const out: ComingDay[] = []
  const add = (kind: DayKind, personIds: string[], text: string) => {
    const date = fullDate(text)
    if (!date) return
    const { daysAway, years } = next(date, today)
    if (daysAway <= within && years > 0) out.push({ kind, personIds, month: date.month, day: date.day, daysAway, years })
  }
  const byId = new Map(graph.persons.map((p) => [p.id, p]))
  for (const p of graph.persons.filter(shown)) {
    add(p.living ? 'birthday' : 'birth-memory', [p.id], p.birthDate)
    if (!p.living) add('death-memory', [p.id], p.deathDate)
  }
  for (const u of graph.unions) {
    const a = byId.get(u.aId), b = byId.get(u.bId)
    if (!a || !b || !shown(a) || !shown(b) || u.endDate) continue
    add(a.living && b.living ? 'wedding' : 'wedding-memory', [a.id, b.id], u.startDate)
  }
  return out.sort((x, y) => x.daysAway - y.daysAway)
}

export type LifeKind = 'birth' | 'death' | 'union' | 'child' | 'fact'
export interface LifeEvent { kind: LifeKind; date: string; year: number; age: number | null; title: string; note: string; otherId: string | null }

/** One life in order, from what the card and the family already say. Nothing here is stored or guessed. */
export function lifeEvents(person: Person, graph: Graph): LifeEvent[] {
  const byId = new Map(graph.persons.map((p) => [p.id, p]))
  const born = yearOf(person.birthDate)
  const events: LifeEvent[] = []
  const add = (kind: LifeKind, date: string, title: string, note = '', otherId: string | null = null) => {
    const year = yearOf(date)
    if (year !== null) events.push({ kind, date, year, age: born !== null && year >= born && kind !== 'birth' ? year - born : null, title, note, otherId })
  }
  add('birth', person.birthDate, 'Рождение', person.birthPlace)
  for (const u of graph.unions) {
    if (u.aId !== person.id && u.bId !== person.id) continue
    const other = byId.get(u.aId === person.id ? u.bId : u.aId)
    if (other && shown(other)) add('union', u.startDate, u.kind === 'civil' ? 'Союз' : 'Брак', personName(other), other.id)
  }
  for (const l of graph.parentChild) {
    if (l.parentId !== person.id) continue
    const child = byId.get(l.childId)
    if (child && shown(child)) add('child', child.birthDate, 'Рождение ребёнка', personName(child), child.id)
  }
  for (const f of person.facts) add('fact', f.date, f.kind, [f.place, f.note].filter(Boolean).join('. '))
  add('death', person.deathDate, 'Смерть', person.deathPlace)
  const order: Record<LifeKind, number> = { birth: 0, union: 1, child: 1, fact: 1, death: 2 }
  return events.sort((a, b) => a.year - b.year || order[a.kind] - order[b.kind])
}

export interface FamilyNumbers {
  people: number; living: number; generations: number
  surnames: [string, number][]; places: [string, number][]
  oldest: { id: string; age: number } | null
  earliest: { id: string; year: number } | null
}

const top = (names: string[], count = 5): [string, number][] => {
  const seen = new Map<string, number>()
  for (const n of names) if (n.trim()) seen.set(n.trim(), (seen.get(n.trim()) ?? 0) + 1)
  return [...seen].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, count)
}

export function familyNumbers(graph: Graph): FamilyNumbers {
  const known = graph.persons.filter(shown)
  const parents = new Map<string, string[]>()
  for (const l of graph.parentChild) parents.set(l.childId, [...(parents.get(l.childId) ?? []), l.parentId])
  const depth = new Map<string, number>()
  const down = (id: string, path: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!
    if (path.has(id)) return 0
    path.add(id)
    const d = 1 + Math.max(0, ...(parents.get(id) ?? []).map((p) => down(p, path)))
    path.delete(id)
    depth.set(id, d)
    return d
  }
  let oldest: FamilyNumbers['oldest'] = null
  let earliest: FamilyNumbers['earliest'] = null
  for (const p of known) {
    if (p.birthYear !== null && (!earliest || p.birthYear < earliest.year)) earliest = { id: p.id, year: p.birthYear }
    if (p.birthYear !== null && p.deathYear !== null && p.deathYear >= p.birthYear && (!oldest || p.deathYear - p.birthYear > oldest.age)) oldest = { id: p.id, age: p.deathYear - p.birthYear }
  }
  return {
    people: graph.persons.length,
    living: graph.persons.filter((p) => p.living).length,
    generations: Math.max(0, ...graph.persons.map((p) => down(p.id, new Set()))),
    surnames: top(known.flatMap((p) => [p.surname, p.maidenName])),
    places: top(known.flatMap((p) => [p.birthPlace, p.deathPlace])),
    oldest,
    earliest,
  }
}

/** Ancestors by place in the fan: the father's side first, then the mother's. A slot with nobody known stays empty. */
export function fanSlots(rootId: string, graph: Graph, rings = 5): (Person | null)[][] {
  const byId = new Map(graph.persons.map((p) => [p.id, p]))
  const parentsOf = (id: string): [Person | null, Person | null] => {
    const list = graph.parentChild.filter((l) => l.childId === id)
    const people = [...list.filter((l) => l.kind === 'birth'), ...list.filter((l) => l.kind !== 'birth')].flatMap((l) => byId.get(l.parentId) ?? [])
    const father = people.find((p) => p.sex === 'M') ?? null
    const mother = people.find((p) => p.sex === 'F') ?? null
    const rest = people.filter((p) => p !== father && p !== mother)
    return [father ?? rest.shift() ?? null, mother ?? rest.shift() ?? null]
  }
  const levels: (Person | null)[][] = [[byId.get(rootId) ?? null]]
  for (let g = 1; g <= rings; g++) levels.push(levels[g - 1].flatMap((p) => (p ? parentsOf(p.id) : [null, null])))
  return levels
}

const icsText = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n')
const pad = (n: number) => String(n).padStart(2, '0')

/**
 * The family's days as a calendar file: each comes round every year. Built from what this person already sees, so a
 * phone's calendar learns nothing the app would not show, and no link to the archive is left behind.
 */
export function familyCalendar(graph: Graph, t: (key: string) => string, stamp = new Date()): string {
  const byId = new Map(graph.persons.map((p) => [p.id, p]))
  const name = (p: Person) => personName(p) || t('Без названия')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Folkbranch//Family days//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsText(t('Семейные даты'))}`]
  const now = `${stamp.getUTCFullYear()}${pad(stamp.getUTCMonth() + 1)}${pad(stamp.getUTCDate())}T000000Z`
  const add = (uid: string, title: string, text: string) => {
    const date = fullDate(text)
    if (!date) return
    const day = `${date.year}${pad(date.month)}${pad(date.day)}`
    lines.push('BEGIN:VEVENT', `UID:${uid}@folkbranch`, `DTSTAMP:${now}`, `DTSTART;VALUE=DATE:${day}`, 'RRULE:FREQ=YEARLY', `SUMMARY:${icsText(title)}`, 'TRANSP:TRANSPARENT', 'END:VEVENT')
  }
  for (const p of graph.persons.filter(shown)) {
    add(`b-${p.id}`, `${t(p.living ? 'День рождения' : 'Со дня рождения')}: ${name(p)}`, p.birthDate)
    if (!p.living) add(`d-${p.id}`, `${t('День памяти')}: ${name(p)}`, p.deathDate)
  }
  for (const u of graph.unions) {
    const a = byId.get(u.aId), b = byId.get(u.bId)
    if (a && b && shown(a) && shown(b) && !u.endDate) add(`w-${u.id}`, `${t('Годовщина свадьбы')}: ${name(a)} ${t('и')} ${name(b)}`, u.startDate)
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}
