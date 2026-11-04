// GEDCOM 5.5.1 and 7.0: a deterministic parser and writer. No model is involved.
import type { Fact, Graph, Person, Source } from './types'
import { splitPatronymic } from './names'

/** Facts that have their own GEDCOM tag. Any other kind travels as EVEN with a TYPE. */
export const FACT_TAGS: Record<string, [string, string]> = {
  OCCU: ['Профессия', 'Occupation'], RESI: ['Место жительства', 'Residence'], EDUC: ['Образование', 'Education'], RELI: ['Вероисповедание', 'Religion'],
  NATI: ['Национальность', 'Nationality'], TITL: ['Титул', 'Title'], CHR: ['Крещение', 'Christening'], BURI: ['Погребение', 'Burial'], CENS: ['Перепись', 'Census'],
  EMIG: ['Эмиграция', 'Emigration'], IMMI: ['Иммиграция', 'Immigration'], NATU: ['Подданство', 'Naturalization'],
}

export interface GedLine { level: number; xref?: string; tag: string; value: string; children: GedLine[] }

export function parseLines(text: string): GedLine[] {
  const roots: GedLine[] = []
  const stack: GedLine[] = []
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const m = raw.match(/^\s*(\d+)\s+(?:(@[^@]+@)\s+)?([A-Za-z0-9_]+)(?: (.*))?$/)
    if (!m) continue
    const line: GedLine = { level: +m[1], xref: m[2], tag: m[3].toUpperCase(), value: m[4] ?? '', children: [] }
    stack.length = line.level
    if (line.level === 0) roots.push(line)
    else stack[line.level - 1]?.children.push(line)
    stack[line.level] = line
  }
  return roots
}

const child = (l: GedLine, tag: string) => l.children.find((c) => c.tag === tag)
const val = (l: GedLine | undefined, tag: string) => (l && child(l, tag)?.value.trim()) || ''

/** A text value together with its continuation lines. */
function longText(l: GedLine) {
  let out = l.value
  for (const c of l.children) {
    if (c.tag === 'CONT') out += '\n' + c.value
    if (c.tag === 'CONC') out += c.value
  }
  return out.replace(/@@/g, '@').trim()
}

const MONTHS: Record<string, string> = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' }

/** "12 MAR 1890" → "12.03.1890", "ABT 1876" → "~1876", other values pass through. */
export function fromGedDate(v: string): string {
  const range = v.trim().match(/^BET\s+(.+?)\s+AND\s+(.+)$/i)
  if (range) return `${fromGedDate(range[1])}–${fromGedDate(range[2])}`
  const bound = v.trim().match(/^(BEF|AFT)\s+(.+)$/i)
  if (bound) return `${bound[1].toUpperCase() === 'BEF' ? '<' : '>'}${fromGedDate(bound[2])}`
  const s = v.trim().replace(/^(ABT|EST|CAL)\s+/i, '~')
  const m = s.match(/^(~?)(?:(\d{1,2})\s+)?(?:([A-Z]{3})\s+)?(\d{3,4})$/i)
  if (!m) return s
  const mon = m[3] ? MONTHS[m[3].toUpperCase()] : ''
  return `${m[1]}${m[2] ? m[2].padStart(2, '0') + '.' : ''}${mon ? mon + '.' : ''}${m[4]}`
}

export function toGedDate(v: string): string {
  const s = v.trim()
  const range = s.match(/^([^–]+)–([^–]+)$/)
  if (range) return `BET ${toGedDate(range[1])} AND ${toGedDate(range[2])}`
  if (/^[<>]/.test(s)) return `${s[0] === '<' ? 'BEF' : 'AFT'} ${toGedDate(s.slice(1))}`
  let m = s.match(/^(\d{1,2})\.(\d{2})\.(\d{4})$/)
  const names = Object.keys(MONTHS)
  if (m) return `${+m[1]} ${names[+m[2] - 1]} ${m[3]}`
  m = s.match(/^(\d{2})\.(\d{4})$/)
  if (m) return `${names[+m[1] - 1]} ${m[2]}`
  m = s.match(/^~\s*(.+)$/)
  if (m) return `ABT ${toGedDate(m[1])}`
  if (/^\d{3,4}$/.test(s)) return s
  return s ? `(${s})` : ''
}

export interface ImportedPerson {
  xref: string
  givenName: string
  surname: string
  maidenName: string
  patronymic: string
  otherNames: string
  sex: 'M' | 'F' | 'U'
  birthDate: string
  birthPlace: string
  deathDate: string
  deathPlace: string
  dead: boolean
  /** Best QUAY among citations of the person's name, birth and death; null when none gives one. */
  quality: number | null
  notes: string[]
  facts: Fact[]
  sources: Source[]
}

export interface Imported {
  version: string
  persons: ImportedPerson[]
  families: { husb?: string; wife?: string; children: { xref: string; adopted: boolean }[]; date: string; end: string; place: string; kind: 'marriage' | 'civil'; hasEvent: boolean }[]
}

function bestQuality(person: GedLine) {
  const vital = person.children.filter((c) => ['NAME', 'BIRT', 'DEAT'].includes(c.tag))
  const quays = [person, ...vital].flatMap((l) => l.children.filter((c) => c.tag === 'SOUR')).map((s) => val(s, 'QUAY')).filter((q) => /^[0-3]$/.test(q)).map(Number)
  return quays.length ? Math.max(...quays) : null
}

/** PAGE holds "ref, л. 12" here: a reference and a sheet, split where we can tell them apart. */
function pageOf(v: string) {
  const m = v.match(/^(.*?)(?:,\s*)?(?:л\.|лист|p\.|page)\s*(\S+)$/i)
  return m ? { ref: m[1], page: m[2] } : { ref: v, page: '' }
}

function uniqueSources(list: Source[]) {
  const seen = new Set<string>()
  return list.filter((s) => { const k = JSON.stringify(s); return !seen.has(k) && !!seen.add(k) })
}

export function parseGedcom(text: string, lang: 'ru' | 'en' = 'ru'): Imported {
  const roots = parseLines(text)
  const head = roots.find((r) => r.tag === 'HEAD')
  const version = (head && val(child(head, 'GEDC'), 'VERS')) || '?'
  const notes = new Map(roots.filter((r) => r.tag === 'SNOTE' || (r.tag === 'NOTE' && r.xref)).map((r) => [r.xref!, longText(r)]))
  const sourceTitles = new Map(roots.filter((r) => r.tag === 'SOUR' && r.xref).map((r) => [r.xref!, val(r, 'TITL') || val(r, 'ABBR')]))
  const noteOf = (c: GedLine) => (c.value.startsWith('@') ? notes.get(c.value) ?? '' : longText(c))

  // Adoption is written on the child: 1 ADOP / 2 FAMC @F1@, or 1 FAMC / 2 PEDI adopted.
  const adopted = new Set<string>()
  const persons = roots.filter((r) => r.tag === 'INDI').map((r): ImportedPerson => {
    const name = child(r, 'NAME')
    const nm = name?.value.match(/^([^/]*)(?:\/([^/]*)\/)?/) ?? []
    const [given, patronymic] = splitPatronymic(val(name, 'GIVN') || (nm[1] ?? '').trim())
    const surn = val(name, 'SURN') || (nm[2] ?? '').trim()
    const birt = child(r, 'BIRT'), deat = child(r, 'DEAT')
    const married = r.children.filter((c) => c.tag === 'NAME').map((c) => ({ type: val(c, 'TYPE').toLowerCase(), surn: val(c, 'SURN') || c.value.match(/\/([^/]*)\//)?.[1] || '' })).find((n) => n.type === 'married' || n.type === 'maiden')
    for (const c of r.children) {
      if (c.tag === 'ADOP') { const f = val(c, 'FAMC'); if (f) adopted.add(`${r.xref}|${f}`) }
      if (c.tag === 'FAMC' && val(c, 'PEDI').toLowerCase() === 'adopted') adopted.add(`${r.xref}|${c.value}`)
    }
    const sex = val(r, 'SEX').toUpperCase()
    return {
      xref: r.xref ?? '',
      givenName: given,
      surname: surn,
      maidenName: married?.type === 'maiden' ? married.surn : '',
      patronymic,
      otherNames: val(name, 'NICK'),
      sex: sex === 'M' ? 'M' : sex === 'F' ? 'F' : 'U',
      birthDate: fromGedDate(val(birt, 'DATE')),
      birthPlace: val(birt, 'PLAC'),
      deathDate: fromGedDate(val(deat, 'DATE')),
      deathPlace: val(deat, 'PLAC'),
      dead: !!deat,
      quality: bestQuality(r),
      notes: r.children.filter((c) => c.tag === 'NOTE' || c.tag === 'SNOTE').map(noteOf).filter(Boolean),
      facts: r.children
        .filter((c) => c.tag === 'EVEN' || c.tag in FACT_TAGS)
        .map((c) => {
          const source = c.children.find((x) => x.tag === 'SOUR')
          const note = [c.value, ...c.children.filter((x) => x.tag === 'NOTE' || x.tag === 'SNOTE').map(noteOf)].filter(Boolean).join('\n')
          return { kind: val(c, 'TYPE') || FACT_TAGS[c.tag]?.[lang === 'en' ? 1 : 0] || (lang === 'en' ? 'Event' : 'Событие'), date: fromGedDate(val(c, 'DATE')), place: val(c, 'PLAC'), note, source: source ? sourceTitles.get(source.value) ?? source.value : '' }
        }),
      // Citations on an event stay with its fact; the rest are about the person.
      sources: uniqueSources([...r.children, ...r.children.filter((c) => c.tag !== 'EVEN' && !(c.tag in FACT_TAGS)).flatMap((c) => c.children)].filter((c) => c.tag === 'SOUR').map((c) => ({ title: sourceTitles.get(c.value) ?? c.value, ...pageOf(val(c, 'PAGE')), url: val(c, 'WWW') || val(c, 'NOTE') })).filter((s) => s.title)),
    }
  })

  const families = roots.filter((r) => r.tag === 'FAM').map((r) => {
    const marr = child(r, 'MARR')
    return {
      husb: child(r, 'HUSB')?.value,
      wife: child(r, 'WIFE')?.value,
      children: r.children.filter((c) => c.tag === 'CHIL').map((c) => ({ xref: c.value, adopted: adopted.has(`${c.value}|${r.xref}`) })),
      date: fromGedDate(val(marr, 'DATE')),
      end: child(r, 'DIV') ? fromGedDate(val(child(r, 'DIV'), 'DATE')) || '?' : '',
      place: val(marr, 'PLAC'),
      // No MARR record says nothing about the union, so it never implies a civil one.
      kind: (/civil|граждан/i.test(val(marr, 'TYPE')) ? 'civil' : 'marriage') as 'marriage' | 'civil',
      hasEvent: !!marr,
    }
  })
  return { version, persons, families }
}

function factLines(f: Fact) {
  const tag = Object.entries(FACT_TAGS).find(([, names]) => names.includes(f.kind))?.[0]
  const note = f.note.split('\n')
  const lines = [`1 ${tag ?? 'EVEN'}${note[0] ? ` ${note[0]}` : ''}`]
  note.slice(1).forEach((l) => lines.push(`2 CONT ${l}`))
  if (!tag && f.kind) lines.push(`2 TYPE ${f.kind}`)
  if (f.date) lines.push(`2 DATE ${toGedDate(f.date)}`)
  if (f.place) lines.push(`2 PLAC ${f.place}`)
  if (f.source) lines.push(`2 SOUR ${f.source}`)
  return lines
}

export function writeGedcom(graph: Graph, opts: { hideLiving: boolean; source: string }): string {
  const out = ['0 HEAD', `1 SOUR ${opts.source}`, '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8']
  const hide = (p: Person) => opts.hideLiving && p.living
  const xref = new Map(graph.persons.map((p, i) => [p.id, `@I${i + 1}@`]))
  const fams = new Map<string, { a?: string; b?: string; children: { id: string; adopted: boolean }[]; start: string; end?: string; place?: string; kind?: string }>()
  const famKey = (a: string, b?: string) => (b ? [a, b].sort().join('|') : a)
  for (const u of graph.unions) fams.set(famKey(u.aId, u.bId), { a: u.aId, b: u.bId, children: [], start: u.startDate, end: u.endDate, place: u.place, kind: u.kind })
  const byChild = new Map<string, typeof graph.parentChild>()
  for (const l of graph.parentChild) byChild.set(l.childId, [...(byChild.get(l.childId) ?? []), l])
  for (const [child, links] of byChild) {
    const key = famKey(links[0].parentId, links[1]?.parentId)
    if (!fams.has(key)) fams.set(key, { a: links[0].parentId, b: links[1]?.parentId, children: [], start: '' })
    fams.get(key)!.children.push({ id: child, adopted: links.some((l) => l.kind === 'adopted') })
  }
  const famList = [...fams.values()]
  const famRef = (i: number) => `@F${i + 1}@`
  const sexOf = new Map(graph.persons.map((p) => [p.id, p.sex]))
  for (const p of graph.persons) {
    out.push(`0 ${xref.get(p.id)} INDI`)
    if (hide(p)) {
      out.push('1 NAME Living //', '1 SEX U')
    } else {
      const given = [p.givenName, p.patronymic].filter(Boolean).join(' ')
      out.push(`1 NAME ${given} /${p.surname}/`)
      if (given) out.push(`2 GIVN ${given}`)
      if (p.surname) out.push(`2 SURN ${p.surname}`)
      if (p.otherNames) out.push(`2 NICK ${p.otherNames}`)
      if (p.maidenName) out.push(`1 NAME ${given} /${p.maidenName}/`, '2 TYPE maiden')
      out.push(`1 SEX ${p.sex}`)
      if (p.birthDate || p.birthPlace) {
        out.push('1 BIRT')
        if (p.birthDate) out.push(`2 DATE ${toGedDate(p.birthDate)}`)
        if (p.birthPlace) out.push(`2 PLAC ${p.birthPlace}`)
      }
      if (!p.living) {
        out.push(p.deathDate || p.deathPlace ? '1 DEAT' : '1 DEAT Y')
        if (p.deathDate) out.push(`2 DATE ${toGedDate(p.deathDate)}`)
        if (p.deathPlace) out.push(`2 PLAC ${p.deathPlace}`)
      }
      for (const f of p.facts) out.push(...factLines(f))
      for (const s of p.sources) {
        out.push(`1 SOUR ${s.title}`)
        const page = [s.ref, s.page && `л. ${s.page}`].filter(Boolean).join(', ')
        if (page) out.push(`2 PAGE ${page}`)
        if (s.url) out.push(`2 NOTE ${s.url}`)
      }
    }
    famList.forEach((f, i) => {
      if (f.a === p.id || f.b === p.id) out.push(`1 FAMS ${famRef(i)}`)
      const c = f.children.find((x) => x.id === p.id)
      if (c) { out.push(`1 FAMC ${famRef(i)}`); if (c.adopted) out.push('2 PEDI adopted') }
    })
  }
  famList.forEach((f, i) => {
    out.push(`0 ${famRef(i)} FAM`)
    const parents = [f.a, f.b].filter(Boolean) as string[]
    const husb = parents.find((x) => sexOf.get(x) === 'M') ?? parents[0]
    const wife = parents.find((x) => x !== husb)
    if (husb) out.push(`1 HUSB ${xref.get(husb)}`)
    if (wife) out.push(`1 WIFE ${xref.get(wife)}`)
    f.children.forEach((c) => out.push(`1 CHIL ${xref.get(c.id)}`))
    if (f.kind === 'marriage') {
      out.push('1 MARR')
      if (f.start) out.push(`2 DATE ${toGedDate(f.start)}`)
      if (f.place) out.push(`2 PLAC ${f.place}`)
    }
    if (f.end) {
      out.push('1 DIV')
      if (f.end !== '?') out.push(`2 DATE ${toGedDate(f.end)}`)
    }
  })
  out.push('0 TRLR')
  return out.join('\n') + '\n'
}
