// Speed on a large family, the way a person meets it: reload the map and start zooming at once. The map must show faces,
// answer the first zoom, and keep the page free (no long stretch where nothing responds). On a phone's processor, four
// times slower. Budgets are in tests/budgets.json under mapReload; they are generous for a shared build machine (today's
// numbers are a fifth to a half of them), so they catch a slowdown of the size we once had on a phone (a first zoom of 4.9 s
// when portraits were all decoded at once) and not machine noise. Tighten them as the app gets faster.
import { readFileSync } from 'node:fs'
import { browser, finish, isPhone, ok, open, O, sleep, SIZES } from './lib.mjs'

const budget = JSON.parse(readFileSync(new URL('../budgets.json', import.meta.url), 'utf8')).mapReload
const br = await browser()
for (const [name, size] of [['desktop', SIZES['desktop-1440']], ['phone', SIZES['phone-390']]]) {
  const phone = isPhone(size)
  const { page, ctx } = await open(br, size)
  const cdp = await ctx.newCDPSession(page)
  if (phone) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await page.addInitScript(() => { window.__long = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration) }).observe({ type: 'longtask', buffered: true }) })
  await page.goto(O + '/'); await page.locator('.pcard').first().waitFor({ timeout: 90000 }); await sleep(1500)
  // Twice: the first load warms the server and the browser's cache, the second is what a returning person sees.
  let shown = 0, zoom = 0, long = 0, faces = 0
  for (let run = 0; run < 2; run++) {
    const t0 = Date.now()
    await page.goto(`${O}/?view=map&y=1950`)
    await page.waitForFunction(() => document.querySelectorAll('.map-face').length > 100, null, { timeout: 90000, polling: 20 })
    shown = Date.now() - t0
    faces = await page.locator('.map-face').count()
    const z0 = await page.evaluate(() => document.querySelector('.leaflet-proxy').style.transform)
    const t1 = Date.now()
    if (phone) await page.evaluate(() => document.querySelector('.family-map').dispatchEvent(new WheelEvent('wheel', { deltaY: -60, ctrlKey: true, clientX: innerWidth / 2, clientY: innerHeight / 2, bubbles: true, cancelable: true })))
    else { await page.mouse.move(720, 450); await page.mouse.wheel(0, -400) }
    await page.waitForFunction((z) => document.querySelector('.leaflet-proxy').style.transform !== z, z0, { timeout: 30000, polling: 'raf' }).catch(() => {})
    zoom = Date.now() - t1
    await sleep(1500)
    long = await page.evaluate(() => Math.round(window.__long.reduce((a, b) => a + b, 0)))
  }
  const b = (k) => budget[`${name}${k}`]
  ok(`${name}: faces are on the map within ${b('ShownMs')} ms of a reload`, shown <= b('ShownMs'), `${shown} ms, ${faces} faces`)
  ok(`${name}: the first zoom answers within ${b('ZoomMs')} ms`, zoom <= b('ZoomMs'), `${zoom} ms`)
  ok(`${name}: the page is busy no longer than ${b('LongMs')} ms in all`, long <= b('LongMs'), `${long} ms of long tasks`)
  await ctx.close()
}
await br.close()
finish()
