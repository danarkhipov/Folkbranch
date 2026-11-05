// Who belongs to a part of the family. Pure, so the page and the server choose people the same way.
import type { Family } from '../kinship'

/** Parents, spouses, children, siblings and grandparents: the people closest to someone. */
export function nearFamily(family: Family, id: string) {
  const parents = family.parents.get(id) ?? []
  const siblings = parents.flatMap((p) => family.children.get(p) ?? []).filter((c) => c !== id)
  const grand = parents.flatMap((p) => family.parents.get(p) ?? [])
  return [...new Set([...parents, ...(family.spouses.get(id) ?? []), ...(family.children.get(id) ?? []), ...siblings, ...grand])]
}
