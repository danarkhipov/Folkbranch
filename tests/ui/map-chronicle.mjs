// The chronicle on the map, on the invented entries of tests/fixtures/chronicle-demo.json: the rust marks and the chip
// in the bar, the entry card on a phone, the front page on a wide screen. Geometry and behaviour, never pixels.
import { browser, COOKIE, finish, ok, open, O, shot, sleep } from './lib.mjs'

const CYR = /[А-Яа-яЁё]/
const PHONES = { 'phone-375': { width: 375, height: 812 }, 'phone-390': { width: 390, height: 844 } }

/** The map at a year, with faces on it and the chronicle's list in. */
async function mapAt(page, year) {
  await page.goto(`${O}/?view=map&y=${year}`)
  await page.locator('.map-face').first().waitFor({ state: 'attached', timeout: 60000 })
  await page.locator('.map-era').first().waitFor({ state: 'attached', timeout: 20000 })
  await sleep(1200)
}
const box = (page, sel) => page.evaluate((sel) => {
  const el = [...document.querySelectorAll(sel)].find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' })
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }
}, sel)
const meet = (a, b) => a && b && Math.min(a.r, b.r) - Math.max(a.l, b.l) > 2 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 2
const year = (page) => page.locator('.map-track').getAttribute('aria-valuenow').then(Number)
const chipText = (page) => page.locator('.map-era-chip').innerText().catch(() => '')
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
/** Pairs of these that lie over each other, by name. */
async function overlaps(page, sels) {
  const boxes = await Promise.all(sels.map((s) => box(page, s)))
  const out = []
  for (let i = 0; i < sels.length; i++) for (let j = i + 1; j < sels.length; j++) if (meet(boxes[i], boxes[j])) out.push(`${sels[i]} × ${sels[j]}`)
  return out
}

const br = await browser()

// A phone: the chip in the buttons' row, a finger's size, the bar no wider than the screen; the card opens over the
// track, inside the bar, and Escape closes it.
for (const [name, size] of Object.entries(PHONES)) {
  const { page, ctx, errors } = await open(br, size)
  await mapAt(page, 1948)
  const marks = await page.locator('.map-era').count()
  ok(`a rust mark per entry on the track @ ${name}`, marks === 3, `${marks} marks`)
  const chip = await box(page, '.map-era-chip'), play = await box(page, '.map-controls button[aria-label="Play"]'), bar = await box(page, '.map-bar')
  ok(`the chip names the year's entry @ ${name}`, /northern quarantine/i.test(await chipText(page)), await chipText(page))
  ok(`the chip is in the buttons' row @ ${name}`, !!chip && !!play && Math.abs((chip.t + chip.b) / 2 - (play.t + play.b) / 2) < 4, JSON.stringify({ chip, play }))
  ok(`the chip is at least 40 px high @ ${name}`, (chip?.h ?? 0) >= 40, `${chip?.h}px`)
  ok(`the chip stays inside the bar @ ${name}`, !!chip && !!bar && chip.r <= bar.r + 0.5 && chip.l >= bar.l, JSON.stringify({ chip, bar }))
  ok(`the bar is no wider than the screen @ ${name}`, (await overflowX(page)) <= 1 && !!bar && bar.r <= size.width && bar.l >= 0, JSON.stringify(bar))
  await shot(page, `chronicle-bar-${name}`)
  const barBefore = bar
  await page.locator('.map-era-chip').click(); await sleep(500)
  const card = await box(page, '.chronicle-card'), track = await box(page, '.map-track')
  ok(`the chip opens the card @ ${name}`, !!card && (await page.locator('.map-era-chip').getAttribute('aria-expanded')) === 'true')
  ok(`the card stands over the track, inside the bar @ ${name}`, !!card && !!track && card.b <= track.t + 1 && card.t >= 0, JSON.stringify({ card, track }))
  ok(`the bar grows upwards, its foot stays @ ${name}`, !!card && Math.abs((await box(page, '.map-bar')).b - barBefore.b) < 1)
  ok(`the card has a close button a finger can press @ ${name}`, ((await box(page, '.chronicle-close'))?.h ?? 0) >= 40)
  ok(`nothing is wider than the screen with the card open @ ${name}`, (await overflowX(page)) <= 1)
  await shot(page, `chronicle-card-${name}`)
  await page.keyboard.press('Escape'); await sleep(300)
  ok(`Escape closes the card @ ${name}`, (await page.locator('.chronicle-card').count()) === 0)
  // A second press on the chip closes what the first opened.
  await page.locator('.map-era-chip').click(); await sleep(300)
  await page.locator('.map-era-chip').click(); await sleep(300)
  ok(`a second press on the chip closes the card @ ${name}`, (await page.locator('.chronicle-card').count()) === 0)
  ok(`no script error @ ${name}`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// A tablet: the card too, its text no wider than 560 px.
{
  const { page, ctx } = await open(br, { width: 768, height: 1024 })
  await mapAt(page, 1948)
  await page.locator('.map-era-chip').click(); await sleep(500)
  const article = await box(page, '.chronicle-card article')
  ok('a tablet opens the card, its text at most 560 px wide', !!article && article.w <= 560, JSON.stringify(article))
  ok('nothing is wider than the screen @ tablet', (await overflowX(page)) <= 1)
  await shot(page, 'chronicle-card-tablet-768')
  await ctx.close()
}

// Spanish and Catalan: the chip, the card and the page in the reader's language, no Russian left.
for (const lang of ['es', 'ca']) {
  const phone = await open(br, PHONES['phone-390'], { lang })
  await mapAt(phone.page, 1948)
  await phone.page.locator('.map-era-chip').click(); await sleep(500)
  const barText = await phone.page.locator('.map-bar').innerText()
  ok(`the bar and the card speak ${lang}, no Russian @ phone`, !CYR.test(barText) && barText.includes(lang === 'es' ? 'La cuarentena del norte' : 'La quarantena del nord'), barText.match(/[А-Яа-яЁё]+/)?.[0] ?? barText.slice(0, 60))
  await shot(phone.page, `chronicle-card-${lang}`)
  await phone.ctx.close()
  const desk = await open(br, { width: 1440, height: 900 }, { lang })
  await mapAt(desk.page, 1948)
  await desk.page.locator('aside.chronicle').waitFor({ timeout: 10000 })
  const pageText = await desk.page.locator('aside.chronicle').innerText()
  ok(`the front page speaks ${lang}, no Russian`, !CYR.test(pageText) && pageText.includes(lang === 'es' ? 'EN LA FAMILIA' : 'A LA FAMÍLIA'), pageText.match(/[А-Яа-яЁё]+/)?.[0] ?? pageText.slice(0, 80))
  await shot(desk.page, `chronicle-page-${lang}`)
  await desk.ctx.close()
}

// A wide screen: the chip and the slider's words follow the year.
{
  const { page, ctx, errors } = await open(br, { width: 1440, height: 900 })
  await mapAt(page, 1948)
  ok('the chip names the year\'s entry @ desktop', /northern quarantine/i.test(await chipText(page)), await chipText(page))
  await page.locator('.map-track').focus()
  await page.keyboard.press('Home'); await sleep(400)
  ok('no chip in a year with no entry @ desktop', (await page.locator('.map-era-chip').count()) === 0, `year ${await year(page)}`)
  await page.goto(`${O}/?view=map&y=1937`); await page.locator('.map-era').first().waitFor({ state: 'attached', timeout: 20000 }); await sleep(1000)
  ok('the chip follows the year @ desktop', /goes to sea/i.test(await chipText(page)), await chipText(page))
  ok('the slider says the entry too @ desktop', /John goes to sea/.test(await page.locator('.map-track').getAttribute('aria-valuetext')))
  await shot(page, 'chronicle-bar-desktop-1440')
  ok('no script error @ desktop', errors.length === 0, errors.join(' | '))
  await ctx.close()
}
// A wide screen: the page stands on the left and keeps clear of everything else.
const PARTS = ['aside.chronicle', '.chronicle-tab', '.map-bar', '.map-gaps > button', '.view-tools', '.map-follow', 'aside.panel']
for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 1100, height: 800 }]) {
  const name = `${size.width}x${size.height}`
  const { page, ctx, errors } = await open(br, size)
  await mapAt(page, 1948)
  ok(`the chip names the year's entry @ ${name}`, /northern quarantine/i.test(await chipText(page)))
  const pageBox = await box(page, 'aside.chronicle')
  ok(`the front page is open on the left @ ${name}`, !!pageBox && pageBox.l <= 13 && pageBox.w === 360, JSON.stringify(pageBox))
  ok(`the page, the bar, the gaps chip and the view tools do not meet @ ${name}`, (await overlaps(page, PARTS)).length === 0, (await overlaps(page, PARTS)).join('; '))
  ok(`the page shows the year's entry and its family @ ${name}`, (await page.locator('aside.chronicle article h3').first().innerText()).includes('The northern quarantine') && (await page.locator('.chronicle-line').count()) === 2)
  await shot(page, `chronicle-page-${name}`)
  // The headline goes to the entry and frames it: the camera lets go, so "Follow" comes back; still nothing meets.
  await page.locator('aside.chronicle article h3 button').first().click(); await sleep(1400)
  ok(`the headline frames the entry and lets the camera go @ ${name}`, (await page.locator('.map-follow').count()) === 1)
  ok(`nothing meets with Follow shown @ ${name}`, (await overlaps(page, PARTS)).length === 0, (await overlaps(page, PARTS)).join('; '))
  // The chip follows the year.
  await page.locator('.map-track').focus()
  await page.keyboard.press('Home'); await sleep(400)
  const atStart = await year(page)
  ok(`no chip in a year with no entry @ ${name}`, (await page.locator('.map-era-chip').count()) === 0, `year ${atStart}`)
  ok(`the page says so, and offers the next entry @ ${name}`, (await page.locator('.chronicle-none .chronicle-near').count()) >= 1)
  await page.locator('.chronicle-foot button').last().click(); await sleep(500)
  ok(`"after" moves the year to the next entry @ ${name}`, (await year(page)) === 1911, `year ${await year(page)}`)
  ok(`and the chip follows it @ ${name}`, /mill fires/i.test(await chipText(page)), await chipText(page))
  await page.locator('.chronicle-foot button').last().click(); await sleep(500)
  ok(`"after" again goes on to the next @ ${name}`, (await year(page)) === 1936 && /goes to sea/i.test(await chipText(page)), `year ${await year(page)}`)
  await page.locator('.chronicle-foot button').first().click(); await sleep(500)
  ok(`"before" goes back @ ${name}`, (await year(page)) === 1911, `year ${await year(page)}`)
  // Back to the quarantine: a relative's line opens their card and moves the year to theirs.
  await page.goto(`${O}/?view=map&y=1948`); await page.locator('.chronicle-line').first().waitFor({ timeout: 30000 }); await sleep(1000)
  await page.locator('.chronicle-line', { hasText: 'Gregory Harlan' }).click(); await sleep(1200)
  const panel = await box(page, 'aside.panel')
  // The name is in the card's own fields.
  const panelText = panel ? await page.evaluate(() => { const a = document.querySelector('aside.panel'); return `${a.innerText} ${[...a.querySelectorAll('input, textarea')].map((i) => i.value).join(' ')}` }) : ''
  ok(`a family line opens that person @ ${name}`, panelText.includes('Gregory') && panelText.includes('Harlan'), panelText.slice(0, 80))
  ok(`and moves the year to their line's @ ${name}`, (await year(page)) === 1949, `year ${await year(page)}`)
  if (size.width >= 1360) ok(`with the person card open both panels stand @ ${name}`, !!(await box(page, 'aside.chronicle')) && (await page.locator('.chronicle-tab').count()) === 0)
  else ok(`with the person card open the page folds to its tab @ ${name}`, !(await box(page, 'aside.chronicle')) && !!(await box(page, '.chronicle-tab')))
  ok(`nothing meets with the person card open @ ${name}`, (await overlaps(page, PARTS)).length === 0, (await overlaps(page, PARTS)).join('; '))
  ok(`nothing is wider than the screen @ ${name}`, (await overflowX(page)) <= 1)
  await shot(page, `chronicle-person-${name}`)
  ok(`no script error @ ${name}`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// Folded by hand, it stays folded on the next visit; the tab brings it back.
{
  const { page, ctx } = await open(br, { width: 1440, height: 900 })
  await mapAt(page, 1948)
  await page.getByRole('button', { name: 'Fold the chronicle away' }).click(); await sleep(300)
  const tab = await box(page, '.chronicle-tab'), gaps = await box(page, '.map-gaps > button')
  ok('folded, the page is a tab with a dot for the year\'s entry', !!tab && (await page.locator('.chronicle-tab .chronicle-dot').count()) === 1)
  ok('the gaps chip moves below the tab', !gaps || gaps.t >= tab.b, JSON.stringify({ tab, gaps }))
  await shot(page, 'chronicle-tab-1440x900')
  await page.reload(); await page.locator('.map-face').first().waitFor({ state: 'attached', timeout: 60000 }); await sleep(1500)
  ok('the fold is remembered', (await page.locator('aside.chronicle').count()) === 0 && (await page.locator('.chronicle-tab').count()) === 1)
  await page.locator('.map-era-chip').click(); await sleep(600)
  ok('the chip opens the page at its article', (await page.locator('aside.chronicle #chronicle-northern-quarantine').count()) === 1)
  await ctx.close()
}

// Story focus: the relatives an entry names stay in full ink, everyone else goes quiet; following someone wins, and
// Escape gives the whole family back. At a phone's size the same button is in the card.
const faceLooks = (page) => page.evaluate(() => [...document.querySelectorAll('.map-face-in')].filter((el) => getComputedStyle(el).display !== 'none' && (el.querySelector('img')?.getBoundingClientRect().width ?? 0) > 0)
  .map((el) => ({ id: el.dataset.person, name: el.getAttribute('aria-label') ?? '', opacity: Number(getComputedStyle(el).opacity), open: el.classList.contains('open') })))
const mapHas = (page, cls) => page.evaluate((cls) => document.querySelector('.family-map').classList.contains(cls), cls)
for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const name = `${size.width}x${size.height}`
  const { page, ctx, errors } = await open(br, size)
  await mapAt(page, 1948)
  if (size.width < 1100) { await page.locator('.map-era-chip').click(); await sleep(500) }
  const scope = page.locator(size.width < 1100 ? '.chronicle-card' : 'aside.chronicle')
  const button = scope.getByRole('button', { name: 'Show only those it touched' })
  ok(`the article offers story focus @ ${name}`, (await button.count()) === 1 && ((await box(page, '.chronicle-story'))?.h ?? 0) >= (size.width < 1100 ? 40 : 36))
  await button.click(); await sleep(1500)
  let faces = await faceLooks(page)
  const ids = await page.evaluate(async () => (await (await fetch('/api/v1/graph')).json()).persons.filter((p) => ['Gregory Harlan', 'Stephen Whitlock'].includes(`${p.givenName} ${p.surname}`)).map((p) => p.id))
  const named = faces.filter((f) => ids.includes(f.id)), others = faces.filter((f) => !ids.includes(f.id) && !f.open)
  ok(`story focus quiets the map @ ${name}`, await mapHas(page, 'storying'))
  ok(`a face the story names keeps full ink @ ${name}`, named.length > 0 && named.every((f) => f.opacity === 1), JSON.stringify(named).slice(0, 300))
  ok(`everyone else is at 0.3 @ ${name}`, others.length > 0 && others.every((f) => Math.abs(f.opacity - 0.3) < 0.01), `${others.length} others, ${others.filter((f) => Math.abs(f.opacity - 0.3) >= 0.01).length} not quiet`)
  ok(`the button now gives the whole family back @ ${name}`, (await scope.getByRole('button', { name: 'The whole family' }).count()) === 1)
  ok(`the year stays inside the entry @ ${name}`, (await year(page)) >= 1947 && (await year(page)) <= 1951, `year ${await year(page)}`)
  await shot(page, `chronicle-story-${name}`)
  if (size.width >= 1100) {
    // Following a relative from the story: the follow look wins, the story waits under it.
    await page.locator('.chronicle-line', { hasText: 'Gregory Harlan' }).click(); await sleep(1200)
    ok(`following someone switches to the follow look @ ${name}`, (await mapHas(page, 'focusing')) && !(await mapHas(page, 'storying')))
    await page.getByRole('button', { name: 'Stop following' }).click(); await sleep(800)
    ok(`letting go brings the story back @ ${name}`, (await mapHas(page, 'storying')) && !(await mapHas(page, 'focusing')))
  } else {
    // The card takes the first Escape, the story the next.
    await page.keyboard.press('Escape'); await sleep(300)
    ok(`the first Escape closes the card, the story stays @ ${name}`, (await page.locator('.chronicle-card').count()) === 0 && (await mapHas(page, 'storying')))
  }
  await page.keyboard.press('Escape'); await sleep(600)
  faces = await faceLooks(page)
  // Nobody at the story's 0.3 any more (a face the map shows as unsure keeps its own half ink).
  ok(`Escape gives everyone back @ ${name}`, !(await mapHas(page, 'storying')) && faces.length > 0 && faces.every((f) => f.opacity > 0.31), `${faces.filter((f) => f.opacity <= 0.31).length} of ${faces.length} still quiet`)
  ok(`no script error @ story ${name}`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// Settings > Map, the owner's own tab: two switches (the shapes, the words) and who sees them. The map's own pages
// carry no switch any more.
/** Settings opened from the map, on the Map tab. */
async function mapTab(page) {
  await page.getByRole('button', { name: /^Settings/ }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: /^Map$/ }).click()
  await dialog.getByRole('switch', { name: 'History on the map' }).waitFor({ timeout: 10000 })
  await sleep(300)
  return dialog
}
const closeDialog = async (page) => { await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 5000 }); await sleep(800) }
/** Flips a switch on the tab to the state wanted and waits for the server's answer. */
async function flip(page, dialog, name, on) {
  const sw = dialog.getByRole('switch', { name })
  if ((await sw.getAttribute('aria-checked')) === String(on)) return
  const answered = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/v1\/chronicle$/.test(r.url()))
  await sw.click()
  await answered
  await sleep(300)
}
const shapesCanvas = (page) => page.locator('.leaflet-chronicle-pane canvas').count()
/** What of the chronicle the map shows now. */
const chronicleShown = async (page) => ({ marks: await page.locator('.map-era').count(), chip: await page.locator('.map-era-chip').count(), page: await page.locator('aside.chronicle, .chronicle-tab').count(), canvas: await shapesCanvas(page) })
/** Whether any script the page loaded holds the chronicle's own code (its card, its front page, its canvas). */
const chronicleCodeLoaded = (page) => page.evaluate(async () => {
  const urls = [...new Set(performance.getEntriesByType('resource').map((r) => r.name).filter((u) => /\.js(\?|$)/.test(u)))]
  const texts = await Promise.all(urls.map((u) => fetch(u).then((r) => r.text()).catch(() => '')))
  return texts.some((s) => s.includes('chronicle-close') || s.includes('letter-spacing:.18em'))
})

for (const size of [{ width: 1440, height: 900 }, PHONES['phone-375']]) {
  const name = `${size.width}x${size.height}`
  const { page, ctx, errors } = await open(br, size)
  await mapAt(page, 1948)
  ok(`the map's pages carry no switch any more @ ${name}`, (await page.locator('.chronicle-show, .chronicle-switch-row').count()) === 0)
  const dialog = await mapTab(page)
  const history = dialog.getByRole('switch', { name: 'History on the map' }), words = dialog.getByRole('switch', { name: 'Chronicle' })
  ok(`the owner has a Map tab with both switches on @ ${name}`, (await history.getAttribute('aria-checked')) === 'true' && (await words.getAttribute('aria-checked')) === 'true')
  ok(`each switch says what it adds and that agents fill it @ ${name}`, /through the API/.test(await history.locator('xpath=ancestor::label[1]').innerText()) && /through the API/.test(await words.locator('xpath=ancestor::label[1]').innerText()))
  const radios = dialog.getByRole('radiogroup', { name: 'Who sees it' }).getByRole('radio')
  ok(`who sees it is a choice of two, "Everyone with access" chosen @ ${name}`, (await radios.count()) === 2 && (await dialog.getByRole('radio', { name: /^Everyone with access/ }).getAttribute('aria-checked')) === 'true')
  const wide = await page.evaluate(() => { const d = document.querySelector('[role="dialog"]'); return { page: document.documentElement.scrollWidth - innerWidth, dialog: d ? d.scrollWidth - d.clientWidth : 0 } })
  ok(`nothing on the tab is wider than the screen @ ${name}`, wide.page <= 1 && wide.dialog <= 1, JSON.stringify(wide))
  if (size.width < 640) {
    const box1 = await history.boundingBox(), row = await dialog.getByRole('radio', { name: /^Only you/ }).boundingBox()
    ok(`the switch row and the choices are a finger's size @ ${name}`, (await history.locator('xpath=ancestor::label[1]').boundingBox()).height >= 40 && row.height >= 44, JSON.stringify({ box1, row }))
  }
  await shot(page, `settings-map-${name}`)
  // Both off: who sees it goes, since there is nothing to see.
  await flip(page, dialog, 'Chronicle', false)
  await flip(page, dialog, 'History on the map', false)
  ok(`with both off the choice of who sees it goes @ ${name}`, (await dialog.getByRole('radiogroup').count()) === 0)
  await shot(page, `settings-map-off-${name}`)
  await closeDialog(page)
  let now = await chronicleShown(page)
  ok(`switched off, the map has no marks, no chip, no page and no shapes @ ${name}`, Object.values(now).every((n) => n === 0), JSON.stringify(now))
  // One at a time: the shapes alone, then the words alone.
  await flip(page, await mapTab(page), 'History on the map', true)
  await closeDialog(page)
  await page.locator('.leaflet-chronicle-pane canvas').waitFor({ state: 'attached', timeout: 15000 }).catch(() => {})
  now = await chronicleShown(page)
  ok(`the history alone: shapes on the map, no marks, chip or page @ ${name}`, now.canvas === 1 && now.marks + now.chip + now.page === 0, JSON.stringify(now))
  const dialog2 = await mapTab(page)
  await flip(page, dialog2, 'History on the map', false)
  await flip(page, dialog2, 'Chronicle', true)
  await closeDialog(page)
  await page.locator('.map-era').first().waitFor({ state: 'attached', timeout: 15000 }).catch(() => {})
  now = await chronicleShown(page)
  ok(`the chronicle alone: marks and the chip, no shapes @ ${name}`, now.canvas === 0 && now.marks === 3 && now.chip === 1 && (size.width < 1100 || now.page === 1), JSON.stringify(now))
  // Both on again: everything is back.
  await flip(page, await mapTab(page), 'History on the map', true)
  await closeDialog(page)
  await page.locator('.leaflet-chronicle-pane canvas').waitFor({ state: 'attached', timeout: 15000 }).catch(() => {})
  now = await chronicleShown(page)
  ok(`switched on again, the marks, the chip and the shapes come back @ ${name}`, now.canvas === 1 && now.marks === 3 && now.chip === 1, JSON.stringify(now))
  await page.locator('.map-era-chip').click(); await sleep(500)
  ok(`and the entry opens again @ ${name}`, size.width >= 1100 ? (await page.locator('aside.chronicle').count()) === 1 : (await page.locator('.chronicle-card').count()) === 1)
  ok(`no script error @ settings map ${name}`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// Off means off: a map opened with both switches off asks for no entry and no shape, and loads none of the chronicle's
// code. The same map with them on does all three, so the probe is known to see it.
{
  const set = (json) => fetch(`${O}/api/v1/chronicle`, { method: 'PUT', headers: { origin: O, cookie: COOKIE, 'content-type': 'application/json' }, body: JSON.stringify(json) })
  for (const on of [false, true]) {
    ok(`the switches are set ${on ? 'on' : 'off'} through the API`, (await set({ history: on, chronicle: on })).ok)
    const { page, ctx, errors } = await open(br, { width: 1440, height: 900 })
    const asked = []
    page.on('request', (r) => { if (/\/api\/v1\/chronicle(\/[^/]+\/shape)?(\?|$)/.test(r.url())) asked.push(r.url()) })
    await page.goto(`${O}/?view=map&y=1948`)
    await page.locator('.map-face').first().waitFor({ state: 'attached', timeout: 60000 }); await sleep(2500)
    const code = await chronicleCodeLoaded(page)
    if (!on) ok('both off: the map asks for no entry and no shape, and loads no chronicle code', asked.length === 0 && !code, JSON.stringify({ asked, code }))
    else ok('both on: the map asks for the entries and the shapes, and loads the chronicle code', asked.length > 1 && code, JSON.stringify({ asked: asked.length, code }))
    ok(`no script error @ off means off (${on ? 'on' : 'off'})`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
}

// Only the owner has the tab.
{
  const token = (await (await fetch(`${O}/api/v1/shares`, { method: 'POST', headers: { origin: O, cookie: COOKIE, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Tab check' }) })).json()).token
  const ctx = await br.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' })
  await ctx.addInitScript(() => { try { localStorage.setItem('folkbranch-tour', '1') } catch {} })
  const page = await ctx.newPage()
  await page.goto(`${O}/share/${token}`)
  await page.evaluate(async (token) => fetch('/api/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) }), token)
  await page.goto(`${O}/?view=map&y=1948`)
  await page.locator('.map-face').first().waitFor({ state: 'attached', timeout: 60000 }); await sleep(800)
  const settings = page.getByRole('button', { name: /^Settings/ })
  if (await settings.count()) {
    await settings.first().click()
    await page.getByRole('dialog').getByRole('navigation', { name: 'Settings' }).waitFor({ timeout: 10000 })
    ok('a reader has no Map tab in Settings', (await page.getByRole('dialog').getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: /^Map$/ }).count()) === 0)
    await shot(page, 'settings-reader-1440x900')
  } else ok('a reader has no Map tab in Settings (no settings at all through a link)', true)
  // Signed in as an editor, through an invitation.
  const invite = await (await fetch(`${O}/api/v1/invites`, { method: 'POST', headers: { origin: O, cookie: COOKIE, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Edith Tabs', role: 'editor' }) })).json()
  const ed = await br.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' })
  await ed.addInitScript(() => { try { localStorage.setItem('folkbranch-tour', '1') } catch {} })
  const ep = await ed.newPage()
  await ep.goto(`${O}/invite/${invite.token}`)
  await ep.getByRole('button', { name: 'Accept invitation' }).click()
  await ep.locator('.pcard').first().waitFor({ timeout: 60000 })
  const me = await ep.evaluate(async () => (await fetch('/api/v1/me')).json().catch(() => null))
  if (me?.role === 'editor') {
    await ep.getByRole('button', { name: /^Settings/ }).first().click()
    const nav = ep.getByRole('dialog').getByRole('navigation', { name: 'Settings' })
    await nav.waitFor({ timeout: 10000 })
    ok('an editor has no Map tab in Settings', (await nav.getByRole('button', { name: /^Map$/ }).count()) === 0)
  } else ok('an editor could be signed in for the tab check', false, JSON.stringify(me))
  await ed.close(); await ctx.close()
}

// Who sees it, from Settings > Map. With the chronicle on owner-only, a reader through a share link gets nothing of it:
// no chip, no tab, no era mark, and the page never asks for a shape. The owner flips it, and the same reader sees it all.
{
  const owner = await open(br, { width: 1440, height: 900 })
  await mapAt(owner.page, 1948)
  let dialog = await mapTab(owner.page)
  await dialog.getByRole('radio', { name: /^Only you/ }).click(); await sleep(800)
  ok('"Only you" is chosen', (await dialog.getByRole('radio', { name: /^Only you/ }).getAttribute('aria-checked')) === 'true')
  await shot(owner.page, 'settings-map-only-you-1440x900')
  await closeDialog(owner.page)
  ok('only the owner sees it: the masthead carries the small eye', (await owner.page.locator('aside.chronicle .chronicle-label .chronicle-draft').count()) === 1)
  await shot(owner.page, 'chronicle-owner-only-1440x900')
  const token = (await owner.page.evaluate(async () => (await fetch('/api/v1/shares', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Neighbour' }) })).json())).token
  ok('the owner makes a share link', typeof token === 'string' && token.length > 10)

  const ctx = await br.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' })
  await ctx.addInitScript(() => { try { localStorage.setItem('folkbranch-tour', '1') } catch {} })
  const page = await ctx.newPage()
  const errors = [], shapes = [], lists = []
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)))
  page.on('request', (r) => { if (/\/api\/v1\/chronicle\/[^/]+\/shape/.test(r.url())) shapes.push(r.url()); if (/\/api\/v1\/chronicle(\?|$)/.test(r.url())) lists.push(r.url()) })
  await page.goto(`${O}/share/${token}`)
  ok('the link opens for the reader', (await page.evaluate(async (token) => (await fetch('/api/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })).status, token)) === 200)
  const readerMap = async () => {
    await page.goto(`${O}/?view=map&y=1948`)
    await page.locator('.map-face').first().waitFor({ state: 'attached', timeout: 60000 }); await sleep(1500)
  }
  await readerMap()
  const switches = await page.evaluate(async () => (await fetch('/api/v1/chronicle/switches')).json())
  ok('owner-only: the reader is told both are off, and not who sees it', switches.history === false && switches.chronicle === false && !('show' in switches), JSON.stringify(switches))
  const nothing = { chip: await page.locator('.map-era-chip').count(), tab: await page.locator('.chronicle-tab').count(), page: await page.locator('aside.chronicle').count(), marks: await page.locator('.map-era').count(), shapes: shapes.length, lists: lists.length }
  ok('owner-only: no chip, no tab, no page, no era mark, no list or shape asked for', Object.values(nothing).every((n) => n === 0), JSON.stringify(nothing))
  await shot(page, 'chronicle-reader-hidden-1440x900')

  dialog = await mapTab(owner.page)
  await dialog.getByRole('radio', { name: /^Everyone with access/ }).click(); await sleep(800)
  await closeDialog(owner.page)
  ok('shown to everyone, the small eye goes', (await owner.page.locator('.chronicle-draft').count()) === 0)
  const listed = page.waitForResponse((r) => /\/api\/v1\/chronicle(\?|$)/.test(r.url()), { timeout: 30000 })
  await readerMap()
  const list = await (await listed).json()
  await page.locator('.map-era').first().waitFor({ state: 'attached', timeout: 20000 }); await sleep(800)
  ok('flipped: the reader is sent the entries, without who sees it', list.entries.length === 3 && !('show' in list), `${list.entries?.length} entries`)
  ok('flipped: the era marks and the chip appear', (await page.locator('.map-era').count()) === 3 && /northern quarantine/i.test(await chipText(page)))
  ok('flipped: the front page stands', (await page.locator('aside.chronicle').count()) === 1)
  ok('flipped: the shapes are asked for', shapes.length > 0, `${shapes.length} requests`)
  await shot(page, 'chronicle-reader-shown-1440x900')
  ok('no script error @ reader', errors.length === 0 && owner.errors.length === 0, [...errors, ...owner.errors].join(' | '))
  await ctx.close(); await owner.ctx.close()
}

// A front moves: through the quarantine's stages its zone covers more of the map a little at a time. A cross-fade would
// paint each next stage whole from its first moment, only faintly, so the covered area would jump once a stage.
// Opened twice, so the second opening is a returning reader's, with the app's service worker in charge of its files.
{
  const { page, ctx, errors } = await open(br, { width: 1440, height: 900 })
  await mapAt(page, 1947)
  await mapAt(page, 1947)
  // The headline frames the entry and lets the camera go, so the map stands still while it plays.
  await page.locator('aside.chronicle article h3 button').first().click(); await sleep(1500)
  /** Pixels of the advancing zone (ink-grey, not the rust of the province around it) on the chronicle's canvas. */
  const covered = () => page.evaluate(() => {
    const c = document.querySelector('.leaflet-chronicle-pane canvas')
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] >= 6 && d[i] - d[i + 2] < 50) n++
    return n
  })
  const start = await covered()
  await page.locator('.map-controls button[aria-label="Play"]').click()
  const seen = [start]
  while ((await year(page)) < 1950 && seen.length < 400) { await sleep(60); seen.push(await covered()) }
  await page.locator('.map-controls button[aria-label="Pause"]').click().catch(() => {})
  const total = Math.max(...seen) - start
  const jumps = seen.slice(1).map((n, i) => n - seen[i])
  const biggest = Math.max(...jumps), backs = Math.min(...jumps), steps = jumps.filter((j) => j > total * 0.005).length
  ok('the zone grows as the front moves', total > 0 && seen.at(-1) > start, `${start} → ${seen.at(-1)} px over ${seen.length} looks`)
  ok('it never shrinks on the way (a growing front)', backs >= -total * 0.02, `largest step back ${backs} px of ${total}`)
  ok('it grows a little at a time, not a stage at once', biggest < total * 0.15 && steps >= 8, `largest step ${biggest} px of ${total}, ${steps} steps`)
  await shot(page, 'chronicle-front-moving-1440')
  ok('no script error @ moving front', errors.length === 0, errors.join(' | '))
  await ctx.close()
}
await br.close()
finish()
