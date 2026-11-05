// Versions of a value. A person's birth date can come from a register and from an aunt, and they
// can disagree. Each version keeps its source and status; the person's own field holds whichever
// is accepted, so the chart, the API and GEDCOM read one value as before.
import type { Certainty, Claim, ClaimField, Person, Reliability, Source } from './types'

export const CLAIM_FIELDS: ClaimField[] = ['birthDate', 'birthPlace', 'deathDate', 'deathPlace']
export const NAME_FIELDS: ClaimField[] = ['givenName', 'patronymic', 'surname', 'maidenName']
export const RELIABILITY: Record<Reliability, string> = { original: 'оригинал документа', copy: 'копия или выписка', transcript: 'расшифровка', witness: 'рассказ очевидца', hearsay: 'пересказ', guess: 'предположение' }

type Subject = Pick<Person, 'claims' | 'sources' | 'certainty' | ClaimField>
export type ClaimPatch = Partial<Pick<Person, 'claims' | 'certainty' | ClaimField>>

const newId = () => Math.random().toString(36).slice(2, 10)
const make = (field: ClaimField, value: string, sourceId: string | null, status: Claim['status']): Claim => ({ id: newId(), field, value, sourceId, status, reason: '', at: Date.now() })

/** The field's value becomes a version of its own the first time a second one appears. */
function withCurrent(p: Subject, field: ClaimField) {
  const value = p[field]
  const has = p.claims.some((c) => c.field === field && c.status === 'accepted')
  if (!value || has) return p.claims
  // Stable, because the interface shows this version before it is ever saved, then acts on its id.
  let id = `cur:${field}:${value}`
  while (p.claims.some((c) => c.id === id)) id += '+'
  return [...p.claims, { ...make(field, value, null, 'accepted'), id }]
}

const finish = (p: Subject, claims: Claim[], fields: Partial<Pick<Person, ClaimField>> = {}): ClaimPatch => {
  const next = { ...p, ...fields, claims }
  return { ...fields, claims, certainty: cardCertainty(next) }
}

/** Every version of a field, the accepted one first. */
export function versions(p: Subject, field: ClaimField) {
  return withCurrent(p, field).filter((c) => c.field === field).sort((a, b) => rank(a) - rank(b))
}
const rank = (c: Claim) => (c.status === 'accepted' ? 0 : c.status === 'possible' ? 1 : 2)

export function addVersion(p: Subject, field: ClaimField, value: string, sourceId: string | null): ClaimPatch {
  const claims = withCurrent(p, field)
  const first = !claims.some((c) => c.field === field && c.status === 'accepted')
  return finish(p, [...claims, make(field, value, sourceId, first ? 'accepted' : 'possible')], first ? { [field]: value } : {})
}

export function accept(p: Subject, field: ClaimField, id: string): ClaimPatch {
  const claims = withCurrent(p, field).map((c) => (c.field !== field ? c : c.id === id ? { ...c, status: 'accepted' as const, reason: '' } : c.status === 'accepted' ? { ...c, status: 'possible' as const } : c))
  return finish(p, claims, { [field]: claims.find((c) => c.id === id)!.value })
}

/** A wrong version stays, with the reason, so nobody accepts it again. The next one takes over. */
export function reject(p: Subject, field: ClaimField, id: string, reason: string): ClaimPatch {
  const all = withCurrent(p, field)
  const wasAccepted = all.find((c) => c.id === id)?.status === 'accepted'
  let claims = all.map((c) => (c.id === id ? { ...c, status: 'rejected' as const, reason } : c))
  if (!wasAccepted) return finish(p, claims)
  const next = claims.find((c) => c.field === field && c.status === 'possible')
  claims = claims.map((c) => (c === next ? { ...c, status: 'accepted' as const } : c))
  return finish(p, claims, { [field]: next?.value ?? '' })
}

export function restore(p: Subject, field: ClaimField, id: string): ClaimPatch {
  const claims = withCurrent(p, field)
  const none = !claims.some((c) => c.field === field && c.status === 'accepted')
  const value = claims.find((c) => c.id === id)!.value
  return finish(p, claims.map((c) => (c.id === id ? { ...c, status: none ? ('accepted' as const) : ('possible' as const), reason: '' } : c)), none ? { [field]: value } : {})
}

export function setSource(p: Subject, field: ClaimField, id: string, sourceId: string | null): ClaimPatch {
  return finish(p, withCurrent(p, field).map((c) => (c.id === id ? { ...c, sourceId } : c)))
}

/** Typing into the field corrects the accepted version instead of adding one. What is typed is no longer what the source says, so the link to the source goes. */
export function editValue(p: Subject, field: ClaimField, value: string): ClaimPatch {
  const claims = p.claims.some((c) => c.field === field) ? withCurrent(p, field) : p.claims
  const next = value ? claims.map((c) => (c.field === field && c.status === 'accepted' && c.value !== value ? { ...c, value, sourceId: null } : c)) : claims.filter((c) => !(c.field === field && c.status === 'accepted'))
  return finish(p, next, { [field]: value })
}

/** Versions that still compete and say different things. */
export const hasConflict = (p: Subject, field: ClaimField) => new Set(p.claims.filter((c) => c.field === field && c.status !== 'rejected').map((c) => c.value)).size > 1

export const sourceOf = (p: Pick<Person, 'sources'>, c: Pick<Claim, 'sourceId'>): Source | undefined => (c.sourceId ? p.sources.find((s) => s.id === c.sourceId) : undefined)

/** What the card can say about itself, counted from the values that are filled in. */
export function summary(p: Subject) {
  const out = { documented: 0, told: 0, unsourced: 0, conflict: 0 }
  // Names count once someone has given them a source or a second version; a bare name says nothing.
  const named = NAME_FIELDS.filter((f) => p.claims.some((c) => c.field === f))
  for (const field of [...CLAIM_FIELDS, ...named]) {
    if (hasConflict(p, field)) out.conflict++
    if (!p[field]) continue
    // Any source that says the same thing supports the value; the strongest one counts.
    const backing = p.claims.filter((x) => x.field === field && x.status !== 'rejected' && x.value === p[field]).map((x) => sourceOf(p, x)).filter(Boolean)
    if (backing.some((s) => s!.reliability === 'original' || s!.reliability === 'copy' || s!.reliability === 'transcript')) out.documented++
    else if (backing.length) out.told++
    else out.unsourced++
  }
  return out
}

/** The one mark the chart and GEDCOM need, worked out rather than set by hand. */
export function cardCertainty(p: Subject): Certainty {
  const s = summary(p)
  if (s.documented + s.told + s.unsourced === 0) return p.certainty
  // A guess marks the card only while nothing better stands behind that value.
  const guess = p.claims.some((c) => c.status === 'accepted' && sourceOf(p, c)?.reliability === 'guess'
    && !p.claims.some((x) => x.field === c.field && x.value === c.value && x.status !== 'rejected' && sourceOf(p, x) && sourceOf(p, x)!.reliability !== 'guess'))
  if (guess) return 'assumed'
  return s.documented && !s.told && !s.unsourced && !s.conflict ? 'documented' : 'family'
}

/**
 * Two cards become one. Every version either held stays. Where the cards disagreed, the value picked is the accepted
 * one and the other stays as a possible version, so nothing anyone wrote is lost.
 */
export function mergeClaims(keep: Claim[], drop: Claim[], fields: { field: ClaimField; keep: string; drop: string; chosen: string }[], id: () => string): Claim[] {
  const ids = new Set(keep.map((c) => c.id))
  const out = [...keep, ...drop.map((c) => (ids.has(c.id) ? { ...c, id: id() } : c))]
  const same = (c: Claim, field: ClaimField, value: string) => c.field === field && c.value === value
  for (const { field, keep: a, drop: b, chosen } of fields) {
    if (!(a && b && a !== b) && !out.some((c) => c.field === field)) continue
    for (const value of [a, b]) {
      if (value && !out.some((c) => same(c, field, value))) out.push({ id: id(), field, value, sourceId: null, status: 'possible', reason: '', at: Date.now() })
    }
    for (const c of out) {
      if (c.field !== field || c.status === 'rejected') continue
      c.status = c.value === chosen ? 'accepted' : 'possible'
    }
    // The same value noted on both cards is one version, not two.
    const first = out.find((c) => same(c, field, chosen) && c.status === 'accepted')
    for (let i = out.length - 1; i >= 0; i--) if (out[i] !== first && same(out[i], field, chosen) && out[i].status === 'accepted') out.splice(i, 1)
  }
  return out.map((c) => ({ ...c }))
}

