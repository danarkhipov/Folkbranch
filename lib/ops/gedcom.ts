import { eq } from 'drizzle-orm'
import { parseGedcom, unreadTags, writeGedcom } from '../gedcom'
import type { Certainty, Fact, Source } from '../types'
import { yearOf } from '../types'
import { peopleWords } from '../names'
import { Actor, dropStoriesAboutNobody, mutate, OpError, requireRole, seesOnlyPublic } from './core'
import { addParent, addUnion, getGraph, insertPerson, normalize } from './people'
import { accountsLetGo, matchPeople, matchReport } from './gedcom-match'
import { getDb, schema } from '../db'
import { insertPage } from './pages'
import { archiveLang, say } from './settings'


export function previewGedcom(actor: Actor, text: string) {
  requireRole(actor, 'editor')
  const g = parseGedcom(text)
  const known = new Set(getGraph(actor).persons.map((p) => `${p.givenName} ${p.surname}`.toLowerCase()))
  return {
    version: g.version,
    persons: g.persons.length,
    families: g.families.length,
    sample: g.persons.slice(0, 6).map((p) => [p.givenName, p.surname].filter(Boolean).join(' ')),
    existing: g.persons.filter((p) => known.has(`${p.givenName} ${p.surname}`.toLowerCase())).length,
    unread: unreadTags(text),
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
  const g = parseGedcom(text, archiveLang())
  const db = getDb()
  const verb = mode === 'replace' ? 'Заменить дерево файлом' : mode === 'merge' ? 'Объединить с файлом' : 'Импорт GEDCOM'
  return mutate(actor, { summary: `${say(verb)}: ${peopleWords(g.persons.length, archiveLang())}` }, (c) => {
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
      ] as const) for (const r of rows) c.remove(table, r.id)
      dropStoriesAboutNobody(c)
      accountsLetGo()
    }
    const found = mode === 'merge' ? matchPeople(g) : new Map()
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
          ...(gaps.deathDate ? { living: false } : {}),
        })
        ids.set(p.xref, row.id)
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
      // Notes have no field of their own, so they become a page.
      const blocks = [
        ...p.notes.flatMap((n) => n.split('\n').filter(Boolean).map(paragraph)),
      ]
      if (blocks.length) insertPage(c, { personId: id, title: say('Биография'), content: blocks })
    }
    // Godparents and witnesses named by their place in the file now point at their cards.
    const xrefs = new Set(g.persons.map((p) => p.xref))
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
      if (placeholder) a = insertPerson(c, { givenName: '?', living: false, certainty: 'assumed' })
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
    return { persons: g.persons.length, families: g.families.length, merged: found.size }
  })
}

export function exportGedcom(actor: Actor, hideLiving: boolean) {
  const graph = getGraph(actor)
  // Readers never get living relatives, whatever the checkbox says.
  return writeGedcom(graph, { hideLiving: hideLiving || seesOnlyPublic(actor), source: 'Folkbranch', pageWord: say('л.') })
}
