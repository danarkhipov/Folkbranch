import { eq } from 'drizzle-orm'
import { parseGedcom, placeholders, unreadTags, writeGedcom } from '../gedcom'
import type { Certainty, Fact, Source } from '../types'
import { yearOf } from '../types'
import { peopleWords } from '../names'
import { Actor, type Changes, dropStoriesAboutNobody, mutate, newId, OpError, requireRole, seesOnlyPublic } from './core'
import { addParent, addUnion, getGraph, insertPerson, normalize } from './people'
import { accountsLetGo, matchPeople, matchReport } from './gedcom-match'
import { getDb, schema } from '../db'
import { insertPage } from './pages'
import { archiveLang, say, tell } from './settings'
import { findPlace, onMap, placeMatches } from '../places'
import { listPlaces, toPlace } from './places'
import type { Imported } from '../gedcom'
import { isGrampsXml, parseGramps } from '../gramps'
import type { Lang } from '../types'

/** A GEDCOM file or Gramps' own XML: both arrive as text and are read into one shape. */
const readTree = (text: string, lang?: Lang) => (isGrampsXml(text) ? parseGramps(text, lang) : parseGedcom(text, lang))
const pointCount = (g: Imported) => g.places.filter((p) => p.lat !== null && p.lon !== null).length


export function previewGedcom(actor: Actor, text: string) {
  requireRole(actor, 'editor')
  const g = readTree(text)
  const known = new Set(getGraph(actor).persons.map((p) => `${p.givenName} ${p.surname}`.toLowerCase()))
  return {
    version: g.version,
    // A family with no parent in the file gains a card "?", and the count says so before the import.
    persons: g.persons.length + placeholders(g),
    families: g.families.length,
    sample: g.persons.slice(0, 6).map((p) => [p.givenName, p.surname].filter(Boolean).join(' ')),
    existing: g.persons.filter((p) => known.has(`${p.givenName} ${p.surname}`.toLowerCase())).length,
    unread: g.unread ?? unreadTags(text),
    // Places the file gives a point for: they will be on the map without anyone typing it.
    points: pointCount(g),
    format: isGrampsXml(text) ? 'gramps' : 'gedcom',
    people: g.persons.map((p) => ({ xref: p.xref, name: [p.givenName, p.patronymic, p.surname].filter(Boolean).join(' '), year: yearOf(p.birthDate) })),
    media: g.persons.flatMap((p) => p.media.map((m) => ({ xref: p.xref, ...m }))),
    ...matchReport(g),
  }
}

export type ImportMode = 'add' | 'merge' | 'replace'
const list = <T>(s: string | null) => JSON.parse(s ?? '[]') as T[]
const unite = <T>(a: T[], b: T[], key: (x: T) => string) => { const seen = new Set(a.map(key)); return [...a, ...b.filter((x) => !seen.has(key(x)))] }
const sameFact = (f: Fact) => JSON.stringify([f.kind, f.date, f.place, f.note])
const sameSource = (s: Source) => s.id ?? JSON.stringify([s.title, s.ref, s.page, s.url])

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] })

// QUAY: 3 and 2 are direct and secondary evidence, 1 questionable, 0 unreliable.
function certaintyOf(quality: number | null): Certainty {
  if (quality === null) return 'family'
  return quality >= 2 ? 'documented' : quality === 1 ? 'family' : 'assumed'
}

export function importGedcom(actor: Actor, text: string, mode: ImportMode = 'add') {
  requireRole(actor, mode === 'replace' ? 'owner' : 'editor')
  const g = readTree(text, archiveLang())
  const gramps = isGrampsXml(text)
  // A truncated download or the wrong file has no INDI at all: replacing with it would empty the archive.
  if (mode === 'replace' && !g.persons.length) throw new OpError(400, tell('В файле нет ни одного человека: замена опустошила бы архив'))
  // Two records with one id would make every link point at whichever came last, with no warning.
  const xrefs = new Set<string>()
  const repeated = new Set<string>()
  for (const p of g.persons) {
    if (!p.xref) continue
    if (xrefs.has(p.xref)) repeated.add(p.xref)
    xrefs.add(p.xref)
  }
  if (repeated.size) throw new OpError(400, `${tell('В файле повторяются номера записей')}: ${[...repeated].join(', ')}`)
  const db = getDb()
  const verb = mode === 'replace' ? 'Заменить дерево файлом' : mode === 'merge' ? 'Объединить с файлом' : gramps ? 'Импорт Gramps' : 'Импорт GEDCOM'
  const found = mode === 'merge' ? matchPeople(g) : new Map()
  // A family without parents gains a card "?" so its children stay siblings; it is new like the rest.
  const total = g.persons.length + placeholders(g)
  const oldCount = mode === 'replace' ? db.select({ id: schema.persons.id }).from(schema.persons).all().length : 0
  // Whether the cards came in new, merged into existing ones or replaced the whole tree, and how many of each.
  const counts = mode === 'replace'
    ? ` · ${say('Удалено')}: ${oldCount} · ${say('новых')}: ${total}`
    : mode === 'merge'
      ? ` · ${say('новых')}: ${total - found.size} · ${say('обновлено')}: ${found.size}`
      : ` · ${say('новых')}: ${total}`
  const personIds: string[] = []
  const points = pointCount(g) ? ` · ${say('точек мест из файла')}: ${pointCount(g)}` : ''
  return mutate(actor, { summary: `${say(verb)}: ${peopleWords(total, archiveLang())}${counts}${points}`, personIds }, (c) => {
    const ids = new Map<string, string>()
    if (mode === 'replace') {
      for (const [table, rows] of [
        ['parentChild', db.select({ id: schema.parentChild.id }).from(schema.parentChild).all()],
        ['unions', db.select({ id: schema.unions.id }).from(schema.unions).all()],
        ['mediaTags', db.select({ id: schema.mediaTags.id }).from(schema.mediaTags).all()],
        ['pages', db.select({ id: schema.pages.id }).from(schema.pages).all()],
        ['storyPeople', db.select({ id: schema.storyPeople.id }).from(schema.storyPeople).all()],
        ['contacts', db.select({ id: schema.contacts.id }).from(schema.contacts).all()],
        ['persons', db.select({ id: schema.persons.id }).from(schema.persons).all()],
      ] as const) for (const r of rows) { c.remove(table, r.id); if (table === 'persons') personIds.push(r.id) }
      dropStoriesAboutNobody(c)
      accountsLetGo(c)
    }
    for (const p of g.persons) {
      const same = found.get(p.xref)
      if (same) {
        // The card already here keeps what it has; the file only fills the gaps and adds what is new.
        const row = same.row
        const gaps: Record<string, string> = {}
        for (const k of ['patronymic', 'maidenName', 'birthDate', 'birthPlace', 'deathDate', 'deathPlace'] as const) if (!row[k] && p[k]) gaps[k] = p[k]
        if (row.sex === 'U' && p.sex !== 'U') gaps.sex = p.sex
        const names = unite(row.otherNames ? row.otherNames.split(', ') : [], p.otherNames ? p.otherNames.split(', ') : [], (x) => x.toLowerCase()).join(', ')
        c.update('persons', row.id, {
          ...normalize({ ...gaps, otherNames: names, facts: unite(list<Fact>(row.facts), p.facts, sameFact), sources: unite(list<Source>(row.sources), p.sources, sameSource) }),
          ...(gaps.deathDate || p.dead ? { living: false } : {}),
        })
        ids.set(p.xref, row.id)
        personIds.push(row.id)
        const blocks = p.notes.flatMap((n) => n.split('\n').filter(Boolean).map(paragraph))
        const hasBio = db.select({ id: schema.pages.id }).from(schema.pages).where(eq(schema.pages.personId, row.id)).all().length > 0
        if (blocks.length && !hasBio) insertPage(c, { personId: row.id, title: say('Биография'), content: blocks })
        continue
      }
      const living = !p.dead && !p.deathDate && !((yearOf(p.birthDate) ?? 9999) < new Date().getFullYear() - 110)
      const id = insertPerson(c, {
        givenName: p.givenName, surname: p.surname, maidenName: p.maidenName, patronymic: p.patronymic, otherNames: p.otherNames, sex: p.sex, facts: p.facts, sources: p.sources,
        birthDate: p.birthDate, birthPlace: p.birthPlace, deathDate: p.deathDate, deathPlace: p.deathPlace, keepPrivate: p.keepPrivate, noChildren: p.noChildren, neverMarried: p.neverMarried,
        living, certainty: certaintyOf(p.quality),
      })
      ids.set(p.xref, id)
      personIds.push(id)
      // Notes have no field of their own, so they become a page.
      const blocks = [
        ...p.notes.flatMap((n) => n.split('\n').filter(Boolean).map(paragraph)),
      ]
      if (blocks.length) insertPage(c, { personId: id, title: say('Биография'), content: blocks })
    }
    // Godparents and witnesses named by their place in the file now point at their cards.
    const mapId = (x: string | null | undefined) => (x ? ids.get(x) ?? (xrefs.has(x) ? null : x) : null)
    for (const p of g.persons) {
      if (!p.facts.some((f) => f.people?.some((x) => x.personId))) continue
      const id = ids.get(p.xref)!
      const facts = list<Fact>(db.select({ f: schema.persons.facts }).from(schema.persons).where(eq(schema.persons.id, id)).get()!.f).map((f) => (f.people ? { ...f, people: f.people.map((x) => ({ ...x, personId: mapId(x.personId) })) } : f))
      c.update('persons', id, { facts: JSON.stringify(facts) })
    }
    for (const f of g.families) {
      let a = f.husb && ids.get(f.husb)
      const b = f.wife && ids.get(f.wife)
      // Exports with hidden people can drop both parents; a placeholder keeps the children siblings.
      const placeholder = !a && !b && f.children.length > 1
      if (placeholder) { a = insertPerson(c, { givenName: '?', living: false, certainty: 'assumed' }); personIds.push(a) }
      if (a && b) addUnion(c, a, b, f.kind, f.date, f.end, f.place)
      for (const ch of f.children) {
        const cid = ids.get(ch.xref)
        if (!cid) continue
        // Merging into a tree that already has these people: a link that would make someone their own ancestor is left out.
        const safe = (fn: () => void) => { if (mode !== 'merge') return fn(); try { fn() } catch (e) { if (!(e instanceof OpError)) throw e } }
        if (a) safe(() => addParent(c, a, cid, ch.adopted ? 'adopted' : 'birth', placeholder ? 'assumed' : 'family'))
        if (b) safe(() => addParent(c, b, cid, ch.adopted ? 'adopted' : 'birth', 'family'))
      }
    }
    const placed = filePoints(c, g.places, say(gramps ? 'Точка из файла Gramps' : 'Точка из файла GEDCOM'))
    return { persons: total, families: g.families.length, merged: found.size, ids: Object.fromEntries(ids), places: placed }
  })
}

/**
 * The points a file gives its places, written to the archive's place records in the same change as the people, so one
 * undo takes both back. A record with no point gets the file's; a place with no record gets one; a point already in the
 * archive is kept, since someone chose it here; a text two records answer to is left for a person to settle.
 * A Gramps file also gives places without a point, what each is part of and its other names: a new record takes them,
 * and one already here gains the names it lacks and a parent where it has none.
 */
function filePoints(c: Changes, points: Imported['places'], credit: string) {
  const all = getDb().select().from(schema.places).all().map(toPlace)
  const out = { filled: 0, created: 0, kept: 0, ambiguous: 0 }
  // The record each text of the file came to mean, so a place finds its parent even when the name is common.
  const recordOf = new Map<string, string>()
  for (const pt of points) {
    const hasPoint = pt.lat !== null && pt.lon !== null
    const parentId = pt.parent ? recordOf.get(pt.parent) ?? null : null
    const place = findPlace(pt.text, all)
    if (place) {
      recordOf.set(pt.text, place.id)
      const known = new Set([place.name, ...place.otherNames.map((n) => n.name)].map((n) => n.toLowerCase()))
      const names = (pt.otherNames ?? []).filter((n) => !known.has(n.name.toLowerCase()))
      const more = {
        ...(names.length ? { otherNames: JSON.stringify([...place.otherNames, ...names].slice(0, 30)) } : {}),
        ...(!place.parentId && parentId && parentId !== place.id ? { parentId } : {}),
      }
      if (onMap(place) || !hasPoint) {
        if (hasPoint) out.kept++
        if (Object.keys(more).length) { c.update('places', place.id, { ...more, updatedAt: Date.now() }); Object.assign(place, { ...more, otherNames: [...place.otherNames, ...names] }) }
        continue
      }
      c.update('places', place.id, { ...more, lat: pt.lat, lon: pt.lon, note: [place.note, credit].filter(Boolean).join('\n').slice(0, 2000), updatedAt: Date.now() })
      out.filled++
      continue
    }
    if (placeMatches(pt.text, all).length > 1) { if (hasPoint) out.ambiguous++; continue }
    const row = {
      id: newId(), name: (pt.name ?? pt.text).slice(0, 160), kind: (pt.kind ?? '').slice(0, 60), parentId,
      otherNames: JSON.stringify((pt.otherNames ?? []).slice(0, 30)), lat: pt.lat, lon: pt.lon, note: hasPoint ? credit : '', updatedAt: Date.now(),
    }
    c.insert('places', row)
    recordOf.set(pt.text, row.id)
    // Two texts of the file may name one new record: "Anson" and "Anson, Somerset" find the first one made.
    all.push(toPlace(row))
    out.created++
  }
  return out
}

export function exportGedcom(actor: Actor, hideLiving: boolean) {
  const graph = getGraph(actor)
  // Readers never get living relatives, whatever the checkbox says.
  // Points go out with the places they belong to, as GEDCOM's MAP, so Gramps, webtrees or RootsMagic draw them too.
  return writeGedcom(graph, { hideLiving: hideLiving || seesOnlyPublic(actor), source: 'Folkbranch', pageWord: say('л.'), lang: archiveLang(), places: listPlaces(actor) })
}
