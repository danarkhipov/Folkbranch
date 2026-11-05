// Printing by hand, in a browser, and the file checked by a program that knows nothing about how it was made.
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { IMAGE, sh, sleep, waitUp } from './lib.mjs'

const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' · ' + x : ''}`); if (!c) process.exitCode = 1 }
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'family-print-'))
const gs = (args, file) => execSync(`gs -q -dNOPAUSE -dBATCH ${args} "${file}" 2>&1`, { maxBuffer: 1e8 }).toString()
const O = 'http://localhost:3444'
try { sh('docker rm -f fg-print') } catch {}
sh(`docker run -d --name fg-print -p 127.0.0.1:3444:3000 -e BETTER_AUTH_URL=${O} -e SETUP_TOKEN=x ${IMAGE}`)
await waitUp(O)
const r = await fetch(O + '/api/auth/family/setup', { method: 'POST', headers: { 'content-type': 'application/json', origin: O }, body: JSON.stringify({ name: 'Анна', familyName: 'Лесные', language: 'ru', demo: true, code: 'x' }) })
const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
const g = await (await fetch(O + '/api/v1/graph', { headers: { cookie } })).json()
const living = g.persons.filter((p) => p.living).map((p) => p.givenName).filter(Boolean)
const dead = g.persons.find((p) => !p.living)
const invite = async (role, name) => (await (await fetch(O + '/api/v1/invites', { method: 'POST', headers: { cookie, origin: O, 'content-type': 'application/json' }, body: JSON.stringify({ name, role }) })).json()).token

const br = await chromium.launch({ channel: 'chrome', headless: true })
const errs = []
const session = async (token) => {
  const c = await br.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  const p = await c.newPage()
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 160)))
  if (token) { await p.goto(`${O}/invite/${token}`); await p.getByRole('button', { name: 'Принять приглашение' }).click() } else {
    await c.addCookies(cookie.split('; ').map((x) => ({ name: x.split('=')[0], value: x.slice(x.indexOf('=') + 1), domain: 'localhost', path: '/', httpOnly: true })))
    await p.goto(O + '/')
  }
  await p.locator('.pcard').first().waitFor({ timeout: 20000 }); await sleep(600)
  return p
}
const download = async (p, name) => {
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 120000 }), p.getByRole('button', { name: 'Скачать PDF' }).click()])
  const f = path.join(work, name)
  await dl.saveAs(f)
  return f
}
const check = (name, f) => {
  const text = gs('-sDEVICE=txtwrite -sOutputFile=-', f)
  const log = gs('-sDEVICE=nullpage', f)
  ok(`${name}: valid PDF, no substituted fonts`, !/error|substitut|Can.t find/i.test(log), log.slice(0, 120))
  return text
}
const pages = (f) => (gs('-sDEVICE=nullpage -dNODISPLAY -c "" -f', f), Number(execSync(`gs -q -dNODISPLAY --permit-file-read="${f}" -c "(${f}) (r) file runpdfbegin pdfpagecount = quit" 2>&1`).toString().trim()))

const A = await session()
const jsBefore = await A.evaluate(() => performance.getEntriesByType('resource').filter((x) => /font.*ttf/.test(x.name)).length)
ok('fonts for print are not loaded until someone prints', jsBefore === 0)
await A.getByRole('button', { name: 'Печать схемы' }).click()
await A.getByRole('dialog').waitFor(); await sleep(400)
ok('the dialog says how large names will be', await A.getByText('Имена на бумаге').count() === 1)
await A.screenshot({ path: '/tmp/family-print-dialog.png' })
const one = await download(A, 'one.pdf')
const t1 = check('one sheet, living hidden', one)
ok('Cyrillic text can be read out of the file', t1.includes(dead.givenName), dead.givenName)
ok('living relatives are not in it', !living.some((n) => t1.includes(n)), `${living.length} checked`)
ok('it says who was hidden', t1.includes('Живой') && t1.includes('родственник'))
ok('one sheet is one page', pages(one) === 1)
fs.copyFileSync(one, '/tmp/family-print-one.pdf')

await A.getByText('Скрыть живых родственников').click(); await sleep(300)
const full = await download(A, 'full.pdf')
const t2 = check('one sheet, everyone', full)
ok('the owner can print everyone when asked', living.some((n) => t2.includes(n)))

await A.getByText('Склеить из листов').click(); await sleep(300)
await A.getByLabel('Размер имён').selectOption('12'); await sleep(300)
const sheetsText = await A.getByRole('status').innerText()
const many = await download(A, 'many.pdf')
check('glued sheets', many)
const n = pages(many)
ok('the page count matches what the dialog promised', sheetsText.includes(`Листов: ${n}`) && n > 1, `${n} pages`)
ok('every sheet says where it goes', gs('-sDEVICE=txtwrite -sOutputFile=-', many).split('из').length > n)
ok('no card is cut at this size', await A.getByText('попадёт на стык').count() === 0)
fs.copyFileSync(many, '/tmp/family-print-many.pdf')
await A.keyboard.press('Escape'); await sleep(200)

// A branch prints alone.
await A.locator('.pcard .nm', { hasText: 'Иван' }).first().click(); await A.locator('.panel').waitFor(); await sleep(300)
await A.getByRole('button', { name: 'Кого показать' }).first().click(); await A.getByRole('button', { name: /^Предки/ }).click(); await sleep(600); await A.keyboard.press('Escape')
await A.getByRole('button', { name: 'Печать схемы' }).click(); await A.getByRole('dialog').waitFor(); await sleep(300)
const part = await download(A, 'branch.pdf')
const t3 = check('a branch', part)
ok('only that branch is printed', t3.includes('Иван') && !t3.includes('Алиса'))

// A reader never had the names.
const R = await session(await invite('reader', 'Читатель'))
await R.getByRole('button', { name: 'Печать схемы' }).click(); await R.getByRole('dialog').waitFor(); await sleep(300)
ok('a reader has no choice to show the living', await R.getByText('Скрыть живых родственников').count() === 0)
const rf = await download(R, 'reader.pdf')
const t4 = check('reader', rf)
ok('a reader\'s print holds no living names', !living.some((x) => t4.includes(x)) && t4.includes(dead.givenName))
ok('no page errors', errs.length === 0, errs.join(' | '))
await br.close(); sh('docker rm -f fg-print')
fs.rmSync(work, { recursive: true, force: true })
process.exit(process.exitCode ?? 0)
