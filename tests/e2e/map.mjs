// The family on a map through time, on the invented demo family: the tree-or-map switch, the year slider and its keys, Play and
// Pause, stepping through events, a person's route, who is here, a phone's bars, nothing asked of another server, and
// a reader who sees no living relative on it.
// FG_URL=http://localhost:3417 node tests/e2e/map.mjs runs it against a `pnpm dev` that holds the English demo family
// instead of a container (dev signs the owner in by itself on this computer).
import { chromium } from 'playwright-core'
import { IMAGE, sh, sleep, waitUp } from './lib.mjs'

const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' · ' + x : ''}`); if (!c) process.exitCode = 1 }
const O = process.env.FG_URL ?? 'http://localhost:3447'
let cookie = process.env.FG_COOKIE ?? ''
if (!process.env.FG_URL) {
  try { sh('docker rm -fv fg-map') } catch {}
  sh(`docker run -d --name fg-map -p 127.0.0.1:3447:3000 -e BETTER_AUTH_URL=${O} -e SETUP_TOKEN=x ${IMAGE}`)
  await waitUp(O)
  const r = await fetch(O + '/api/auth/family/setup', { method: 'POST', headers: { 'content-type': 'application/json', origin: O }, body: JSON.stringify({ name: 'Ann', familyName: 'Woods', language: 'en', demo: true, code: 'x' }) })
  cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
}

const br = await chromium.launch({ channel: 'chrome', headless: true })
const errs = [], outside = []
const session = async (name, viewport = { width: 1440, height: 900 }) => {
  const phone = viewport.width < 600
  const c = await br.newContext({ viewport, isMobile: phone, hasTouch: phone, locale: 'en-GB' })
  if (cookie && name === 'owner') await c.addCookies(cookie.split('; ').map((x) => ({ name: x.split('=')[0], value: x.slice(x.indexOf('=') + 1), domain: new URL(O).hostname, path: '/', httpOnly: true })))
  // Every request the page makes, to anywhere but this server: the map must make none.
  c.on('request', (r) => { const u = r.url(); if (!/^(data|blob|about):/.test(u) && new URL(u).origin !== O) outside.push(`${name}: ${u.slice(0, 120)}`) })
  const p = await c.newPage()
  p.on('pageerror', (e) => errs.push(`${name}: ${e.message.slice(0, 160)}`))
  return p
}
const track = (p) => p.locator('.map-track[role=slider]')
const now = async (p) => Number(await track(p).getAttribute('aria-valuenow'))
const faces = (p) => p.locator('.map-face-in[role=button]')
/** A press on the track at the start of a year, as a hand would. */
const pressYear = async (p, y) => {
  const at = await p.evaluate((y) => {
    const t = document.querySelector('.map-track'), line = t.querySelector('.map-line').getBoundingClientRect()
    const min = +t.getAttribute('aria-valuemin'), max = +t.getAttribute('aria-valuemax')
    return { x: line.left + ((y - min + 0.02) / (max - min + 1)) * line.width, y: line.top + 1 }
  }, y)
  await p.mouse.click(at.x, at.y); await p.mouse.move(5, 300); await sleep(1200)
}
/** The names of the faces drawn now (a stack's lower faces are hidden). */
const shownFaces = async (p) => [...new Set(await faces(p).evaluateAll((els) => els.filter((e) => !e.closest('.hidden-face')).map((e) => e.getAttribute('aria-label'))))]
/** A press on a face: the button itself has no size, its picture does. */
const pressFace = async (p, label) => {
  const at = await p.evaluate((label) => {
    const el = [...document.querySelectorAll('.map-face-in[role=button]')].find((e) => e.getAttribute('aria-label') === label && !e.closest('.hidden-face'))
    const r = el.querySelector('img').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, label)
  await p.mouse.click(at.x, at.y)
}
const openMap = async (p) => {
  await p.getByRole('radio', { name: 'Map', exact: true }).click()
  await p.locator('.family-map canvas').first().waitFor({ state: 'attached', timeout: 30000 })
  await faces(p).first().waitFor({ state: 'attached', timeout: 30000 }); await sleep(1500)
}

// The owner opens the map from the main bar.
const A = await session('owner')
if (process.env.FG_URL) await A.goto(O + '/api/auth/family/local')
await A.goto(O + '/'); await A.locator('.pcard').first().waitFor({ timeout: 30000 }); await sleep(600)
const graph = await A.evaluate(async () => (await fetch('/api/v1/graph')).json())
const fullName = (p) => [p.givenName, p.surname].filter(Boolean).join(' ')
const living = graph.persons.filter((p) => p.living).map(fullName)
ok('the demo family has living relatives to hide', living.length > 0, `${living.length} of ${graph.persons.length}`)
const atlas = []
A.on('request', (r) => { if (r.url().includes('/atlas/')) atlas.push(new URL(r.url()).pathname) })
await openMap(A)
ok('the switch opens the map and keeps it in the address', A.url().includes('view=map'))
ok('the base map comes from this server', ['land', 'borders', 'labels'].every((f) => atlas.includes(`/atlas/${f}.json`)), atlas.join(' '))
const min = Number(await track(A).getAttribute('aria-valuemin')), max = Number(await track(A).getAttribute('aria-valuemax'))
ok('the slider spans the family', min <= 1890 && max >= 1980, `${min}–${max}`)
await pressYear(A, 1925)
ok('a press on the track moves the year', (await now(A)) === 1925, String(await now(A)))
ok('the family stands on the map', (await faces(A).count()) >= 5, `${await faces(A).count()} faces in 1925`)
ok('exactly one face is a keyboard stop', (await A.locator('.map-face-in[role=button][tabindex="0"]').count()) === 1)

// The keys move the year: one with the arrows, ten with Page Up, the ends with Home and End.
await track(A).focus()
const y0 = await now(A)
await A.keyboard.press('ArrowRight'); await sleep(200)
ok('→ is one year on', (await now(A)) === y0 + 1)
await A.keyboard.press('ArrowLeft'); await A.keyboard.press('PageUp'); await sleep(200)
ok('Page Up is ten years on', (await now(A)) === y0 + 10)
await A.keyboard.press('End'); await sleep(200)
ok('End is the last year', (await now(A)) === max)
await A.keyboard.press('Home'); await sleep(600)
ok('Home is the first year', (await now(A)) === min)
ok('the year is told to a screen reader', /\d{4}/.test(await A.locator('.map-bar [aria-live]').innerText()))

// Play runs the years on, Pause stops them.
await A.getByRole('button', { name: 'Play', exact: true }).click(); await sleep(2500)
const playing = await now(A)
ok('Play runs the years on', playing > min, `${min} → ${playing}`)
await A.getByRole('button', { name: 'Pause', exact: true }).click(); await sleep(400)
const paused = await now(A); await sleep(1500)
ok('Pause stops them', (await now(A)) === paused && (await A.getByRole('button', { name: 'Play', exact: true }).count()) === 1, String(paused))
await A.getByRole('button', { name: 'Speed: 1×' }).click()
ok('the speed changes', (await A.getByRole('button', { name: 'Speed: 2×' }).count()) === 1)

// Next event jumps to the next year something happened, and says what.
await track(A).focus(); await A.keyboard.press('Home'); await sleep(400)
const before = await now(A)
await A.getByRole('button', { name: 'Next event' }).click(); await sleep(800)
const caption = (await A.locator('.map-caption').innerText()).trim()
ok('Next event steps forward', (await now(A)) > before, `${before} → ${await now(A)}`)
ok('and the caption says what happened', caption.length > 8, caption.slice(0, 80))
const first = await now(A)
ok('there is no event before the first', await A.getByRole('button', { name: 'Previous event' }).isDisabled())
await A.getByRole('button', { name: 'Next event' }).click(); await sleep(800)
const second = await now(A)
await A.getByRole('button', { name: 'Previous event' }).click(); await sleep(800)
ok('Previous event steps back to it', second > first && (await now(A)) === first, `${second} → ${await now(A)}`)

// Who is here: zoomed out by hand, the towns' people stand in stacks, and a stack's card lists them.
await pressYear(A, 1925)
for (let i = 0; i < 3; i++) { await A.getByRole('button', { name: 'Zoom out', exact: true }).click(); await sleep(700) }
await sleep(600)
ok('a move by hand stops following, and offers it back', (await A.getByRole('button', { name: 'Follow' }).count()) === 1)
const stack = (await shownFaces(A)).find((l) => /: \d+ people, /.test(l))
ok('several people stand together in a town', !!stack, stack ?? '')
if (stack) {
  await pressFace(A, stack); await sleep(500)
  const card = A.locator('.map-place[role=dialog]')
  const rows = await card.locator('li button').allInnerTexts()
  const named = stack.split(/people, /)[1].replace(/ \+\d+$/, '').split(', ')
  ok('the place card lists who is there', (await card.count()) === 1 && rows.length === Number(stack.match(/: (\d+) people/)[1]), `${rows.length} rows`)
  ok('by the names on the stack, with since when', named.every((n) => rows.some((r) => r.includes(n))) && rows.every((r) => /since \d{4}/.test(r)), rows.join(' | ').replace(/\s+/g, ' ').slice(0, 120))
  await A.keyboard.press('Escape'); await sleep(300)
  ok('Escape closes it', (await card.count()) === 0)
}
await A.getByRole('button', { name: 'Follow' }).click(); await sleep(1500)

// Picking a person shows their whole life as a numbered route.
let route = 0, who = ''
for (const label of (await shownFaces(A)).filter((l) => !/ people, /.test(l))) {
  await pressFace(A, label); await sleep(1500)
  route = await A.locator('.map-stop-in').count()
  who = label
  if (route >= 2) break
}
ok('a person picked opens their card', (await A.locator('aside.panel').count()) === 1, who)
ok('and their route is drawn with numbered stops', route >= 2 && (await A.locator('.map-stop-in b').first().innerText()) === '1', `${route} stops`)
ok('the person followed is marked', (await A.locator('.map-face-in.focused').count()) === 1)
await A.screenshot({ path: '/tmp/family-map-route.png' })

ok('nothing was asked of another server', outside.length === 0, outside.slice(0, 3).join(' '))

// On a phone the year bar stands clear of the main bar at the bottom.
const P = await session('owner', { width: 390, height: 844 })
if (process.env.FG_URL) await P.goto(O + '/api/auth/family/local')
await P.goto(O + '/'); await P.locator('.pcard').first().waitFor({ timeout: 30000 }); await sleep(600)
await openMap(P)
const [bar, menu] = await P.evaluate(() => ['.map-bar', '.main-bar'].map((s) => document.querySelector(s).getBoundingClientRect().toJSON()))
ok('on a phone the year bar is clear of the main bar', bar.bottom <= menu.top || menu.bottom <= bar.top, `bar ${Math.round(bar.top)}–${Math.round(bar.bottom)}, menu ${Math.round(menu.top)}–${Math.round(menu.bottom)}`)
ok('and of the screen\'s edges', bar.left >= 0 && bar.right <= 390 && (await P.evaluate(() => document.documentElement.scrollWidth)) <= 390)
await P.screenshot({ path: '/tmp/family-map-phone.png' })

// A line of descent: from an ancestor down to "you". The owner says which card is theirs.
const byId = new Map(graph.persons.map((p) => [p.id, p]))
const parentsOf = (id) => graph.parentChild.filter((l) => l.childId === id).map((l) => l.parentId)
const ancestors = (id, seen = new Set()) => { for (const p of parentsOf(id)) if (!seen.has(p)) { seen.add(p); ancestors(p, seen) } return seen }
const depth = (id) => Math.max(0, ...parentsOf(id).map((p) => 1 + depth(p)))
// "You": among the deepest descendants whose own parent is living (so a reader's line runs through someone hidden),
// the one whose forebears' lives are best written: the line that travels.
const written = (id) => [...ancestors(id)].reduce((n, a) => n + byId.get(a).facts.length, 0)
const me = graph.persons.filter((p) => parentsOf(p.id).some((x) => byId.get(x).living)).sort((a, b) => depth(b.id) - depth(a.id) || written(b.id) - written(a.id))[0]
let top = me.id
while (parentsOf(top).length) top = parentsOf(top).find((x) => depth(x) === depth(top) - 1) ?? parentsOf(top)[0]
const stranger = graph.persons.find((p) => !p.living && p.id !== top && !ancestors(me.id).has(p.id) && p.birthPlace)
ok(`the demo family has a line of ${depth(me.id) + 1} generations`, depth(me.id) >= 3, `${fullName(byId.get(top))} → ${fullName(me)}`)
await A.evaluate(async (personId) => fetch('/api/v1/me', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ personId }) }), me.id)
const lineRadio = (p) => p.getByRole('radio', { name: 'Line to you' })
await A.goto(`${O}/?view=map&p=${stranger.id}`); await faces(A).first().waitFor({ state: 'attached', timeout: 30000 }); await sleep(2000)
ok('someone who is not your ancestor is followed for their own life only', (await A.locator('.map-chip').count()) === 1 && (await lineRadio(A).count()) === 0, fullName(stranger))
await A.goto(`${O}/?view=map&p=${top}`); await faces(A).first().waitFor({ state: 'attached', timeout: 30000 }); await sleep(2000)
ok('an ancestor offers the line to you', (await lineRadio(A).count()) === 1)
await lineRadio(A).click(); await sleep(2500)
ok('choosing it puts the line in the address', new URL(A.url()).searchParams.get('line') === top, A.url().replace(O, ''))
const lineUrl = A.url()
await A.goto(lineUrl); await faces(A).first().waitFor({ state: 'attached', timeout: 30000 }); await sleep(2500)
ok('a cold load opens the same line', (await lineRadio(A).getAttribute('aria-checked')) === 'true')
const chip = (await A.locator('.map-chip').getAttribute('aria-label')) + ' · ' + (await A.locator('.map-chip').innerText()).replace(/\s+/g, ' ')
ok('the chip says whose line it is and how long', chip.includes(`${fullName(byId.get(top))} → you`) && /\d+ generations/.test(chip), chip.slice(0, 140))
const gens = (await A.locator('.map-stop-in.map-gen b').allInnerTexts()).flatMap((x) => x.split(/\D+/).filter(Boolean).map(Number)).sort((a, b) => a - b)
ok('each generation hands over at a numbered mark (one mark a town)', gens.length === depth(me.id) + 1 && gens.every((n, i) => n === i + 1), gens.join(' '))
await track(A).focus(); await A.keyboard.press('Home'); await sleep(500)
const steps = []
for (let i = 0; i < 40 && !(await A.getByRole('button', { name: 'Next event' }).isDisabled()); i++) {
  await A.getByRole('button', { name: 'Next event' }).click(); await sleep(450)
  steps.push([await now(A), (await A.locator('.map-caption').innerText()).trim()])
}
const child = graph.persons.find((p) => parentsOf(p.id).includes(top) && ancestors(me.id).has(p.id))
const handover = steps.findIndex(([, c]) => c.includes(`Birth · ${fullName(child)}`))
ok('next event steps across a handover, and the caption names the next in line', handover >= 0, steps[handover]?.join(' ') ?? steps.map((x) => x[1]).join(' | ').slice(0, 160))
if (handover > 0) {
  while ((await now(A)) > steps[handover][0]) { await A.getByRole('button', { name: 'Previous event' }).click(); await sleep(400) }
  await A.getByRole('button', { name: 'Previous event' }).click(); await sleep(450)
  ok('and previous steps back over it', (await now(A)) === steps[handover - 1][0], `${steps[handover][0]} → ${await now(A)}`)
}
await A.screenshot({ path: '/tmp/family-map-line.png' })

// A reader sees the map with the living left out, as on the chart.
const token = (await A.evaluate(async () => (await fetch('/api/v1/invites', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Cousin', role: 'reader' }) })).json())).token
const R = await session('reader')
await R.goto(`${O}/invite/${token}`)
await R.getByRole('button', { name: 'Accept invitation' }).click()
await R.locator('.pcard').first().waitFor({ timeout: 30000 }); await sleep(600)
await openMap(R)
const seen = []
for (let y = min; y <= max; y += 10) {
  await pressYear(R, y)
  seen.push(...await faces(R).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') + ' ' + e.textContent)))
}
await R.locator('.map-gaps > button').click().catch(() => {}); await sleep(300)
const text = seen.join('\n') + (await R.locator('body').innerText())
const shown = living.filter((n) => text.includes(n))
ok('the reader sees the family on the map', seen.length > 0)
ok('but no living relative, in any year or list', shown.length === 0, shown.join(', '))
// Nor where and when someone shown married someone hidden: followed, that person has no such stop.
const mixed = graph.unions.filter((u) => u.place && u.startDate && byId.get(u.aId).living !== byId.get(u.bId).living)
ok('the demo family has a marriage to a living relative', mixed.length > 0)
for (const u of mixed) {
  const open = [u.aId, u.bId].find((id) => !byId.get(id).living)
  await R.goto(`${O}/?view=map&p=${open}`); await faces(R).first().waitFor({ state: 'attached', timeout: 30000 }); await sleep(2000)
  await R.locator('aside.panel').waitFor({ timeout: 15000 }).catch(() => {})
  const told = []
  await track(R).focus(); await R.keyboard.press('Home'); await sleep(400)
  for (let i = 0; i < 30 && !(await R.getByRole('button', { name: 'Next event' }).isDisabled()); i++) {
    await R.getByRole('button', { name: 'Next event' }).click(); await sleep(500)
    told.push(await R.locator('.map-caption').innerText())
  }
  const wed = told.filter((c) => c.includes(u.place) && /Marriage|Partnership/.test(c))
  ok(`a reader following ${fullName(byId.get(open))} sees no marriage to a hidden partner`, told.length > 0 && wed.length === 0, wed.join(' | ') || `${told.length} events`)
}

// A reader whose card is "you" follows a line that runs through a hidden parent: nothing of that parent shows.
const everything = (p) => p.evaluate(() => [document.body.innerText, ...[...document.querySelectorAll('*')].flatMap((e) => ['aria-label', 'title', 'aria-valuetext', 'alt'].map((a) => e.getAttribute(a) ?? '')), ...[...document.querySelectorAll('.map-face-in, .map-stop-in, .map-band-name, .map-chip, [aria-live]')].map((e) => e.textContent)].join('\n'))
const hiddenFrom = (self) => graph.persons.filter((p) => p.living && p.id !== self)
const leaks = (text, self) => hiddenFrom(self).flatMap((p) => [fullName(p), p.givenName]).filter((n) => new RegExp(`\\b${n}\\b`).test(text))
const readerAs = async (personId, name) => {
  const tok = (await A.evaluate(async (b) => (await fetch('/api/v1/invites', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json(), { name, role: 'reader', personId })).token
  const r = await session(name)
  await r.goto(`${O}/invite/${tok}`); await r.getByRole('button', { name: 'Accept invitation' }).click()
  await r.locator('.pcard').first().waitFor({ timeout: 30000 }); await sleep(600)
  return r
}
const walk = async (p) => {
  let text = await everything(p)
  await p.locator('.map-chip-gaps').click().catch(() => {}); await sleep(300); text += await everything(p)
  await track(p).focus(); await p.keyboard.press('Home'); await sleep(400)
  for (let i = 0; i < 40 && !(await p.getByRole('button', { name: 'Next event' }).isDisabled()); i++) { await p.getByRole('button', { name: 'Next event' }).click(); await sleep(350); text += await everything(p) }
  return text
}
const hiddenParent = parentsOf(me.id).find((x) => byId.get(x).living)
const inLine = [...ancestors(me.id)].filter((x) => ancestors(x).has(top) || x === top)
const R2 = await readerAs(me.id, 'Grandchild')
await R2.goto(`${O}/?view=map&p=${top}`); await faces(R2).first().waitFor({ state: 'attached', timeout: 30000 }); await sleep(2000)
ok('a reader is offered the line to them', (await lineRadio(R2).count()) === 1)
await lineRadio(R2).click().catch(() => {}); await sleep(2500)
ok('it opens', new URL(R2.url()).searchParams.get('line') === top)
const middle = leaks(await walk(R2), me.id)
ok(`no name, mark, band, caption, list or label shows the hidden ${inLine.some((x) => byId.get(x).living) ? 'bearers' : 'parent'} in the line`, middle.length === 0, middle.join(', ') || `hidden in line: ${inLine.filter((x) => byId.get(x).living).length}`)
// The line from a hidden parent, by address: still nothing of them.
await R2.goto(`${O}/?view=map&p=${hiddenParent}&line=${hiddenParent}`); await sleep(3500)
const fromHidden = leaks(await everything(R2), me.id)
ok('a line asked for from a hidden parent shows nothing of them', fromHidden.length === 0, fromHidden.join(', '))
// A line whose end is hidden: a reader with no card narrows the tree to a hidden person's ancestors, then follows the top ancestor.
const R3 = await readerAs(null, 'Neighbour')
await R3.goto(`${O}/?p=${hiddenParent}`); await R3.locator('.pcard').first().waitFor({ timeout: 30000 }); await sleep(800)
await R3.getByRole('button', { name: 'Who to show' }).click(); await sleep(300)
await R3.getByRole('button', { name: /^Ancestors/ }).click(); await sleep(800)
await openMap(R3)
await pressYear(R3, (byId.get(top).birthYear ?? min) + 5)
const topFace = (await shownFaces(R3)).find((l) => l.startsWith(fullName(byId.get(top))))
if (topFace) { await pressFace(R3, topFace); await sleep(2000) } else { await track(R3).focus(); await R3.keyboard.press('End') }
ok('a line to a hidden person is not offered', (await R3.getByRole('radio').filter({ hasText: /^Line/ }).count()) === 0, topFace ?? 'top ancestor not drawn')
const toHidden = leaks(await walk(R3), null)
ok('and nothing of them shows', toHidden.length === 0, toHidden.join(', '))

ok('nothing was asked of another server', outside.length === 0, outside.slice(0, 3).join(' '))
ok('no errors on the page', errs.length === 0, errs.slice(0, 3).join(' | '))
await br.close()
if (!process.env.FG_URL) try { sh('docker rm -fv fg-map') } catch {}
