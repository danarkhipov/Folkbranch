// Brings a kinship research case into the archive. New cards only: matching them to people already here is a decision
// for a person, in the merge dialog, because a name match proves nothing. A card from an earlier import of the same case
// only gains what is new: nothing a person wrote or chose there is replaced.
import { z } from 'zod'
import { addVersion } from '../claims'
import { caseTag, planCase, type CasePlan, type CaseFiles, type PlannedPerson } from '../kinship-case'
import type { Person } from '../types'
import { Actor, mutate, requireRole, OpError } from './core'
import { addParent, addUnion, getGraph, insertPerson, normalize, type PersonInput } from './people'
import { archiveLang, say } from './settings'

export const caseFiles = z.object({
  caseId: z.string().min(1).max(300).describe('The case_id from case-intake.yaml, or the name of the case folder'),
  persons: z.string().min(1).describe('Text of person-register.csv'), relationships: z.string().optional(), claims: z.string().optional(), artifacts: z.string().optional(),
})

function additions(cur: Person, p: PlannedPerson): PersonInput | null {
  const patch: PersonInput = {}
  const facts = p.facts.filter((f) => !cur.facts.some((x) => x.kind === f.kind && x.note === f.note))
  const sources = p.sources.filter((s) => !cur.sources.some((x) => x.title === s.title && x.ref === s.ref && x.url === s.url))
  if (facts.length && cur.facts.length < 100) patch.facts = [...cur.facts, ...facts].slice(0, 100)
  if (sources.length && cur.sources.length < 100) patch.sources = [...cur.sources, ...sources].slice(0, 100)
  let subject = cur
  for (const field of ['birthDate', 'deathDate'] as const) {
    const value = p[field]
    // A version someone already turned down stays turned down.
    if (!value || value === subject[field] || subject.claims.some((c) => c.field === field && c.value === value)) continue
    const version = addVersion(subject, field, value, null)
    Object.assign(patch, version)
    subject = { ...subject, ...version }
  }
  if (patch.deathDate) patch.living = false
  return Object.keys(patch).length ? patch : null
}

function compare(actor: Actor, files: CaseFiles) {
  const plan: CasePlan = planCase(files, archiveLang())
  if (plan.problems.length) throw new OpError(422, plan.problems.join('; '))
  const graph = getGraph(actor)
  const ids = new Map<string, string>()
  for (const p of graph.persons) for (const tag of p.tags) ids.set(tag, p.id)
  const idOf = (caseId: string) => ids.get(caseTag(files.caseId, caseId))
  const byId = new Map(graph.persons.map((p) => [p.id, p]))
  const fresh = plan.people.filter((p) => !idOf(p.caseId))
  const updates = plan.people.flatMap((p) => {
    const id = idOf(p.caseId)
    const patch = id ? additions(byId.get(id)!, p) : null
    return id && patch ? [{ id, patch }] : []
  })
  const parentLine = (parent?: string, child?: string) => graph.parentChild.find((l) => l.parentId === parent && l.childId === child)
  const unionLine = (a?: string, b?: string) => graph.unions.find((u) => (u.aId === a && u.bId === b) || (u.aId === b && u.bId === a))
  const hasParent = (parent?: string, child?: string) => !!parentLine(parent, child)
  const hasUnion = (a?: string, b?: string) => !!unionLine(a, b)
  const parents = plan.parents.filter((l) => !hasParent(idOf(l.parent), idOf(l.child)))
  const unions = plan.unions.filter((u) => !hasUnion(idOf(u.a), idOf(u.b)))
  const disputed = plan.disputed.filter(({ a, b }) => hasUnion(idOf(a), idOf(b)) || hasParent(idOf(a), idOf(b)) || hasParent(idOf(b), idOf(a)))
  // A line the case has since proved firms up. It never goes the other way: taking back a line is a person's decision.
  const firmer = (line: { certainty: string } | undefined, certainty: string) => line?.certainty === 'assumed' && certainty === 'documented'
  const provedParents = plan.parents.flatMap((l) => { const line = parentLine(idOf(l.parent), idOf(l.child)); return line && firmer(line, l.certainty) ? [line.id] : [] })
  const provedUnions = plan.unions.flatMap((u) => { const line = unionLine(idOf(u.a), idOf(u.b)); return line && firmer(line, u.certainty) ? [line.id] : [] })
  return { plan, fresh, updates, parents, unions, disputed, ids, provedParents, provedUnions }
}

export function previewCase(actor: Actor, files: CaseFiles) {
  requireRole(actor, 'editor')
  const { plan, fresh, updates, parents, unions, disputed, provedParents, provedUnions } = compare(actor, files)
  return {
    people: fresh.length, already: plan.people.length - fresh.length, updated: updates.length, parents: parents.length, unions: unions.length, proved: provedParents.length + provedUnions.length,
    candidates: fresh.filter((p) => p.candidate).length, openRelations: plan.openRelations, leftOut: plan.leftOut.length, living: fresh.filter((p) => p.living).length,
    disputed: disputed.length, broken: plan.broken, trimmed: plan.trimmed,
  }
}

export function importCase(actor: Actor, files: CaseFiles) {
  requireRole(actor, 'editor')
  const { fresh, updates, parents, unions, ids, provedParents, provedUnions } = compare(actor, files)
  const result = { persons: fresh.length, updated: updates.length, parents: parents.length, unions: unions.length }
  if (!fresh.length && !updates.length && !parents.length && !unions.length && !provedParents.length && !provedUnions.length) return result
  return mutate(actor, { summary: `${say('Импорт дела')}: ${fresh.length}` }, (c) => {
    const idOf = (caseId: string) => ids.get(caseTag(files.caseId, caseId))!
    for (const p of fresh) {
      const tag = caseTag(files.caseId, p.caseId)
      ids.set(tag, insertPerson(c, { givenName: p.givenName, patronymic: p.patronymic, surname: p.surname, otherNames: p.otherNames, sex: p.sex, birthDate: p.birthDate, deathDate: p.deathDate, living: p.living, certainty: p.certainty, facts: p.facts, sources: p.sources, tags: [tag] }))
    }
    for (const u of updates) c.update('persons', u.id, normalize(u.patch))
    for (const l of parents) addParent(c, idOf(l.parent), idOf(l.child), l.kind, l.certainty)
    for (const u of unions) addUnion(c, idOf(u.a), idOf(u.b), u.kind, '', '', '', u.certainty)
    for (const id of provedParents) c.update('parentChild', id, { certainty: 'documented' })
    for (const id of provedUnions) c.update('unions', id, { certainty: 'documented' })
    return result
  })
}
