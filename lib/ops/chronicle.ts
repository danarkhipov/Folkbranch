// The chronicle's store. Entries are what was going on around the family, not facts about a person: agents write them
// straight, with no review queue and no history, as saved views are (views.ts). Every read goes through one gate,
// listChronicle, so a reader never receives a relative hidden from them.
import { eq, getTableColumns, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '../db'
import { announceChange } from '../live'
import { endOfDate, isDate, mentionedIn, parseDate, type ChronicleList, type ChronicleSwitches, type Entry, type PersonLine, type PlaceRef, type RouteStop, type Shape, type Text } from '../chronicle'
import { Actor, newId, OpError, requireRole, seesOnlyPublic } from './core'
import { getSetting, setSetting } from './app-config'
import { getGraph } from './people'
import { listPlaces } from './places'

export const SHOW_KEY = 'chronicleShow'
/** Settings > Map: the entries' shapes drawn on the map, and their words beside it. 'on' or 'off'. */
export const HISTORY_KEY = 'mapHistory'
export const CHRONICLE_KEY = 'mapChronicle'
const SWITCH_KEYS = [HISTORY_KEY, CHRONICLE_KEY]
const MAX_ENTRIES = 300
const MAX_POINTS = 5000
export const KEY = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** Words in any of the app's languages, each checked the same way. */
const langs = (word: z.ZodType<string>) => z.object({ ru: word.optional(), en: word.optional(), es: word.optional(), ca: word.optional() }).strict()
const text = (max: number) => langs(z.string().trim().min(1).max(max)).refine((t) => Object.values(t).some(Boolean), 'at least one language')
const date = z.string().refine(isDate, 'a date is YYYY, YYYY-MM or YYYY-MM-DD, between 1000 and 2200')
const round = (v: number) => Math.round(v * 1000) / 1000
const lonLat = z.tuple([z.number().min(-180).max(180), z.number().min(-85).max(85)]).transform(([lon, lat]) => [round(lon), round(lat)] as [number, number])
const ring = z.array(lonLat).min(4)
const outline = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Polygon'), coordinates: z.array(ring).min(1) }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(ring).min(1)) }),
])
const pointsOf = (o: z.infer<typeof outline>) => (o.type === 'Polygon' ? [o.coordinates] : o.coordinates).reduce((n, poly) => n + poly.reduce((m, r) => m + r.length, 0), 0)
const stage = z.object({ at: date, outline, label: lonLat.optional(), hold: z.boolean().optional() })
  .refine((s) => pointsOf(s.outline) <= MAX_POINTS, `at most ${MAX_POINTS} points a stage`)
const zone = z.object({ id: z.string().trim().min(1).max(40), name: text(80), tone: z.union([z.literal(1), z.literal(2), z.literal(3)]), stages: z.array(stage).min(1).max(30) })
  .refine((zn) => zn.stages.every((s, i) => i === 0 || parseDate(s.at) > parseDate(zn.stages[i - 1].at)), 'stages must be in rising order of date')
const placeRef = z.object({ place: z.string().trim().min(1).max(40) })
const freeStop = z.object({ at: lonLat, name: text(80).optional() })
const shape = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('places'), places: z.array(placeRef).min(1).max(60) }),
  z.object({ kind: z.literal('route'), stops: z.array(z.union([placeRef, freeStop])).min(2).max(60), unsure: z.array(z.number().int().min(0)).max(60).optional() })
    .refine((r) => (r.unsure ?? []).every((i) => i < r.stops.length - 1), 'unsure lists legs: 0 to the number of stops minus 2'),
  z.object({ kind: z.literal('zones'), zones: z.array(zone).min(1).max(4) }),
])
const personLine = z.object({ personId: z.string().trim().min(1).max(40), at: date.optional(), text: text(400) })

export const entryInput = z.object({
  from: date,
  to: date.optional(),
  lead: z.boolean().default(false),
  namesPeople: z.boolean().default(false),
  title: text(80),
  body: langs(z.string().max(4000)).default({}),
  link: langs(z.string().max(500).startsWith('https://', 'a link starts with https://')).default({}),
  shape: shape.nullish(),
  people: z.array(personLine).max(200).default([]),
}).refine((e) => !e.to || endOfDate(e.to) > parseDate(e.from), { message: 'to is before from', path: ['to'] })

type Row = typeof schema.chronicle.$inferSelect

/** One relative's line as stored: the year worked out once, on write. */
const storedLine = (l: z.infer<typeof personLine>): PersonLine => ({ personId: l.personId, ...(l.at ? { at: l.at, year: parseDate(l.at) } : {}), text: l.text as Text })

function storedShape(s: z.infer<typeof shape>): Shape {
  if (s.kind !== 'zones') return s as Shape
  return { kind: 'zones', zones: s.zones.map((zn) => ({ ...zn, name: zn.name as Text, stages: zn.stages.map((st) => ({ ...st, year: parseDate(st.at) })) })) }
}

const placeIds = (s: z.infer<typeof shape> | null | undefined): string[] =>
  !s ? [] : s.kind === 'places' ? s.places.map((p) => p.place) : s.kind === 'route' ? s.stops.flatMap((st) => ('place' in st ? [st.place] : [])) : []

/** Creates or replaces a whole entry under its key. The same body twice leaves one entry. */
export function putEntry(actor: Actor, key: string, raw: unknown) {
  requireRole(actor, 'editor')
  if (actor.guest) throw new OpError(403, 'forbidden')
  if (!KEY.test(key) || key.length > 80) throw new OpError(400, 'key: lower-case words joined by "-", at most 80 characters')
  const e = entryInput.parse(raw)
  const db = getDb()
  // Ids that do not exist are named, so an agent's typo is caught at once.
  const persons = new Set(db.select({ id: schema.persons.id }).from(schema.persons).all().map((r) => r.id))
  const places = new Set(db.select({ id: schema.places.id }).from(schema.places).all().map((r) => r.id))
  const lines = new Set(e.people.map((l) => l.personId))
  const unknownPeople = [...new Set([...lines].filter((id) => !persons.has(id)))]
  const unknownPlaces = [...new Set(placeIds(e.shape).filter((id) => !places.has(id)))]
  if (unknownPeople.length || unknownPlaces.length) throw new OpError(400, [unknownPeople.length ? `unknown people: ${unknownPeople.join(', ')}` : '', unknownPlaces.length ? `unknown places: ${unknownPlaces.join(', ')}` : ''].filter(Boolean).join('; '))
  // A mention names a relative in words every reader of the entry gets: allowed only where the entry is hidden whole
  // from anyone who cannot see everyone in it.
  const mentioned = [...mentionedIn(e.title), ...mentionedIn(e.body), ...e.people.flatMap((l) => mentionedIn(l.text))]
  if (mentioned.length && !e.namesPeople) throw new OpError(400, 'a person: mention needs namesPeople: true')
  const stray = [...new Set(mentioned.filter((id) => !lines.has(id)))]
  if (stray.length) throw new OpError(400, `mentioned but not in people: ${stray.join(', ')}`)
  const now = Date.now()
  const values = {
    fromYear: parseDate(e.from), toYear: endOfDate(e.to ?? e.from), dateFrom: e.from, dateTo: e.to ?? '',
    lead: e.lead ? 1 : 0, namesPeople: e.namesPeople ? 1 : 0,
    title: JSON.stringify(e.title), body: JSON.stringify(e.body), link: JSON.stringify(e.link),
    shape: e.shape ? JSON.stringify(storedShape(e.shape)) : null,
    people: JSON.stringify(e.people.map(storedLine)),
    updatedBy: actor.name,
  }
  const t = schema.chronicle
  const created = db.transaction(() => {
    const old = db.select({ id: t.id, updatedAt: t.updatedAt }).from(t).where(eq(t.key, key)).get()
    if (old) {
      // Later than before, always: the browser keeps a shape by its entry's time.
      db.update(t).set({ ...values, updatedAt: Math.max(now, old.updatedAt + 1) }).where(eq(t.id, old.id)).run()
      return false
    }
    const count = db.select({ n: sql<number>`count(*)` }).from(t).get()?.n ?? 0
    if (count >= MAX_ENTRIES) throw new OpError(400, `at most ${MAX_ENTRIES} entries`)
    // An archive's first entry: the switches the owner never touched are written off here, so an agent filling the
    // chronicle never turns it on by itself (an unwritten switch counts as on only where entries came before them).
    if (!count) for (const k of SWITCH_KEYS) if (getSetting(k) === null) setSetting(k, 'off')
    db.insert(t).values({ id: newId(), key, ...values, createdBy: actor.name, createdAt: now, updatedAt: now }).run()
    return true
  })
  announceChange()
  return { key, created }
}

export function deleteEntry(actor: Actor, key: string) {
  requireRole(actor, 'editor')
  if (actor.guest) throw new OpError(403, 'forbidden')
  const gone = getDb().delete(schema.chronicle).where(eq(schema.chronicle.key, key)).run()
  if (!gone.changes) throw new OpError(404, 'not found')
  announceChange()
}

const switchesInput = z.object({ history: z.boolean().optional(), chronicle: z.boolean().optional(), show: z.enum(['owner', 'all']).optional() }).strict()
  .refine((v) => Object.keys(v).length > 0, 'history, chronicle or show')

/**
 * The owner's switches under Settings > Map: the shapes on the map (`history`), the words beside it (`chronicle`), and
 * who sees them (`show`: the owner alone, the default, or everyone, each through the filter below). Any of the three.
 */
export function setSwitches(actor: Actor, raw: unknown): ChronicleSwitches {
  requireRole(actor, 'owner')
  if (actor.tokenId || actor.guest) throw new OpError(403, 'forbidden')
  const v = switchesInput.parse(raw)
  if (v.history !== undefined) setSetting(HISTORY_KEY, v.history ? 'on' : 'off')
  if (v.chronicle !== undefined) setSetting(CHRONICLE_KEY, v.chronicle ? 'on' : 'off')
  if (v.show) setSetting(SHOW_KEY, v.show)
  announceChange()
  return getSwitches(actor)
}

/** Who sees the chronicle, alone: the switch as it was before Settings > Map. */
export function setShow(actor: Actor, raw: unknown) {
  const { show } = z.object({ show: z.enum(['owner', 'all']) }).parse(raw)
  setSwitches(actor, { show })
  return { show }
}

const showing = (): 'owner' | 'all' => (getSetting(SHOW_KEY) === 'all' ? 'all' : 'owner')
const entryCount = () => getDb().select({ n: sql<number>`count(*)` }).from(schema.chronicle).get()?.n ?? 0
/** A switch as stored; one never written counts as on where entries were written before it (an archive from before Settings > Map). */
function switchOn(key: string, entries = entryCount): boolean {
  const v = getSetting(key)
  return v === null ? entries() > 0 : v === 'on'
}
const isOwner = (a: Actor) => a.role === 'owner' && !a.tokenId && !a.guest
/** While only the owner sees it, the agents writing it still read what they wrote. */
const seesDrafts = (a: Actor) => isOwner(a) || (!!a.tokenId && a.role === 'editor' && !a.guest)
/** Whether this person is shown the chronicle at all: the owner and the agents writing it always, others when it is on for them. */
const shownTo = (a: Actor) => seesDrafts(a) || showing() === 'all'

/** The switches as this person gets them, so a page that would show nothing never asks for the entries. */
export function getSwitches(actor: Actor): ChronicleSwitches {
  let n: number | null = null
  const count = () => (n ??= entryCount())
  const history = switchOn(HISTORY_KEY, count), chronicle = switchOn(CHRONICLE_KEY, count)
  if (isOwner(actor)) return { history, chronicle, show: showing(), entries: count() }
  return shownTo(actor) ? { history, chronicle } : { history: false, chronicle: false }
}

/** The rows this person may have, each with only the lines of relatives shown to them. The one gate. */
type Listed = Row & { kind: string | null }
function visibleRows(actor: Actor): { row: Listed; people: PersonLine[] }[] {
  // Off means off for everyone but those who write it and the owner who turns it on.
  if (!seesDrafts(actor) && (!shownTo(actor) || !(switchOn(HISTORY_KEY) || switchOn(CHRONICLE_KEY)))) return []
  const graph = getGraph(actor)
  // In the graph and not masked: someone outside a link's view is not there at all, someone living is an empty card.
  const visible = new Set(graph.persons.filter((p) => !p.hidden).map((p) => p.id))
  const out: { row: Listed; people: PersonLine[] }[] = []
  const t = schema.chronicle
  // The shape's kind is read by the database, so a list never parses the outlines it does not send.
  for (const row of getDb().select({ ...getTableColumns(t), kind: sql<string | null>`json_extract(${t.shape}, '$.kind')` }).from(t).orderBy(t.fromYear).all()) {
    const all = JSON.parse(row.people) as PersonLine[]
    const people = all.filter((l) => visible.has(l.personId))
    // An entry whose own words name relatives goes whole or not at all.
    if (row.namesPeople && people.length !== all.length) continue
    out.push({ row, people })
  }
  return out
}

const KINDS = new Set(['places', 'route', 'zones'])
const toEntry = (actor: Actor, row: Listed, people: PersonLine[]): Entry => ({
  key: row.key, from: row.dateFrom, to: row.dateTo, fromYear: row.fromYear, toYear: row.toYear,
  lead: !!row.lead, namesPeople: !!row.namesPeople,
  title: JSON.parse(row.title), body: JSON.parse(row.body), link: JSON.parse(row.link),
  hasShape: row.shape !== null, kind: row.kind && KINDS.has(row.kind) ? (row.kind as Entry['kind']) : null, people: [...people].sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity)),
  // An account's name can be a living relative's: a reader is not told who wrote it.
  by: seesOnlyPublic(actor) ? '' : row.updatedBy,
  updatedAt: row.updatedAt,
})

export function listChronicle(actor: Actor): ChronicleList {
  const entries = visibleRows(actor).map(({ row, people }) => toEntry(actor, row, people))
  return isOwner(actor) ? { show: showing(), entries } : { entries }
}

/** An entry's shape with the register's names and points in it, for whoever may see the entry; otherwise 404. */
export function shapeFor(actor: Actor, key: string): { shape: Shape } {
  if (!seesDrafts(actor) && !switchOn(HISTORY_KEY)) throw new OpError(404, 'not found')
  const found = visibleRows(actor).find((r) => r.row.key === key)
  if (!found?.row.shape) throw new OpError(404, 'not found')
  const s = JSON.parse(found.row.shape) as Shape
  if (s.kind === 'zones') return { shape: s }
  // A reader gets only the places shown to them (listPlaces): a town can be all that is left of a hidden relative.
  const known = new Map((seesOnlyPublic(actor) ? listPlaces(actor) : getDb().select().from(schema.places).all()).map((p) => [p.id, p]))
  const fill = (r: PlaceRef): PlaceRef | null => {
    const p = known.get(r.place)
    if (!p) return null
    return { place: r.place, name: p.name, ...(p.lat !== null && p.lon !== null ? { lat: p.lat, lon: p.lon } : {}) }
  }
  if (s.kind === 'places') return { shape: { kind: 'places', places: s.places.map(fill).filter((p): p is PlaceRef => !!p) } }
  // A stop left out joins the legs either side of it; a leg is unsure if either was.
  const stops: RouteStop[] = [], unsure = new Set<number>(), was = new Set(s.unsure ?? [])
  let doubt = false
  s.stops.forEach((st, i) => {
    const kept = 'place' in st ? fill(st) : st
    if (i > 0 && was.has(i - 1)) doubt = true
    if (!kept) return
    if (doubt && stops.length) unsure.add(stops.length - 1)
    doubt = false
    stops.push(kept)
  })
  return { shape: { kind: 'route', stops, ...(unsure.size ? { unsure: [...unsure] } : {}) } }
}

