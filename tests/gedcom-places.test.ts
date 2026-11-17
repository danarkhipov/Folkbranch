import { describe, expect, it } from 'vitest'
import { gedCoord, parseGedcom, writeGedcom } from '../lib/gedcom'
import type { Graph, Place } from '../lib/types'

const place = (id: string, name: string, lat: number | null, lon: number | null): Place => ({ id, name, kind: '', parentId: null, otherNames: [], lat, lon, note: '' })

describe('gedCoord', () => {
  it('reads hemisphere letters, with S and W negative', () => {
    expect(gedCoord('N55.7558', 'E37.6173')).toEqual({ lat: 55.7558, lon: 37.6173 })
    expect(gedCoord('S33.86', 'W0.73585')).toEqual({ lat: -33.86, lon: -0.73585 })
  })

  it('reads signed decimals', () => {
    expect(gedCoord('35.115', '-86.3623')).toEqual({ lat: 35.115, lon: -86.3623 })
  })

  it('reads a comma as the decimal mark and cuts long float tails to six decimals', () => {
    expect(gedCoord('N48,6667', 'E2,3333')).toEqual({ lat: 48.6667, lon: 2.3333 })
    expect(gedCoord('N50.1', 'E12.280000000000001')).toEqual({ lat: 50.1, lon: 12.28 })
  })

  it('refuses 0,0, values out of range, a letter from the other axis, and anything else', () => {
    expect(gedCoord('0', '0')).toBeNull()
    expect(gedCoord('N0', 'E0')).toBeNull()
    expect(gedCoord('N91', 'E10')).toBeNull()
    expect(gedCoord('N10', 'E181')).toBeNull()
    expect(gedCoord('E10', 'E10')).toBeNull()
    expect(gedCoord('W55', 'E37')).toBeNull()
    expect(gedCoord('N-55', 'E37')).toBeNull()
    expect(gedCoord('', '')).toBeNull()
    expect(gedCoord('north', 'east')).toBeNull()
  })
})

describe('points in a GEDCOM file', () => {
  it('reads a point under an event place in a person or a family, with its hemisphere signs', () => {
    const g = parseGedcom(`0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME John /Smith/
1 BIRT
2 PLAC Milton Keynes, Buckinghamshire, England
3 MAP
4 LATI N52.02707
4 LONG W0.73585
0 @F1@ FAM
1 HUSB @I1@
1 MARR
2 PLAC Anson, Somerset
3 MAP
4 LATI N51.1
4 LONG W2.7
0 TRLR`)
    expect(g.places).toEqual([
      { text: 'Milton Keynes, Buckinghamshire, England', lat: 52.02707, lon: -0.73585 },
      { text: 'Anson, Somerset', lat: 51.1, lon: -2.7 },
    ])
  })

  it('reads the top-level place records of RootsMagic, Legacy and webtrees', () => {
    const g = parseGedcom(`0 HEAD
1 GEDC
2 VERS 5.5.1
0 _PLAC Wells, Somerset
1 MAP
2 LATI N51.21
2 LONG W2.64
0 _PLAC_DEFN
1 PLAC Bath
1 MAP
2 LATI N51.38
2 LONG W2.36
0 @L1@ _LOC
1 NAME Taunton
1 MAP
2 LATI N51.01
2 LONG W3.1
0 TRLR`)
    expect(g.places).toEqual([
      { text: 'Wells, Somerset', lat: 51.21, lon: -2.64 },
      { text: 'Bath', lat: 51.38, lon: -2.36 },
      { text: 'Taunton', lat: 51.01, lon: -3.1 },
    ])
  })

  it('keeps one entry per text, compared trimmed and case-insensitively, and the first point given for it', () => {
    const g = parseGedcom(`0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME A /B/
1 BIRT
2 PLAC Anson, Somerset
3 MAP
4 LATI N51.1
4 LONG W2.7
1 DEAT
2 PLAC  anson, somerset
3 MAP
4 LATI N10
4 LONG E10
0 _PLAC Anson, Somerset
1 MAP
2 LATI N51.1
2 LONG W2.7
0 TRLR`)
    expect(g.places).toEqual([{ text: 'Anson, Somerset', lat: 51.1, lon: -2.7 }])
  })

  it('gives no places when the file has no usable point, and skips an out-of-range one', () => {
    const plain = parseGedcom(`0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME A /B/
1 BIRT
2 PLAC Кострома
0 @I2@ INDI
1 NAME C /D/
1 BIRT
2 PLAC Тверь
3 MAP
4 LATI N91
4 LONG E10
0 TRLR`)
    expect(plain.places).toEqual([])
  })
})

describe('writing places with their points', () => {
  const moscow = place('pm', 'Москва', 55.7558, 37.6173)
  const milton = place('mk', 'Milton Keynes', 52.02707, -0.73585)
  const tver = place('pt', 'Тверь', null, null)
  const person = (over: Record<string, unknown>) => ({ id: 'a', givenName: 'Пётр', patronymic: '', surname: 'Иванов', maidenName: '', otherNames: '', sex: 'M', birthDate: '1880', birthPlace: '', deathDate: '1950', deathPlace: '', living: false, facts: [], sources: [], ...over })

  it('writes MAP, LATI and LONG under a birth place that has a point, and nothing under one that has not', () => {
    const graph = { persons: [person({ birthPlace: 'Москва', birthPlaceId: 'pm', deathPlace: 'Тверь', deathPlaceId: 'pt' })], parentChild: [], unions: [] } as unknown as Graph
    const out = writeGedcom(graph, { hideLiving: false, source: 't', places: [moscow, tver] })
    expect(out).toContain('2 PLAC Москва\n3 MAP\n4 LATI N55.7558\n4 LONG E37.6173')
    expect(out).toContain('2 PLAC Тверь\n')
    expect(out.match(/MAP/g)).toHaveLength(1)
  })

  it('writes the point of a fact place and of a marriage place', () => {
    const graph = {
      persons: [person({ facts: [{ kind: 'Профессия', date: '', place: 'Москва', note: '' }] }), person({ id: 'b', givenName: 'Анна', sex: 'F', birthDate: '', deathDate: '' })],
      parentChild: [],
      unions: [{ id: 'u', aId: 'a', bId: 'b', kind: 'marriage', startDate: '1905', endDate: '', place: 'Milton Keynes', placeId: 'mk', certainty: 'family' }],
    } as unknown as Graph
    const out = writeGedcom(graph, { hideLiving: false, source: 't', places: [moscow, milton] })
    expect(out).toContain('1 OCCU\n2 PLAC Москва\n3 MAP\n4 LATI N55.7558')
    expect(out).toContain('1 MARR\n2 DATE 1905\n2 PLAC Milton Keynes\n3 MAP\n4 LATI N52.02707\n4 LONG W0.73585')
  })

  it('follows the record a link names when two places share a name, and not the text alone', () => {
    const near = place('m1', 'Иваново', 57, 41)
    const far = place('m2', 'Иваново', 10.5, 20.25)
    const graph = {
      persons: [person({ birthPlace: 'Иваново', birthPlaceId: 'm2', deathPlace: '' }), person({ id: 'b', birthPlace: 'Иваново', birthPlaceId: null, deathPlace: '' })],
      parentChild: [],
      unions: [],
    } as unknown as Graph
    const out = writeGedcom(graph, { hideLiving: false, source: 't', places: [near, far] })
    expect(out).toContain('2 PLAC Иваново\n3 MAP\n4 LATI N10.5\n4 LONG E20.25')
    expect(out.match(/MAP/g)).toHaveLength(1)
  })

  it('writes no MAP without places, and round-trips the points through parseGedcom', () => {
    const graph = { persons: [person({ birthPlace: 'Москва', birthPlaceId: 'pm', deathPlace: 'Milton Keynes', deathPlaceId: 'mk' })], parentChild: [], unions: [] } as unknown as Graph
    expect(writeGedcom(graph, { hideLiving: false, source: 't' })).not.toContain('MAP')
    const out = writeGedcom(graph, { hideLiving: false, source: 't', places: [moscow, milton] })
    expect(parseGedcom(out).places).toEqual([
      { text: 'Москва', lat: 55.7558, lon: 37.6173 },
      { text: 'Milton Keynes', lat: 52.02707, lon: -0.73585 },
    ])
  })
})
