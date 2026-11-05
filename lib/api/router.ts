// How the API is described: each route says who may call it and what it does.
import { z } from 'zod'
import type { Actor } from '@/lib/ops/core'
import { dispatch } from '@/lib/ops/proposals'
import { OPS } from '@/lib/ops/registry'

export type Ctx = { actor: Actor; params: Record<string, string>; req: Request; query: URLSearchParams; body: () => Promise<any> }
export type Handler = (c: Ctx) => unknown | Promise<unknown>
export interface Route { method: string; path: string; handler: Handler; summary: string; op?: string; human?: boolean; guest?: boolean }

export const role = z.enum(['owner', 'editor', 'reader'])

export const get = (path: string, summary: string, handler: Handler): Route => ({ method: 'GET', path, summary, handler })
/** A write for signed-in people only; tokens are refused before it runs. */
export const human = (method: string, path: string, summary: string, handler: Handler): Route => ({ method, path, summary, handler, human: true })
/** A read that someone with a viewing link may make. Every other route refuses them. */
export const open = (path: string, summary: string, handler: Handler): Route => ({ ...get(path, summary, handler), guest: true })
/** A write through the operation registry, so a token's call lands in the review queue. */
export const op = (method: string, path: string, name: string, toArgs: (c: Ctx, body: any) => unknown = (_, b) => b): Route => ({
  method, path, op: name, summary: OPS[name].description,
  handler: async (c) => dispatch(c.actor, name, toArgs(c, method === 'DELETE' || path.endsWith('/undo') ? null : await c.body())),
})

export function openApi(routes: Route[]) {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const r of routes) {
    if (r.human) continue
    const path = `/api/v1/${r.path.replace(/:(\w+)/g, '{$1}')}`
    const parameters = [...r.path.matchAll(/:(\w+)/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }))
    const schema = r.op && r.method !== 'DELETE' ? z.toJSONSchema(OPS[r.op].input, { unrepresentable: 'any' }) : null
    ;(paths[path] ??= {})[r.method.toLowerCase()] = {
      summary: r.summary,
      ...(parameters.length ? { parameters } : {}),
      ...(schema ? { requestBody: { content: { 'application/json': { schema } } } } : {}),
      responses: { 200: { description: 'Done' }, ...(r.op ? { 202: { description: 'Queued for review: status pending_review, with a temporary id' } } : {}), 401: { description: 'No valid token' }, 403: { description: 'Not allowed' } },
    }
  }
  return {
    openapi: '3.1.0',
    info: { title: 'Folkbranch API', version: '1' },
    components: { securitySchemes: { token: { type: 'http', scheme: 'bearer' } } },
    security: [{ token: [] }],
    paths,
  }
}

export function match(routes: Route[], method: string, path: string[]) {
  for (const r of routes) {
    if (r.method !== method) continue
    const parts = r.path.split('/')
    if (parts.length !== path.length) continue
    const params: Record<string, string> = {}
    if (parts.every((p, i) => (p[0] === ':' ? ((params[p.slice(1)] = path[i]), true) : p === path[i]))) return { route: r, params }
  }
  return null
}
