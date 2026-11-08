// The released version is used for a while, then replaced by this one on the same data and in the same browser.
// FG_OLD_IMAGE names the release to start from; without it the latest published image is pulled.
import { chromium } from 'playwright-core'
import { execSync as sh } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const PORT = 3487, B = `http://127.0.0.1:${PORT}`
const OLD = process.env.FG_OLD_IMAGE ?? 'ghcr.io/danarkhipov/folkbranch:latest', NEW = process.env.FG_IMAGE ?? 'folkbranch:check'
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-up-'))
const q = (c) => { try { return sh(c, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim() } catch (e) { return 'ERR ' + e.stderr } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ok = (n, c, x = '') => console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x && !c ? '  ' + x : ''}`)
const info = () => {}
if (q(`docker image inspect ${OLD}`).startsWith('ERR') && q(`docker pull -q ${OLD}`).startsWith('ERR')) {
  console.log(`SKIP  no released image to update from: ${OLD}`)
  process.exit(0)
}
q('docker rm -fv fg-up'); q('docker volume rm fg-up-data')
const serve = async (image) => {
  q('docker rm -fv fg-up')
  q(`docker run -d --name fg-up -p 127.0.0.1:${PORT}:3000 -v fg-up-data:/data -e BETTER_AUTH_URL=${B} -e BETTER_AUTH_SECRET=${'u'.repeat(64)} ${image}`)
  for (let i = 0; i < 80; i++) { try { if ((await fetch(B + '/api/health')).ok) break } catch {} await sleep(500) }
  await sleep(800)
}
const errs = []
const open = async () => { const ctx = await chromium.launchPersistentContext(PROFILE, { channel: 'chrome', headless: true, locale: 'ru-RU', viewport: { width: 1280, height: 800 } }); const p = ctx.pages()[0] ?? await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); return { ctx, p } }

// ---------- the released version ----------
await serve(OLD)
let { ctx, p } = await open()
const code = q('docker logs fg-up').match(/setup\?code=(\S+)/)[1]
info('old: setup', (await ctx.request.post(B + '/api/auth/family/setup', { headers: { origin: B }, data: { name: 'Анна', familyName: 'Проба', language: 'ru', demo: true, code } })).status())
const g1 = await (await ctx.request.get(B + '/api/v1/graph')).json()
const dead = g1.persons.filter((x) => !x.living)[2]
await ctx.request.patch(`${B}/api/v1/persons/${dead.id}`, { headers: { origin: B }, data: { facts: [{ kind: 'Профессия', date: '1930', place: 'Тверь', note: 'учитель', source: '' }] } })
await p.goto(`${B}/?p=${dead.id}`); await p.locator('.pcard').first().waitFor(); await p.waitForTimeout(1000)
// The released version has no service worker yet: the new one arrives with the update.
// a phone that hid the bars, a chosen direction, and models downloaded for faces and voice
await p.evaluate(async () => {
  localStorage.setItem('bars-hidden', '1'); localStorage.setItem('chart-direction', 'down')
  await (await caches.open('folkbranch-models')).put('/smart-models/face.onnx', new Response('model'))
  await (await caches.open('transformers-cache')).put('https://huggingface.co/x/whisper/model.onnx', new Response('model'))
})
// text typed while the connection was gone
await p.getByRole('tab', { name: 'Биография' }).click(); await p.waitForTimeout(600)
if (!(await p.locator('[contenteditable="true"]').count())) { await p.getByRole('button', { name: /Новая страница|Написать|Начать/ }).first().click({ timeout: 5000 }); await p.waitForTimeout(1200) }
await p.route('**/api/v1/pages/**', (r) => (r.request().method() === 'PATCH' ? r.abort() : r.continue()))
await p.locator('[contenteditable="true"]').first().click(); await p.keyboard.type('Черновик без связи.'); await p.waitForTimeout(2000)
const before = await p.evaluate(async () => ({ ls: Object.fromEntries(Object.entries(localStorage)), caches: await caches.keys(), sw: (await navigator.serviceWorker?.getRegistration())?.active?.scriptURL }))
info('old: browser keeps', JSON.stringify({ ls: Object.keys(before.ls), caches: before.caches, sw: !!before.sw }))
const people1 = g1.persons.length
await ctx.close()

// ---------- the new version, same data, same browser ----------
await serve(NEW)
;({ ctx, p } = await open())
await p.goto(`${B}/?p=${dead.id}`); await p.waitForTimeout(2500)
ok('still signed in after the update', !/\/login/.test(p.url()), p.url())
await p.locator('.pcard').first().waitFor({ timeout: 15000 }).catch(() => {})
const g2 = await (await ctx.request.get(B + '/api/v1/graph')).json()
ok('everyone is still there', g2.persons?.length === people1, `${g2.persons?.length} vs ${people1}`)
ok('a fact written in the old version is intact', JSON.stringify(g2.persons.find((x) => x.id === dead.id)?.facts).includes('учитель'))
ok('the new parts of the database are there', (await ctx.request.get(B + '/api/v1/places')).status() === 200)
// let the new service worker take over
await p.reload(); await p.waitForTimeout(2500); await p.reload(); await p.waitForTimeout(2000)
const after = await p.evaluate(async () => ({ ls: Object.fromEntries(Object.entries(localStorage)), caches: await caches.keys() }))
info('new: browser keeps', JSON.stringify({ ls: Object.keys(after.ls), caches: after.caches }))
ok('screen settings survive', after.ls['bars-hidden'] === '1' && after.ls['chart-direction'] === 'down')
ok('downloaded models survive', after.caches.includes('folkbranch-models') && after.caches.includes('transformers-cache'), after.caches.join(','))
await p.getByRole('tab', { name: 'Биография' }).click().catch(() => {}); await p.waitForTimeout(1500)
ok('text typed offline in the old version comes back', (await p.getByText('Черновик без связи').count()) > 0)
ok('no page errors', errs.length === 0, errs.join(' | ').slice(0, 300))
await ctx.close()
q('docker rm -fv fg-up'); q('docker volume rm fg-up-data'); fs.rmSync(PROFILE, { recursive: true, force: true })
