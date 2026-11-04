import { asc, eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { Page, PageMeta } from '../types'
import { personName } from '../types'
import { translate } from '../i18n'
import { Actor, Changes, mutate, newId, OpError, requireRole } from './core'
import { getGraph, getPersonRow, hiddenFor } from './people'
import { getSetting } from './settings'

const say = (key: string) => translate(getSetting('language') === 'en' ? 'en' : 'ru', key)

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
  return actor.role === 'reader' ? { ...page, content: scrubMentions(actor, page.content) } : page
}

/** A mention stores the person's name; a reader must not learn it for a hidden relative. */
function scrubMentions(actor: Actor, content: string) {
  const hidden = new Set(getGraph(actor).persons.filter((p) => p.hidden).map((p) => p.id))
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

export function updatePage(actor: Actor, id: string, patch: { title?: string; icon?: string; content?: unknown; parentPageId?: string | null; position?: number }) {
  requireRole(actor, 'editor')
  const page = row(id)
  if (patch.parentPageId && isDescendant(id, patch.parentPageId)) throw new OpError(400, 'cannot nest a page inside itself')
  const person = getPersonRow(page.personId)
  const set: Record<string, unknown> = { ...patch, updatedAt: Date.now() }
  if (patch.content !== undefined) set.content = JSON.stringify(patch.content)
  mutate(actor, { summary: `${personName(person)}: «${patch.title ?? page.title ?? say('Без названия')}»`, personIds: [page.personId], key: `page:${id}` }, (c) => c.update('pages', id, set))
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
