// Brings a kinship research case into the archive. New cards only: matching them to people already here is a decision
// for a person, in the merge dialog, because a name match proves nothing.
import { planCase, type CaseFiles } from '../kinship-case'
import { Actor, mutate, requireRole, OpError } from './core'
import { addParent, addUnion, getGraph, insertPerson } from './people'
import { archiveLang, say } from './settings'

const tagOf = (caseId: string) => `case:${caseId}`

function fresh(actor: Actor, files: CaseFiles) {
  const plan = planCase(files, archiveLang())
  if (plan.problems.length) throw new OpError(422, plan.problems.join('; '))
  const here = new Set(getGraph(actor).persons.flatMap((p) => p.tags))
  const again = plan.people.filter((p) => here.has(tagOf(p.caseId))).map((p) => p.caseId)
  return { plan, again: new Set(again) }
}

export function previewCase(actor: Actor, files: CaseFiles) {
  requireRole(actor, 'editor')
  const { plan, again } = fresh(actor, files)
  return { people: plan.people.length - again.size, already: again.size, parents: plan.parents.length, unions: plan.unions.length, candidates: plan.candidates, openRelations: plan.openRelations, leftOut: plan.leftOut.length, living: plan.people.filter((p) => p.living).length }
}

export function importCase(actor: Actor, files: CaseFiles) {
  requireRole(actor, 'editor')
  const { plan, again } = fresh(actor, files)
  const added = plan.people.length - again.size
  return mutate(actor, { summary: `${say('Импорт дела')}: ${added}` }, (c) => {
    const ids = new Map<string, string>()
    for (const p of getGraph(actor).persons) for (const t of p.tags) if (t.startsWith('case:')) ids.set(t.slice(5), p.id)
    for (const p of plan.people) {
      if (again.has(p.caseId)) continue
      ids.set(p.caseId, insertPerson(c, { givenName: p.givenName, patronymic: p.patronymic, surname: p.surname, otherNames: p.otherNames, sex: p.sex, birthDate: p.birthDate, deathDate: p.deathDate, living: p.living, certainty: p.certainty, facts: p.facts, sources: p.sources, tags: [tagOf(p.caseId)] }))
    }
    // On a second import only what joins a new card is added, so nothing doubles.
    for (const l of plan.parents) if (!again.has(l.parent) || !again.has(l.child)) addParent(c, ids.get(l.parent)!, ids.get(l.child)!, l.kind, l.certainty)
    for (const u of plan.unions) if (!again.has(u.a) || !again.has(u.b)) addUnion(c, ids.get(u.a)!, ids.get(u.b)!, u.kind, '', '', '', u.certainty)
    return { persons: added, parents: plan.parents.length, unions: plan.unions.length }
  })
}
