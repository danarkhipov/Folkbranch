// The chronicle: dates, blends, the store, and above all who gets what. Invented people and places only.
import { eq, inArray } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getDb, schema } from '../lib/db'
import { activeAt, activeIn, around, endOfDate, entryBounds, entryFade, formatSpan, parseDate, pickText, spanYears, topEntry, zoneBlend, type Shape, type Stage, type Zone } from '../lib/chronicle'
import { chronicleRoutes } from '../lib/api/routes/chronicle'
import type { Actor } from '../lib/ops/core'
import * as chronicle from '../lib/ops/chronicle'
import * as people from '../lib/ops/people'
import * as places from '../lib/ops/places'
import { listProposals } from '../lib/ops/proposals'
import { createShare, guestFromCookie, openShare } from '../lib/ops/share'
import * as tokens from '../lib/ops/tokens'
import * as views from '../lib/ops/views'

const owner: Actor = { userId: 'o', name: 'Owner Person', role: 'owner', personId: null }
const editor: Actor = { userId: 'e', name: 'Editor Person', role: 'editor', personId: null }
const readerCookie: Actor = { userId: 'r', name: 'Reader Person', role: 'reader', personId: null }
const token = (role: 'reader' | 'editor', review = true) => tokens.actorFromToken(tokens.createToken(owner, { name: `chron-${role}-${review}-${Math.random()}`, role, review }).token)!
const guestOf = (tok: string) => guestFromCookie(openShare(tok, undefined).cookie)!

let grandpa: string, father: string, aunt: string, living: string, hush: string, stranger: string
let town: string, port: string, quiet: string

const ring = (lon: number, lat: number, d = 1): [number, number][] => [[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]
const poly = (lon: number, lat: number, d = 1) => ({ type: 'Polygon' as const, coordinates: [ring(lon, lat, d)] })
const general = (over: Record<string, unknown> = {}) => ({
  from: '1856-07-17', to: '1859-04-01', lead: true, title: { en: 'A war in the hills' }, body: { en: 'General history, no relative named.' },
  people: [
    { personId: grandpa, at: '1856-11', text: { en: 'Grandpa line' } },
    { personId: living, at: '1857', text: { en: 'Living cousin line' } },
    { personId: hush, text: { en: 'Kept private line' } },
    { personId: stranger, at: '1858-02-03', text: { en: 'Stranger line' } },
  ],
  shape: { kind: 'zones', zones: [
    { id: 'all', name: { en: 'Whole land' }, tone: 3, stages: [{ at: '1856-07-17', outline: poly(-1, 40, 4) }] },
    { id: 'b', name: { en: 'North side' }, tone: 1, stages: [{ at: '1856-07-25', outline: poly(0, 41), label: [0.5, 41.5] }, { at: '1857', outline: poly(0, 41, 2) }] },
  ] },
  ...over,
})
const lines = (a: Actor, key: string) => chronicle.listChronicle(a).entries.find((e) => e.key === key)?.people.map((l) => l.text.en)

beforeAll(() => {
  const make = (givenName: string, extra: Record<string, unknown> = {}) => (people.createPerson(owner, { givenName, surname: 'Inventa', ...extra } as never) as unknown as { id: string }).id
  places.savePlace(owner, null, { name: 'Hill Town Test', lat: 41.2, lon: 1.7 })
  places.savePlace(owner, null, { name: 'Port Test', lat: 41.4, lon: 2.1 })
  places.savePlace(owner, null, { name: 'Quiet Hamlet', lat: 41.6, lon: 0.9 })
  const byName = (n: string) => places.listPlaces(owner).find((p) => p.name === n)!.id
  town = byName('Hill Town Test'); port = byName('Port Test'); quiet = byName('Quiet Hamlet')
  grandpa = make('Grandpa', { deathDate: '1970', birthPlace: 'Hill Town Test', birthPlaceId: town })
  father = make('Father', { deathDate: '1999', birthPlace: 'Port Test', birthPlaceId: port })
  aunt = make('Aunt', { deathDate: '2001' })
  // Only the living cousin was born in the quiet hamlet: to a reader it is a place of a hidden relative.
  living = make('Cousin', { living: true, birthPlace: 'Quiet Hamlet', birthPlaceId: quiet })
  hush = make('Hushed', { deathDate: '1980', keepPrivate: true })
  stranger = make('Stranger', { deathDate: '1990' })
  people.linkPeople(owner, 'son', grandpa, father)
  people.linkPeople(owner, 'daughter', grandpa, aunt)
  people.linkPeople(owner, 'son', father, living)
  people.linkPeople(owner, 'son', father, hush)
})

beforeEach(() => {
  getDb().delete(schema.chronicle).run()
  chronicle.setSwitches(owner, { show: 'all', history: true, chronicle: true })
})
/** The switches as an archive from before Settings > Map has them: never written. */
const unwritten = () => getDb().delete(schema.settings).where(inArray(schema.settings.key, [chronicle.HISTORY_KEY, chronicle.CHRONICLE_KEY])).run()
const stored = (key: string) => getDb().select().from(schema.settings).where(eq(schema.settings.key, key)).get()?.value ?? null

describe('dates', () => {
  it('reads a year, a month and a day, each from its start', () => {
    expect(parseDate('1856')).toBe(1856)
    expect(parseDate('1856-07')).toBeCloseTo(1856 + 182 / 366, 6)
    expect(parseDate('1856-07-17')).toBeCloseTo(1856 + 198 / 366, 6)
    expect(parseDate('1856-01-01')).toBe(1856)
  })
  it('ends a date at the end of its own precision', () => {
    expect(endOfDate('1856')).toBe(1857)
    expect(endOfDate('1856-12')).toBe(1857)
    expect(endOfDate('1859-04-01')).toBeCloseTo(1859 + 91 / 365, 6)
    expect(spanYears('1856')).toEqual({ fromYear: 1856, toYear: 1857 })
    expect(spanYears('1856-07-17', '1859-04-01').toYear).toBeCloseTo(endOfDate('1859-04-01'), 9)
  })
  it('refuses free text, impossible days and years out of range', () => {
    for (const s of ['summer 1856', '1856-7', '36', '1856-13', '1857-02-29', '0999', '2201', '1856/07/17', '']) expect(parseDate(s)).toBeNaN()
    expect(parseDate('1856-02-29')).not.toBeNaN()
  })
  it('prints whole years with a dash and days in the reader\'s language', () => {
    expect(formatSpan('1856', '1859', 'es')).toBe('1856–1859')
    expect(formatSpan('1856', undefined, 'es')).toBe('1856')
    expect(formatSpan('1856-07-17', '1859-04-01', 'es')).toBe('17 jul 1856 – 1 abr 1859')
    expect(formatSpan('1856-07', '1857', 'en')).toBe('Jul 1856 – 1857')
  })
  it('a date the store refuses is a 400 naming the field', () => {
    expect(() => chronicle.putEntry(owner, 'x', general({ from: '1858', to: '1856' }))).toThrow(/to is before from/)
    expect(() => chronicle.putEntry(owner, 'x', general({ from: 'summer of 1856' }))).toThrow(/from/)
    expect(() => chronicle.putEntry(owner, 'x', general({ from: '1856-07' , to: '1856-07' }))).not.toThrow()
  })
})

describe('the order and the words', () => {
  const e = (key: string, fromYear: number, toYear: number, lead = false) => ({ key, fromYear, toYear, lead })
  it('picks what is going on, and which entry speaks for the moment', () => {
    const all = [e('war', 1856.5, 1859.25, true), e('strike', 1857, 1858), e('flood', 1858.1, 1858.3)]
    expect(activeAt(all, 1856.4)).toEqual([])
    expect(activeAt(all, 1857.5).map((x) => x.key)).toEqual(['war', 'strike'])
    expect(activeAt(all, 1858).map((x) => x.key)).toEqual(['war'])
    expect(topEntry(activeAt(all, 1858.2))?.key).toBe('war')
    expect(topEntry(activeAt(all, 1858.2).filter((x) => !x.lead))?.key).toBe('flood')
    expect(topEntry([])).toBeNull()
  })
  it('counts an entry for every whole year it touches, and finds the nearest ones outside a year', () => {
    const all = [e('war', 1856.5, 1859.25, true), e('strike', 1857, 1858), e('flood', 1858.1, 1858.3), e('fair', 1861, 1862)]
    expect(activeIn(all, 1856).map((x) => x.key)).toEqual(['war'])
    expect(activeIn(all, 1858).map((x) => x.key)).toEqual(['war', 'flood'])
    expect(activeIn(all, 1859).map((x) => x.key)).toEqual(['war'])
    expect(activeIn(all, 1860)).toEqual([])
    expect(around(all, 1860)).toEqual({ before: all[0], after: all[3] })
    expect(around(all, 1857)).toEqual({ before: null, after: all[2] })
    expect(around(all, 1855)).toEqual({ before: null, after: all[0] })
    expect(around(all, 1865)).toEqual({ before: all[3], after: null })
  })
  it('reads the reader\'s language, then the archive\'s, then English, then any', () => {
    expect(pickText({ es: 'hola', en: 'hi', ca: 'bon dia' }, 'ca', 'es')).toBe('bon dia')
    expect(pickText({ es: 'hola', en: 'hi' }, 'ca', 'es')).toBe('hola')
    expect(pickText({ en: 'hi', ru: 'привет' }, 'ca', 'es')).toBe('hi')
    expect(pickText({ ru: 'привет' }, 'ca', 'es')).toBe('привет')
    expect(pickText({}, 'ca')).toBe('')
  })
  it('fades an entry in and out over its edges', () => {
    const x = { fromYear: 1856, toYear: 1859 }
    expect(entryFade(x, 1855.99)).toBe(0)
    expect(entryFade(x, 1856.04)).toBeCloseTo(0.5)
    expect(entryFade(x, 1857)).toBe(1)
    expect(entryFade(x, 1858.96)).toBeCloseTo(0.5)
    expect(entryFade(x, 1859)).toBe(0)
  })
})

describe('a zone through its stages', () => {
  const st = (year: number, hold = false): Stage => ({ at: String(year), year, outline: poly(0, 0), ...(hold ? { hold } : {}) })
  const zone: Pick<Zone, 'stages'> = { stages: [st(1856), st(1857), st(1858, true), st(1859)] }
  it('is not there before its first stage', () => expect(zoneBlend(zone, 1855.9)).toBeNull())
  it('cross-fades between two stages', () => {
    const b = zoneBlend(zone, 1856.25)!
    expect(b.a.year).toBe(1856)
    expect(b.b?.year).toBe(1857)
    expect(b.u).toBeCloseTo(0.25)
    expect(zoneBlend(zone, 1857)!).toMatchObject({ u: 0 })
    expect(zoneBlend(zone, 1857)!.a.year).toBe(1857)
  })
  it('holds a stage marked to hold, until the next one starts', () => {
    expect(zoneBlend(zone, 1858.7)).toEqual({ a: zone.stages[2], u: 0 })
    expect(zoneBlend(zone, 1859)!.a.year).toBe(1859)
  })
  it('stands on its last stage for good', () => expect(zoneBlend(zone, 2000)).toEqual({ a: zone.stages[3], u: 0 }))
  it('frames every point a shape has', () => {
    expect(entryBounds({ kind: 'zones', zones: [{ id: 'a', name: { en: 'a' }, tone: 1, stages: [st(1856)] }] })).toEqual([[0, 0], [1, 1]])
    expect(entryBounds({ kind: 'route', stops: [{ place: 'p', lat: 41, lon: 2 }, { at: [-3, 40] }] } as Shape)).toEqual([[40, -3], [41, 2]])
    expect(entryBounds({ kind: 'places', places: [{ place: 'p' }] })).toBeNull()
  })
})

describe('writing entries', () => {
  it('one key is one entry: the same body twice leaves one row, and a change replaces it', () => {
    expect(chronicle.putEntry(owner, 'war-in-the-hills', general())).toEqual({ key: 'war-in-the-hills', created: true })
    expect(chronicle.putEntry(owner, 'war-in-the-hills', general())).toEqual({ key: 'war-in-the-hills', created: false })
    expect(getDb().select().from(schema.chronicle).all()).toHaveLength(1)
    const before = chronicle.listChronicle(owner).entries[0].updatedAt
    chronicle.putEntry(owner, 'war-in-the-hills', general({ title: { es: 'Otra' } }))
    const [e] = chronicle.listChronicle(owner).entries
    expect(e.title).toEqual({ es: 'Otra' })
    expect(e.updatedAt).toBeGreaterThan(before)
    expect(e.by).toBe('Owner Person')
  })
  it('deletes by key, and a missing key is a 404', () => {
    chronicle.putEntry(owner, 'gone-soon', general())
    chronicle.deleteEntry(editor, 'gone-soon')
    expect(chronicle.listChronicle(owner).entries).toEqual([])
    expect(() => chronicle.deleteEntry(owner, 'gone-soon')).toThrow('not found')
  })
  it('names every unknown person and place id', () => {
    const bad = general({ people: [{ personId: 'nobody-1', text: { en: 'x' } }, { personId: grandpa, text: { en: 'y' } }, { personId: 'nobody-2', text: { en: 'z' } }], shape: { kind: 'route', stops: [{ place: town }, { place: 'nowhere-9' }] } })
    expect(() => chronicle.putEntry(owner, 'bad', bad)).toThrow('unknown people: nobody-1, nobody-2; unknown places: nowhere-9')
  })
  it('a mention needs namesPeople, and its person among the lines', () => {
    const named = (namesPeople: boolean, id: string) => general({ namesPeople, body: { en: `Then [@Grandpa](person:${id}) left.` } })
    expect(() => chronicle.putEntry(owner, 'm', named(false, grandpa))).toThrow(/namesPeople/)
    expect(() => chronicle.putEntry(owner, 'm', named(true, father))).toThrow(`mentioned but not in people: ${father}`)
    expect(() => chronicle.putEntry(owner, 'm', named(true, grandpa))).not.toThrow()
    // A relative's own sentence cannot smuggle another relative in.
    expect(() => chronicle.putEntry(owner, 'm2', general({ people: [{ personId: grandpa, text: { en: `with [@F](person:${father})` } }] }))).toThrow(/namesPeople/)
  })
  it('checks keys, words, links, coordinates and stages', () => {
    expect(() => chronicle.putEntry(owner, 'Bad Key', general())).toThrow(/key/)
    expect(() => chronicle.putEntry(owner, 'a'.repeat(81), general())).toThrow(/key/)
    expect(() => chronicle.putEntry(owner, 'k', general({ title: {} }))).toThrow(/title/)
    expect(() => chronicle.putEntry(owner, 'k', general({ title: { en: 'x'.repeat(81) } }))).toThrow(/title/)
    expect(() => chronicle.putEntry(owner, 'k', general({ title: { de: 'Krieg' } }))).toThrow(/title/)
    expect(() => chronicle.putEntry(owner, 'k', general({ link: { en: 'http://plain.example' } }))).toThrow(/link/)
    expect(() => chronicle.putEntry(owner, 'k', general({ link: { en: 'javascript:alert(1)' } }))).toThrow(/link/)
    expect(() => chronicle.putEntry(owner, 'k', general({ people: [{ personId: grandpa, text: { en: 'x'.repeat(401) } }] }))).toThrow(/people/)
    const zones = (stages: unknown[]) => general({ shape: { kind: 'zones', zones: [{ id: 'a', name: { en: 'a' }, tone: 1, stages }] } })
    expect(() => chronicle.putEntry(owner, 'k', zones([{ at: '1857', outline: poly(0, 0) }, { at: '1856', outline: poly(0, 0) }]))).toThrow(/rising/)
    expect(() => chronicle.putEntry(owner, 'k', zones([{ at: '1857', outline: { type: 'Polygon', coordinates: [[[0, 0], [200, 0], [1, 1], [0, 0]]] } }]))).toThrow(/shape/)
    expect(() => chronicle.putEntry(owner, 'k', zones([{ at: '1857', outline: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }]))).toThrow(/shape/)
    const big = Array.from({ length: 5001 }, (_, i) => [i / 10000, 0])
    big.push(big[0])
    expect(() => chronicle.putEntry(owner, 'k', zones([{ at: '1857', outline: { type: 'Polygon', coordinates: [big] } }]))).toThrow(/5000/)
    expect(() => chronicle.putEntry(owner, 'k', general({ shape: { kind: 'route', stops: [{ place: town }] } }))).toThrow(/shape/)
    expect(() => chronicle.putEntry(owner, 'k', general({ shape: { kind: 'route', stops: [{ place: town }, { place: port }], unsure: [1] } }))).toThrow(/unsure/)
    expect(() => chronicle.putEntry(owner, 'k', zones([{ at: '0999', outline: poly(0, 0) }]))).toThrow(/at/)
  })
  it('rounds coordinates to three decimals and works out each stage\'s year', () => {
    chronicle.putEntry(owner, 'fine', general({ shape: { kind: 'zones', zones: [{ id: 'a', name: { en: 'a' }, tone: 2, stages: [{ at: '1857-07', outline: { type: 'Polygon', coordinates: [[[0.12345, 40.98765], [1, 40], [1, 41], [0.12345, 40.98765]]] } }] }] } }))
    const { shape } = chronicle.shapeFor(owner, 'fine')
    if (shape.kind !== 'zones') throw new Error('zones expected')
    expect(shape.zones[0].stages[0].outline.coordinates[0][0]).toEqual([0.123, 40.988])
    expect(shape.zones[0].stages[0].year).toBeCloseTo(parseDate('1857-07'))
  })
  it('only an editor or the owner writes; a reader, a reader token and a link cannot', () => {
    const g = guestOf(createShare(owner, { name: 'w' }).token)
    for (const a of [readerCookie, token('reader'), g]) {
      expect(() => chronicle.putEntry(a, 'no', general())).toThrow('forbidden')
      expect(() => chronicle.deleteEntry(a, 'no')).toThrow('forbidden')
      expect(() => chronicle.setShow(a, { show: 'all' })).toThrow('forbidden')
    }
    expect(() => chronicle.setShow(editor, { show: 'all' })).toThrow('forbidden')
    expect(() => chronicle.setShow(token('editor'), { show: 'all' })).toThrow('forbidden')
  })
  it('an editor token writes at once: nothing waits in the review queue, nothing goes in the history', () => {
    const bot = token('editor', true)
    const queued = listProposals(owner).length
    const history = getDb().select().from(schema.history).all().length
    expect(chronicle.putEntry(bot, 'by-agent', general())).toEqual({ key: 'by-agent', created: true })
    expect(listProposals(owner).length).toBe(queued)
    expect(getDb().select().from(schema.history).all().length).toBe(history)
    expect(chronicle.listChronicle(owner).entries[0].by).toBe(bot.name)
  })
  it('the routes: reads open to links, writes not, the switch for people only', () => {
    const r = (m: string, p: string) => chronicleRoutes.find((x) => x.method === m && x.path === p)!
    expect(r('GET', 'chronicle').guest).toBe(true)
    expect(r('GET', 'chronicle/:key/shape').guest).toBe(true)
    expect(r('PUT', 'chronicle/:key').guest).toBeFalsy()
    expect(r('DELETE', 'chronicle/:key').guest).toBeFalsy()
    expect(r('PUT', 'chronicle').human).toBe(true)
    expect(r('GET', 'chronicle/switches').guest).toBe(true)
    expect(r('PUT', 'chronicle/:key').op).toBeUndefined()
  })
})

describe('who gets what', () => {
  /** Every way in that sees only the public: none may receive a line of someone hidden from them. */
  const readers = () => {
    const { id: branch } = views.createView(owner, { name: `Father's branch ${Math.random()}`, scope: 'descendants', focusId: father, collapsed: [] })
    return {
      'reader token': token('reader'),
      'reader cookie': readerCookie,
      'plain link': guestOf(createShare(owner, { name: 'plain' }).token),
      'link with a view': guestOf(createShare(owner, { name: 'view', viewId: branch }).token),
    } as Record<string, Actor>
  }
  const hiddenFrom = (who: string) => ({
    // The living cousin is hidden from every reader; the one kept private always is; a view drops
    // everyone outside it (grandpa and the stranger are above or beside father's branch).
    'reader token': ['Living cousin line', 'Kept private line'],
    'reader cookie': ['Living cousin line', 'Kept private line'],
    'plain link': ['Living cousin line', 'Kept private line'],
    'link with a view': ['Living cousin line', 'Kept private line', 'Grandpa line', 'Stranger line'],
  } as Record<string, string[]>)[who]
  const ALL = ['Grandpa line', 'Living cousin line', 'Kept private line', 'Stranger line']

  it('the owner, an editor and an editor token get every line', () => {
    chronicle.putEntry(owner, 'war', general())
    for (const a of [owner, editor, token('editor')]) expect(lines(a, 'war')?.sort()).toEqual([...ALL].sort())
  })

  it('every reader gets only the lines of relatives shown to them, and nothing else of the hidden', () => {
    chronicle.putEntry(owner, 'war', general())
    for (const [who, a] of Object.entries(readers())) {
      const hidden = hiddenFrom(who)
      const got = chronicle.listChronicle(a)
      expect(lines(a, 'war')?.sort(), who).toEqual(ALL.filter((l) => !hidden.includes(l)).sort())
      // Not the words, not the id, anywhere in the answer.
      const wire = JSON.stringify(got)
      for (const l of hidden) expect(wire, who).not.toContain(l)
      if (hidden.includes('Living cousin line')) expect(wire, who).not.toContain(living)
      expect(wire, who).not.toContain(hush)
      // A reader is not told which account wrote it.
      expect(got.entries[0].by, who).toBe('')
      expect(got.show, who).toBeUndefined()
      // The general entry stays, with its text untouched.
      expect(got.entries[0].body, who).toEqual({ en: 'General history, no relative named.' })
    }
  })

  it('an entry whose words name relatives vanishes whole for anyone who cannot see them all', () => {
    chronicle.putEntry(owner, 'journey', general({ namesPeople: true, body: { en: `[@G](person:${grandpa}) walked with [@C](person:${living}).` }, people: [{ personId: grandpa, text: { en: 'Grandpa line' } }, { personId: living, text: { en: 'Living cousin line' } }] }))
    chronicle.putEntry(owner, 'only-dead', general({ namesPeople: true, body: { en: `[@G](person:${grandpa}) stayed.` }, people: [{ personId: grandpa, text: { en: 'Grandpa line' } }] }))
    const rs = readers()
    for (const [who, a] of Object.entries(rs)) {
      const keys = chronicle.listChronicle(a).entries.map((e) => e.key)
      const seesBoth = !hiddenFrom(who).includes('Living cousin line') && !hiddenFrom(who).includes('Grandpa line')
      expect(keys.includes('journey'), who).toBe(seesBoth)
      expect(keys.includes('only-dead'), who).toBe(!hiddenFrom(who).includes('Grandpa line'))
      if (!seesBoth) {
        expect(JSON.stringify(chronicle.listChronicle(a)), who).not.toContain('walked with')
        expect(() => chronicle.shapeFor(a, 'journey'), who).toThrow('not found')
      }
    }
    // Nobody in this set sees both.
    expect(Object.entries(rs).filter(([, a]) => chronicle.listChronicle(a).entries.some((e) => e.key === 'journey')).map(([w]) => w)).toEqual([])
    expect(chronicle.listChronicle(owner).entries.map((e) => e.key).sort()).toEqual(['journey', 'only-dead'])
  })

  it('a line whose person was deleted since is dropped for everyone', () => {
    const gone = (people.createPerson(owner, { givenName: 'Brief', surname: 'Inventa', deathDate: '1950' } as never) as unknown as { id: string }).id
    chronicle.putEntry(owner, 'w', general({ people: [{ personId: gone, text: { en: 'Brief line' } }, { personId: grandpa, text: { en: 'Grandpa line' } }] }))
    people.deletePerson(owner, gone)
    expect(lines(owner, 'w')).toEqual(['Grandpa line'])
  })

  it('while only the owner sees it, every reader and every editor in person gets nothing, and no shape', () => {
    chronicle.putEntry(owner, 'war', general())
    chronicle.setShow(owner, { show: 'owner' })
    for (const [who, a] of Object.entries({ ...readers(), editor })) {
      expect(chronicle.listChronicle(a), who).toEqual({ entries: [] })
      expect(() => chronicle.shapeFor(a, 'war'), who).toThrow('not found')
    }
    expect(chronicle.listChronicle(owner)).toMatchObject({ show: 'owner', entries: [{ key: 'war' }] })
    // The agents writing it still read what they wrote.
    expect(lines(token('editor'), 'war')?.length).toBe(4)
    expect(chronicle.shapeFor(token('editor'), 'war').shape.kind).toBe('zones')
    // Missing or anything else than "all" is the owner alone.
    getDb().delete(schema.settings).where(eq(schema.settings.key, chronicle.SHOW_KEY)).run()
    expect(chronicle.listChronicle(readerCookie).entries).toEqual([])
    getDb().insert(schema.settings).values({ key: chronicle.SHOW_KEY, value: 'everyone' }).run()
    expect(chronicle.listChronicle(readerCookie).entries).toEqual([])
    expect(chronicle.listChronicle(owner).show).toBe('owner')
  })

  it('the shape route answers only for an entry the reader may see, and only with places shown to them', () => {
    chronicle.putEntry(owner, 'trip', general({ shape: { kind: 'route', stops: [{ place: town }, { place: quiet }, { at: [2.5, 41.9], name: { en: 'Hill' } }, { place: port }], unsure: [0] } }))
    chronicle.putEntry(owner, 'spots', general({ shape: { kind: 'places', places: [{ place: town }, { place: quiet }] } }))
    chronicle.putEntry(owner, 'bare', general({ shape: null }))
    expect(chronicle.shapeFor(owner, 'trip').shape).toEqual({ kind: 'route', stops: [{ place: town, name: 'Hill Town Test', lat: 41.2, lon: 1.7 }, { place: quiet, name: 'Quiet Hamlet', lat: 41.6, lon: 0.9 }, { at: [2.5, 41.9], name: { en: 'Hill' } }, { place: port, name: 'Port Test', lat: 41.4, lon: 2.1 }], unsure: [0] })
    expect(() => chronicle.shapeFor(owner, 'bare')).toThrow('not found')
    expect(() => chronicle.shapeFor(owner, 'no-such-key')).toThrow('not found')
    expect(chronicle.listChronicle(owner).entries.find((e) => e.key === 'bare')?.hasShape).toBe(false)
    // The list says what kind of shape each entry has, without sending it.
    expect(Object.fromEntries(chronicle.listChronicle(owner).entries.filter((e) => ['trip', 'spots', 'bare'].includes(e.key)).map((e) => [e.key, e.kind]))).toEqual({ trip: 'route', spots: 'places', bare: null })
    // To a reader the hamlet is a place of a hidden relative: the stop goes, and the leg that replaces it stays unsure.
    const r = chronicle.shapeFor(readerCookie, 'trip').shape
    expect(JSON.stringify(r)).not.toContain('Quiet Hamlet')
    expect(JSON.stringify(r)).not.toContain(quiet)
    expect(r).toEqual({ kind: 'route', stops: [{ place: town, name: 'Hill Town Test', lat: 41.2, lon: 1.7 }, { at: [2.5, 41.9], name: { en: 'Hill' } }, { place: port, name: 'Port Test', lat: 41.4, lon: 2.1 }], unsure: [0] })
    expect(chronicle.shapeFor(readerCookie, 'spots').shape).toEqual({ kind: 'places', places: [{ place: town, name: 'Hill Town Test', lat: 41.2, lon: 1.7 }] })
    // The list never carries a shape at all.
    expect(JSON.stringify(chronicle.listChronicle(owner))).not.toContain('Hill Town Test')
  })
})

describe('the switches under Settings > Map', () => {
  it('a fresh archive starts with both off, and an agent writing the first entry does not turn them on', () => {
    unwritten()
    expect(chronicle.getSwitches(owner)).toEqual({ history: false, chronicle: false, show: 'all', entries: 0 })
    chronicle.putEntry(token('editor', false), 'first', general())
    expect([stored(chronicle.HISTORY_KEY), stored(chronicle.CHRONICLE_KEY)]).toEqual(['off', 'off'])
    expect(chronicle.getSwitches(owner)).toMatchObject({ history: false, chronicle: false, entries: 1 })
  })

  it('an archive whose agents wrote entries before them counts each unwritten switch as on, until the owner flips it', () => {
    chronicle.putEntry(owner, 'war', general())
    unwritten()
    expect(chronicle.getSwitches(owner)).toEqual({ history: true, chronicle: true, show: 'all', entries: 1 })
    expect(lines(readerCookie, 'war')?.length).toBeGreaterThan(0)
    // A later entry keeps them as they are.
    chronicle.putEntry(owner, 'later', general())
    expect(stored(chronicle.HISTORY_KEY)).toBeNull()
    // Flipped, the stored value wins over the rule.
    expect(chronicle.setSwitches(owner, { chronicle: false })).toMatchObject({ history: true, chronicle: false })
    expect(stored(chronicle.CHRONICLE_KEY)).toBe('off')
    expect(chronicle.getSwitches(owner)).toMatchObject({ history: true, chronicle: false, entries: 2 })
  })

  it('the two are independent', () => {
    chronicle.setSwitches(owner, { history: false, chronicle: true })
    expect(chronicle.getSwitches(owner)).toMatchObject({ history: false, chronicle: true })
    chronicle.setSwitches(owner, { history: true, chronicle: false })
    expect(chronicle.getSwitches(owner)).toMatchObject({ history: true, chronicle: false })
    chronicle.setSwitches(owner, { history: true })
    expect(chronicle.getSwitches(owner)).toMatchObject({ history: true, chronicle: false })
  })

  it('only the owner in person sets them: not an editor, a token, a reader or a link', () => {
    const g = guestOf(createShare(owner, { name: 's' }).token)
    for (const a of [editor, readerCookie, token('editor'), token('editor', false), token('reader'), g]) {
      expect(() => chronicle.setSwitches(a, { history: true })).toThrow('forbidden')
    }
  })

  it('a wrong value is refused', () => {
    for (const bad of [{}, { history: 'yes' }, { chronicle: 1 }, { show: 'everyone' }, { history: true, other: true }, null, 'on']) {
      expect(() => chronicle.setSwitches(owner, bad), JSON.stringify(bad)).toThrow()
    }
    expect(chronicle.getSwitches(owner)).toMatchObject({ history: true, chronicle: true, show: 'all' })
  })

  it('off means off for readers and editors in person, and the agents writing it still read and write', () => {
    chronicle.putEntry(owner, 'war', general())
    chronicle.setSwitches(owner, { history: false, chronicle: false })
    for (const [who, a] of Object.entries({ editor, readerCookie, link: guestOf(createShare(owner, { name: 'off' }).token) })) {
      expect(chronicle.getSwitches(a), who).toEqual({ history: false, chronicle: false })
      expect(chronicle.listChronicle(a).entries, who).toEqual([])
      expect(() => chronicle.shapeFor(a, 'war'), who).toThrow('not found')
    }
    const bot = token('editor')
    expect(chronicle.putEntry(bot, 'more', general())).toEqual({ key: 'more', created: true })
    expect(chronicle.listChronicle(bot).entries.map((e) => e.key).sort()).toEqual(['more', 'war'])
    expect(chronicle.shapeFor(bot, 'war').shape.kind).toBe('zones')
    expect(chronicle.listChronicle(owner).entries.length).toBe(2)
  })

  it('the words alone: readers get the entries but no shape; the shapes alone: both', () => {
    chronicle.putEntry(owner, 'war', general())
    chronicle.setSwitches(owner, { history: false, chronicle: true })
    expect(chronicle.listChronicle(readerCookie).entries.map((e) => e.key)).toEqual(['war'])
    expect(() => chronicle.shapeFor(readerCookie, 'war')).toThrow('not found')
    chronicle.setSwitches(owner, { history: true, chronicle: false })
    expect(chronicle.listChronicle(readerCookie).entries.map((e) => e.key)).toEqual(['war'])
    expect(chronicle.shapeFor(readerCookie, 'war').shape.kind).toBe('zones')
  })

  it('while only the owner sees it, everyone else is told both are off', () => {
    chronicle.putEntry(owner, 'war', general())
    chronicle.setSwitches(owner, { show: 'owner' })
    expect(chronicle.getSwitches(readerCookie)).toEqual({ history: false, chronicle: false })
    expect(chronicle.getSwitches(editor)).toEqual({ history: false, chronicle: false })
    expect(chronicle.getSwitches(token('editor'))).toEqual({ history: true, chronicle: true })
    expect(chronicle.getSwitches(owner)).toEqual({ history: true, chronicle: true, show: 'owner', entries: 1 })
  })
})
