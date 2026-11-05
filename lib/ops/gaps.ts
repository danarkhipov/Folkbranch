// What is still unfinished, person by person. The assistant and the page share this list.
import { CLAIM_FIELDS, hasConflict, NAME_FIELDS, summary } from '../claims'
import type { Person } from '../types'
import type { Actor } from './core'
import { getGraph } from './people'

export function findGaps(actor: Actor, { limit = 30, onlyConflicts = false }: { limit?: number; onlyConflicts?: boolean } = {}) {
  const g = getGraph(actor)
  const parents = new Set(g.parentChild.map((l) => l.childId))
  return g.persons.filter((p) => !p.hidden).map((p: Person) => {
    const missing = [!p.birthDate && 'birthDate', !p.birthPlace && 'birthPlace', !p.living && !p.deathDate && 'deathDate', !p.living && !p.deathPlace && 'deathPlace', !parents.has(p.id) && 'parents', p.sex === 'U' && 'sex'].filter(Boolean) as string[]
    return { person: p, missing, unsourced: summary(p).unsourced, conflicts: CLAIM_FIELDS.concat(NAME_FIELDS).filter((f) => hasConflict(p, f)) as string[] }
  }).filter((r) => (onlyConflicts ? r.conflicts.length : r.missing.length || r.unsourced || r.conflicts.length))
    .sort((p, q) => q.conflicts.length - p.conflicts.length || q.missing.length - p.missing.length).slice(0, limit)
}
