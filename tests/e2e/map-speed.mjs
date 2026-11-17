// The family map's speed, from Chrome's own counters, on a desktop and on a phone with a 4× slower processor:
// idle frames (none may run while nothing moves), panning, wheel and pinch zoom (how far one gesture zooms, as on
// Google Maps), Play, memory over a long Play, and live edits from another person arriving while it plays.
// FG_URL=http://localhost:3528 node tests/e2e/map-speed.mjs runs it against a running build that signs the owner in
// by itself (FOLKBRANCH_LOCAL_LOGIN=1 on localhost) and holds a large family with places.
import { chromium } from 'playwright-core'

const O = process.env.FG_URL ?? 'http://localhost:3528'
const br = await chromium.launch({ channel: 'chrome', headless: true })
const results = {}

async function measure(label, { viewport, phone }) {
  const ctx = await br.newContext({ viewport, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 3 : 2 })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 160)))
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Performance.enable')
  if (phone) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  const counters = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
  // Main-thread work while fn runs, in ms, and frames drawn.
  const cost = async (fn) => {
    await page.evaluate(() => { window.__f = []; let last = performance.now(); window.__on = true; const tick = (t) => { window.__f.push(t - last); last = t; if (window.__on) requestAnimationFrame(tick) }; requestAnimationFrame(tick) })
    const a = await counters(), t = Date.now()
    await fn()
    const b = await counters(), wall = Date.now() - t
    const f = await page.evaluate(() => { window.__on = false; return window.__f.sort((x, y) => x - y) })
    const p95 = Math.round(f[Math.floor(f.length * 0.95)] ?? 0)
    const ms = (k) => Math.round((b[k] - a[k]) * 1000)
    return { wall, taskMsPerS: Math.round((ms('TaskDuration') / wall) * 1000), scriptMsPerS: Math.round((ms('ScriptDuration') / wall) * 1000), styleMsPerS: Math.round((ms('RecalcStyleDuration') / wall) * 1000), layoutMs: ms('LayoutDuration'), fps: Math.round(f.length / (wall / 1000)), p95 }
  }
  // Frames requested while nothing moves: anything above zero is wasted battery.
  const idle = async () => {
    await page.waitForTimeout(1500)
    const a = await counters()
    const n = await page.evaluate(async () => { let n = 0; const o = window.requestAnimationFrame; window.requestAnimationFrame = (fn) => { n++; return o(fn) }; await new Promise((r) => setTimeout(r, 2000)); window.requestAnimationFrame = o; return n })
    const b = await counters()
    return { frames: n, taskMs: Math.round((b.TaskDuration - a.TaskDuration) * 1000) }
  }
  // The zoom level, from Leaflet's zoom proxy (scaled by 2^(zoom - 1)); how far a gesture zoomed, in levels.
  const zoomNow = () => page.evaluate(() => { const t = getComputedStyle(document.querySelector('.leaflet-proxy')).transform; const k = t.startsWith('matrix(') ? +t.slice(7).split(',')[0] : NaN; return Math.log2(k) + 1 })
  const zoomBy = async (fn) => { const z0 = await zoomNow(); await fn(); await page.waitForTimeout(1200); return +((await zoomNow()) - z0).toFixed(2) }
  const W = viewport.width, H = viewport.height, cx = Math.round(W / 2), cy = Math.round(H * 0.42)
  const pinch = async (from, to) => {
    const pts = (d) => [{ x: cx - d / 2, y: cy, id: 1 }, { x: cx + d / 2, y: cy, id: 2 }]
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) })
    for (let i = 1; i <= 12; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(from + ((to - from) * i) / 12) }); await page.waitForTimeout(16) }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  const drag = async () => {
    if (phone) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, id: 1 }] })
      for (let i = 1; i <= 30; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx - i * 5, y: cy - i * 2, id: 1 }] }); await page.waitForTimeout(16) }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    } else {
      await page.mouse.move(cx, cy); await page.mouse.down()
      for (let i = 1; i <= 40; i++) { await page.mouse.move(cx + i * 6, cy + i * 2); await page.waitForTimeout(16) }
      await page.mouse.up()
    }
  }
  const play = () => page.getByRole('button', { name: 'Play', exact: true }).click()
  const pause = () => page.getByRole('button', { name: 'Pause', exact: true }).click()
  const showOnly = (name) => page.getByRole('radio', { name, exact: true }).click()

  const r = { errs }
  const t0 = Date.now()
  await page.goto(O + '/', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Map', exact: true }).click({ timeout: 60000 })
  await page.waitForSelector('.atlas-country', { timeout: 60000 })
  await page.waitForTimeout(1500)
  r.openMs = Date.now() - t0
  r.heapStartMB = await page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1048576))
  r.idle = await idle()
  if (phone) {
    r.pinch2x = await zoomBy(() => pinch(120, 240))
    r.pinchBack = await zoomBy(() => pinch(240, 120))
  } else {
    // One notch of a mouse wheel, as Chrome reports it (100 px); Playwright's own wheel scales it by the screen.
    const notch = (dy) => page.evaluate(({ dy, cx, cy }) => document.querySelector('.leaflet-container').dispatchEvent(new WheelEvent('wheel', { deltaY: dy, deltaMode: 0, clientX: cx, clientY: cy, bubbles: true, cancelable: true })), { dy, cx, cy })
    r.wheelNotch = await zoomBy(() => notch(-100))
    r.wheelNotchBack = await zoomBy(() => notch(100))
    r.zoomIn = await cost(async () => { await page.mouse.move(cx, cy); for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(80) } await page.waitForTimeout(600) })
    r.zoomOut = await cost(async () => { for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(80) } await page.waitForTimeout(600) })
  }
  r.pinchCost = phone ? await cost(async () => { await pinch(120, 260); await page.waitForTimeout(400); await pinch(260, 120); await page.waitForTimeout(400) }) : undefined
  r.pan = await cost(drag)
  await play()
  r.play = await cost(() => page.waitForTimeout(6000))
  r.panWhilePlaying = await cost(drag)
  r.zoomWhilePlaying = phone ? await zoomBy(() => pinch(120, 240)) : await zoomBy(async () => { await page.mouse.move(cx, cy); await page.mouse.wheel(0, -100) })
  await page.waitForTimeout(3000)
  r.heapAfterPlayMB = await page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1048576))
  r.nodes = await page.evaluate(() => document.getElementsByTagName('*').length)
  await pause().catch(() => {})
  r.idleAfterPlay = await idle()
  await showOnly('Events')
  await play(); await page.waitForTimeout(2500); await pause().catch(() => {})
  await page.getByRole('slider').focus()
  for (let i = 0; i < 8; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(40) }
  r.idleEvents = await idle()
  await showOnly('All')
  await ctx.close()
  results[label] = r
}

await measure('desktop', { viewport: { width: 1440, height: 900 }, phone: false })
await measure('phone', { viewport: { width: 390, height: 844 }, phone: true })
await br.close()
for (const [k, v] of Object.entries(results)) console.log(k, JSON.stringify(v))
