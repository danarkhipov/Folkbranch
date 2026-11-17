// A point typed into a place: a pair pasted into one field, what cannot be right, and what is only worth a warning.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Land } from '../lib/land'
import { isOnLand, landFromGeoJSON } from '../lib/land'
import type { Actor } from '../lib/ops/core'
import { coordinateIssue, parseCoords } from '../lib/places'

const owner: Actor = { userId: 'o', name: 'Owner', role: 'owner', personId: null }

let land: Land
let places: typeof import('../lib/ops/places')
const onLand = (lat: number, lon: number) => isOnLand(lat, lon, land)

beforeAll(async () => {
  land = landFromGeoJSON(JSON.parse(readFileSync(path.join(process.cwd(), 'public/atlas/land.json'), 'utf8')))
  places = await import('../lib/ops/places')
})

describe('a point pasted into one field', () => {
  it('splits a decimal pair into latitude and longitude', () => {
    expect(parseCoords('55.7558, 37.6173')).toEqual({ lat: 55.7558, lon: 37.6173 })
  })
  it('reads degrees, minutes and the side of the world', () => {
    expect(parseCoords('55°45′N 37°37′E')).toEqual({ lat: 55.75, lon: 37.616667 })
    expect(parseCoords('33°52′S 151°12′W')).toEqual({ lat: -33.866667, lon: -151.2 })
  })
  it('leaves a single number alone, including one with a decimal comma', () => {
    expect(parseCoords('56.86')).toBeNull()
    expect(parseCoords('56,86')).toBeNull()
    expect(parseCoords('')).toBeNull()
  })
})

describe('a point that cannot be right', () => {
  it('stops a latitude beyond the poles and a longitude beyond 180', () => {
    expect(coordinateIssue(91, 200)).toEqual({ kind: 'range', block: true })
    expect(coordinateIssue(55.7, 181)).toEqual({ kind: 'range', block: true })
  })
  it('calls a pole-sized latitude with a longitude beside it a swap, since one click makes it a place', () => {
    expect(coordinateIssue(100, 37.6)).toEqual({ kind: 'swapped', block: true })
  })
  it('stops the empty point 0,0', () => {
    expect(coordinateIssue(0, 0)).toEqual({ kind: 'zero', block: true })
  })
  it('refuses them through the API too, and nothing is written', () => {
    expect(() => places.savePlace(owner, null, { name: 'За морем', lat: 55.7, lon: 181 })).toThrow('coordinates out of range')
    expect(() => places.savePlace(owner, null, { name: 'Пустая точка', lat: 0, lon: 0 })).toThrow('point 0,0 is not a place')
    expect(places.listPlaces(owner).map((p) => p.name)).not.toContain('За морем')
    expect(places.listPlaces(owner).map((p) => p.name)).not.toContain('Пустая точка')
  })
})

describe('a point that may be a swap', () => {
  it('warns when the point is at sea but the other way round is land', () => {
    // A city written backwards: 82.92, 55.03 is the Kara Sea; 55.03, 82.92 is Novosibirsk.
    expect(coordinateIssue(82.92, 55.03, onLand)).toEqual({ kind: 'swapped', block: false })
  })
  it('says nothing about a city written the right way round', () => {
    expect(coordinateIssue(55.7558, 37.6173, onLand)).toBeNull()
  })
})

describe('a point at sea', () => {
  it('passes a berth just offshore, where the drawn coast is a few kilometres out', () => {
    // The Golden Horn in Vladivostok is water in these polygons, but only four kilometres from the coast.
    expect(onLand(43.115, 131.885)).toBe(true)
    expect(coordinateIssue(43.115, 131.885, onLand)).toBeNull()
  })
  it('passes an island', () => {
    expect(coordinateIssue(37.5, 14.0, onLand)).toBeNull()
  })
  it('warns about a ship in open sea, and still saves it', () => {
    expect(coordinateIssue(0, -140, onLand)).toEqual({ kind: 'sea', block: false })
    expect(places.savePlace(owner, null, { name: 'Корабль', lat: 0, lon: -140 })).toBeTruthy()
    expect(places.listPlaces(owner).map((p) => p.name)).toContain('Корабль')
  })
})

describe('a place renamed', () => {
  it('keeps answering to its old name, so the births and moves written with it stay on the map', async () => {
    const { findPlace } = await import('../lib/places')
    const { id } = places.savePlace(owner, null, { name: 'Молотов', lat: 58.01, lon: 56.24 }) as { id: string }
    places.savePlace(owner, id, { name: 'Пермь', lat: 58.01, lon: 56.24 })
    const all = places.listPlaces(owner)
    expect(findPlace('Молотов', all)?.id).toBe(id)
    expect(findPlace('Пермь', all)?.id).toBe(id)
    // Saved again under the same name, nothing is added twice.
    places.savePlace(owner, id, { name: 'Пермь', otherNames: [{ name: 'Молотов', years: '' }], lat: 58.01, lon: 56.24 })
    expect(places.listPlaces(owner).find((p) => p.id === id)?.otherNames.map((n) => n.name)).toEqual(['Молотов'])
  })
})
