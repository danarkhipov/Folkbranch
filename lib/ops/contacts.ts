// How to reach a living relative: for the people who keep the archive, never for readers, guests, keys or the assistant.
// Kept apart from the card, so nothing that copies the family out (the graph, GEDCOM, the file for relatives) has it.
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '../db'
import type { Contacts } from '../types'
import { Actor, mutate, newId, OpError, requireRole } from './core'
import { getPersonRow } from './people'
import { say } from './settings'

const input = z.object({
  phone: z.string().trim().max(80).default(''),
  email: z.string().trim().max(200).default(''),
  address: z.string().trim().max(400).default(''),
  note: z.string().trim().max(1000).default(''),
})

const allowed = (actor: Actor) => {
  requireRole(actor, 'editor')
  if (actor.tokenId || actor.assistant || actor.guest) throw new OpError(403, 'not available here')
}

export function getContacts(actor: Actor, personId: string): Contacts {
  allowed(actor)
  getPersonRow(personId)
  const r = getDb().select().from(schema.contacts).where(eq(schema.contacts.personId, personId)).get()
  return { phone: r?.phone ?? '', email: r?.email ?? '', address: r?.address ?? '', note: r?.note ?? '' }
}

export function saveContacts(actor: Actor, personId: string, raw: unknown) {
  allowed(actor)
  const p = getPersonRow(personId)
  const v = input.parse(raw)
  const r = getDb().select().from(schema.contacts).where(eq(schema.contacts.personId, personId)).get()
  const empty = !v.phone && !v.email && !v.address && !v.note
  mutate(actor, { summary: `${say('Контакты')}: ${[p.givenName, p.surname].filter(Boolean).join(' ')}`, personIds: [personId] }, (c) => {
    if (r && empty) c.remove('contacts', r.id)
    else if (r) c.update('contacts', r.id, v)
    else if (!empty) c.insert('contacts', { id: newId(), personId, ...v })
  })
  return getContacts(actor, personId)
}
