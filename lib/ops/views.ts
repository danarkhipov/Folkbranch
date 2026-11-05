// Saved ways to look at the family. They change what is drawn and where, never who is related to whom.
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '../db'
import { announceChange } from '../live'
import type { Scope } from '../graph/select'
import { Actor, newId, OpError, requireRole, seesOnlyPublic } from './core'
import { hiddenPeople } from './people'

export const MAIN_VIEW = 'main'
const MAX_PINS = 5000

export interface ChartView { id: string; name: string; scope: Scope; focusId: string | null; collapsed: string[]; pins: Record<string, number>; updatedAt: number }

export const viewInput = z.object({
  name: z.string().trim().min(1).max(80),
  scope: z.enum(['all', 'ancestors', 'descendants', 'near']),
  focusId: z.string().max(40).nullable(),
  collapsed: z.array(z.string().max(40)).max(MAX_PINS),
  pins: z.record(z.string().max(40), z.number().finite()).optional(),
})
const pinInput = z.object({ personId: z.string().max(40), x: z.number().finite().nullable() })

const shape = (r: typeof schema.views.$inferSelect): ChartView => ({ id: r.id, name: r.name, scope: r.scope as Scope, focusId: r.focusId, collapsed: JSON.parse(r.collapsed), pins: JSON.parse(r.pins), updatedAt: r.updatedAt })

/** A reader does not get a view built around someone hidden from them: its name could say who. */
export function listViews(actor: Actor): ChartView[] {
  const rows = getDb().select().from(schema.views).all().map(shape)
  if (!seesOnlyPublic(actor)) return rows
  const hidden = hiddenPeople(actor)
  return rows.filter((v) => !v.focusId || !hidden.has(v.focusId))
}

export function createView(actor: Actor, input: unknown) {
  requireRole(actor, 'editor')
  const v = viewInput.parse(input)
  const id = newId()
  getDb().insert(schema.views).values({ id, name: v.name, scope: v.scope, focusId: v.focusId, collapsed: JSON.stringify(v.collapsed), pins: JSON.stringify(v.pins ?? {}), createdBy: actor.userId, updatedAt: Date.now() }).run()
  announceChange()
  return { id }
}

export function deleteView(actor: Actor, id: string) {
  requireRole(actor, 'editor')
  if (id === MAIN_VIEW) throw new OpError(400, 'the main chart cannot be deleted')
  getDb().delete(schema.views).where(eq(schema.views.id, id)).run()
  announceChange()
}

/** One card at a time and read inside the write, so two people moving different cards both keep their change. */
export function setPin(actor: Actor, viewId: string, input: unknown) {
  requireRole(actor, 'editor')
  const { personId, x } = pinInput.parse(input)
  const db = getDb()
  db.transaction(() => {
    const row = db.select().from(schema.views).where(eq(schema.views.id, viewId)).get()
    if (!row && viewId !== MAIN_VIEW) throw new OpError(404, 'not found')
    const pins = row ? (JSON.parse(row.pins) as Record<string, number>) : {}
    if (x === null) delete pins[personId]
    else pins[personId] = x
    if (Object.keys(pins).length > MAX_PINS) throw new OpError(400, 'too many placed by hand')
    if (row) db.update(schema.views).set({ pins: JSON.stringify(pins), updatedAt: Date.now() }).where(eq(schema.views.id, viewId)).run()
    else db.insert(schema.views).values({ id: MAIN_VIEW, pins: JSON.stringify(pins), createdBy: actor.userId, updatedAt: Date.now() }).run()
  })
  announceChange()
}

export function clearPins(actor: Actor, viewId: string) {
  requireRole(actor, 'editor')
  getDb().update(schema.views).set({ pins: '{}', updatedAt: Date.now() }).where(eq(schema.views.id, viewId)).run()
  announceChange()
}
