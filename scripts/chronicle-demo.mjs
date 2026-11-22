#!/usr/bin/env node
// Development only, not shipped: puts the invented chronicle entries of tests/fixtures/chronicle-demo.json into an
// archive that has the English demo family, through the API, as an agent would. The fixture names places and people;
// this turns them into the archive's ids. Run against a dev server signed in as the owner:
//   FB_URL=http://127.0.0.1:3417 FB_COOKIE='<session cookie>' node scripts/chronicle-demo.mjs
//   FB_URL=… FB_TOKEN=fb_… node scripts/chronicle-demo.mjs       (an editor token)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const FIXTURE = new URL('../tests/fixtures/chronicle-demo.json', import.meta.url)

/** Puts every fixture entry; returns their keys. `auth` is { cookie } or { token }. */
export async function loadChronicleDemo(B, auth, { show = 'owner' } = {}) {
  const headers = { 'content-type': 'application/json', origin: B, ...(auth.token ? { authorization: `Bearer ${auth.token}` } : { cookie: auth.cookie }) }
  const get = async (p) => { const r = await fetch(`${B}/api/v1/${p}`, { headers }); if (!r.ok) throw new Error(`${p} answered ${r.status}`); return r.json() }
  const [graph, places] = await Promise.all([get('graph'), get('places')])
  const personId = new Map(graph.persons.map((p) => [`${p.givenName} ${p.surname}`.trim(), p.id]))
  const placeId = new Map(places.map((p) => [p.name, p.id]))
  const need = (map, name, what) => { const id = map.get(name); if (!id) throw new Error(`no ${what} called ${name}: is this the English demo family?`); return id }
  const placeOf = (ref) => ({ place: need(placeId, ref.place, 'place') })
  const { entries } = JSON.parse(readFileSync(FIXTURE, 'utf8'))
  for (const { key, ...e } of entries) {
    const body = {
      ...e,
      body: Object.fromEntries(Object.entries(e.body ?? {}).map(([l, v]) => [l, v.replace(/\(person:\{([^}]+)\}\)/g, (_, n) => `(person:${need(personId, n, 'person')})`)])),
      people: (e.people ?? []).map(({ person, ...l }) => ({ ...l, personId: need(personId, person, 'person') })),
      shape: e.shape?.kind === 'places' ? { ...e.shape, places: e.shape.places.map(placeOf) }
        : e.shape?.kind === 'route' ? { ...e.shape, stops: e.shape.stops.map((s) => ('place' in s ? placeOf(s) : s)) }
        : e.shape,
    }
    const r = await fetch(`${B}/api/v1/chronicle/${key}`, { method: 'PUT', headers, body: JSON.stringify(body) })
    if (!r.ok) throw new Error(`${key} answered ${r.status}: ${await r.text()}`)
  }
  // The switches under Settings > Map are the owner's own: a token cannot set them. A fresh archive starts with both
  // off, so the demo turns them on, with who sees it.
  if (!auth.token) {
    const r = await fetch(`${B}/api/v1/chronicle`, { method: 'PUT', headers, body: JSON.stringify({ show, history: true, chronicle: true }) })
    if (!r.ok) throw new Error(`the switch answered ${r.status}`)
  }
  return entries.map((e) => e.key)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const B = process.env.FB_URL ?? 'http://127.0.0.1:3417'
  const auth = process.env.FB_TOKEN ? { token: process.env.FB_TOKEN } : { cookie: process.env.FB_COOKIE }
  if (!auth.token && !auth.cookie) { console.error('Set FB_COOKIE (the owner\'s session cookie) or FB_TOKEN (an editor token).'); process.exit(2) }
  const keys = await loadChronicleDemo(B, auth)
  console.log(`put ${keys.length} entries: ${keys.join(', ')}`)
}
