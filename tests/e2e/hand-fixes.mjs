// Defects a person had to find by hand on the chart, now measured so they stay fixed.
// Each check says what the person saw. Prints the numbers on a failure; the data is invented.
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { boot, cookiesOf, IMAGE, sh } from './lib.mjs'

const { B, cookie } = await boot('fg-hand', 3449, IMAGE, { people: 0 })
const ged = sh(`python3 "${fileURLToPath(new URL('gen-tangled-family.py', import.meta.url))}" 32`)
const imported = await fetch(B + '/api/v1/gedcom/import', { method: 'POST', headers: { cookie, origin: B, 'content-type': 'text/plain' }, body: ged })
if (!imported.ok) throw new Error('import ' + imported.status)

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
await context.addCookies(cookiesOf(cookie))
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)))
const ok = (name, good, detail) => console.log(good ? 'ok  ' : 'FAIL', name, good || detail === undefined ? '' : JSON.stringify(detail))
const home = async () => { await page.goto(B + '/'); await page.waitForSelector('.pcard'); await page.waitForTimeout(900) }
const park = async () => { await page.mouse.move(4, 896); await page.waitForTimeout(200) }

// The visible text of the people's captions, line by line.
const CAPTION_TEXT = `[...document.querySelectorAll('.pcard .nm, .pcard .yr')].flatMap((e) => {
  const range = document.createRange(); range.selectNodeContents(e)
  // A name cut after three lines still has the later lines in the document, clipped away: only what shows counts.
  const shown = e.getBoundingClientRect().bottom
  return [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1 && r.top < shown - 1).map((r) => ({ who: e.textContent.trim().slice(0, 40), card: e.closest('.pcard'), el: e, x: r.left, y: r.top, r: r.right, b: r.bottom }))
})`
const CROSS = 'const cross = (a, b) => Math.min(a.r, b.r) - Math.max(a.x, b.x) > 2 && Math.min(a.b, b.b) - Math.max(a.y, b.y) > 2;'

await home()
const portraits = await page.evaluate(() => [...document.querySelectorAll('.pcard')].map((card, index) => {
  const r = card.querySelector('.ava')?.getBoundingClientRect()
  return r && r.top > 90 && r.bottom < 780 && r.left > 60 && r.right < 1380 ? { index, x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width } : null
}).filter(Boolean).slice(0, 8))
ok('the chart shows enough people to measure', portraits.length >= 6, portraits.length)

// Pluses: small beside the portrait, on every side of it, and never over a name.
const hovers = []
for (const c of portraits) {
  await park()
  await page.mouse.move(c.x, c.y); await page.waitForTimeout(300)
  hovers.push(await page.evaluate(`(() => { ${CROSS}
    const card = document.querySelectorAll('.pcard')[${c.index}], ava = card.querySelector('.ava').getBoundingClientRect()
    const shown = [...card.querySelectorAll('button')].filter((b) => { let o = 1; for (let e = b; e && e !== card; e = e.parentElement) o *= +getComputedStyle(e).opacity; return o > 0.5 && b.getBoundingClientRect().width > 0 })
    const rects = shown.map((b) => { const r = b.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom } })
    const side = (r) => { const dx = (r.x + r.r) / 2 - (ava.left + ava.right) / 2, dy = (r.y + r.b) / 2 - (ava.top + ava.bottom) / 2; return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top') }
    return { pluses: rects.length, ratio: rects.length ? Math.max(...rects.map((r) => r.r - r.x)) / ava.width : 0, sides: new Set(rects.map(side)).size,
      covered: ${CAPTION_TEXT}.filter((t) => rects.some((r) => cross(r, t))).map((t) => t.who) }
  })()`))
}
const hovered = hovers.filter((h) => h.pluses)
ok('hovering a portrait brings its pluses', hovered.length === portraits.length, hovers.map((h) => h.pluses))
ok('a plus is much smaller than the portrait', hovered.length > 0 && Math.max(...hovered.map((h) => h.ratio)) <= 0.7, hovered.map((h) => +h.ratio.toFixed(2)))
ok('there is a plus on all four sides', hovered.length > 0 && hovered.every((h) => h.sides === 4), hovered.map((h) => h.sides))
ok('no plus covers a name', hovered.length > 0 && hovered.every((h) => !h.covered.length), [...new Set(hovered.flatMap((h) => h.covered))].slice(0, 6))

// A click on the portrait itself opens the editor.
let opened = 0
for (const c of portraits) {
  await home()
  await park()
  await page.mouse.click(c.x, c.y); await page.waitForTimeout(600)
  if (await page.locator('aside.panel').count()) opened++
}
ok('a click on any portrait opens the card', opened === portraits.length, { opened, of: portraits.length })

// Captions on a settled chart: lines stay out of them and they stay out of each other.
await home()
await park()
const settled = await page.evaluate(`(() => { ${CROSS}
  const opaque = (from, stop) => { for (let e = from; e && e !== stop.parentElement; e = e.parentElement) { const m = getComputedStyle(e).backgroundColor.match(/[\\d.]+/g); if (m && (m.length === 3 || +m[3] > 0.5)) return true } return false }
  const texts = ${CAPTION_TEXT}, through = new Set(), overlap = new Set()
  for (const path of document.querySelectorAll('svg path.line, svg path.union')) {
    const m = path.getScreenCTM(), length = path.getTotalLength(); if (!m || length < 12) continue
    for (let i = 0, n = Math.ceil(length / 4); i <= n; i++) {
      const q = path.getPointAtLength(length * i / n), x = q.x * m.a + q.y * m.c + m.e, y = q.x * m.b + q.y * m.d + m.f
      for (const t of texts) if (x > t.x + 1 && x < t.r - 1 && y > t.y + 2 && y < t.b - 2 && !opaque(t.el, t.card)) through.add(t.who)
    }
  }
  texts.forEach((a, i) => texts.slice(i + 1).forEach((b) => { if (a.card !== b.card && cross(a, b)) overlap.add(a.who + ' / ' + b.who) }))
  return { texts: texts.length, through: [...through], overlap: [...overlap] }
})()`)
ok('the captions are there to measure', settled.texts > 10, settled.texts)
ok('no line runs through a name', settled.through.length === 0, settled.through.slice(0, 8))
ok('names do not overlap', settled.overlap.length === 0, settled.overlap.slice(0, 8))

// A click anywhere along a line selects it, not only at some spots.
const along = await page.evaluate(() => {
  const res = []
  for (const path of document.querySelectorAll('svg path.line')) {
    const m = path.getScreenCTM(), length = path.getTotalLength(); if (!m || length < 60) continue
    // A hand does not land exactly on a thin line, so each click is a little off it.
    const at = [0.2, 0.5, 0.8].map((f) => { const q = path.getPointAtLength(length * f); return [q.x * m.a + q.y * m.c + m.e + 2, q.x * m.b + q.y * m.d + m.f + 2] })
    const free = ([x, y]) => x > 60 && x < 1380 && y > 90 && y < 780 && !document.elementFromPoint(x, y)?.closest('.pcard, button, a, .float')
    res.push(...at.filter(free))
  }
  return res.filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 15)) === 0).slice(0, 15)
})
let answered = 0, clicks = 0
const missed = []
for (const [x, y] of along) {
  await home()
  const under = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return `${e?.tagName} ${e?.getAttribute('class') ?? ''}` }, [x, y])
  await page.mouse.click(x, y); await page.waitForTimeout(350); clicks++
  if (await page.locator('.linkbar').count()) answered++
  else missed.push({ x: Math.round(x), y: Math.round(y), under })
}
ok('a click anywhere along a line selects it', clicks >= 9 && answered === clicks, { answered, clicks, missed })

// The settings window keeps its place and size between its sections.
await home()
await page.locator('button[aria-label="Настройки"]:visible, button[title="Настройки"]:visible').first().click({ timeout: 4000 }).catch(() => {})
await page.waitForTimeout(500)
const sections = page.locator('[role=dialog] nav button, [role=dialog] [role=tab]')
const sizes = []
for (let i = 0, n = await sections.count(); i < n; i++) {
  await sections.nth(i).click(); await page.waitForTimeout(350)
  sizes.push(await page.locator('[role=dialog]').evaluate((d) => { const r = d.getBoundingClientRect(); return { y: Math.round(r.y), h: Math.round(r.height) } }))
}
const spread = (k) => (sizes.length ? Math.max(...sizes.map((s) => s[k])) - Math.min(...sizes.map((s) => s[k])) : 0)
ok('settings has sections to switch', sizes.length >= 3, sizes.length)
ok('the settings window does not jump between sections', spread('y') <= 8 && spread('h') <= 8, sizes)

// The person's card can be made wider by its edge.
await home()
await park()
await page.mouse.click(portraits[0].x, portraits[0].y); await page.waitForSelector('aside.panel', { timeout: 4000 }).catch(() => {})
await page.waitForTimeout(400)
const width = () => page.locator('aside.panel').first().evaluate((e) => e.getBoundingClientRect().width).catch(() => 0)
const edge = await page.locator('aside.panel [role=separator], aside.panel .panel-edge').first().boundingBox({ timeout: 1500 }).catch(() => null)
const narrow = await width()
if (edge) {
  const x = edge.x + edge.width / 2, y = edge.y + edge.height / 2, grow = x < 720 ? 90 : -90
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + grow, y, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200)
}
const wide = await width()
ok('the card gets wider by dragging its edge', wide - narrow >= 60, { edge: !!edge, narrow, wide })

ok('nothing broke on the page', errors.length === 0, errors.slice(0, 3))
await browser.close()
