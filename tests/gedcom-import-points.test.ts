// A GEDCOM file from another program brings the points of its places: a record without a point gets the file's, a place
// with no record gets one, a point already chosen in the archive stays, and one undo takes the whole import back.
import { describe, expect, it } from 'vitest'
import { desc } from 'drizzle-orm'
import { getDb, schema } from '../lib/db'
import { type Actor, undo } from '../lib/ops/core'
import { exportGedcom, importGedcom, previewGedcom } from '../lib/ops/gedcom'
import { listPlaces, savePlace } from '../lib/ops/places'

const owner: Actor = { userId: 'o', name: 'Owner', role: 'owner', personId: null }

const FILE = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME Anna /Точкина/
1 BIRT
2 DATE 1890
2 PLAC Вологда
3 MAP
4 LATI N59.2181
4 LONG E39.8886
1 DEAT
2 PLAC Москва
3 MAP
4 LATI N10
4 LONG E10
1 RESI
2 PLAC Anson, Somerset, Maine
0 _PLAC Anson, Somerset, Maine
1 MAP
2 LATI N44.79833
2 LONG W69.88972
0 TRLR`

describe('points from a GEDCOM file', () => {
  it('are counted in the preview, so a person knows before importing', () => {
    expect(previewGedcom(owner, FILE).points).toBe(3)
  })

  it('fill a record without a point, make a record for an unknown place, and keep a point already chosen', () => {
    savePlace(owner, null, { name: 'Вологда' })
    savePlace(owner, null, { name: 'Москва', lat: 55.7558, lon: 37.6173 })
    const r = importGedcom(owner, FILE, 'add') as { places: { filled: number; created: number; kept: number } }
    expect(r.places).toEqual({ filled: 1, created: 1, kept: 1, ambiguous: 0 })
    const byName = new Map(listPlaces(owner).map((p) => [p.name, p]))
    expect(byName.get('Вологда')).toMatchObject({ lat: 59.2181, lon: 39.8886, note: expect.stringContaining('GEDCOM') })
    expect(byName.get('Москва')).toMatchObject({ lat: 55.7558, lon: 37.6173 })
    expect(byName.get('Anson, Somerset, Maine')).toMatchObject({ lat: 44.79833, lon: -69.88972 })
  })

  it('go out again on export, under the place they belong to', () => {
    expect(exportGedcom(owner, false)).toContain('2 PLAC Вологда\n3 MAP\n4 LATI N59.2181\n4 LONG E39.8886')
  })

  it('are taken back with the people by one undo', () => {
    const last = getDb().select().from(schema.history).orderBy(desc(schema.history.at)).limit(1).get()!
    expect(last.summary).toContain('3')
    undo(owner, last.id, 'undo')
    const byName = new Map(listPlaces(owner).map((p) => [p.name, p]))
    expect(byName.get('Вологда')?.lat).toBeNull()
    expect(byName.has('Anson, Somerset, Maine')).toBe(false)
  })
})
