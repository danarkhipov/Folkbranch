import { parseGedcom, unreadTags, writeGedcom } from '../gedcom'
import type { Certainty } from '../types'
import { yearOf } from '../types'
import { peopleWords } from '../names'
import { Actor, mutate, requireRole, seesOnlyPublic } from './core'
import { addParent, addUnion, getGraph, insertPerson } from './people'
import { insertPage } from './pages'
import { getSetting, say } from './settings'


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
  }
}

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] })

// QUAY: 3 and 2 are direct and secondary evidence, 1 questionable, 0 unreliable.
function certaintyOf(quality: number | null): Certainty {
  if (quality === null) return 'family'
  return quality >= 2 ? 'documented' : quality === 1 ? 'family' : 'assumed'
}

export function importGedcom(actor: Actor, text: string) {
  requireRole(actor, 'editor')
  const g = parseGedcom(text, getSetting('language') === 'en' ? 'en' : 'ru')
  return mutate(actor, { summary: `${say('Импорт GEDCOM')}: ${peopleWords(g.persons.length, getSetting('language') === 'en' ? 'en' : 'ru')}` }, (c) => {
    const ids = new Map<string, string>()
    for (const p of g.persons) {
      const living = !p.dead && !p.deathDate && !((yearOf(p.birthDate) ?? 9999) < new Date().getFullYear() - 110)
      const id = insertPerson(c, {
        givenName: p.givenName, surname: p.surname, maidenName: p.maidenName, patronymic: p.patronymic, otherNames: p.otherNames, sex: p.sex, facts: p.facts, sources: p.sources,
        birthDate: p.birthDate, birthPlace: p.birthPlace, deathDate: p.deathDate, deathPlace: p.deathPlace,
        living, certainty: certaintyOf(p.quality),
      })
      ids.set(p.xref, id)
      // Notes have no field of their own, so they become a page.
      const blocks = [
        ...p.notes.flatMap((n) => n.split('\n').filter(Boolean).map(paragraph)),
      ]
      if (blocks.length) insertPage(c, { personId: id, title: say('Биография'), content: blocks })
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
        if (a) addParent(c, a, cid, ch.adopted ? 'adopted' : 'birth', placeholder ? 'assumed' : 'family')
        if (b) addParent(c, b, cid, ch.adopted ? 'adopted' : 'birth', 'family')
      }
    }
    return { persons: g.persons.length, families: g.families.length }
  })
}

export function exportGedcom(actor: Actor, hideLiving: boolean) {
  const graph = getGraph(actor)
  // Readers never get living relatives, whatever the checkbox says.
  return writeGedcom(graph, { hideLiving: hideLiving || seesOnlyPublic(actor), source: 'FamilyGraph' })
}
