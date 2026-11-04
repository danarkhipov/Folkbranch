// The text form of the graph. Based on Diagrammo's `family` chart: one person per line,
// `A + B` for a couple, indented lines for their children. Pure code: the browser uses it
// for the live preview and the server for the real import.
import { splitPatronymic } from './names'
import type { Certainty, Graph, ParentKind, Person, Sex } from './types'
import { personName, yearOf } from './types'

const KEYS = ['id', 'b', 'bp', 'd', 'dp', 'sex', 'maiden', 'c', 'm', 'end', 'kind', 'union']
const ATTR = new RegExp(`(?:^|[\\s,])(${KEYS.join('|')}):\\s*`, 'g')

export interface TextPerson {
  ref: string
  id?: string
  givenName: string
  surname: string
  attrs: Record<string, string>
  line: number
}
export interface TextUnion { a: string; b: string; attrs: Record<string, string>; line: number }
export interface TextParent { parent: string; child: string; kind: ParentKind; certainty: Certainty; line: number }
export interface ParsedText {
  title: string
  people: Map<string, TextPerson>
  unions: TextUnion[]
  parents: TextParent[]
  errors: { line: number; message: string }[]
}

const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ')

function splitAttrs(s: string) {
  const attrs: Record<string, string> = {}
  const hits = [...s.matchAll(ATTR)]
  hits.forEach((m, i) => {
    const start = m.index + m[0].length
    attrs[m[1]] = s.slice(start, hits[i + 1]?.index ?? s.length).trim().replace(/,$/, '').trim()
  })
  return { head: (hits[0] ? s.slice(0, hits[0].index) : s).trim(), attrs }
}

const SEX: Record<string, Sex> = { m: 'M', f: 'F', u: 'U', м: 'M', ж: 'F' }

export function parseFamilyText(text: string): ParsedText {
  const out: ParsedText = { title: '', people: new Map(), unions: [], parents: [], errors: [] }
  const byName = new Map<string, string>()
  const stack: { indent: number; parents: string[] }[] = []

  const person = (term: string, attrs: Record<string, string>, line: number): string => {
    if (term.startsWith('@')) {
      const id = term.slice(1)
      const ref = `@${id}`
      if (!out.people.has(ref)) out.people.set(ref, { ref, id, givenName: '', surname: '', attrs: {}, line })
      merge(ref, attrs)
      return ref
    }
    const key = norm(term)
    if (!key) {
      out.errors.push({ line, message: 'empty name' })
      return ''
    }
    const ref = attrs.id ? `@${attrs.id}` : (byName.get(key) ?? `~${key}`)
    if (attrs.id || !byName.has(key)) byName.set(key, ref)
    if (!out.people.has(ref)) {
      const parts = term.trim().split(/\s+/)
      out.people.set(ref, { ref, id: attrs.id, givenName: parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0], surname: parts.length > 1 ? parts.at(-1)! : '', attrs: {}, line })
    } else if (attrs.id) {
      const p = out.people.get(ref)!
      if (!p.givenName && !p.surname) {
        const parts = term.trim().split(/\s+/)
        p.givenName = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0]
        p.surname = parts.length > 1 ? parts.at(-1)! : ''
      }
    }
    merge(ref, attrs)
    return ref
  }
  const merge = (ref: string, attrs: Record<string, string>) => {
    const p = out.people.get(ref)!
    for (const k of ['b', 'bp', 'd', 'dp', 'sex', 'maiden', 'c']) if (attrs[k]) p.attrs[k] = attrs[k]
  }

  text.replace(/\r/g, '').split('\n').forEach((raw, i) => {
    const line = i + 1
    if (!raw.trim() || /^\s*(#|\/\/)/.test(raw)) return
    const indent = raw.length - raw.trimStart().length
    const s = raw.trim()
    if (indent === 0 && /^family(\s|$)/i.test(s)) {
      out.title = s.slice(6).trim()
      return
    }
    const { head, attrs } = splitAttrs(s)
    if (attrs.sex && !SEX[attrs.sex.toLowerCase()]) out.errors.push({ line, message: `unknown sex: ${attrs.sex}` })
    const terms = head.split(/\s\+\s/).map((t) => t.trim())
    if (terms.length > 2) out.errors.push({ line, message: 'a couple line has exactly two people' })

    while (stack.length && stack.at(-1)!.indent >= indent) stack.pop()
    const up = stack.at(-1)

    const isPair = terms.length === 2
    // On a couple line, dates belong to the marriage; on any other line, to the person.
    // On an indented line, `c` is about the link to the parents, not about the person.
    const own = up ? { ...attrs, c: '' } : attrs
    const first = person(terms[0], isPair ? { id: attrs.id ?? '' } : own, line)
    if (!first) return
    if (up) {
      for (const parent of up.parents) {
        if (parent === first) out.errors.push({ line, message: 'a person cannot be their own parent' })
        else out.parents.push({ parent, child: first, kind: (attrs.kind as ParentKind) || 'birth', certainty: (attrs.c as Certainty) || 'family', line })
      }
    }
    const members = [first]
    if (isPair) {
      const second = person(terms[1], {}, line)
      if (second) {
        members.push(second)
        out.unions.push({ a: first, b: second, attrs, line })
      }
    }
    stack.push({ indent, parents: members })
  })
  return out
}

/** A graph built from the text alone, for the preview. */
export function parsedToGraph(p: ParsedText): Graph {
  const persons: Person[] = [...p.people.values()].map((t) => ({
    id: t.ref, givenName: t.givenName || t.ref, surname: t.surname, maidenName: t.attrs.maiden ?? '', patronymic: '', otherNames: '', sex: SEX[(t.attrs.sex ?? 'u').toLowerCase()] ?? 'U',
    birthDate: t.attrs.b ?? '', birthYear: yearOf(t.attrs.b ?? ''), birthPlace: t.attrs.bp ?? '', deathDate: t.attrs.d ?? '', deathYear: yearOf(t.attrs.d ?? ''), deathPlace: t.attrs.dp ?? '',
    living: !t.attrs.d, certainty: (t.attrs.c as Certainty) ?? 'family', avatarMediaId: null, avatarCrop: null, updatedAt: 0, tags: [], facts: [], sources: [], claims: [],
  }))
  return {
    persons,
    parentChild: p.parents.map((l, i) => ({ id: `l${i}`, parentId: l.parent, childId: l.child, kind: l.kind, certainty: l.certainty })),
    unions: p.unions.map((u, i) => ({ id: `u${i}`, aId: u.a, bId: u.b, kind: u.attrs.union === 'civil' ? 'civil' : 'marriage', startDate: u.attrs.m ?? '', endDate: u.attrs.end ?? '', place: '', certainty: 'family' })),
  }
}

export interface PlannedOp { op: string; args: Record<string, unknown>; tempId?: string }
export interface TextPlan {
  ops: PlannedOp[]
  creates: string[]
  updates: string[]
  relations: number
  ambiguous: { ref: string; name: string; candidates: { id: string; name: string; years: string }[] }[]
  errors: { line: number; message: string }[]
}

const FIELDS: [string, keyof Person][] = [['b', 'birthDate'], ['bp', 'birthPlace'], ['d', 'deathDate'], ['dp', 'deathPlace'], ['maiden', 'maidenName'], ['c', 'certainty']]

/**
 * Compares the text with the current graph. Text only adds and changes: removing a line never
 * deletes anybody, so a model that returns part of the tree cannot wipe the rest.
 */
export function planFamilyText(parsed: ParsedText, graph: Graph, resolutions: Record<string, string> = {}): TextPlan {
  const plan: TextPlan = { ops: [], creates: [], updates: [], relations: 0, ambiguous: [], errors: [...parsed.errors] }
  const ids = new Map<string, string>()
  const byId = new Map(graph.persons.map((p) => [p.id, p]))
  const byName = new Map<string, Person[]>()
  for (const p of graph.persons) {
    // Findable both as "Пётр Иванов" and as "Пётр Сергеевич Иванов".
    for (const k of new Set([norm(personName(p)), norm([p.givenName, p.patronymic, p.surname].filter(Boolean).join(' '))])) {
      if (k) byName.set(k, [...(byName.get(k) ?? []), p])
    }
  }

  let tmp = 0
  for (const t of parsed.people.values()) {
    if (t.id) {
      if (byId.has(t.id)) ids.set(t.ref, t.id)
      else plan.errors.push({ line: t.line, message: `unknown id: ${t.id}` })
      continue
    }
    const chosen = resolutions[t.ref]
    if (chosen && chosen !== 'new') {
      ids.set(t.ref, chosen)
      continue
    }
    const year = yearOf(t.attrs.b ?? '')
    const same = (byName.get(norm(`${t.givenName} ${t.surname}`)) ?? []).filter((c) => !year || !c.birthYear || c.birthYear === year)
    if (chosen !== 'new' && same.length === 1) ids.set(t.ref, same[0].id)
    else if (chosen !== 'new' && same.length > 1) {
      plan.ambiguous.push({ ref: t.ref, name: `${t.givenName} ${t.surname}`.trim(), candidates: same.map((c) => ({ id: c.id, name: personName(c), years: [c.birthDate, c.deathDate].filter(Boolean).join(' – ') })) })
    } else {
      const tempId = `tmp_t${++tmp}`
      ids.set(t.ref, tempId)
      plan.creates.push(`${t.givenName} ${t.surname}`.trim())
      const [givenName, patronymic] = splitPatronymic(t.givenName)
      plan.ops.push({ op: 'create_person', tempId, args: { person: {
        givenName, ...(patronymic ? { patronymic } : {}), surname: t.surname, sex: SEX[(t.attrs.sex ?? '').toLowerCase()] ?? 'U', maidenName: t.attrs.maiden ?? '',
        birthDate: t.attrs.b ?? '', birthPlace: t.attrs.bp ?? '', deathDate: t.attrs.d ?? '', deathPlace: t.attrs.dp ?? '',
        ...(t.attrs.c ? { certainty: t.attrs.c } : {}),
      } } })
    }
  }

  for (const t of parsed.people.values()) {
    const id = ids.get(t.ref)
    const cur = id ? byId.get(id) : undefined
    if (!cur) continue
    const patch: Record<string, unknown> = {}
    for (const [key, field] of FIELDS) if (t.attrs[key] && t.attrs[key] !== cur[field]) patch[field] = t.attrs[key]
    const sex = SEX[(t.attrs.sex ?? '').toLowerCase()]
    if (sex && sex !== cur.sex) patch.sex = sex
    if (Object.keys(patch).length) {
      plan.updates.push(personName(cur))
      plan.ops.push({ op: 'update_person', args: { id, patch } })
    }
  }

  const linked = new Set(graph.parentChild.map((l) => `${l.parentId}|${l.childId}`))
  const married = new Set(graph.unions.flatMap((u) => [`${u.aId}|${u.bId}`, `${u.bId}|${u.aId}`]))
  for (const u of parsed.unions) {
    const a = ids.get(u.a), b = ids.get(u.b)
    if (!a || !b || married.has(`${a}|${b}`)) continue
    married.add(`${a}|${b}`).add(`${b}|${a}`)
    plan.relations++
    plan.ops.push({ op: 'add_relation', args: { type: 'spouse', to: a, other: b, startDate: u.attrs.m ?? '', endDate: u.attrs.end ?? '', unionKind: u.attrs.union === 'civil' ? 'civil' : 'marriage' } })
  }
  for (const l of parsed.parents) {
    const parent = ids.get(l.parent), child = ids.get(l.child)
    if (!parent || !child || linked.has(`${parent}|${child}`)) continue
    linked.add(`${parent}|${child}`)
    plan.relations++
    plan.ops.push({ op: 'add_relation', args: { type: 'son', to: parent, other: child, kind: l.kind, certainty: l.certainty } })
  }
  return plan
}

/** One person's line; a value may contain commas, the next key is what ends it. */
export function serializeNameLine(name: string, attrs: Record<string, string>) {
  const a = Object.entries(attrs).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ')
  return a ? `${name} ${a}` : name
}

export function serializeFamilyText(graph: Graph, title = ''): string {
  const visible = graph.persons.filter((p) => !p.hidden)
  const counts = new Map<string, number>()
  for (const p of visible) counts.set(norm(personName(p)), (counts.get(norm(personName(p))) ?? 0) + 1)
  const safe = (n: string) => n.includes(' ') && !/ \+ |:|^@|^family\s/i.test(n)
  const ref = (id: string) => {
    const p = graph.persons.find((x) => x.id === id)
    if (!p || p.hidden) return `@${id}`
    const n = personName(p)
    return n && counts.get(norm(n)) === 1 && safe(n) ? n : `@${id}`
  }
  const lines: string[] = [`family ${title}`.trim(), '']
  const attrs = (pairs: [string, string | undefined][]) => pairs.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ')

  const byAge = [...visible].sort((a, b) => (a.birthYear ?? 9999) - (b.birthYear ?? 9999))
  for (const p of byAge) {
    const name = personName(p) || '?'
    const a = attrs([['id', p.id], ['b', p.birthDate], ['bp', p.birthPlace], ['d', p.deathDate], ['dp', p.deathPlace], ['sex', p.sex === 'U' ? '' : p.sex.toLowerCase()], ['maiden', p.maidenName], ['c', p.certainty === 'family' ? '' : p.certainty]])
    lines.push(`${name} ${a}`)
  }
  lines.push('')

  const parentsOf = new Map<string, typeof graph.parentChild>()
  for (const l of graph.parentChild) parentsOf.set(l.childId, [...(parentsOf.get(l.childId) ?? []), l])
  const families = new Map<string, { parents: string[]; children: typeof graph.parentChild }>()
  const add = (parents: string[], l: (typeof graph.parentChild)[number]) => {
    const key = [...parents].sort().join('|')
    const f = families.get(key) ?? { parents, children: [] }
    f.children.push(l)
    families.set(key, f)
  }
  for (const links of parentsOf.values()) {
    if (links.length === 2) add(links.map((l) => l.parentId), links[0])
    else links.forEach((l) => add([l.parentId], l))
  }
  const childLine = (l: (typeof graph.parentChild)[number]) => {
    const a = attrs([['kind', l.kind === 'birth' ? '' : l.kind], ['c', l.certainty === 'family' ? '' : l.certainty]])
    return `  ${ref(l.childId)}${a ? ` ${a}` : ''}`
  }
  const done = new Set<string>()
  for (const u of graph.unions) {
    const key = [u.aId, u.bId].sort().join('|')
    done.add(key)
    const a = attrs([['m', u.startDate], ['end', u.endDate], ['union', u.kind === 'civil' ? 'civil' : '']])
    lines.push(`${ref(u.aId)} + ${ref(u.bId)}${a ? ` ${a}` : ''}`)
    families.get(key)?.children.forEach((l) => lines.push(childLine(l)))
  }
  for (const [key, f] of families) {
    if (done.has(key)) continue
    lines.push(f.parents.map(ref).join(' + '))
    f.children.forEach((l) => lines.push(childLine(l)))
  }
  return lines.join('\n').trimEnd() + '\n'
}
