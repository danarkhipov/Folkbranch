// Which people in a file are already in the archive. Cautious on purpose: a wrong match would fold two
// people into one card, so only a clear, single candidate counts and anything doubtful stays a new card.
import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { Imported, ImportedPerson } from '../gedcom'
import { personName, yearOf } from '../types'

type Row = typeof schema.persons.$inferSelect
const plain = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е')
const surnames = (p: { surname: string; maidenName: string }) => [p.surname, p.maidenName].map(plain).filter(Boolean)

function alike(a: ImportedPerson, b: Row) {
  const ga = plain(a.givenName), gb = plain(b.givenName)
  if (!ga || ga !== gb) return 0
  const sa = surnames(a), sb = surnames(b)
  if (sa.length && sb.length && !sa.some((s) => sb.includes(s))) return 0
  if (!sa.length !== !sb.length) return 0
  const pa = plain(a.patronymic), pb = plain(b.patronymic)
  if (pa && pb && pa !== pb) return 0
  if (a.sex !== 'U' && b.sex !== 'U' && a.sex !== b.sex) return 0
  const ya = yearOf(a.birthDate), yb = b.birthYear
  if (ya && yb && Math.abs(ya - yb) > 2) return 0
  return 1 + (pa && pa === pb ? 1 : 0) + (ya && yb && ya === yb ? 2 : 0) + (sa.length ? 1 : 0)
}

/** xref in the file → id of the card it would join. */
export function matchPeople(g: Imported) {
  const rows = getDb().select().from(schema.persons).all()
  const byGiven = Map.groupBy(rows, (r) => plain(r.givenName))
  const found = new Map<string, { row: Row; score: number }>()
  const taken = new Map<string, number>()
  for (const p of g.persons) {
    const scored = (byGiven.get(plain(p.givenName)) ?? []).map((row) => ({ row, score: alike(p, row) })).filter((x) => x.score > 0).sort((x, y) => y.score - x.score)
    // Two equally good cards, or a card two people in the file would both take: leave it to a person.
    if (!scored.length || (scored[1] && scored[1].score === scored[0].score)) continue
    found.set(p.xref, scored[0])
    taken.set(scored[0].row.id, (taken.get(scored[0].row.id) ?? 0) + 1)
  }
  for (const [xref, m] of found) if ((taken.get(m.row.id) ?? 0) > 1) found.delete(xref)
  return found
}

export function matchReport(g: Imported) {
  const found = matchPeople(g)
  const existing = getDb().select().from(schema.parentChild).all()
  const have = new Set(existing.map((l) => `${l.parentId}>${l.childId}`))
  const marriages = new Set(getDb().select().from(schema.unions).all().flatMap((u) => [`${u.aId}+${u.bId}`, `${u.bId}+${u.aId}`]))
  const id = (xref?: string) => (xref ? found.get(xref)?.row.id ?? null : null)
  let links = 0, already = 0
  for (const f of g.families) {
    const parents = [f.husb, f.wife].filter(Boolean) as string[]
    for (const ch of f.children) for (const p of parents) {
      const a = id(p), b = id(ch.xref)
      if (a && b && have.has(`${a}>${b}`)) already++
      else links++
    }
    const a = id(f.husb), b = id(f.wife)
    if (f.husb && f.wife) { if (a && b && marriages.has(`${a}+${b}`)) already++; else links++ }
  }
  const byXref = new Map(g.persons.map((p) => [p.xref, p]))
  return {
    inArchive: getDb().select().from(schema.persons).all().length,
    matched: found.size,
    added: g.persons.length - found.size,
    newLinks: links,
    knownLinks: already,
    pairs: [...found].slice(0, 300).map(([xref, m]) => {
      const p = byXref.get(xref)!
      return { xref, file: [p.givenName, p.patronymic, p.surname].filter(Boolean).join(' '), fileYear: yearOf(p.birthDate), card: personName(m.row as never), cardYear: m.row.birthYear, cardId: m.row.id }
    }),
  }
}

/** Clears the tree for a file that replaces it. Photos and accounts stay; only what pointed at the old cards goes. */
export function accountsLetGo() {
  const db = getDb()
  db.update(schema.user).set({ personId: null }).run()
  db.update(schema.invites).set({ personId: null }).run()
  for (const v of db.select().from(schema.views).all()) if (v.focusId) db.update(schema.views).set({ focusId: null, pins: '{}', collapsed: '[]' }).where(eq(schema.views.id, v.id)).run()
}
