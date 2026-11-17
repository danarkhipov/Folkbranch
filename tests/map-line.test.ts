import { describe, expect, it } from 'vitest'
import { bearerAt, clipLeg, descentLine, lineFor, lineThread, threadPoints, withLine, type Bearer } from '../lib/map-line'
import { mapTimeline, trackLegs } from '../lib/map-timeline'
import type { Graph, Person, Place } from '../lib/types'

const parents = (links: [string, string][]) => {
  const m = new Map<string, string[]>()
  for (const [p, c] of links) { m.set(c, [...(m.get(c) ?? []), p]); if (!m.has(p)) m.set(p, []) }
  return m
}

describe('the chain from an ancestor down to someone', () => {
  // a → b → c → d, and a → x → d as well (a shorter way round through x), and y → x.
  const fam = parents([['a', 'b'], ['b', 'c'], ['c', 'd'], ['a', 'x'], ['x', 'd'], ['y', 'x']])
  it('takes the shortest when there are several', () => {
    expect(descentLine(fam, 'a', 'd')).toEqual(['a', 'x', 'd'])
  })
  it('is null when there is none, or for the person themselves', () => {
    expect(descentLine(fam, 'd', 'a')).toBeNull()
    expect(descentLine(fam, 'b', 'x')).toBeNull()
    expect(descentLine(fam, 'd', 'd')).toBeNull()
    expect(descentLine(fam, 'zz', 'd')).toBeNull()
  })
  it('is the two of them when the ancestor is a parent', () => {
    expect(descentLine(fam, 'c', 'd')).toEqual(['c', 'd'])
    expect(descentLine(fam, 'y', 'd')).toEqual(['y', 'x', 'd'])
  })
  // Two equally short ways from g to m: through p (hidden) or through q, and through r (nothing placed) or s.
  const cousins = parents([['g', 'p'], ['g', 'q'], ['p', 'm'], ['q', 'm'], ['h', 'r'], ['h', 's'], ['r', 'n'], ['s', 'n']])
  it('goes round a hidden person when another way is as short, and keeps one as the only way', () => {
    expect(descentLine(cousins, 'g', 'm', { hidden: (id) => id === 'p' })).toEqual(['g', 'q', 'm'])
    expect(descentLine(cousins, 'g', 'm', { hidden: (id) => id === 'p' || id === 'q' })).toHaveLength(3)
  })
  it('counts step and adoptive parents as kinship does, but takes a chain of birth links first among equal ones', () => {
    // j → k (step) → o and j → l (birth) → o: both two links long.
    const both = parents([['j', 'k'], ['j', 'l'], ['k', 'o'], ['l', 'o']])
    const kind = (p: string, c: string) => (p === 'j' && c === 'k' ? 'step' as const : 'birth' as const)
    expect(descentLine(both, 'j', 'o', { kind })).toEqual(['j', 'l', 'o'])
    // Even through a hidden person: being born of them matters more than being seen.
    expect(descentLine(both, 'j', 'o', { kind, hidden: (id) => id === 'l' })).toEqual(['j', 'l', 'o'])
    // A step link alone still makes an ancestor, as kinship names a step-grandparent a grandparent.
    expect(descentLine(parents([['j', 'k'], ['k', 'o']]), 'j', 'o', { kind })).toEqual(['j', 'k', 'o'])
  })
  it('never loops on a cycle, and runs down a very deep pedigree without running out of stack', () => {
    const loop = parents([['a', 'b'], ['b', 'c'], ['c', 'a'], ['x', 'c']])
    expect(descentLine(loop, 'a', 'c')).toEqual(['a', 'b', 'c'])
    expect(descentLine(loop, 'c', 'b')).toEqual(['c', 'a', 'b'])
    expect(descentLine(parents([['a', 'a'], ['a', 'b']]), 'a', 'b')).toEqual(['a', 'b'])
    const deep: [string, string][] = []
    for (let i = 0; i < 20000; i++) deep.push([`p${i + 1}`, `p${i}`])
    const t0 = performance.now()
    expect(descentLine(parents(deep), 'p20000', 'p0')).toHaveLength(20001)
    expect(performance.now() - t0).toBeLessThan(1000)
  })
  it('prefers the better documented of equal ways, then the first written', () => {
    expect(descentLine(cousins, 'h', 'n', { placed: (id) => id !== 'r' })).toEqual(['h', 's', 'n'])
    expect(descentLine(cousins, 'h', 'n')).toEqual(['h', 'r', 'n'])
  })
})

describe('which line is offered', () => {
  const fam = parents([['a', 'b'], ['b', 'c'], ['c', 'me'], ['c', 'root']])
  it('runs to the reader first, else to the tree root', () => {
    expect(lineFor(fam, 'a', ['me', 'root'])).toEqual({ ids: ['a', 'b', 'c', 'me'], end: 'me' })
    expect(lineFor(fam, 'a', [null, 'root'])).toEqual({ ids: ['a', 'b', 'c', 'root'], end: 'root' })
    expect(lineFor(fam, 'me', ['me', 'root'])).toBeNull()
    expect(lineFor(fam, null, ['me'])).toBeNull()
  })
  it('is never offered from or to someone hidden, and a hidden middle stays in the line', () => {
    expect(lineFor(fam, 'a', ['me', 'root'], { hidden: (id) => id === 'a' })).toBeNull()
    expect(lineFor(fam, 'a', ['me', 'root'], { hidden: (id) => id === 'me' })).toEqual({ ids: ['a', 'b', 'c', 'root'], end: 'root' })
    expect(lineFor(fam, 'a', ['me'], { hidden: (id) => id === 'me' })).toBeNull()
    expect(lineFor(fam, 'a', ['me'], { hidden: (id) => id === 'b' })!.ids).toEqual(['a', 'b', 'c', 'me'])
  })
  it('is null for an id nobody has', () => {
    expect(lineFor(fam, 'zz', ['me'])).toBeNull()
    expect(lineFor(fam, 'a', ['zz'])).toBeNull()
  })
})

const person = (id: string, extra: Partial<Person> = {}): Person => ({ id, givenName: id, surname: '', maidenName: '', patronymic: '', otherNames: '', sex: 'U', birthDate: '', birthYear: null, birthPlace: '', deathDate: '', deathYear: null, deathPlace: '', living: false, certainty: 'documented', avatarMediaId: null, avatarCrop: null, updatedAt: 0, tags: [], facts: [], sources: [], claims: [], ...extra })
const place = (name: string, lat: number, lon: number): Place => ({ id: name, name, kind: '', parentId: null, otherNames: [], lat, lon, note: '' })
const places = [place('Reus', 41.15, 1.1), place('Madrid', 40.4, -3.7), place('Buenos Aires', -34.6, -58.4), place('New York', 40.7, -74), place('Boston', 42.36, -71.06)]
const fact = (kind: string, date: string, p: string) => ({ kind, date, place: p, note: '' })
const born = (y: number, p: string, extra: Partial<Person> = {}) => ({ birthDate: String(y), birthYear: y, birthPlace: p, ...extra })
// Ana (Reus 1840, Madrid 1870) → Bea (Madrid 1872, Buenos Aires 1900, New York 1920) → Cai (New York 1925, Boston
// 1950) → Dan (born 1955 in Boston, still alive); Bea's last move, to New York, comes after Cai is born there.
const graph = {
  persons: [
    person('ana', born(1840, 'Reus', { deathDate: '1910', deathYear: 1910, facts: [fact('Moved', '1870', 'Madrid'), fact('Moved', '1890', 'Reus')] })),
    person('bea', born(1872, 'Madrid', { deathDate: '1950', deathYear: 1950, facts: [fact('Moved', '1900', 'Buenos Aires'), fact('Moved', '1930', 'New York')] })),
    person('cai', born(1925, 'New York', { deathDate: '2000', deathYear: 2000, facts: [fact('Moved', '1950', 'Boston')] })),
    person('dan', born(1955, 'Boston', { living: true })),
  ],
  parentChild: [], unions: [],
} as unknown as Graph
const tl = mapTimeline(graph, places)
const track = (id: string) => tl.tracks.find((t) => t.personId === id) ?? null
const bearer = (id: string, b: number | null): Bearer => ({ id, track: track(id), born: b })

describe('the thread of a line', () => {
  const th = lineThread([bearer('ana', 1840), bearer('bea', 1872), bearer('cai', 1925), bearer('dan', 1955)], 2026)
  it('hands over at each birth, from the first placed event to now', () => {
    expect(th.stretches.map((s) => [s.personId, s.from, s.to])).toEqual([['ana', 1840, 1872], ['bea', 1872, 1925], ['cai', 1925, 1955], ['dan', 1955, 2026]])
    expect(th.handovers.map((h) => [h.gen, h.year, h.child, h.parent, h.place, h.birth])).toEqual([[1, 1840, 'ana', null, 'Reus', false], [2, 1872, 'bea', 'ana', 'Madrid', true], [3, 1925, 'cai', 'bea', 'New York', true], [4, 1955, 'dan', 'cai', 'Boston', true]])
    expect([th.start, th.end]).toEqual([1840, 2026])
  })
  it('follows each bearer only over their own stretch, and keeps the rest of their life as a branch', () => {
    // Ana's Madrid move is hers on the thread; her return to Reus in 1890 is after Bea was born.
    expect(th.stretches[0].segs.map((s) => s.kind)).toEqual(['route'])
    expect(th.branches.find((b) => b.personId === 'ana')!.segs).toHaveLength(1)
    // Bea: to Buenos Aires on the thread; New York in 1930 after Cai was born, so a branch.
    expect(th.branches.find((b) => b.personId === 'bea')!.segs.at(-1)!.pts.at(-1)![1]).toBeCloseTo(-74)
    expect(th.branches.some((b) => b.personId === 'dan')).toBe(false)
  })
  it('joins a parent somewhere else at a birth with an assumed link, and never invents a place', () => {
    // At Cai's birth in New York (1925) Bea was in Buenos Aires.
    const cai = th.stretches[2]
    expect(cai.segs[0].kind).toBe('link')
    expect(cai.segs[0].pts[0][0]).toBeCloseTo(-34.6)
    expect(cai.segs[0].pts.at(-1)![1]).toBeCloseTo(-74)
    expect(th.handovers[2].linked).toBe(true)
    expect(th.handovers[1].linked).toBe(false)
    // Every point of the thread is on a route or a link between two documented places.
    const all = threadPoints(th)
    expect(all.every(([lat, lon]) => lat > -40 && lat < 45 && lon > -80 && lon < 5)).toBe(true)
  })
  it('passes over a bearer with nothing placed with a link from the last known point to the next', () => {
    const t2 = lineThread([bearer('ana', 1840), { id: 'ghost', track: null, born: 1872 }, bearer('cai', 1925)], 2026)
    expect(t2.stretches.map((s) => [s.personId, s.from, s.to])).toEqual([['ana', 1840, 1872], ['ghost', 1872, 1925], ['cai', 1925, 2000]])
    expect(t2.stretches[1].segs).toEqual([])
    const l = t2.stretches[2].segs[0]
    expect(l.kind).toBe('link')
    // From Madrid, where Ana stood when she handed over, in the last stretch before Cai's birth.
    expect(l.pts[0][1]).toBeCloseTo(-3.7)
    expect(l.at[0]).toBeCloseTo(1925 - 1.5)
    expect(t2.handovers.find((h) => h.child === 'ghost')).toMatchObject({ lat: null, place: '' })
  })
  it('says when nobody in the line stands anywhere on the map', () => {
    expect(th.placed).toBe(true)
    expect(lineThread([{ id: 'x', track: null, born: 1900 }, { id: 'y', track: null, born: null }], 2026).placed).toBe(false)
    expect(lineThread([{ id: 'x', track: track('ana'), born: 1840, hidden: true }, { id: 'y', track: null, born: 1900 }], 2026).placed).toBe(false)
  })
  it('names nothing of a hidden person: no stretch, no handover, the line goes on round them', () => {
    const t3 = lineThread([bearer('ana', 1840), { id: 'hid', track: null, born: null, hidden: true }, bearer('cai', 1925)], 2026)
    expect(t3.stretches.map((s) => s.personId)).toEqual(['ana', 'cai'])
    expect(t3.handovers.map((h) => h.child)).toEqual(['ana', 'cai'])
    expect(t3.stretches[0].to).toBe(1925)
  })
  it('takes the next birth from the first placed event when the year is unknown, never before the parent', () => {
    const t4 = lineThread([bearer('ana', 1840), { id: 'bea', track: track('bea'), born: null }], 2026)
    expect(t4.handovers[1]).toMatchObject({ year: 1872, birth: false })
    const t5 = lineThread([bearer('bea', 1872), { id: 'ana', track: track('ana'), born: 1840 }], 2026)
    expect(t5.handovers[1].year).toBe(1872)
  })
  it('says where a birth was only when the archive does, and calls a handover a birth only in the birth year', () => {
    expect(th.handovers[1]).toMatchObject({ birth: true, bornAt: 'Madrid' })
    // Cai's birth year is known but not where: he takes the thread up where he is first placed, not born there.
    const nowhere = mapTimeline({ ...graph, persons: graph.persons.map((p) => (p.id === 'cai' ? { ...p, birthPlace: '' } : p)) } as Graph, places)
    const cai = { id: 'cai', track: nowhere.tracks.find((t) => t.personId === 'cai')!, born: 1925 }
    // The mark there tells the year the archive first puts him in Boston, not his birth year.
    expect(lineThread([bearer('bea', 1872), cai], 2026).handovers[1]).toMatchObject({ year: 1925, birth: true, place: 'Boston', placeYear: 1950, bornAt: '' })
    expect(th.handovers.map((h) => h.placeYear)).toEqual([1840, 1872, 1925, 1955])
    // Ana "born" before her parent Bea: the handover waits for Bea, and that year is not Ana's birth.
    expect(lineThread([bearer('bea', 1872), bearer('ana', 1840)], 2026).handovers[1]).toMatchObject({ year: 1872, birth: false })
  })
  it('says who carries it at a moment', () => {
    expect([1839, 1850, 1872, 1924.9, 2020].map((y) => bearerAt(th, y))).toEqual([null, 'ana', 'bea', 'bea', 'dan'])
  })
  it('cuts a journey to the years asked, with the cut ends put in', () => {
    const leg = trackLegs(track('ana')!)[0]
    const mid = (leg.leave + leg.arrive) / 2
    const half = clipLeg(leg, leg.leave - 5, mid)!
    expect(half.at[0]).toBe(leg.at[0])
    expect(half.at.at(-1)).toBeCloseTo(mid)
    expect(clipLeg(leg, leg.arrive, leg.arrive + 10)).toBeNull()
  })
})

describe('the people a line adds to a narrowed view', () => {
  // The view shows Ana only; the line runs on through Bea, who married Zoe (hidden from this reader) in Madrid.
  const zoe = { ...person('zoe'), givenName: '', hidden: true }
  const wed = { id: 'u1', aId: 'bea', bId: 'zoe', kind: 'marriage', startDate: '1895', endDate: '', place: 'Madrid', certainty: 'documented' }
  const whole = { ...graph, persons: [...graph.persons, zoe], unions: [wed] } as unknown as Graph
  const view = { ...whole, persons: whole.persons.filter((p) => p.id === 'ana'), unions: [] } as Graph
  it('brings in everyone in the line, and not a marriage to someone hidden', () => {
    const g = withLine(view, whole, ['ana', 'bea'])
    expect(g.persons.map((p) => p.id)).toEqual(['ana', 'bea'])
    const bea = mapTimeline(g, places).tracks.find((x) => x.personId === 'bea')!
    expect(bea.stops.some((s) => s.kind === 'union')).toBe(false)
  })
  it('keeps a marriage to someone the reader may see', () => {
    const open = { ...whole, persons: whole.persons.map((p) => (p.id === 'zoe' ? person('zoe') : p)) } as Graph
    const g = withLine(view, open, ['ana', 'bea'])
    expect(mapTimeline(g, places).tracks.find((x) => x.personId === 'bea')!.stops.some((s) => s.kind === 'union')).toBe(true)
  })
  it('is the view itself when the whole line is in it', () => {
    expect(withLine(whole, whole, ['ana', 'bea'])).toBe(whole)
  })
})
