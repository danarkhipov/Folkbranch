// A research case made by the ex-USSR kinship skill, as a plan for the archive. Its rules hold here too: a candidate
// stays a separate person, a hypothesis never becomes a line on the chart, a status and its source stay with what they
// describe, and nobody counts as dead until the case says so.
import { translate } from './i18n'
import { parseCsv } from './import-formats'
import { yearOf, type Certainty, type Fact, type Lang, type ParentKind, type Sex, type Source, type Reliability, type UnionKind } from './types'

/** `caseId` is the case's own name: every case numbers its people from P-0001, so a number alone says nothing. */
export interface CaseFiles { caseId: string; persons: string; relationships?: string; claims?: string; artifacts?: string }

export interface PlannedPerson {
  caseId: string; givenName: string; patronymic: string; surname: string; otherNames: string; sex: Sex; birthDate: string; deathDate: string
  living: boolean; candidate: boolean; certainty: Certainty; facts: Fact[]; sources: Source[]
}
export interface PlannedParent { parent: string; child: string; kind: ParentKind; certainty: Certainty }
export interface PlannedUnion { a: string; b: string; kind: UnionKind; certainty: Certainty }
export interface CasePlan {
  people: PlannedPerson[]; parents: PlannedParent[]; unions: PlannedUnion[]
  /** Candidates kept apart, and relations that are not on the chart because the case has not proved them. */
  candidates: number; openRelations: number; leftOut: string[]; problems: string[]
  /** Pairs the case now contradicts: a line already on the chart stays until a person takes it off. */
  disputed: { a: string; b: string }[]
  /** Relations naming somebody the case does not list, and cards that did not fit the archive's limits whole. */
  broken: number; trimmed: number
}

// A short name of the case, not the name itself: a tag can reach a reader, and a folder name can say who is researched.
const shortHash = (s: string) => {
  let h = 2166136261
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619)
  return (h >>> 0).toString(36)
}
export const caseTag = (caseId: string, personId: string) => `case:${shortHash(caseId.trim())}:${personId}`

type Row = Record<string, string>
const rows = (text = ''): Row[] => {
  const [head, ...body] = parseCsv(text.replace(/^﻿/, ''))
  if (!head) return []
  const names = head.map((h) => h.trim())
  return body.filter((cells) => cells.some((c) => c.trim())).map((cells) => Object.fromEntries(names.map((n, i) => [n, (cells[i] ?? '').trim()])))
}
const list = (s: string) => s.split(/[;,|]/).map((x) => x.trim()).filter(Boolean)

/** Russian word order varies: the patronymic says which word is the given name. Surnames like Рабинович look like one, so the middle word goes first. */
function splitName(label: string) {
  const w = label.split(/\s+/).filter(Boolean)
  const isPatronymic = (s = '') => /(вич|ьич|[кмт]ич|ична|овна|евна)$/i.test(s)
  const isSurname = (s = '') => s.length >= 5 && /(ов|ев|ёв|ова|ева|ёва|ский|цкий|ская|цкая|енко)$/i.test(s)
  if (w.length >= 3 && isPatronymic(w[1])) return { givenName: w[0], patronymic: w[1], surname: w[2], rest: w.slice(3) }
  if (w.length >= 3 && isPatronymic(w[2])) return { surname: w[0], givenName: w[1], patronymic: w[2], rest: w.slice(3) }
  if (w.length === 2 && isSurname(w[0]) && !isSurname(w[1])) return { surname: w[0], givenName: w[1], patronymic: '', rest: [] }
  return { givenName: w[0] ?? '', patronymic: '', surname: w[1] ?? '', rest: w.slice(2) }
}

const STATUS_WORD: Record<string, string> = {
  hypothesis: 'Гипотеза', 'single-source': 'Один источник', corroborated: 'Подтверждено', 'strongly-corroborated': 'Надёжно подтверждено',
  contradicted: 'Опровергается', unresolved: 'Не решено',
}
const statusWord = (s: string) => STATUS_WORD[s] ?? 'Не решено'

/** Only what the case has established draws a line. */
const certaintyOf = (status: string): Certainty | null =>
  status === 'corroborated' || status === 'strongly-corroborated' ? 'documented' : status === 'single-source' ? 'assumed' : null

const reliabilityOf = (a: Row): Reliability => {
  const made = `${a.originality} ${a.directness} ${a.provenance_level}`.toLowerCase()
  if (/lead|index/.test(made)) return 'guess'
  if (/transcript|транскр/.test(made)) return 'transcript'
  if (/original|оригинал/.test(made)) return 'original'
  if (/oral|family|устн/.test(made)) return 'hearsay'
  return 'copy'
}

/** A path on the researcher's disk says nothing to a relative, and something about the researcher. */
const sourceOf = (a: Row): Source => ({
  reliability: reliabilityOf(a),
  title: a.source_title || a.repository_or_archive || a.artifact_id,
  ref: [a.repository_or_archive !== a.source_title ? a.repository_or_archive : '', a.archival_reference].filter(Boolean).join(', '),
  page: '',
  url: /^https?:\/\//i.test(a.source_url_or_path) ? a.source_url_or_path : '',
})

// Only a patronymic says this; a surname ending can mislead (Щербина, Дурново).
const sexOf = (patronymic: string): Sex => (/(вич|ьич|[кмт]ич)$/i.test(patronymic) ? 'M' : /(овна|евна|ична)$/i.test(patronymic) ? 'F' : 'U')

/**
 * The register leaves this column free, so only a word that plainly means the nearest relation draws a line.
 * A grandfather, a godmother or a son-in-law must not become a parent because the word contains one.
 */
function relationOf(type: string): { as: 'parent' | 'child' | 'spouse'; kind?: ParentKind } | null {
  const w = type.trim().toLowerCase().replace(/ё/g, 'е').replace(/[\s_]+/g, '-').replace(/-(of|to)$/, '')
  if (/^(parent|father|mother|biological-(parent|father|mother)|отец|мать|родитель)$/.test(w)) return { as: 'parent' }
  if (/^(adoptive-(parent|father|mother)|приемн(ый-отец|ая-мать|ый-родитель)|усыновитель|удочеритель)$/.test(w)) return { as: 'parent', kind: 'adopted' }
  if (/^(step-?(parent|father|mother)|отчим|мачеха)$/.test(w)) return { as: 'parent', kind: 'step' }
  if (/^(child|son|daughter|biological-(child|son|daughter)|сын|дочь|ребенок)$/.test(w)) return { as: 'child' }
  if (/^(adopted-(child|son|daughter)|приемн(ый-сын|ая-дочь)|усыновленн(ый|ая))$/.test(w)) return { as: 'child', kind: 'adopted' }
  if (/^(step-?(child|son|daughter)|пасынок|падчерица)$/.test(w)) return { as: 'child', kind: 'step' }
  if (/^(spouse|wife|husband|partner|married|супруг|супруга|жена|муж)$/.test(w)) return { as: 'spouse' }
  return null
}

const chunks = (s: string, size: number) => {
  const out: string[] = []
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size))
  return out.length ? out : ['']
}

/** A card past the limits of the edit form would refuse every later edit. Long notes continue in the next fact, the rest is counted and said. */
function fit(p: PlannedPerson): { person: PlannedPerson; trimmed: boolean } {
  let trimmed = false
  const clip = (s: string, max: number) => { if (s.length <= max) return s; trimmed = true; return s.slice(0, max - 1) + '…' }
  const facts = p.facts.flatMap((f) => chunks(f.note, 800).map((note) => ({ ...f, kind: clip(f.kind, 80), note })))
  if (facts.length > 100 || p.sources.length > 100) trimmed = true
  return {
    person: {
      ...p,
      givenName: clip(p.givenName, 120), patronymic: clip(p.patronymic, 120), surname: clip(p.surname, 120), otherNames: clip(p.otherNames, 300),
      birthDate: clip(p.birthDate, 120), deathDate: clip(p.deathDate, 120),
      facts: facts.slice(0, 100),
      sources: p.sources.slice(0, 100).map((x) => {
        if (x.url.length > 500) trimmed = true
        return { ...x, title: clip(x.title, 200), ref: clip(x.ref, 120), url: x.url.length > 500 ? '' : x.url }
      }),
    },
    trimmed,
  }
}

export function planCase(files: CaseFiles, lang: Lang = 'ru'): CasePlan {
  const t = (k: string) => translate(lang, k)
  const problems: string[] = []
  const peopleRows = rows(files.persons)
  if (peopleRows.length && !('person_id' in peopleRows[0])) problems.push('person-register.csv: no person_id column')
  const artifacts = new Map(rows(files.artifacts).map((a) => [a.artifact_id, a]))
  const claims = rows(files.claims)
  const relations = rows(files.relationships)
  const leftOut: string[] = []
  const people: PlannedPerson[] = []
  let candidates = 0

  for (const r of peopleRows) {
    if (!r.person_id) continue
    const status = (r.candidate_status ?? '').toLowerCase()
    // The case decided this is someone else: bringing them in would invent a relative.
    if (/reject|exclude|not.?same|отклон|исключ/.test(status)) { leftOut.push(r.person_id); continue }
    const isCandidate = /candidate|possible|unresolved|кандидат/.test(status)
    if (isCandidate) candidates++
    const { givenName, patronymic, surname, rest } = splitName(r.preferred_label || r.names_as_written || r.person_id)
    const facts: Fact[] = []
    const note = (kind: string, value: string) => { if (value) facts.push({ kind: t(kind), date: '', place: '', note: value }) }
    if (isCandidate) note('Кандидат, личность не установлена', r.merge_or_split_rationale || r.preferred_label)
    note('Места', [r.places, r.historical_jurisdictions].filter(Boolean).join('; '))
    note('Занятие или положение', r.occupation_or_status)
    note('Конфессия или община по записи', r.confession_or_community_as_recorded)
    note('Родственники со слов', r.relatives_as_reported)
    note('Заметка из дела', r.notes)
    for (const c of claims) {
      if (!list(c.subject_person_ids ?? '').includes(r.person_id)) continue
      note(statusWord(c.status), [c.claim_text, c.rationale].filter(Boolean).join('. '))
    }
    const ids = new Set([...list(r.source_artifact_ids ?? ''), ...[...artifacts.values()].filter((a) => list(a.person_ids ?? '').includes(r.person_id)).map((a) => a.artifact_id)])
    const sources = [...ids].flatMap((id) => { const a = artifacts.get(id); return a ? [sourceOf(a)] : [] })
    // Nobody lives this long, whatever the case left unfilled: the same line the GEDCOM import draws.
    const dead = /^(deceased|dead|умер|умерла|умерший|умершая)$/i.test(r.living_status ?? '') || /\d/.test(r.death_estimate ?? '') || (yearOf(r.birth_estimate ?? '') ?? 9999) < new Date().getFullYear() - 110
    people.push({
      caseId: r.person_id, givenName, patronymic, surname: [surname, ...rest].filter(Boolean).join(' '),
      otherNames: [r.names_as_written, r.normalized_name_variants].filter(Boolean).join('; '),
      sex: sexOf(patronymic), birthDate: r.birth_estimate ?? '', deathDate: r.death_estimate ?? '',
      // Unknown counts as living: the mistake that hides someone is the one that can be fixed.
      living: !dead, candidate: isCandidate, certainty: !isCandidate && sources.some((s) => s.reliability !== 'guess') ? 'documented' : 'assumed', facts, sources,
    })
  }

  const known = new Map(people.map((p) => [p.caseId, p]))
  const left = new Set(leftOut)
  const parents: PlannedParent[] = []
  const unions: PlannedUnion[] = []
  const disputed: { a: string; b: string }[] = []
  let openRelations = 0, broken = 0
  // A note on one card can be read while the other person is hidden, so a living relative stays a number.
  const who = (p: PlannedPerson) => (p.living ? `${t('Живой человек')} ${p.caseId}` : [p.givenName, p.patronymic, p.surname].filter(Boolean).join(' '))
  const keepOpen = (a: PlannedPerson, b: PlannedPerson, r: Row, kind: string) => {
    openRelations++
    const note = `${r.relationship_type}: ${who(a)} — ${who(b)}${r.rationale ? `. ${r.rationale}` : ''}`
    for (const p of [a, b]) p.facts.push({ kind, date: '', place: '', note })
  }
  const isAncestor = (candidate: string, of: string): boolean => parents.some((l) => l.child === of && (l.parent === candidate || isAncestor(candidate, l.parent)))
  const relationCell = (r: Row) => `${t('Возможная связь')}, ${t(statusWord(r.status)).toLowerCase()}`
  for (const r of relations) {
    const a = known.get(r.person_a_id), b = known.get(r.person_b_id)
    if (!a || !b) {
      if (!left.has(r.person_a_id) && !left.has(r.person_b_id)) broken++
      continue
    }
    const certainty = certaintyOf(r.status)
    if (r.status === 'contradicted') disputed.push({ a: a.caseId, b: b.caseId })
    // A candidate's relation stays open too, whatever it says: the person it joins is not established.
    if (!certainty || a.candidate || b.candidate || a === b) { keepOpen(a, b, r, relationCell(r)); continue }
    const relation = relationOf(r.relationship_type ?? '')
    if (!relation) { keepOpen(a, b, r, t('Связь из дела')); continue }
    const how = (r.biological_legal_household ?? '').toLowerCase()
    if (relation.as === 'spouse') { unions.push({ a: a.caseId, b: b.caseId, kind: /civil|cohab|граждан/.test(how) ? 'civil' : 'marriage', certainty }); continue }
    const [parent, child] = relation.as === 'parent' ? [a, b] : [b, a]
    const kind: ParentKind = relation.kind ?? (/adopt|усынов|удочер/.test(how) ? 'adopted' : /step|household|отчим|мачех/.test(how) ? 'step' : 'birth')
    // Two people cannot descend from each other, and a third parent by birth is a contradiction: both are for a person to resolve.
    const third = kind === 'birth' && parents.filter((l) => l.child === child.caseId && l.kind === 'birth' && l.parent !== parent.caseId).length >= 2
    if (isAncestor(child.caseId, parent.caseId) || third) { keepOpen(a, b, r, t('Связь противоречит другим')); continue }
    parents.push({ parent: parent.caseId, child: child.caseId, kind, certainty })
  }
  // The archive would quietly drop a marriage between a parent and child or between siblings, so the note says it instead.
  const parentsOf = (id: string) => parents.filter((l) => l.child === id).map((l) => l.parent)
  const canPair = (a: string, b: string) => {
    const pa = parentsOf(a), pb = parentsOf(b)
    return !pa.some((x) => pb.includes(x)) && !pa.includes(b) && !pb.includes(a)
  }
  const sound = unions.filter((u) => {
    if (canPair(u.a, u.b)) return true
    const a = known.get(u.a)!, b = known.get(u.b)!
    keepOpen(a, b, { relationship_type: 'spouse' }, t('Связь противоречит другим'))
    return false
  })
  // Two parents of one child share a dot on the chart, as when a person links them by hand. Marked as assumed: the case did not say they married.
  for (const child of new Set(parents.map((l) => l.child))) {
    const pair = parentsOf(child)
    if (pair.length !== 2 || !canPair(pair[0], pair[1])) continue
    if (!sound.some((u) => (u.a === pair[0] && u.b === pair[1]) || (u.a === pair[1] && u.b === pair[0]))) sound.push({ a: pair[0], b: pair[1], kind: 'marriage', certainty: 'assumed' })
  }
  const fitted = people.map(fit)
  return { people: fitted.map((f) => f.person), parents, unions: sound, candidates, openRelations, leftOut, problems, disputed, broken, trimmed: fitted.filter((f) => f.trimmed).length }
}
