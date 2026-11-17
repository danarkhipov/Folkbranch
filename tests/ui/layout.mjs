// How the screens sit, at the sizes people use: nothing wider than the screen, bars and panels inside it and clear of
// each other, a phone's bars with icons only and fingers' room, every icon named for a screen reader. Screenshots of each
// state are kept for the pull request. These are the mistakes found by looking at the app on a phone.
import { browser, finish, isPhone, ok, open, openMap, O, shot, sleep, SIZES } from './lib.mjs'

const BARS = ['.main-bar', '.view-bar', '.view-tools', '.map-bar', '.map-gaps']

/** What the page looks like now, measured in the browser. */
const measure = (page) => page.evaluate((BARS) => {
  const vw = innerWidth, vh = innerHeight
  const shown = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05 }
  const rect = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom } }
  const bars = BARS.flatMap((sel) => [...document.querySelectorAll(sel)].filter(shown).map((el) => ({ sel, ...rect(el) })))
  const overlaps = []
  for (let i = 0; i < bars.length; i++) for (let j = i + 1; j < bars.length; j++) {
    const a = bars[i], b = bars[j]
    const w = Math.min(a.r, b.r) - Math.max(a.l, b.l), h = Math.min(a.b, b.b) - Math.max(a.t, b.t)
    if (w > 2 && h > 2) overlaps.push(`${a.sel} × ${b.sel} (${Math.round(w)}×${Math.round(h)})`)
  }
  const outside = bars.filter((b) => b.l < -1 || b.t < -1 || b.r > vw + 1 || b.b > vh + 1).map((b) => `${b.sel} ${Math.round(b.l)},${Math.round(b.t)}–${Math.round(b.r)},${Math.round(b.b)}`)
  // Buttons of the bars: a label printed on them, too small for a finger, or with no name at all.
  const buttons = [...document.querySelectorAll('.main-bar button, .view-bar button, .view-tools button, .map-bar button')].filter(shown)
  const labelled = buttons.filter((b) => [...b.querySelectorAll('.nav-label')].some(shown)).map((b) => b.getAttribute('aria-label') || b.innerText.trim())
  const small = buttons.filter((b) => { const r = b.getBoundingClientRect(); return r.width < 40 || r.height < 40 }).map((b) => `${b.getAttribute('aria-label') ?? b.innerText.trim()} ${Math.round(b.getBoundingClientRect().width)}×${Math.round(b.getBoundingClientRect().height)}`)
  const unnamed = buttons.filter((b) => !(b.getAttribute('aria-label') || b.getAttribute('title') || b.innerText.trim())).length
  return { overflowX: document.documentElement.scrollWidth - vw, overlaps, outside, labelled, small, unnamed, mainBarHeight: document.querySelector('.main-bar')?.getBoundingClientRect().height ?? 0 }
}, BARS)

const br = await browser()
for (const [name, size] of Object.entries(SIZES)) {
  const phone = isPhone(size)
  const { page, ctx, errors } = await open(br, size)
  const states = [
    ['tree', async () => { await page.goto(O + '/'); await page.locator('.pcard').first().waitFor({ timeout: 60000 }); await sleep(1200) }],
    ['map', async () => { await openMap(page) }],
    ['map-layers', async () => { await page.getByRole('button', { name: 'Map layers' }).click(); await sleep(500) }],
  ]
  for (const [state, go] of states) {
    await go()
    const m = await measure(page)
    const at = `${state} @ ${name}`
    ok(`nothing is wider than the screen: ${at}`, m.overflowX <= 1, `${m.overflowX}px over`)
    ok(`bars and panels are inside the screen: ${at}`, m.outside.length === 0, m.outside.join('; '))
    ok(`bars and panels do not lie over each other: ${at}`, m.overlaps.length === 0, m.overlaps.join('; '))
    ok(`every button has a name: ${at}`, m.unnamed === 0, `${m.unnamed} without`)
    if (phone) {
      ok(`a phone's bars show icons only: ${at}`, m.labelled.length === 0, m.labelled.join(', '))
      ok(`a phone's buttons are big enough for a finger: ${at}`, m.small.length === 0, m.small.join('; '))
      ok(`a phone's bottom bar leaves the room to the family: ${at}`, m.mainBarHeight <= 60, `${Math.round(m.mainBarHeight)}px high`)
    }
    await shot(page, `${state}-${name}`)
  }
  ok(`no script error: ${name}`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}
await br.close()
finish()
