import { describe, expect, it } from 'vitest'
import { eventYear, factKind, mapTimeline, MOVE_YEARS, positionAt, routePoints, routeStops, sinceAt, trackLegs } from '../lib/map-timeline'
import type { Graph, Person, Place } from '../lib/types'

const person = (id: string, extra: Partial<Person> = {}): Person => ({ id, givenName: id, surname: 'Vela', maidenName: '', patronymic: '', otherNames: '', sex: 'U', birthDate: '', birthYear: null, birthPlace: '', deathDate: '', deathYear: null, deathPlace: '', living: false, certainty: 'documented', avatarMediaId: null, avatarCrop: null, updatedAt: 0, tags: [], facts: [], sources: [], claims: [], ...extra })
const place = (id: string, name: string, lat: number | null, lon: number | null): Place => ({ id, name, kind: '', parentId: null, otherNames: [], lat, lon, note: '' })
const places = [place('a', 'Reus', 41.15, 1.1), place('b', 'Madrid', 40.4, -3.7), place('c', 'Nowhere', null, null)]

describe('the map timeline', () => {
  it('reads a year from free-text dates', () => {
    expect(['1937–1942', 'c. 1850', 'h. 1902', 'julio de 1936', '1936-07-18', ''].map(eventYear)).toEqual([1937, 1850, 1902, 1936, 1936, null])
  })
  const graph: Graph = {
    persons: [person('ana', { birthDate: '1900', birthYear: 1900, birthPlace: 'Reus', deathDate: '1960', deathYear: 1960, deathPlace: 'Madrid', facts: [{ kind: 'Moved', date: '1930', place: 'Madrid', note: '' }, { kind: 'Work', date: '1935', place: 'Nowhere', note: '' }, { kind: 'Lived', date: '', place: 'Reus', note: '' }] })],
    parentChild: [], unions: [],
  } as unknown as Graph
  const tl = mapTimeline(graph, places)
  it('keeps placed, dated events and lists the rest with why', () => {
    expect(tl.tracks[0].stops.map((s) => s.year)).toEqual([1900, 1930, 1960])
    expect(tl.missing.map((m) => m.gap).sort()).toEqual(['no-coords', 'no-date'])
    expect([tl.min, tl.max]).toEqual([1900, 1960])
    expect(tl.tracks[0].stops.map((s) => s.kind)).toEqual(['birth', 'move', 'death'])
    expect(tl.absent).toEqual([])
  })
  it('names who has nowhere to stand, and sorts fact kinds into marks', () => {
    const g = { persons: [person('bo', { birthPlace: 'Nowhere', birthDate: '1900' })], parentChild: [], unions: [] } as unknown as Graph
    expect(mapTimeline(g, places).absent.map((a) => [a.personId, a.gaps.map((x) => x.gap)])).toEqual([['bo', ['no-coords']]])
    expect(['Residence', 'Место жительства', 'Occupation', 'Воинская служба', 'Boda', 'Burial', 'Award'].map(factKind)).toEqual(['move', 'move', 'work', 'work', 'union', 'death', 'other'])
  })
  it('sorts the Spanish and Catalan fact names of the tables, with or without accents', () => {
    // The kinds as lib/i18n-es.ts and lib/i18n-ca.ts write them (the fact menu and the GEDCOM tags).
    const es = { move: ['Residencia', 'Mudanza', 'Emigración', 'Inmigración', 'Censo'], work: ['Profesión', 'Ocupación', 'Estudios', 'Graduación', 'Servicio militar'], birth: ['Bautismo', 'Nacimiento'], death: ['Defunción', 'Entierro', 'Causa de la muerte'], union: ['Matrimonio'] }
    const ca = { move: ['Residència', 'Trasllat', 'Emigració', 'Immigració', 'Cens'], work: ['Ofici', 'Ocupació', 'Estudis', 'Fi dels estudis', 'Servei militar'], birth: ['Bateig', 'Naixement'], death: ['Mort', 'Enterrament', 'Causa de la mort'], union: ['Matrimoni', 'Casament'] }
    for (const table of [es, ca]) for (const [kind, names] of Object.entries(table)) expect(names.map((n) => [n, factKind(n)])).toEqual(names.map((n) => [n, kind]))
    // Typed without accents, or in capitals, they still count.
    expect(['Ocupacion', 'PROFESION', 'residencia', 'Defuncion', 'Emigracio'].map(factKind)).toEqual(['work', 'work', 'move', 'death', 'move'])
    // Whole words only: a word that merely contains one is no match.
    expect(['Censor', 'Mortero', 'Casamentera', 'Condecoración', 'Afiliació', 'Herida'].map(factKind)).toEqual(['other', 'other', 'other', 'other', 'other', 'other'])
  })
  it('leaves the Russian and English kinds as they were', () => {
    expect(['Профессия', 'Перепись', 'Крещение', 'Погребение', 'Брак', 'Census', 'Christening', 'Wedding', 'Retirement', 'Cremation', 'Award', 'Official'].map(factKind))
      .toEqual(['work', 'move', 'birth', 'other', 'union', 'move', 'birth', 'union', 'other', 'other', 'other', 'other'])
  })
  it('places a person in a year: nowhere before birth or after death, moving just before a move', () => {
    const tr = tl.tracks[0]
    expect(positionAt(tr, 1899)).toBeNull()
    expect(positionAt(tr, 1961)).toBeNull()
    expect(positionAt(tr, 1920)).toMatchObject({ lat: 41.15, moving: null })
    const mid = positionAt(tr, 1929)!
    expect(mid.moving?.place).toBe('Madrid')
    expect(mid.lat).toBeLessThan(41.15)
    expect(positionAt(tr, 1930)).toMatchObject({ lat: 40.4 })
  })
  it('holds a person with one known place there for their whole life', () => {
    const one = { personId: 'x', name: 'x', born: 1850, died: null, living: false, stops: [{ lat: 1, lon: 2, place: 'Reus', year: 1880, time: 1880, date: '1880', what: 'Moved', kind: 'move' as const }] }
    expect(positionAt(one, 1849)).toBeNull()
    expect(positionAt(one, 1851)).toMatchObject({ lat: 1, lon: 2 })
    expect(positionAt(one, 1939)).toMatchObject({ lat: 1 })
    expect(positionAt(one, 1941)).toBeNull()
    expect(positionAt({ ...one, born: null, died: 1900 }, 1831)).toMatchObject({ lat: 1 })
  })
  it('moves continuously along the way, eased, and stands exactly on each stop in its own year', () => {
    const tr = tl.tracks[0]
    const [leg] = trackLegs(tr)
    expect([leg.leave, leg.arrive]).toEqual([1930 - MOVE_YEARS, 1930])
    expect(trackLegs(tr)).toBe(trackLegs(tr))
    for (const st of tr.stops) expect(positionAt(tr, st.year)).toMatchObject({ lat: st.lat, lon: st.lon })
    // Slow to set off: in the first tenth of the time, well under a tenth of the way.
    const early = positionAt(tr, leg.leave + MOVE_YEARS * 0.1)!
    expect(early.progress).toBeLessThan(0.05)
    // Westward all the way, a little further each time.
    const lons = [0.2, 0.4, 0.6, 0.8].map((f) => positionAt(tr, leg.leave + MOVE_YEARS * f)!.lon)
    expect(lons).toEqual([...lons].sort((a, b) => b - a))
    expect(new Set(lons).size).toBe(4)
    // The year each point of the way is passed runs from leaving to arriving.
    expect(leg.at[0]).toBe(leg.leave)
    expect(leg.at.at(-1)).toBe(leg.arrive)
    // A life shows through its last year, not past it.
    expect(positionAt(tr, 1960.5)).not.toBeNull()
  })
  it('keeps a Spanish or Catalan burial or will after a death, and drops a job after it', () => {
    const facts = ['Entierro', 'Testamento', 'Herencia', 'Enterrament', 'Validació del testament', 'Herència', 'Cremació', 'Profesión', 'Ofici'].map((kind) => ({ kind, date: '1905', place: 'Reus', note: '' }))
    const g = { persons: [person('ines', { birthDate: '1830', birthYear: 1830, deathDate: '1900', deathYear: 1900, deathPlace: 'Reus', facts })], parentChild: [], unions: [] } as unknown as Graph
    const tl = mapTimeline(g, places)
    expect(tl.missing.filter((m) => m.gap === 'outside-span').map((m) => m.what)).toEqual(['Ofici', 'Profesión'])
    expect(tl.tracks[0].stops.filter((s) => s.year === 1905).map((s) => s.what).sort()).toEqual(['Cremació', 'Enterrament', 'Entierro', 'Herencia', 'Herència', 'Testamento', 'Validació del testament'])
  })
  it('keeps a fact from outside a life off the map and off the timeline (died 1702, no birth, facts 1483 and 1700)', () => {
    const g = { persons: [person('theo', { deathDate: '1702', deathYear: 1702, facts: [{ kind: 'Grant', date: '1483', place: 'Reus', note: '' }, { kind: 'Residence', date: '1700', place: 'Madrid', note: '' }] })], parentChild: [], unions: [] } as unknown as Graph
    const tl = mapTimeline(g, places)
    expect(tl.tracks[0].stops.map((s) => s.year)).toEqual([1700])
    expect(tl.missing.filter((m) => m.gap === 'outside-span').map((m) => m.date)).toEqual(['1483'])
    expect(tl.min).toBe(1610)
    expect(tl.max).toBe(1710)
    expect(positionAt(tl.tracks[0], 1483)).toBeNull()
    expect(positionAt(tl.tracks[0], 1650)).toMatchObject({ lat: 40.4 })
    expect(positionAt(tl.tracks[0], 1703)).toBeNull()
  })
})

describe('a life as a route', () => {
  const at = (lat: number, place: string, year: number) => ({ lat, lon: 0, place, year, time: year, date: String(year), what: 'x', kind: 'other' as const })
  const tr = { personId: 'r', name: 'r', born: 1850, died: 1930, living: false, stops: [at(41, 'Reus', 1850), at(41, 'Reus', 1870), at(-34, 'Buenos Aires', 1889), at(41, 'Reus', 1925)] }
  it('numbers each visit in time, and a place visited twice is one mark', () => {
    expect(routeStops(tr).map((r) => [r.place, r.visits, r.years])).toEqual([['Reus', [1, 3], [1850, 1925]], ['Buenos Aires', [2], [1889]]])
  })
  it('says since when someone stands where they are', () => {
    expect(sinceAt(tr, positionAt(tr, 1880)!)).toBe(1850)
    expect(sinceAt(tr, positionAt(tr, 1900)!)).toBe(1889)
    expect(sinceAt(tr, positionAt(tr, 1926)!)).toBe(1925)
  })
  it('frames a route by its stops and the way between them', () => {
    expect(routePoints(tr).length).toBe(4 + 2 * 3)
  })
  it('crosses the date line with the face on the world, arriving exactly at the place', () => {
    const ps = [place('t', 'Tokyo', 35.68, 139.69), place('s', 'San Francisco', 37.77, -122.42)]
    const g = { persons: [person('ken', { birthDate: '1900', birthYear: 1900, birthPlace: 'Tokyo', facts: [{ kind: 'Moved', date: '1920', place: 'San Francisco', note: '' }] })], parentChild: [], unions: [] } as unknown as Graph
    const tr = mapTimeline(g, ps).tracks[0]
    for (let y = 1918.5; y < 1920; y += 0.05) { const lon = positionAt(tr, y)!.lon; expect(lon).toBeGreaterThanOrEqual(-180); expect(lon).toBeLessThanOrEqual(180) }
    expect(positionAt(tr, 1919.999)!.lon).toBeCloseTo(-122.42, 1)
    expect(positionAt(tr, 1920)!.lon).toBe(-122.42)
  })
  it('keeps typing slips and years still to come off the map, listed, and the range the right way round', () => {
    const now = new Date().getFullYear()
    const future = { persons: [person('zo', { birthDate: '2985', birthYear: 2985, birthPlace: 'Reus' })], parentChild: [], unions: [] } as unknown as Graph
    const a = mapTimeline(future, places)
    expect(a.tracks).toEqual([])
    expect(a.min).toBeLessThanOrEqual(a.max)
    expect(a.absent.map((x) => x.personId)).toEqual(['zo'])
    const slip = { persons: [person('ze', { birthDate: '0000', birthYear: 0, birthPlace: 'Reus', facts: [{ kind: 'Moved', date: '1950', place: 'Madrid', note: '' }] })], parentChild: [], unions: [] } as unknown as Graph
    const b = mapTimeline(slip, places)
    expect(b.tracks[0].born).toBeNull()
    expect(b.min).toBeGreaterThanOrEqual(1000)
    const later = { persons: [person('yo', { birthDate: '1990', birthYear: 1990, birthPlace: 'Reus', living: true, facts: [{ kind: 'Moved', date: String(now + 3), place: 'Madrid', note: '' }] })], parentChild: [], unions: [] } as unknown as Graph
    const c = mapTimeline(later, places)
    expect(c.tracks[0].stops.map((s) => s.place)).toEqual(['Reus'])
    expect(c.missing.map((m) => m.gap)).toEqual(['future'])
  })
  it('leaves out a marriage to a hidden partner, and marks a marriage as one event for both', () => {
    const g = {
      persons: [person('ana', { birthDate: '1900', birthYear: 1900, birthPlace: 'Reus' }), person('ben', { hidden: true }), person('cai', { birthDate: '1898', birthYear: 1898, birthPlace: 'Reus' })],
      parentChild: [],
      unions: [{ id: 'u1', aId: 'ana', bId: 'ben', kind: 'marriage', startDate: '1925', place: 'Nowhere' }, { id: 'u2', aId: 'ana', bId: 'cai', kind: 'marriage', startDate: '1930', place: 'Madrid' }],
    } as unknown as Graph
    const tl2 = mapTimeline(g, places)
    expect(tl2.missing).toEqual([])
    const unions = tl2.tracks.flatMap((tr) => tr.stops.filter((s) => s.kind === 'union').map((s) => s.union))
    expect(unions).toEqual(['u2', 'u2'])
  })
  it('gives each of several places in one year its own share of it', () => {
    const g = { persons: [person('di', { birthDate: '1900', birthYear: 1900, birthPlace: 'Reus', facts: [{ kind: 'Moved', date: '1920', place: 'Reus', note: '' }, { kind: 'Moved', date: '1920', place: 'Madrid', note: '' }] })], parentChild: [], unions: [] } as unknown as Graph
    const tr = mapTimeline(g, places).tracks[0]
    expect(tr.stops.map((s) => s.time)).toEqual([1900, 1920, 1920.5])
    expect(positionAt(tr, 1920.1)).toMatchObject({ lat: 41.15 })
    expect(positionAt(tr, 1920.5)).toMatchObject({ lat: 40.4 })
  })
})
