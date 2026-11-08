// Measures a finished chart by its geometry, so the numbers do not depend on how the layout works inside.
import type { Layout } from '../lib/graph/layout'
import { AVATAR_CY, CARD_W } from '../lib/graph/layout'
import type { Graph, Person } from '../lib/types'

type Seg = { x1: number; y1: number; x2: number; y2: number; owner: string; people: Set<string> }

function segments(d: string, owner: string, people: Set<string>): Seg[] {
  const out: Seg[] = []
  let x = 0, y = 0
  const to = (nx: number, ny: number) => { if (nx !== x || ny !== y) out.push({ x1: x, y1: y, x2: nx, y2: ny, owner, people }); x = nx; y = ny }
  for (const m of d.matchAll(/([MLHVQ])([-\d. ]+)/g)) {
    const n = m[2].trim().split(/\s+/).map(Number)
    if (m[1] === 'M') { x = n[0]; y = n[1] } else if (m[1] === 'L') to(n[0], n[1]); else if (m[1] === 'H') to(n[0], y); else if (m[1] === 'V') to(x, n[0]); else { to(n[0], n[1]); to(n[2], n[3]) }
  }
  return out
}
const horizontal = (s: Seg) => s.y1 === s.y2
const between = (v: number, a: number, b: number, m = 0) => v > Math.min(a, b) + m && v < Math.max(a, b) - m

export function quality(l: Layout, g: Graph) {
  const segs: Seg[] = []
  const groups = new Set<string>()
  for (const e of l.edges) {
    const people = new Set([e.childId, ...e.parentIds])
    if (!groups.has(e.group)) { groups.add(e.group); segs.push(...segments(e.shared, e.familyKey, new Set(l.edges.filter((o) => o.group === e.group).flatMap((o) => [o.childId, ...o.parentIds])))) }
    segs.push(...segments(e.own, e.familyKey, people))
  }
  for (const u of l.unions) segs.push(...segments(u.path, u.id, new Set([u.union.aId, u.union.bId])))
  const hs = segs.filter(horizontal), vs = segs.filter((s) => !horizontal(s))
  let crossings = 0, overlaps = 0
  for (const h of hs) for (const v of vs) if (h.owner !== v.owner && between(v.x1, h.x1, h.x2) && between(h.y1, v.y1, v.y2)) crossings++
  for (const [list, along] of [[hs, 'x'], [vs, 'y']] as const) {
    const a1 = along === 'x' ? 'x1' : 'y1', a2 = along === 'x' ? 'x2' : 'y2', c = along === 'x' ? 'y1' : 'x1'
    const byLine = Map.groupBy(list, (s) => Math.round(s[c]))
    for (const same of byLine.values()) for (let i = 0; i < same.length; i++) for (let j = i + 1; j < same.length; j++) {
      const p = same[i], q = same[j]
      if (p.owner !== q.owner && Math.min(Math.max(p[a1], p[a2]), Math.max(q[a1], q[a2])) - Math.max(Math.min(p[a1], p[a2]), Math.min(q[a1], q[a2])) > 1) overlaps++
    }
  }
  // Lines running through someone else's portrait or the part of a caption where text can be.
  let throughCards = 0
  const persons = new Map(g.persons.map((p) => [p.id, p]))
  for (const c of l.cards.values()) {
    const top = c.y, bottom = c.y + AVATAR_CY + 30 + 13 + 34
    const halfText = Math.min(CARD_W / 2, 78)
    for (const s of segs) {
      if (s.people.has(c.id) || !persons.has(c.id)) continue
      const hit = horizontal(s) ? between(s.y1, top, bottom) && Math.max(s.x1, s.x2) > c.x - halfText && Math.min(s.x1, s.x2) < c.x + halfText : between(s.x1, c.x - halfText, c.x + halfText) && Math.max(s.y1, s.y2) > top && Math.min(s.y1, s.y2) < bottom
      if (hit) throughCards++
    }
  }
  // Children of one family at different depths may share a trunk, so lines count per family.
  // A trunk between partners must have a clear strip beside the captions.
  const tight = l.unions.filter((u) => u.x2 - u.x1 < 162 + 8 && l.cards.get(u.union.aId)?.y === l.cards.get(u.union.bId)?.y).length
  return { crossings, overlaps, throughCards, tight, width: Math.round(l.bounds.w), height: Math.round(l.bounds.h) }
}

const person = (id: string, sex: Person['sex'], birthYear: number | null = null) => ({ id, sex, birthYear, givenName: id, surname: '' }) as unknown as Person
export function buildGraph(p: [string, Person['sex'], number?][], parents: [string, string][], unions: [string, string][]): Graph {
  return {
    persons: p.map(([id, sex, y]) => person(id, sex, y ?? null)),
    parentChild: parents.map(([parentId, childId], i) => ({ id: `l${i}`, parentId, childId, kind: 'birth', certainty: 'family' })),
    unions: unions.map(([aId, bId], i) => ({ id: `u${i}`, aId, bId, kind: 'marriage' })),
  } as unknown as Graph
}

/** The shape from the bug report, with invented names: a woman with two husbands, relatives standing far from each other. */
export const TANGLE = buildGraph(
  [['mother', 'F', 1830], ['loner', 'M', 1912], ['unknown', 'U'], ['father2', 'M', 1832], ['mother2', 'M', 1834], ['brother', 'M', 1860], ['army', 'M', 1862], ['ivan', 'M', 1859], ['olga', 'F', 1861], ['k1', 'F'], ['k1s', 'M'], ['k1t', 'M'], ['k2', 'F'], ['k3', 'F'], ['k4', 'F']],
  [['mother', 'ivan'], ['unknown', 'brother'], ['unknown', 'olga'], ['father2', 'army'], ['mother2', 'army'], ['ivan', 'k1'], ['ivan', 'k1s'], ['ivan', 'k1t'], ['ivan', 'k2'], ['olga', 'k2'], ['ivan', 'k3'], ['olga', 'k3'], ['ivan', 'k4'], ['olga', 'k4']],
  [['father2', 'mother2'], ['army', 'ivan'], ['ivan', 'olga'], ['k1', 'k1s'], ['k1s', 'k1t']],
)

/** A small seeded generator: couples, remarriages, cousins marrying, unknown parents, several separate branches. */
export function randomFamily(seed: number, size: number): Graph {
  let s = seed
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)]
  const p: [string, Person['sex'], number?][] = [], parents: [string, string][] = [], unions: [string, string][] = []
  const add = (y: number, sex: Person['sex'] = rnd() < 0.5 ? 'M' : 'F') => { const id = `p${p.length}`; p.push([id, sex, y]); return id }
  const year = new Map<string, number>()
  const married = new Set<string>()
  const couple: [string, string, number][] = []
  const wed = (a: string, y: number) => { const b = add(y); year.set(b, y); unions.push([a, b]); married.add(a); married.add(b); couple.push([a, b, y]) }
  for (let i = 0; i < 1 + Math.floor(size / 60); i++) { const a = add(1750 + i * 20); year.set(a, 1750 + i * 20); wed(a, 1750 + i * 20) }
  const singles: string[] = []
  for (let guard = 0; p.length < size && guard < size * 20; guard++) {
    const [a, b, y] = couple.shift() ?? pick(couple.length ? couple : [[p[0][0], p[1][0], 1750] as [string, string, number]])
    const n = 1 + Math.floor(rnd() * 4)
    for (let k = 0; k < n && p.length < size; k++) {
      const c = add(y + 25 + k * 2); year.set(c, y + 25 + k * 2)
      parents.push([a, c])
      if (rnd() < 0.9) parents.push([b, c])
      const roll = rnd()
      if (roll < 0.55) wed(c, y + 26 + k)
      else if (roll < 0.65) singles.push(c)
      if (roll < 0.08 && married.has(c)) wed(c, y + 30 + k) // a second marriage
    }
    if (singles.length > 1 && rnd() < 0.15) {
      const x = singles.shift()!, w = singles.shift()!
      if (!parents.some(([pa, ch]) => ch === x && parents.some(([pb, ch2]) => ch2 === w && pb === pa))) { unions.push([x, w]); couple.push([x, w, year.get(x)!]) }
    }
    if (rnd() < 0.08 && singles.length) { const k = add((year.get(singles[0]) ?? 1800) - 25, 'U'); parents.push([k, singles.shift()!]) }
  }
  return buildGraph(p, parents, unions)
}

/** Lines of different families running side by side so close that the eye cannot follow either. */
export function nearLines(l: Layout, gap = 12) {
  const segs: Seg[] = []
  const groups = new Set<string>()
  for (const e of l.edges) {
    if (!groups.has(e.group)) { groups.add(e.group); segs.push(...segments(e.shared, e.familyKey, new Set())) }
    segs.push(...segments(e.own, e.familyKey, new Set()))
  }
  for (const u of l.unions) segs.push(...segments(u.path, u.id, new Set()))
  let near = 0
  for (const horiz of [true, false]) {
    const list = segs.filter((s) => horizontal(s) === horiz)
    const [a1, a2, c] = horiz ? (['x1', 'x2', 'y1'] as const) : (['y1', 'y2', 'x1'] as const)
    const sorted = list.toSorted((p, q) => p[c] - q[c])
    for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length && sorted[j][c] - sorted[i][c] < gap; j++) {
      const p = sorted[i], q = sorted[j]
      const d = q[c] - p[c]
      if (d < 1 || p.owner === q.owner) continue
      if (Math.min(Math.max(p[a1], p[a2]), Math.max(q[a1], q[a2])) - Math.max(Math.min(p[a1], p[a2]), Math.min(q[a1], q[a2])) > 4) near++
    }
  }
  return near
}

/**
 * How well a chart keeps families apart and relatives together, from where the cards stand.
 * intrusions: strangers standing inside the stretch a branch covers in a row (a branch is the descendants of one person with their partners).
 * parentSpan: how far a child stands from its parents, in cards. cousinSpan: how far first cousins stand from each other, in cards.
 */
export function kinship(l: Layout, g: Graph, pitch = 162) {
  const kids = new Map<string, string[]>(), parents = new Map<string, string[]>(), mates = new Map<string, string[]>()
  for (const e of g.parentChild) { kids.set(e.parentId, [...(kids.get(e.parentId) ?? []), e.childId]); parents.set(e.childId, [...(parents.get(e.childId) ?? []), e.parentId]) }
  for (const u of g.unions) { mates.set(u.aId, [...(mates.get(u.aId) ?? []), u.bId]); mates.set(u.bId, [...(mates.get(u.bId) ?? []), u.aId]) }
  const at = (id: string) => l.cards.get(id)
  let intrusions = 0, branches = 0
  const detail: { id: string; n: number; who: string[] }[] = []
  const up = (id: string) => parents.get(id) ?? []
  const closure = (id: string, next: (x: string) => string[]) => { const seen = new Set<string>(); const st = [...next(id)]; while (st.length) { const x = st.pop()!; if (seen.has(x) || x === id) continue; seen.add(x); st.push(...next(x)) } return seen }
  for (const p of g.persons) {
    // Everyone below a person, and everyone above one, should each stand as one stretch of their row.
    for (const kin of [closure(p.id, (x) => kids.get(x) ?? []), closure(p.id, up)]) {
      if (kin.size < 3) continue
      const branch = new Set([p.id, ...(mates.get(p.id) ?? []), ...kin, ...[...kin].flatMap((x) => mates.get(x) ?? [])])
      const rows = Map.groupBy([...branch].map(at).filter((c) => !!c), (c) => c!.y)
      for (const [y, cs] of rows) {
        if (cs.length < 2) continue
        const lo = Math.min(...cs.map((c) => c!.x)), hi = Math.max(...cs.map((c) => c!.x))
        for (const c of l.cards.values()) if (c.y === y && c.x > lo && c.x < hi && !branch.has(c.id)) { intrusions++; const e = detail.find((x) => x.id === p.id) ?? (detail.push({ id: p.id, n: 0, who: [] }), detail.at(-1)!); e.n++; e.who.push(c.id) }
      }
      branches++
    }
  }
  const dist: number[] = []
  for (const [child, ps] of parents) { const c = at(child); const px = ps.map(at).filter((x) => !!x).map((x) => x!.x); if (c && px.length) dist.push(Math.abs(c.x - px.reduce((a, b) => a + b, 0) / px.length) / pitch) }
  const cousins: number[] = []
  const people = g.persons.map((p) => p.id)
  const grand = new Map(people.map((id) => [id, new Set(up(id).flatMap(up))]))
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
    const a = people[i], b = people[j]
    if (up(a).some((x) => up(b).includes(x))) continue
    if ([...grand.get(a)!].some((x) => grand.get(b)!.has(x))) { const ca = at(a), cb = at(b); if (ca && cb) cousins.push(Math.abs(ca.x - cb.x) / pitch) }
  }
  const mean = (xs: number[]) => (xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : 0)
  return { detail, intrusions, branches, parentSpan: mean(dist), cousinSpan: mean(cousins), cousinPairs: cousins.length }
}
