// page-recovery.mjs: the page's own stability. A proxy stands in for Railway's edge, so a deploy can answer 502.
import http from 'node:http'; import { chromium } from 'playwright-core'
import { boot, IMAGE, sleep } from './lib.mjs'
const img = IMAGE; const ok = (n, g, note = '') => console.log(`${g ? 'PASS' : 'FAIL'} ${n}${note ? ' · ' + note : ''}`)
const INNER = 3425, PUB = 3424; let down = false; const live = new Set()
const proxy = http.createServer((q, s) => {
  if (down) { s.writeHead(502); return s.end('bad gateway') }
  const up = http.request({ host: '127.0.0.1', port: INNER, path: q.url, method: q.method, headers: q.headers }, (r) => { s.writeHead(r.statusCode, r.headers); r.pipe(s) })
  up.on('error', () => { if (!s.headersSent) s.writeHead(502); s.end() }); q.pipe(up)
  if (q.url.startsWith('/api/events')) { live.add(s); s.on('close', () => { live.delete(s); up.destroy() }) }
}).listen(PUB, '127.0.0.1')
const B = `http://localhost:${PUB}`
const { cookie } = await boot('fg-cl', INNER, img, { pub: B, people: 1000 })
const h = { cookie, origin: B, 'content-type': 'application/json' }
const g = await (await fetch(B + '/api/v1/graph', { headers: { cookie } })).json()
const br = await chromium.launch({ channel: 'chrome', headless: true }); const ctx = await br.newContext({ viewport: { width: 1440, height: 900 } })
const [n, v] = cookie.split('=').length ? [cookie.split('=')[0], cookie.slice(cookie.indexOf('=') + 1)] : []
await ctx.addCookies(cookie.split('; ').map((c) => ({ name: c.split('=')[0], value: c.slice(c.indexOf('=') + 1), domain: 'localhost', path: '/', httpOnly: true })))
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message.slice(0, 150)))
await p.goto(B + '/'); await p.waitForSelector('.pcard'); await sleep(800)
ok('one live line for one page', live.size === 1, String(live.size))
const visible = await p.evaluate(() => document.querySelector('.pcard').dataset.person)
const name = async () => p.locator(`.pcard[data-person="${visible}"] .nm`).innerText()
const rename = (t) => fetch(`${B}/api/v1/persons/${visible}`, { method: 'PATCH', headers: h, body: JSON.stringify({ givenName: t }) })
await rename('Живой1'); await sleep(1200); ok('edit elsewhere arrives', (await name()).includes('Живой1'))

// Deploy: the edge answers 502 for a while. The browser's own retry gives up on an error page.
down = true; for (const s of live) s.destroy(); await sleep(9000)
down = false; await rename('ПослеДеплоя'); const t0 = Date.now(); let seen = false
while (Date.now() - t0 < 30000) { if ((await name()).includes('ПослеДеплоя')) { seen = true; break } await sleep(300) }
ok('the page comes back by itself after 502s', seen, seen ? `${Date.now() - t0} ms` : 'still stale after 30 s')
await rename('ЕщёРаз'); await sleep(1500); ok('and stays live afterwards', (await name()).includes('ЕщёРаз'))

// Real restart.
const { execSync } = await import('node:child_process')
execSync('docker kill -s KILL fg-cl'); await sleep(1500); execSync('docker start fg-cl'); let up = false; for (let i = 0; i < 100 && !up; i++) { up = await fetch(B + '/api/health').then((r) => r.ok).catch(() => false); await sleep(100) }
await rename('ПослеПадения'); const t1 = Date.now(); seen = false
while (Date.now() - t1 < 110000) { if ((await name()).includes('ПослеПадения')) { seen = true; break } await sleep(300) }
ok('after a crash behind a stuck proxy (a line dead without a word) the page returns by itself', seen, `${Date.now() - t1} ms`)

// A hidden tab holds nothing open; it catches up on return.
await sleep(1000); const lines = live.size
await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')) }); await sleep(1200)
ok('a hidden tab closes its line', live.size === lines - 1, `${lines} → ${live.size}`)
await rename('ПокаСкрыта'); await sleep(1000)
await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')) }); await sleep(1500)
ok('it catches up when shown again', (await name()).includes('ПокаСкрыта'), `lines ${live.size}`)

// Leaks: a long working session, measured after forcing a collection.
const cdp = await ctx.newCDPSession(p); await cdp.send('Performance.enable')
const m = async () => { await cdp.send('HeapProfiler.collectGarbage'); await sleep(200); const x = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((e) => [e.name, e.value])); return { heapMB: +(x.JSHeapUsedSize / 1048576).toFixed(1), nodes: x.Nodes, listeners: x.JSEventListeners, docs: x.Documents } }
const round = async () => {
  for (let i = 0; i < 10; i++) {
    const spot = await p.evaluate((n) => { const seen = [...document.querySelectorAll('.pcard .nm')].map((e) => e.getBoundingClientRect()).filter((r) => r.left > 20 && r.right < innerWidth - 500 && r.top > 80 && r.bottom < innerHeight - 80); const r = seen[n % Math.max(1, seen.length)]; return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 } }, i); if (!spot) continue; await p.mouse.click(spot.x, spot.y); await p.locator('.panel').waitFor(); await sleep(60); await p.mouse.click(1000, 880).catch(() => {})
    await p.keyboard.press('Escape'); await sleep(60)
  }
  const free = await p.evaluate(() => { for (let y = 120; y < 860; y += 37) for (let x = 200; x < 1300; x += 53) { const e = document.elementFromPoint(x, y); if (e?.classList.contains('canvas') || e?.classList.contains('world')) return { x, y } } return { x: 700, y: 120 } })
  await p.mouse.move(free.x, free.y); await p.mouse.down(); for (let i = 0; i < 20; i++) await p.mouse.move(free.x - i * 40, free.y); await p.mouse.up()
  await p.mouse.move(free.x, free.y); await sleep(50); const free2 = await p.evaluate(() => { for (let y = 120; y < 860; y += 37) for (let x = 200; x < 1300; x += 53) { const e = document.elementFromPoint(x, y); if (e?.classList.contains('canvas') || e?.classList.contains('world')) return { x, y } } return { x: 700, y: 120 } })
  await p.mouse.move(free2.x, free2.y); await p.mouse.down(); for (let i = 0; i < 20; i++) await p.mouse.move(free2.x + i * 40, free2.y); await p.mouse.up()
  if (await p.locator('[role=dialog]').count()) console.log('stray dialog after pan', await p.locator('[role=dialog]').first().innerText())
  for (let i = 0; i < 10; i++) { await p.mouse.wheel(0, i < 5 ? 150 : -150); await sleep(15) }
  await p.keyboard.press('Meta+k'); await sleep(150); await p.keyboard.type('Имя1'); await sleep(150); await p.keyboard.press('Escape'); await sleep(150)
  for (const label of ['История', 'Кем приходится?', 'Настройки']) { const b = p.locator(`nav button[aria-label="${label}"], nav button[aria-label="${label}?"], nav button[aria-label="Кем приходится?"]`).first(); await p.keyboard.press('Escape'); await sleep(250); if (await p.locator('[role=dialog]').count()) { console.log('Escape left a dialog open:', (await p.locator('[role=dialog]').first().innerText()).slice(0, 80)); errs.push('stuck dialog'); await p.keyboard.press('Escape'); await sleep(250) } await b.click({ timeout: 5000 }).catch(async (e) => { await p.screenshot({ path: '/tmp/page-recovery-fail.png' }); throw e }); await sleep(180); await p.keyboard.press('Escape'); await sleep(100); const open = p.locator('.side-panel button[aria-label="Закрыть"], aside button[aria-label="Закрыть"]').first(); if (await open.count()) await open.click({ timeout: 1000 }).catch(() => {}); await sleep(80) }
  for (let i = 0; i < 5; i++) { await rename('Цикл' + i); await sleep(500) }
}
const series = [await m()]
for (let r = 0; r < 6; r++) { await round(); series.push(await m()) }
console.log(JSON.stringify(series))
const a = series[1], z = series.at(-1)
ok('no steady growth over a long session', z.heapMB - a.heapMB < 6 && z.nodes - a.nodes < 400 && z.listeners - a.listeners < 150, `heap ${a.heapMB} → ${z.heapMB} MB, nodes ${a.nodes} → ${z.nodes}, listeners ${a.listeners} → ${z.listeners}`)
ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '))
await br.close(); proxy.close(); proxy.closeAllConnections?.(); execSync('docker rm -f fg-cl'); process.exit(0)
