// The map's layers: what is switched off stays off in the saved choice, can never leave the map empty by itself, and
// really takes the kind of event out of where people stand.
import { describe, expect, it } from 'vitest'
import { drawGhost, type TrailState } from '../components/map-trails'
import { DEFAULT_LAYERS, isChanged, KINDS, parseLayers } from '../lib/map-layers'
import { mercator } from '../lib/map-motion'
import { withoutKinds, type MapTimeline, type Track } from '../lib/map-timeline'

const stop = (kind: Track['stops'][number]['kind'], year: number, lon: number) => ({ lat: 0, lon, place: String(lon), year, date: String(year), what: kind, kind, time: year })
const track = (id: string, stops: Track['stops']): Track => ({ personId: id, name: id, born: 1900, died: null, living: false, stops })
const data = (tracks: Track[]): MapTimeline => ({ tracks, missing: [], absent: [], min: 1900, max: 2000 })

describe('what is saved of the layers', () => {
  it('reads nothing, damage and unknown values as the default', () => {
    expect(parseLayers(null)).toEqual(DEFAULT_LAYERS)
    expect(parseLayers('{not json')).toEqual(DEFAULT_LAYERS)
    expect(parseLayers('{"routes":"sideways","hidden":["birth","nonsense"],"trails":"yes"}')).toMatchObject({ routes: 'recent', hidden: ['birth'], trails: true })
  })
  it('keeps faces or marks on, and at least one kind of event', () => {
    expect(parseLayers('{"people":false,"events":false}')).toMatchObject({ people: true, events: false })
    expect(parseLayers(JSON.stringify({ hidden: KINDS })).hidden).toEqual([])
  })
  it('says whether anything differs from the default, for the button to show it', () => {
    expect(isChanged(DEFAULT_LAYERS)).toBe(false)
    expect(isChanged({ ...DEFAULT_LAYERS, hidden: ['death'] })).toBe(true)
    expect(isChanged({ ...DEFAULT_LAYERS, routes: 'all' })).toBe(true)
  })
})

describe('leaving a kind of event out', () => {
  const t = data([track('a', [stop('birth', 1900, 0), stop('move', 1920, 1), stop('death', 1980, 2)]), track('b', [stop('birth', 1910, 3)])])
  it('is the same object when nothing is left out, so nothing is built again', () => {
    expect(withoutKinds(t, [])).toBe(t)
  })
  it('takes the place of that kind away from where a person stands, and a person with nothing left off the map', () => {
    const r = withoutKinds(t, ['birth'])
    expect(r.tracks.map((x) => [x.personId, x.stops.map((s) => s.kind)])).toEqual([['a', ['move', 'death']]])
    // The viewer chose this: nobody is listed as missing for it.
    expect(r.absent).toEqual([])
    // A person with none of the kind left out is the same track, not a copy.
    expect(withoutKinds(t, ['union']).tracks[0]).toBe(t.tracks[0])
  })
})

describe('the routes layer', () => {
  const view = (ctx: unknown) => { const c = mercator([0, 0]); return { ctx: ctx as CanvasRenderingContext2D, scale: 64, ox: c[0] * 64 - 720, oy: c[1] * 64 - 450, w: 1440, h: 900, dpr: 1 } }
  const strokes = (trails: boolean) => {
    let n = 0
    const ctx = new Proxy({ stroke() { n++ }, fill() {} }, { get: (o, k) => (k in o ? (o as never)[k] : () => {}), set: () => true })
    const st: TrailState = { tracks: [track('a', [stop('birth', 1900, 0), stop('move', 1901, 1)])], year: 1910, positions: new Map(), pulses: [], ink: '#000', focus: null, line: null, trails }
    drawGhost(view(ctx), st)
    return n
  }
  it('draws no line of past journeys when switched off, and one stroke when on', () => {
    expect(strokes(true)).toBeGreaterThan(0)
    expect(strokes(false)).toBe(0)
  })
})
