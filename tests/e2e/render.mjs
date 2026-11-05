// rperf.mjs: rendering cost per scenario, from Chrome's own counters (no frame-rate guessing in headless).
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { boot, cookiesOf, IMAGE } from './lib.mjs'
const { B, cookie: raw } = await boot('fg-render', 3441, IMAGE)
const cookies = cookiesOf(raw)
const budgets = JSON.parse(fs.readFileSync(new URL('../budgets.json', import.meta.url), 'utf8'))
const br = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await br.newContext({ viewport: { width: 1440, height: 900 } }); await ctx.addCookies(cookies)
const page = await ctx.newPage(); const errs = []
page.on('pageerror', (e) => errs.push(e.message.slice(0, 160)))
const cdp = await ctx.newCDPSession(page); await cdp.send('Performance.enable')
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
const out = {}
const run = async (name, fn) => {
  const a = await metrics(); const t = Date.now(); await fn(); await page.waitForTimeout(300); const b = await metrics()
  const d = (k) => Math.round((b[k] - a[k]) * 1000)
  out[name] = { wall: Date.now() - t, script: d('ScriptDuration'), style: d('RecalcStyleDuration'), layout: d('LayoutDuration'), task: d('TaskDuration') }
}
const t0 = Date.now()
await run('load', async () => { await page.goto(B + '/', { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => document.querySelectorAll('.pcard').length > 0, { timeout: 120000 }) })
out.readyMs = Date.now() - t0 - 300
await page.waitForTimeout(1000)
const snap = () => page.evaluate(() => ({ nodes: document.getElementsByTagName('*').length, cards: document.querySelectorAll('.pcard').length, heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576) }))
out.afterLoad = await snap()
out.js = await page.evaluate(() => Math.round(performance.getEntriesByType('resource').filter((r) => r.name.includes('.js')).reduce((a, r) => a + r.encodedBodySize, 0) / 1024))
const C = await page.evaluate(() => { for (let y = 120; y < 860; y += 23) for (let x = 200; x < 1300; x += 31) { const e = document.elementFromPoint(x, y); if (e?.classList.contains('canvas') || e?.classList.contains('world')) return { x, y } } return { x: 720, y: 120 } })
await run('pan', async () => { await page.mouse.move(C.x, C.y); await page.mouse.down(); for (let i = 0; i < 60; i++) { await page.mouse.move(C.x + i * 10, C.y + i * 3); await page.waitForTimeout(16) } await page.mouse.up() })
await run('zoomInOut', async () => { await page.mouse.move(C.x, C.y); for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, i < 15 ? -100 : 100); await page.waitForTimeout(16) } })
const vis = () => page.evaluate(() => { for (const c of document.querySelectorAll('.pcard')) { const r = c.getBoundingClientRect(); if (r.x > 400 && r.x < 1000 && r.y > 200 && r.y < 700) return { x: r.x + r.width / 2, y: r.y + 20, id: c.dataset.person } } return null })
const v = await vis()
if (v) {
  await run('hover10', async () => { for (let i = 0; i < 10; i++) { await page.mouse.move(v.x, v.y); await page.waitForTimeout(220); await page.mouse.move(5, 500); await page.waitForTimeout(90) } })
  await run('openClose5', async () => { for (let i = 0; i < 5; i++) { await page.mouse.click(v.x, v.y); await page.waitForSelector('.panel', { timeout: 20000 }); await page.keyboard.press('Escape'); await page.waitForTimeout(100); if (await page.locator('.panel').count()) await page.mouse.click(1000, 880); await page.waitForTimeout(200) } })
  // Someone else's edit arriving over the live channel.
  const cookie = raw
  await run('remoteEdit3', async () => { for (let i = 0; i < 3; i++) { await fetch(`${B}/api/v1/persons/${v.id}`, { method: 'PATCH', headers: { cookie, origin: B, 'content-type': 'application/json' }, body: JSON.stringify({ birthPlace: 'Город ' + Date.now() }) }); await page.waitForTimeout(1500) } })
}
// All the way out: everyone on screen, the worst case for any trick that hides the unseen.
await run('zoomOutFull', async () => { await page.mouse.move(C.x, C.y); for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, 200); await page.waitForTimeout(16) } await page.waitForTimeout(300) })
out.farOut = await snap()
await run('panFar', async () => { await page.mouse.move(C.x, C.y); await page.mouse.down(); for (let i = 0; i < 60; i++) { await page.mouse.move(C.x + i * 4, C.y + i); await page.waitForTimeout(16) } await page.mouse.up() })
// The whole family on paper, in both modes: the largest thing the browser is asked to make.
for (const [name, mode] of [['printOne', 'На одном листе'], ['printSheets', 'Склеить из листов']]) {
  await page.getByRole('button', { name: 'Печать схемы' }).click()
  await page.getByRole('dialog').waitFor()
  await page.getByText(mode).click()
  const t = Date.now()
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 180000 }), page.getByRole('button', { name: 'Скачать PDF' }).click()])
  const f = await dl.path()
  out[name] = { ms: Date.now() - t, MB: +(fs.statSync(f).size / 1e6).toFixed(1) }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
}
out.errs = errs
for (const [k, val] of Object.entries(out)) console.log(k, JSON.stringify(val))
await br.close()
const over = [
  out.afterLoad.nodes > budgets.nodes && `DOM nodes ${out.afterLoad.nodes} > ${budgets.nodes}`,
  out.js > budgets.firstLoadKB && `first load ${out.js} KB > ${budgets.firstLoadKB}`,
  out.hover10 && out.hover10.task / 10 > budgets.hoverMs && `hover ${out.hover10.task / 10} ms > ${budgets.hoverMs}`,
  out.errs.length && `page errors: ${out.errs.length}`,
].filter(Boolean)
console.log(over.length ? `FAIL ${over.join('; ')}` : 'PASS within budgets')
process.exit(over.length ? 1 : 0)
