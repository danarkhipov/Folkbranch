// Presses everything a person can press in an English archive, as each role, two levels deep, on a filled archive.
// The archive holds only English words, so any Russian on a screen, in a system dialog or in an answer is a missed translation.
// BUDGET_S is the time for each role: the default is a quick pass, 600 presses everything (about half an hour).
// FB_BASE points at a running empty server; otherwise a throwaway container is started. Calls no model and no outside service.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { IMAGE, sh, waitUp } from './lib.mjs'

const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' · ' + x : ''}`); if (!c) process.exitCode = 1 }
const SHOTS = process.env.SHOTS
const has = (s) => /[А-Яа-яЁё]/.test(s ?? '')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let B = process.env.FB_BASE
if (!B) {
  B = 'http://localhost:3454'
  try { sh('docker rm -fv fb-all') } catch {}
  sh(`docker run -d --name fb-all -p 127.0.0.1:3454:3000 -e BETTER_AUTH_URL=${B} -e SETUP_TOKEN=x ${IMAGE}`)
}
await waitUp(B, 180000)

// The archive, filled through the API.
const made = await fetch(`${B}/api/auth/family/setup`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ name: 'Ann', familyName: 'The Whitlocks', language: 'en', demo: true, code: 'x' }) })
if (!made.ok) throw new Error(`setup ${made.status}`)
const cookie = made.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
const call = async (method, path, json, extra = {}) => {
  const r = await fetch(`${B}/api/v1/${path}`, { method, headers: { cookie, origin: B, ...(json ? { 'content-type': 'application/json' } : {}), ...extra }, ...(json ? { body: JSON.stringify(json) } : {}) })
  if (!r.ok) console.log(`  seed: ${method} ${path} ${r.status} ${(await r.clone().text()).slice(0, 300)}`)
  return r.json().catch(() => ({}))
}
const graph = await call('GET', 'graph')
const stephen = graph.persons.find((p) => p.givenName === 'Stephen')
const alex = graph.persons.find((p) => p.givenName === 'Alex')
await call('PATCH', `persons/${stephen.id}`, {
  facts: [{ kind: 'Occupation', date: '1970', place: 'Portland', note: 'Shipyard', source: 'A letter' }],
  sources: [{ id: 's1', title: 'Parish register', ref: 'F. 1', page: '12', url: 'https://example.org/a', reliability: 'original' }, { id: 's2', title: 'Family account', ref: 'Told by Anne', page: '', url: '', reliability: 'witness' }],
  claims: [
    { id: 'c1', field: 'birthDate', value: '1946', sourceId: 's1', status: 'accepted', reason: '', at: 1 },
    { id: 'c2', field: 'birthDate', value: '1947', sourceId: 's2', status: 'possible', reason: '', at: 2 },
    { id: 'c3', field: 'birthPlace', value: 'Salem', sourceId: null, status: 'rejected', reason: 'a typo', at: 3 },
  ],
  tags: ['The Whitlocks'],
})
await call('POST', 'persons', { person: { givenName: 'Alex', surname: 'Whitlock', sex: 'M', birthDate: '1972', living: false } })
const photo = new FormData()
photo.append('file', new Blob([readFileSync(fileURLToPath(new URL('../fixtures/photo.jpg', import.meta.url)))], { type: 'image/jpeg' }), 'family.jpg')
photo.append('personId', stephen.id)
await fetch(`${B}/api/v1/media`, { method: 'POST', headers: { cookie, origin: B }, body: photo })
const story = new FormData()
story.append('story', JSON.stringify({ about: [stephen.id], title: 'The sail', body: 'He learned to sail.', tellerName: 'Anne' }))
await fetch(`${B}/api/v1/stories`, { method: 'POST', headers: { cookie, origin: B }, body: story }).then((r) => r.ok || console.log('  seed: story', r.status))
// A draft from an agent, waiting for review, so the review screen has lines.
const { token: robot } = await call('POST', 'tokens', { name: 'robot', role: 'editor', review: true })
const asRobot = (method, path, json) => fetch(`${B}/api/v1/${path}`, { method, headers: { authorization: `Bearer ${robot}`, 'content-type': 'application/json' }, body: JSON.stringify(json) })
await asRobot('POST', 'persons', { person: { givenName: 'Robin', surname: 'Whitlock', sex: 'M', birthDate: '1999', living: false } })
await asRobot('PATCH', `persons/${alex.id}`, { birthPlace: 'Salem' })
await call('POST', 'invites', { name: 'Waiting', role: 'reader' })

const found = new Map()
const note = (text, where) => { const key = text.trim().slice(0, 120); if (key && key !== 'Русский' && !found.has(key)) { found.set(key, where); console.log(`  RU [${where}] ${key}`) } }
const scan = async (page, where) => {
  const words = await page.evaluate(() => {
    const out = new Set()
    const cyr = /[А-Яа-яЁё]/
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    while (walk.nextNode()) {
      const el = walk.currentNode.parentElement
      if (el && !['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName) && cyr.test(walk.currentNode.textContent)) out.add(walk.currentNode.textContent)
    }
    for (const el of document.querySelectorAll('*')) {
      for (const a of ['title', 'aria-label', 'placeholder', 'alt', 'data-placeholder', 'aria-description']) if (cyr.test(el.getAttribute(a) ?? '')) out.add(`${a}: ${el.getAttribute(a)}`)
      if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && cyr.test(el.value)) out.add(`value: ${el.value}`)
    }
    return [...out]
  }).catch(() => [])
  for (const w of words) note(w, where)
}

const br = await chromium.launch({ channel: 'chrome', headless: true })
const errors = []
const session = async (name, { width = 1440, height = 900 } = {}) => {
  const ctx = await br.newContext({ locale: 'en-US', viewport: { width, height } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message.slice(0, 140)}`))
  page.on('dialog', async (d) => { if (has(d.message())) note(`system dialog: ${d.message()}`, name); await d.dismiss() })
  page.on('response', async (r) => {
    if (!r.url().includes('/api/') || r.url().includes('/api/events')) return
    const type = r.headers()['content-type'] ?? ''
    if (!type.includes('json') && !type.startsWith('text/')) return
    const body = await r.text().catch(() => '')
    const hit = body.match(/[^"\n]{0,50}[А-Яа-яЁё][^"\n]{0,50}/)
    if (hit) note(`answer ${r.url().replace(B, '').split('?')[0]}: ${hit[0]}`, name)
  })
  return page
}
const signIn = async (page, c) => {
  await page.context().addCookies(c.split('; ').map((x) => ({ name: x.split('=')[0], value: x.slice(x.indexOf('=') + 1), domain: new URL(B).hostname, path: '/', httpOnly: true })))
}
const chart = async (page) => { await page.goto(`${B}/`); await page.locator('.pcard').first().waitFor({ timeout: 30000 }); await sleep(250) }

// What can be pressed right now, and what must not be: leaving, destroying access, or going outside.
const SKIP = /cancel invit|log ?out|sign ?out|remove|revoke|take away|find faces|close (the )?(link|access)|accept|apply|reject all|restore|replace|^delete (the )?(key|archive)|make a copy|download|choose a copy|record|^stop/i
const pressable = (page, only) => page.evaluate((only) => {
  const out = []
  const cands = document.querySelectorAll('button, [role="tab"], [role="menuitem"], [role="radio"], [role="switch"], summary, [aria-haspopup]')
  const all = [...cands, ...[...document.querySelectorAll('main *, body > div *')].filter((e) => getComputedStyle(e).cursor === 'pointer' && !e.closest('button, a, summary, label, [role]') && !e.querySelector('button, a') && e.children.length < 3 && !e.closest('svg'))]
  const seen = new Set()
  const name = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50)
  for (const el of all) {
    if (seen.has(el)) continue
    seen.add(el)
    if (only && name(el) !== only) continue
    // Long windows and cards scroll: what is below their edge can be pressed too.
    if (el.closest('[role="dialog"], .panel, [data-radix-popper-content-wrapper]')) el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4 || r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight || el.disabled) continue
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    if (!hit || !(el === hit || el.contains(hit) || hit.contains(el))) continue
    out.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, label: name(el) })
    if (only) break
  }
  return out
}, only)
const settle = async (page) => { await sleep(260); await page.waitForLoadState('load').catch(() => {}) }
const budget = Number(process.env.BUDGET_S ?? 60) * 1000
const started = Date.now()
let deadline = started + budget
let presses = 0
const shot = async (page, where) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${where.replace(/\W+/g, '-').slice(0, 90)}.png` }).catch(() => {}) }

/** Opens a place, presses each thing in it from a fresh start, then each new thing that press revealed. */
async function explore(page, name, open) {
  await open()
  await settle(page)
  await scan(page, name)
  await shot(page, name)
  const first = (await pressable(page)).filter((t) => !SKIP.test(t.label))
  const known = new Set(first.map((t) => t.label))
  const labels = [...new Set(first.map((t) => t.label))]
  for (const label of labels) {
    if (Date.now() > deadline) return
    await open()
    await settle(page)
    const [target] = await pressable(page, label)
    if (!target) continue
    presses++
    await page.mouse.move(target.x, target.y)
    await sleep(40)
    await scan(page, `${name} > hover ${label}`)
    await page.mouse.click(target.x, target.y)
    await settle(page)
    await scan(page, `${name} > ${label}`)
    const where = `${name}-${label}`
    await shot(page, where)
    // One level further: what that press revealed.
    const revealed = [...new Set((await pressable(page)).filter((t) => !known.has(t.label) && !SKIP.test(t.label)).map((t) => t.label))].slice(0, 12)
    for (const inner of revealed) {
      if (/^(delete|save|add|create|send|ok|yes)\b/i.test(inner)) continue
      const [t2] = await pressable(page, inner)
      if (!t2) continue
      presses++
      await page.mouse.click(t2.x, t2.y)
      await settle(page)
      await scan(page, `${name} > ${label} > ${inner}`)
    }
  }
}

const walkArchive = async (page, role, hasEdit) => {
  deadline = Date.now() + budget
  const card = () => page.locator('.pcard').filter({ hasText: 'Stephen' }).first()
  const panel = page.locator('.panel').filter({ has: page.getByRole('tab') }).first()
  await explore(page, `${role} chart`, () => chart(page))
  const openCard = async (tab) => {
    await chart(page)
    await card().click()
    await panel.getByRole('tab', { name: tab }).click({ timeout: 8000 })
    await sleep(300)
  }
  for (const tab of ['Biography', 'Details', 'Family', 'Photos', 'Stories']) await explore(page, `${role} card ${tab}`, () => openCard(tab))
  for (const bar of ['Search', 'Relation', 'Assistant', "What's new"]) {
    await explore(page, `${role} ${bar}`, async () => { await chart(page); await page.getByRole('button', { name: bar }).first().click({ timeout: 4000 }).catch(() => {}); await sleep(500) })
  }
  await explore(page, `${role} settings`, async () => { await chart(page); await page.getByRole('button', { name: /^Settings/ }).first().click({ timeout: 4000 }).catch(() => {}); await sleep(300) })
  if (hasEdit) for (const section of ['Getting started', 'My account', 'Users and access', 'General settings', 'AI assistant', 'Data and backups', 'Outside programs', 'Faces and voice']) {
    await explore(page, `${role} settings ${section}`, async () => {
      await chart(page)
      await page.getByRole('button', { name: /^Settings/ }).first().click({ timeout: 4000 }).catch(() => {})
      await page.getByRole('dialog').getByRole('button', { name: section, exact: true }).click({ timeout: 3000 }).catch(() => {})
      await sleep(300)
    })
  }
}

// The owner.
const owner = await session('owner')
await signIn(owner, cookie)
await walkArchive(owner, 'owner', true)

// Things that need typing or a file, which pressing alone does not reach.
for (const [name, text] of [
  ['people.csv', 'First name,Last name,Born\nJoan,Whitlock,1950\nJoan,Whitlock,1951\nAda,,1900\n'],
  ['bad.xlsx', 'not a table'],
  ['people.json', '{"nothing": true}'],
  ['family.ged', '0 HEAD\n1 GEDC\n2 VERS 5.5.1\n0 @I1@ INDI\n1 NAME Wes /Whitlock/\n1 OBJE @M1@\n1 ASSO @I2@\n0 @I2@ INDI\n1 NAME Whitlock\n0 TRLR\n'],
  ['nonsense.txt', 'nonsense'],
]) {
  await chart(owner)
  await owner.getByRole('button', { name: /^Settings/ }).first().click()
  await owner.getByRole('dialog').getByRole('button', { name: 'Data and backups', exact: true }).click()
  await sleep(300)
  await owner.getByRole('button', { name: 'Choose a file' }).click()
  await sleep(500)
  await owner.locator('[role="dialog"]').last().locator('input[type="file"]').first().setInputFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(text) })
  await sleep(1500)
  await scan(owner, `import ${name}`)
  await shot(owner, `import-${name}`)
  for (const t of (await pressable(owner)).filter((t) => !SKIP.test(t.label) && !/^(add|import|save|apply)\b/i.test(t.label)).slice(0, 12)) {
    const [again] = await pressable(owner, t.label)
    if (!again) continue
    await owner.mouse.click(again.x, again.y)
    await sleep(250)
    await scan(owner, `import ${name} > ${t.label}`)
  }
}
// The page editor's own menus.
await chart(owner)
await owner.locator('.pcard').filter({ hasText: 'Stephen' }).first().click()
await owner.locator('.bn-editor').first().waitFor({ timeout: 15000 }).catch(() => {})
const editable = owner.locator('.bn-editor [contenteditable], .bn-editor').first()
if (await editable.isVisible().catch(() => false)) {
  await owner.locator('.bn-editor p').first().click().catch(() => {})
  await owner.keyboard.press('End')
  await owner.keyboard.press('Enter')
  await sleep(200)
  await scan(owner, 'editor empty line')
  await owner.keyboard.type('/')
  await sleep(500)
  await scan(owner, 'editor slash menu')
  await shot(owner, 'editor-slash')
  await owner.keyboard.press('Escape')
  await owner.keyboard.type('@')
  await sleep(500)
  await scan(owner, 'editor mention menu')
  await owner.keyboard.press('Escape')
  await owner.keyboard.press('Shift+Home')
  await sleep(500)
  await scan(owner, 'editor selection toolbar')
}
// A file that is not a backup: the server's own words.
await chart(owner)
await owner.getByRole('button', { name: /^Settings/ }).first().click().catch(() => {})
await owner.getByRole('dialog').getByRole('button', { name: 'Data and backups', exact: true }).click().catch(() => {})
await sleep(400)
const restore = owner.getByRole('dialog').locator('input[type="file"]')
for (let i = 0; i < await restore.count(); i++) {
  await restore.nth(i).setInputFiles({ name: 'nope.zip', mimeType: 'application/zip', buffer: Buffer.from('nope') }).catch(() => {})
  await sleep(1000)
  await scan(owner, 'restore a bad file')
}
await shot(owner, 'restore-bad')
// A token just made shows its connection steps for each client.
await chart(owner)
await owner.getByRole('button', { name: /^Settings/ }).first().click().catch(() => {})
await owner.getByRole('dialog').getByRole('button', { name: 'Outside programs', exact: true }).click().catch(() => {})
await owner.getByRole('dialog').getByRole('textbox').first().pressSequentially('agent').catch(() => {})
await owner.getByRole('button', { name: 'Create token' }).click({ timeout: 3000 }).catch(() => {})
await sleep(500)
await explore(owner, 'token just made', async () => { await sleep(50) })
await shot(owner, 'token-made')

// The two other people, each with their own screen first. Made here because the owner's walk presses "cancel".
const { token: editorInvite } = await call('POST', 'invites', { name: 'Eve', role: 'editor' })
const { token: readerInvite } = await call('POST', 'invites', { name: 'Rob', role: 'reader' })
const share = await call('POST', 'shares', { name: 'Cousin', days: 30 })
const closed = await call('POST', 'shares', { name: 'Locked', days: 30, password: 'secret-word' })
const accept = async (role, token) => {
  const page = await session(role)
  await page.goto(`${B}/invite/${token}`)
  await page.waitForLoadState('networkidle')
  await scan(page, `${role} invitation`)
  await shot(page, `${role}-invitation`)
  await page.getByRole('button', { name: /accept/i }).click()
  await page.locator('.pcard').first().waitFor({ timeout: 30000 })
  return page
}
const editor = await accept('editor', editorInvite)
await walkArchive(editor, 'editor', false)
const reader = await accept('reader', readerInvite)
// A reader's card keeps each label beside its value when a cell is empty.
await chart(reader)
await reader.locator('.pcard').filter({ hasText: 'Stephen' }).first().click()
await reader.getByRole('tab', { name: 'Details' }).click()
await sleep(400)
ok('a label stays beside its value on a read-only card', await reader.evaluate(() => {
  const dt = [...document.querySelectorAll('.panel div, .panel dt')].find((e) => e.textContent === 'Sex')
  const next = dt?.nextElementSibling
  return !!dt && !!next && Math.abs(dt.getBoundingClientRect().top - next.getBoundingClientRect().top) < 12 && dt.getBoundingClientRect().left < next.getBoundingClientRect().left
}))
await walkArchive(reader, 'reader', false)

// A guest with a viewing link, and with a wrong password.
const landing = await session('guest')
await landing.goto(`${B}/share/${closed.token}`)
await landing.waitForLoadState('networkidle')
await scan(landing, 'share with password')
await landing.locator('input[type="password"]').pressSequentially('wrong-word').catch(() => {})
await landing.locator('form button, button').last().click().catch(() => {})
await sleep(800)
await scan(landing, 'share wrong password')
await shot(landing, 'share-wrong-password')
const guest = await session('guest')
await guest.goto(`${B}/share/${share.token}`)
await guest.waitForLoadState('networkidle')
await scan(guest, 'share landing')
await guest.locator('main button').first().click().catch(() => {})
await guest.locator('.pcard').first().waitFor({ timeout: 30000 })
await walkArchive(guest, 'guest', false)

// Signing in, and the places a person lands on by mistake.
const stranger = await session('stranger')
for (const path of ['login', 'setup', 'invite/nope', 'share/nope', 'no-such-page']) {
  await stranger.goto(`${B}/${path}`)
  await stranger.waitForLoadState('networkidle').catch(() => {})
  await scan(stranger, `stranger ${path}`)
  await shot(stranger, `stranger-${path}`)
}

// Narrow, on the screens with the most text.
const phone = await session('phone', { width: 375, height: 812 })
await signIn(phone, cookie)
await explore(phone, 'phone chart', () => chart(phone))
ok('nothing sideways on a phone', await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0)

console.log(`pressed ${presses} things in ${Math.round((Date.now() - started) / 1000)} s`)
ok('no page errors', errors.length === 0, [...new Set(errors)].slice(0, 5).join(' | '))
ok('no Russian anywhere', found.size === 0, `${found.size} found`)
await br.close()
if (!process.env.FB_BASE) sh('docker rm -fv fb-all')
