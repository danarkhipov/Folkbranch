// A research case made by the ex-USSR kinship skill, as a plan for the archive. Its rules hold here too: a candidate
// stays a separate person, a hypothesis never becomes a line on the chart, a status and its source stay with what they
// describe, and nobody counts as dead until the case says so.
import { translate } from './i18n'
import { parseCsv } from './import-formats'
import type { Certainty, Fact, Lang, ParentKind, Sex, Source, Reliability, UnionKind } from './types'

export interface CaseFiles { persons: string; relationships?: string; claims?: string; artifacts?: string }

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
}

type Row = Record<string, string>
const rows = (text = ''): Row[] => {
  const [head, ...body] = parseCsv(text.replace(/^﻿/, ''))
  if (!head) return []
  const names = head.map((h) => h.trim())
  return body.filter((cells) => cells.some((c) => c.trim())).map((cells) => Object.fromEntries(names.map((n, i) => [n, (cells[i] ?? '').trim()])))
}
const list = (s: string) => s.split(/[;,|]/).map((x) => x.trim()).filter(Boolean)

/** Russian word order varies: the patronymic says which word is the given name. */
function splitName(label: string) {
  const w = label.split(/\s+/).filter(Boolean)
  const isPatronymic = (s = '') => /(ович|евич|ьич|ична|инична|овна|евна)$/i.test(s)
  if (w.length >= 3 && isPatronymic(w[2])) return { surname: w[0], givenName: w[1], patronymic: w[2], rest: w.slice(3) }
  if (w.length >= 3 && isPatronymic(w[1])) return { givenName: w[0], patronymic: w[1], surname: w[2], rest: w.slice(3) }
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

const sexOf = (given: string, patronymic: string, surname: string): Sex =>
  /(ович|евич|ьич)$/i.test(patronymic) ? 'M' : /(овна|евна|ична)$/i.test(patronymic) ? 'F' : /(ова|ева|ина|ая)$/i.test(surname) ? 'F' : 'U'

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
    const dead = /deceased|dead|умер/i.test(r.living_status ?? '') || !!r.death_estimate
    people.push({
      caseId: r.person_id, givenName, patronymic, surname: [surname, ...rest].filter(Boolean).join(' '),
      otherNames: [r.names_as_written, r.normalized_name_variants].filter(Boolean).join('; '),
      sex: sexOf(givenName, patronymic, surname), birthDate: r.birth_estimate ?? '', deathDate: r.death_estimate ?? '',
      // Unknown counts as living: the mistake that hides someone is the one that can be fixed.
      living: !dead, candidate: isCandidate, certainty: isCandidate ? 'assumed' : 'documented', facts, sources,
    })
  }

  const known = new Map(people.map((p) => [p.caseId, p]))
  const parents: PlannedParent[] = []
  const unions: PlannedUnion[] = []
  let openRelations = 0
  for (const r of relations) {
    const a = known.get(r.person_a_id), b = known.get(r.person_b_id)
    if (!a || !b) continue
    const type = (r.relationship_type ?? '').toLowerCase()
    const certainty = certaintyOf(r.status)
    // A candidate's relation stays open too, whatever it says: the person it joins is not established.
    if (!certainty || a.candidate || b.candidate) {
      openRelations++
      const text = `${r.relationship_type}: ${r.person_a_id} — ${r.person_b_id}${r.rationale ? `. ${r.rationale}` : ''}`
      for (const p of [a, b]) p.facts.push({ kind: `${t('Возможная связь')}, ${t(statusWord(r.status)).toLowerCase()}`, date: '', place: '', note: text })
      continue
    }
    const how = (r.biological_legal_household ?? '').toLowerCase()
    const kind: ParentKind = /adopt|усынов|удочер/.test(how) ? 'adopted' : /step|household|отчим|мачех/.test(how) ? 'step' : 'birth'
    if (/spouse|wife|husband|marri|partner|супруг|жена|муж|брак/.test(type)) unions.push({ a: a.caseId, b: b.caseId, kind: /civil|cohab|граждан/.test(how) ? 'civil' : 'marriage', certainty })
    else if (/child|son|daughter|сын|дочь|ребён/.test(type)) parents.push({ parent: b.caseId, child: a.caseId, kind, certainty })
    else if (/parent|father|mother|отец|мать|родител/.test(type)) parents.push({ parent: a.caseId, child: b.caseId, kind, certainty })
    else {
      openRelations++
      for (const p of [a, b]) p.facts.push({ kind: t('Связь из дела'), date: '', place: '', note: `${r.relationship_type}: ${r.person_a_id} — ${r.person_b_id}` })
    }
  }
  return { people, parents, unions, candidates, openRelations, leftOut, problems }
}
