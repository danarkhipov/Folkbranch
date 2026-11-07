// The file for relatives, as they get it: made from the button in the app, then opened from disk with no server.
// Needs an archive: pnpm build && node scripts/make-bundle.mjs. No Docker. SHOTS=dir keeps pictures.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'
import { waitUp } from './lib.mjs'

const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x && !c ? ' · ' + x : ''}`); if (!c) process.exitCode = 1 }
const repo = fileURLToPath(new URL('../..', import.meta.url))
const bundleFile = process.env.FG_BUNDLE ?? path.join(repo, `dist/folkbranch-${process.platform}-${process.arch}.tar.xz`)
if (!fs.existsSync(bundleFile)) { console.error(`No archive at ${bundleFile}. Run: pnpm build && node scripts/make-bundle.mjs`); process.exit(1) }
const SHOTS = process.env.SHOTS
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'folkbranch-file-')))
const dir = path.join(work, 'archive'), port = 3472, B = `http://localhost:${port}`
const env = { ...process.env, HOME: work, FOLKBRANCH_BUNDLE: pathToFileURL(bundleFile).href }
const installed = spawnSync('sh', [path.join(repo, 'install.sh'), '--local', '--dir', dir, '--port', String(port)], { cwd: work, env, encoding: 'utf8', timeout: 180000 })
if (installed.status !== 0) { console.error(installed.stdout, installed.stderr); process.exit(1) }

const br = await chromium.launch({ channel: 'chrome', headless: true })
try {
  await waitUp(B)
  const code = fs.readFileSync(path.join(dir, '.env'), 'utf8').match(/^SETUP_TOKEN=(.*)$/m)[1]
  const ctx = await br.newContext({ locale: 'ru-RU', viewport: { width: 1280, height: 860 }, acceptDownloads: true })
  const app = await ctx.newPage()
  const r = await app.request.post(`${B}/api/auth/family/setup`, { headers: { origin: B }, data: { name: 'Анна', familyName: 'Лесные', language: 'ru', demo: true, code } })
  ok('an archive with the demo family', r.ok(), String(r.status()))
  // A real photo on someone who has died, as their portrait too.
  const before = await (await app.request.get(`${B}/api/v1/graph`)).json()
  const dead = before.persons.find((p) => !p.living)
  const up = await app.request.post(`${B}/api/v1/media`, { headers: { origin: B }, multipart: { file: { name: 'p.jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync(new URL('../fixtures/photo.jpg', import.meta.url)) }, personId: dead.id } })
  const photo = await up.json()
  const set = await app.request.put(`${B}/api/v1/persons/${dead.id}/avatar`, { headers: { origin: B }, data: { mediaId: photo.id, crop: { x: 0, y: 0, w: 1, h: 1 } } })
  ok('a photo goes on a card', up.ok() && set.ok(), `${up.status()} ${set.status()}`)
  await app.goto(B)
  await app.getByRole('button', { name: 'Настройки' }).click()
  await app.getByRole('dialog').getByRole('button', { name: 'Пользователи и доступ' }).click()
  const button = app.getByRole('button', { name: 'Скачать файл' })
  await button.scrollIntoViewIfNeeded()
  ok('the button is where sharing is', await button.isVisible())
  const [download] = await Promise.all([app.waitForEvent('download'), button.click()])
  const file = path.join(work, download.suggestedFilename())
  await download.saveAs(file)
  ok('it is named after the family', download.suggestedFilename() === 'Лесные.html', download.suggestedFilename())
  const report = await app.getByRole('status').filter({ hasText: 'Живых скрыто' }).innerText()
  ok('the app says what went in', /Людей: \d+/.test(report), report)
  if (SHOTS) await app.screenshot({ path: `${SHOTS}/file-button.png` })
  const anon = await fetch(`${B}/api/family-file`)
  ok('nobody signed out can make it', anon.status === 401, String(anon.status))
  const html = fs.readFileSync(file, 'utf8')
  const owner = await (await app.request.get(`${B}/api/v1/graph`)).json()
  const living = owner.persons.filter((p) => p.living && (p.givenName || p.surname))
  ok('the demo family has living people to hide', living.length > 0)
  ok('the photo went in', /Фотографий: 1/.test(report), report)
  ok('none of their full names is in the file', living.every((p) => !html.includes(`${p.givenName} ${p.surname}`)), living.map((p) => p.givenName).join())

  // As a relative: from disk, on a phone, and with the server gone.
  spawnSync('./folkbranch', ['stop'], { cwd: dir, env })
  const url = pathToFileURL(file).href
  for (const [label, viewport] of [['phone', { width: 375, height: 700 }], ['narrow', { width: 320, height: 600 }], ['desktop', { width: 1280, height: 800 }]]) {
    const c = await br.newContext({ locale: 'ru-RU', viewport, hasTouch: label !== 'desktop' })
    const p = await c.newPage()
    const asked = [], errors = []
    p.on('request', (q) => { if (!/^(file|data):/.test(q.url())) asked.push(q.url()) })
    p.on('pageerror', (e) => errors.push(e.message))
    p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    await p.goto(url)
    ok(`${label}: the chart is there`, await p.locator('#chart svg a').count() > 0)
    ok(`${label}: the page does not run off the side`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/file-${label}.png` })
    ok(`${label}: the portrait is drawn`, await p.evaluate((id) => { const i = document.querySelector(`#a-${CSS.escape(id)}`); return !!i && i.getAttribute('href').startsWith('data:image/') }, dead.id))
    const first = p.locator('.people li a').first()
    const name = await first.innerText()
    await first.click()
    const card = p.locator('.card:target')
    ok(`${label}: a name opens the card`, await card.isVisible() && (await card.locator('h2').innerText()).length > 0, name)
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/file-${label}-card.png` })
    await card.locator('.close').click()
    ok(`${label}: and it closes`, await p.locator('.card:target').count() === 0)
    await p.locator('#chart svg a').first().click()
    ok(`${label}: a card on the chart opens too`, await p.locator('.card:target').isVisible())
    await p.keyboard.press('Escape')
    ok(`${label}: Escape closes it`, await p.locator('.card:target').count() === 0)
    await p.locator('#q').fill(name.slice(0, 4))
    ok(`${label}: search narrows the list`, await p.locator('.people li:not([hidden])').count() >= 1 && await p.locator('.people li[hidden]').count() > 0)
    ok(`${label}: nothing was asked of any network`, asked.length === 0, asked.slice(0, 3).join(' '))
    ok(`${label}: no errors`, errors.length === 0, errors.slice(0, 3).join(' | '))
    await p.locator('#q').fill('')
    await p.locator(`.people li a[href="#p-${dead.id}"]`).click()
    await p.waitForTimeout(200)
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/file-${label}-photo.png` })
    await c.close()
  }

  // Where a viewer runs no scripts, as some messengers' previews do.
  const plain = await br.newContext({ viewport: { width: 375, height: 700 }, javaScriptEnabled: false })
  const q = await plain.newPage()
  await q.goto(url)
  await q.locator('.people li a').first().click()
  ok('without scripts the cards still open', await q.locator('.card:target').isVisible())
  await plain.close()
  console.log(`INFO ${report}`)
} finally {
  await br.close()
  spawnSync('./folkbranch', ['stop'], { cwd: dir, env })
  fs.rmSync(work, { recursive: true, force: true })
}
process.exit(process.exitCode ?? 0)
