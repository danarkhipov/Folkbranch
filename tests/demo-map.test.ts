// The demo family gives the map something to draw, in either language: towns with a point, and lives that move.
import { describe, expect, it } from 'vitest'
import { loadDemo } from '../lib/demo'
import { translate } from '../lib/i18n'
import { descentLine } from '../lib/map-line'
import { mapTimeline } from '../lib/map-timeline'
import type { Actor } from '../lib/ops/core'
import { getGraph } from '../lib/ops/people'
import { listPlaces } from '../lib/ops/places'
import { findPlace, placeChain } from '../lib/places'
import type { Graph, Lang } from '../lib/types'

const owner: Actor = { userId: 'demo-owner', name: 'Ann', role: 'owner', personId: null }

describe('the demo family on the map', () => {
  const seen = new Set<string>()
  for (const lang of ['ru', 'en'] as Lang[]) {
    it(`has places with points and journeys, in ${lang}`, async () => {
      await loadDemo(owner.userId, owner.name, lang)
      // The other language's family may already be in this archive: look at this one only.
      const all = getGraph(owner)
      const graph: Graph = { ...all, persons: all.persons.filter((p) => !seen.has(p.id)) }
      graph.persons.forEach((p) => seen.add(p.id))
      expect(graph.persons).toHaveLength(27)
      const places = listPlaces(owner)
      const tl = mapTimeline(graph, places, (k) => translate(lang, k))

      expect(tl.tracks.length).toBeGreaterThanOrEqual(25)
      expect(tl.missing.filter((m) => m.gap === 'no-coords')).toEqual([])
      const moving = tl.tracks.filter((t) => new Set(t.stops.map((s) => `${s.lat},${s.lon}`)).size >= 2)
      expect(moving.length).toBeGreaterThanOrEqual(8)
      expect(tl.tracks.some((t) => new Set(t.stops.map((s) => s.place)).size >= 4)).toBe(true)
      expect(tl.min).toBeLessThanOrEqual(1890)

      // Every town on a card is a place record with a parent above it, so the Places screen shows where it is.
      for (const p of graph.persons)
        for (const text of [p.birthPlace, p.deathPlace, ...p.facts.map((f) => f.place)].filter(Boolean)) expect(findPlace(text, places)?.parentId, text).toBeTruthy()
      // One line of descent of five generations crosses far: two countries, and more than 5,000 km.
      const parents = new Map<string, string[]>()
      for (const l of graph.parentChild) parents.set(l.childId, [...(parents.get(l.childId) ?? []), l.parentId])
      const ids = new Set(graph.persons.map((p) => p.id))
      const longest = graph.persons.flatMap((a) => graph.persons.map((b) => descentLine(parents, a.id, b.id) ?? [])).filter((c) => c.every((id) => ids.has(id))).sort((x, y) => y.length - x.length)[0]
      expect(longest.length).toBeGreaterThanOrEqual(5)
      const stops = tl.tracks.filter((t) => longest.includes(t.personId)).flatMap((t) => t.stops)
      const countries = new Set(stops.map((st) => placeChain(findPlace(st.place, places)!, places).at(-1)!.name))
      expect(countries.size).toBeGreaterThanOrEqual(2)
      const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => 6371 * Math.acos(Math.min(1, Math.sin(a.lat * Math.PI / 180) * Math.sin(b.lat * Math.PI / 180) + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.cos((a.lon - b.lon) * Math.PI / 180)))
      expect(Math.max(...stops.flatMap((a) => stops.map((b) => km(a, b))))).toBeGreaterThan(5000)

      // A place written by an old name still finds its record.
      if (lang === 'ru') expect(findPlace('Ленинград', places)?.name).toBe('Санкт-Петербург')
    })
  }
})
