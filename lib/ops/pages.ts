import { asc, eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { Page, PageMeta } from '../types'
import { personName } from '../types'
import { Actor, Changes, mutate, newId, OpError, requireRole, seesOnlyPublic } from './core'
import { getPersonRow, hiddenFor, hiddenPeople } from './people'
import { say } from './settings'


function assertPersonVisible(actor: Actor, personId: string) {
  if (hiddenFor(actor, getPersonRow(personId))) throw new OpError(404, 'not found')
}

export function listPages(actor: Actor, personId: string): PageMeta[] {
  assertPersonVisible(actor, personId)
  const p = schema.pages
  return getDb().select({ id: p.id, personId: p.personId, parentPageId: p.parentPageId, title: p.title, icon: p.icon, position: p.position, updatedAt: p.updatedAt })
    .from(p).where(eq(p.personId, personId)).orderBy(asc(p.position)).all()
}

function row(id: string) {
  const r = getDb().select().from(schema.pages).where(eq(schema.pages.id, id)).get()
  if (!r) throw new OpError(404, 'not found')
  return r
}

export function getPage(actor: Actor, id: string): Page {
  const page = row(id)
  assertPersonVisible(actor, page.personId)
  return seesOnlyPublic(actor) ? { ...page, content: scrubMentions(hiddenPeople(actor), page.content) } : page
}

/** A mention stores the person's name; whoever may not see a relative must not learn it. */

function scrubMentions(hidden: Set<string>, content: string) {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk)
    if (node && typeof node === 'object') {
      const o = node as Record<string, any>
      if (o.type === 'mention' && hidden.has(o.props?.personId)) return { ...o, props: { ...o.props, personId: '', label: say('Скрыто') } }
      return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, walk(v)]))
    }
    return node
  }
  return JSON.stringify(walk(JSON.parse(content)))
}

/** Every page this actor may read, for searching across them. */
export function readablePages(actor: Actor): Page[] {
  const hidden = hiddenPeople(actor)
  const rows = getDb().select().from(schema.pages).all().filter((p) => !hidden.has(p.personId))
  return seesOnlyPublic(actor) ? rows.map((p) => ({ ...p, content: scrubMentions(hidden, p.content) })) : rows
}

export function insertPage(c: Changes, input: { personId: string; title: string; content?: unknown; icon?: string; parentPageId?: string | null; position?: number }) {
  const id = newId()
  c.insert('pages', {
    id,
    personId: input.personId,
    parentPageId: input.parentPageId ?? null,
    title: input.title,
    icon: input.icon ?? '',
    position: input.position ?? Date.now(),
    content: JSON.stringify(input.content ?? []),
    updatedAt: Date.now(),
  })
  return id
}

export function createPage(actor: Actor, input: { personId: string; title?: string; parentPageId?: string | null; icon?: string; content?: unknown[] }) {
  requireRole(actor, 'editor')
  const person = getPersonRow(input.personId)
  const title = input.title ?? ''
  return mutate(actor, { summary: `${personName(person)}: ${say('Новая страница')}`, personIds: [input.personId] }, (c) => row(insertPage(c, { ...input, title })))
}

export function updatePage(actor: Actor, id: string, input: { title?: string; icon?: string; content?: unknown; parentPageId?: string | null; position?: number; baseUpdatedAt?: number }) {
  requireRole(actor, 'editor')
  const page = row(id)
  const { baseUpdatedAt, ...patch } = input
  if (baseUpdatedAt !== undefined && baseUpdatedAt !== page.updatedAt) throw new OpError(409, 'the page changed since this copy was read')
  if (patch.parentPageId && isDescendant(id, patch.parentPageId)) throw new OpError(400, 'cannot nest a page inside itself')
  const person = getPersonRow(page.personId)
  const updatedAt = Math.max(Date.now(), page.updatedAt + 1)
  const set: Record<string, unknown> = { ...patch, updatedAt }
  if (patch.content !== undefined) set.content = JSON.stringify(patch.content)
  mutate(actor, { summary: `${personName(person)}: «${patch.title ?? page.title ?? say('Без названия')}»`, personIds: [page.personId], key: `page:${id}` }, (c) => c.update('pages', id, set))
  return { updatedAt }
}

function isDescendant(ancestor: string, candidate: string) {
  let cur: string | null = candidate
  while (cur) {
    if (cur === ancestor) return true
    cur = row(cur).parentPageId
  }
  return false
}

export function deletePage(actor: Actor, id: string) {
  requireRole(actor, 'editor')
  const db = getDb()
  const page = row(id)
  const person = getPersonRow(page.personId)
  mutate(actor, { summary: `${personName(person)}: ${say('Удалить')} «${page.title}»`, personIds: [page.personId] }, (c) => {
    const drop = (pid: string) => {
      db.select().from(schema.pages).where(eq(schema.pages.parentPageId, pid)).all().forEach((ch) => drop(ch.id))
      c.remove('pages', pid)
    }
    drop(id)
  })
}
