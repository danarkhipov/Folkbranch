// The guide to what the app can do: it opens once for a relative on a new device, not for the owner, and not again once closed.
import { chromium } from 'playwright-core'
import { boot, cookiesOf, IMAGE, sleep } from './lib.mjs'

const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' · ' + x : ''}`); if (!c) process.exitCode = 1 }
const { B, cookie } = await boot('fg-tour', 3455, IMAGE, { people: 6 })
const invite = await fetch(`${B}/api/v1/invites`, { method: 'POST', headers: { cookie, origin: B, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Тётя Зина', role: 'editor' }) })
const { token } = await invite.json()
const br = await chromium.launch({ channel: 'chrome', headless: true })

const owner = await (await br.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await owner.context().addCookies(cookiesOf(cookie))
await owner.goto(B + '/'); await owner.locator('.pcard').first().waitFor({ timeout: 20000 }); await sleep(2500)
ok('the owner is not shown the guide', await owner.getByRole('dialog').count() === 0)

const p = await (await br.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message.slice(0, 160)))
await p.goto(`${B}/invite/${token}`)
await p.getByRole('button', { name: 'Принять приглашение' }).click()
await p.locator('.pcard').first().waitFor({ timeout: 20000 })
await p.getByRole('dialog').waitFor({ timeout: 10000 })
ok('a relative on a new device is shown the guide by itself', (await p.getByRole('dialog').innerText()).includes('Добро пожаловать в семейный архив'))
await p.getByRole('button', { name: 'Понятно' }).click(); await sleep(300)
ok('it closes', await p.getByRole('dialog').count() === 0)
await p.reload(); await p.locator('.pcard').first().waitFor({ timeout: 20000 }); await sleep(2500)
ok('it does not come back', await p.getByRole('dialog').count() === 0)
ok('no page errors', errs.length === 0, errs.join(' | '))
await br.close()
