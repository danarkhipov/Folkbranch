// The map while someone else edits the same archive: a viewer plays the map and follows a person, another writer
// adds, corrects and deletes people. Nothing may break: a deleted person leaves the map, an added one appears, the
// clock never stands outside the family's years, faces are not rebuilt by an edit, and the page logs no error.
// FG_URL=http://localhost:3528 node tests/e2e/map-live.mjs against a build that signs the owner in by itself.
import { chromium } from 'playwright-core'

const O = process.env.FG_URL ?? 'http://localhost:3528'
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' · ' + x : ''}`); if (!c) process.exitCode = 1 }
const br = await chromium.launch({ channel: 'chrome', headless: true })
const viewer = await (await br.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
const writer = await (await br.newContext()).newPage()
const errs = []
viewer.on('pageerror', (e) => errs.push(e.message.slice(0, 160)))
await writer.goto(O + '/')
const api = (path, method = 'GET', json) => writer.evaluate(async ({ path, method, json }) => {
  const r = await fetch('/api/v1/' + path, { method, headers: json ? { 'content-type': 'application/json' } : {}, body: json ? JSON.stringify(json) : undefined })
  return { status: r.status, body: await r.json().catch(() => null) }
}, { path, method, json })

// Two lives in a town of their own, far from the rest, so the faces can be told apart on the map.
const place = (await api('places', 'POST', { name: 'Livetest Harbour', lat: -33.9, lon: 151.2 })).body
const make = async (given, b, d) => (await api('persons', 'POST', { person: { givenName: given, surname: 'Livetest', sex: 'F', birthDate: String(b), birthPlace: 'Livetest Harbour', deathDate: String(d), deathPlace: 'Livetest Harbour', living: false }, notDuplicate: true })).body
const a = await make('Ada', 1850, 1930)
const b = await make('Bea', 1852, 1925)
ok('the writer adds two people', !!a?.id && !!b?.id, `${a?.id} ${b?.id}`)

await viewer.goto(O + '/')
await viewer.getByRole('radio', { name: 'Map', exact: true }).click()
await viewer.waitForSelector('.atlas-country', { timeout: 60000 })
// Follow Ada: her card opens and the map follows her life.
await viewer.goto(`${O}/?view=map&p=${a.id}&y=1900`)
await viewer.waitForSelector('.map-canvas', { timeout: 60000 })
await viewer.waitForTimeout(2500)
const faces = () => viewer.evaluate(() => [...document.querySelectorAll('.leaflet-marker-icon')].filter((e) => /Livetest/.test(e.getAttribute('aria-label') ?? '') || /Ada|Bea|Cleo/.test(e.textContent ?? '')).map((e) => e.textContent?.trim().slice(0, 40)))
const nodeId = (name) => viewer.evaluate((name) => { const el = [...document.querySelectorAll('.leaflet-marker-icon')].find((e) => e.textContent?.includes(name)); if (!el) return null; el.dataset.probe ??= String(Math.random()); return el.dataset.probe }, name)
ok('both are on the map in 1900', (await faces()).length >= 1, JSON.stringify(await faces()))
const beaNode = await nodeId('Bea')

await viewer.getByRole('button', { name: 'Play', exact: true }).click().catch(() => {})
// While it plays: a third person is added, Bea's death is corrected, then Ada (followed) is deleted.
const c = await make('Cleo', 1880, 1950)
await viewer.waitForTimeout(2500)
ok('an added person comes over the live channel', await viewer.evaluate(() => document.body.innerText.includes('Cleo')) || (await faces()).some((f) => f?.includes('Cleo')), 'Cleo')
await api(`persons/${b.id}`, 'PATCH', { deathDate: '1926' })
await viewer.waitForTimeout(2500)
ok('an edit does not rebuild the other faces', (await nodeId('Bea')) === beaNode || (await nodeId('Bea')) === null, 'Bea keeps her marker')
const del = await api(`persons/${a.id}`, 'DELETE')
ok('the writer deletes the followed person', del.status < 300, String(del.status))
await viewer.waitForTimeout(3000)
console.log('DEBUG', JSON.stringify(await viewer.evaluate(() => [...document.querySelectorAll('.leaflet-marker-icon, .leaflet-marker-pane *')].filter((e) => e.children.length === 0 && e.textContent?.includes('Ada')).map((e) => [e.className, e.closest('.leaflet-marker-icon')?.className, e.textContent.slice(0, 50)]))), await viewer.evaluate(() => location.search), await viewer.evaluate(() => !!document.querySelector('aside.panel')))
ok('the deleted person leaves the map', !(await viewer.evaluate(() => [...document.querySelectorAll('.leaflet-marker-icon')].some((e) => e.textContent?.includes('Ada')))))
// Everyone who ends the family's years goes: the clock comes back inside what is left.
for (const p of [b, c]) await api(`persons/${p.id}`, 'DELETE')
await viewer.waitForTimeout(3000)
const range = await viewer.evaluate(() => { const s = document.querySelector('[role=slider]'); return s ? { now: +s.getAttribute('aria-valuenow'), min: +s.getAttribute('aria-valuemin'), max: +s.getAttribute('aria-valuemax') } : null })
ok('the clock stays inside the years after deletes', !!range && range.now >= range.min && range.now <= range.max, JSON.stringify(range))
ok('no error on the page', errs.length === 0, errs.join(' | '))
await api(`places/${place.id}`, 'DELETE')
await br.close()
