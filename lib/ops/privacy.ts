// What a reader may not see. Every way out of the archive goes through these: the graph, pages, photos, history,
// exports. A reader sees the dead, and themself; the living, and anyone the family keeps private, stay on the chart as
// unnamed cards.
import type { Graph, Person, Sex } from '../types'
import { type Actor, seesOnlyPublic } from './core'

/** Whom a reader may not see: the living, and anyone marked private. */
export const isPrivate = (p: { living: boolean; keepPrivate?: boolean }) => p.living || !!p.keepPrivate

export function hiddenFor(actor: Actor, p: { id: string; living: boolean; keepPrivate?: boolean }) {
  if (actor.guest?.only && !actor.guest.only.has(p.id)) return true
  return seesOnlyPublic(actor) && isPrivate(p) && p.id !== actor.personId
}

/** The same card with nothing in it that could say who this is. */
export const maskPerson = (p: Person): Person => ({ ...p, givenName: '', surname: '', maidenName: '', patronymic: '', otherNames: '', birthDate: '', birthYear: null, birthPlace: '', deathDate: '', deathPlace: '', sex: 'U' as Sex, avatarMediaId: null, avatarCrop: null, tags: [], facts: [], sources: [], claims: [], hidden: true })

/** Who is masked for this person, given the graph they were sent. Empty for anyone who sees everyone. */
export const hiddenIn = (actor: Actor, graph: Graph) => (seesOnlyPublic(actor) ? new Set(graph.persons.filter((p) => p.hidden).map((p) => p.id)) : new Set<string>())
