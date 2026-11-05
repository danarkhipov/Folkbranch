// Views by hand, in a browser: who is shown, saving, folding, moving a card, and a second person seeing it.
import { chromium } from 'playwright-core'
import { IMAGE, sh, sleep, waitUp } from './lib.mjs'

const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' · ' + x : ''}`); if (!c) process.exitCode = 1 }
const O = 'http://localhost:3442'
try { sh('docker rm -f fg-views') } catch {}
sh(`docker run -d --name fg-views -p 127.0.0.1:3442:3000 -e BETTER_AUTH_URL=${O} -e SETUP_TOKEN=x ${IMAGE}`)
await waitUp(O)
const r = await fetch(O + '/api/auth/family/setup', { method: 'POST', headers: { 'content-type': 'application/json', origin: O }, body: JSON.stringify({ name: 'Анна', familyName: 'Лесные', language: 'ru', demo: true, code: 'x' }) })
const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
const invite = async (role, name) => (await (await fetch(O + '/api/v1/invites', { method: 'POST', headers: { cookie, origin: O, 'content-type': 'application/json' }, body: JSON.stringify({ name, role }) })).json()).token
const br = await chromium.launch({ channel: 'chrome', headless: true })
const errs = []
const open = async (token) => {
  const c = await br.newContext({ viewport: { width: 1440, height: 900 } })
  const p = await c.newPage()
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 140)))
  if (token) { await p.goto(`${O}/invite/${token}`); await p.getByRole('button', { name: 'Принять приглашение' }).click() } else {
    await c.addCookies(cookie.split('; ').map((x) => ({ name: x.split('=')[0], value: x.slice(x.indexOf('=') + 1), domain: 'localhost', path: '/', httpOnly: true })))
    await p.goto(O + '/')
  }
  await p.locator('.pcard').first().waitFor({ timeout: 20000 }); await sleep(700)
  return p
}
const A = await open()
const cards = (p) => p.locator('.pcard').count()
const has = (p, name) => p.locator('.pcard', { hasText: name }).count()
const menu = (p) => p.getByRole('button', { name: 'Кого показать' }).first().click()
const closeMenu = async (p) => { await p.keyboard.press('Escape'); await sleep(150) }
const total = await cards(A)
ok('the whole family shows at the start', total > 15, String(total))

await menu(A)
ok('branch choices wait until someone is chosen', await A.getByRole('button', { name: 'Предки' }).isDisabled())
await closeMenu(A)
await A.locator('.pcard .nm', { hasText: 'Иван' }).first().click(); await A.locator('.panel').waitFor(); await sleep(400)
await menu(A); await A.getByRole('button', { name: /^Предки/ }).click(); await sleep(700); await closeMenu(A)
const up = await cards(A)
ok('ancestors: fewer people, the chosen one stays', up < total && await has(A, 'Иван Соколов') > 0, `${up} of ${total}`)
ok('someone from another branch is gone', await has(A, 'Алиса') === 0)
ok('the bar says what is shown', await A.getByText('Предки: Иван Соколов').count() > 0)
await menu(A); await A.getByRole('button', { name: /^Потомки/ }).click(); await sleep(700); await closeMenu(A)
ok('descendants bring the partners along', await has(A, 'Анна Соколова') > 0 && await has(A, 'Николай') === 0, `${await cards(A)}`)
await menu(A)
await A.getByPlaceholder('Например, мамина ветка').fill('Ветка Ивана')
await A.getByRole('button', { name: 'Сохранить', exact: true }).click(); await sleep(500); await closeMenu(A)
await A.getByRole('button', { name: 'Показать всю семью' }).click(); await sleep(700)
ok('back to everyone', await cards(A) === total)
await A.reload(); await A.locator('.pcard').first().waitFor(); await sleep(700)
await menu(A); await A.getByRole('button', { name: 'Ветка Ивана', exact: true }).click(); await sleep(700); await closeMenu(A)
ok('a saved view opens after reloading the page', await cards(A) < total && await has(A, 'Николай') === 0, `${await cards(A)}`)
await A.getByRole('button', { name: 'Показать всю семью' }).click(); await sleep(700)

// Folding, from the card of a grandparent.
await A.locator('.pcard .nm', { hasText: 'Николай' }).first().click(); await A.locator('.panel').waitFor(); await sleep(300)
await menu(A); await A.getByRole('button', { name: /^Свернуть потомков/ }).click(); await sleep(700); await closeMenu(A)
const folded = await cards(A)
ok('folding hides the descendants, the card offers them back', folded < total && await A.locator('.pcard .folded').count() === 1, `${folded} of ${total}`)
await A.locator('.pcard .folded').click(); await sleep(700)
ok('unfolding brings everyone back', await cards(A) === total)
await A.locator('.panel button[aria-label="Закрыть"]').first().click(); await sleep(300)

// Moving a card by its caption.
const card = A.locator('.pcard', { hasText: 'Варвара' }).first()
const box = async (p) => p.locator('.pcard', { hasText: 'Варвара' }).first().boundingBox()
const place = (p) => p.locator('.pcard', { hasText: 'Варвара' }).first().evaluate((e) => parseFloat(e.style.left))
const b0 = await box(A)
const x0 = await place(A)
const c0 = await card.locator('.nm').boundingBox()
await A.mouse.move(c0.x + c0.width / 2, c0.y + c0.height / 2); await A.mouse.down()
for (let i = 1; i <= 12; i++) { await A.mouse.move(c0.x + c0.width / 2 + i * 15, c0.y + c0.height / 2); await sleep(12) }
await A.mouse.up(); await sleep(900)
const b1 = await box(A)
ok('the card moved sideways and stayed in its row', Math.abs(b1.x - b0.x - 180) < 12 && Math.abs(b1.y - b0.y) < 2, `${Math.round(b1.x - b0.x)} px`)
ok('moving does not open the card', await A.locator('.panel').count() === 0)
ok('it says the family did not change, and offers undo', await A.getByText('Родство не изменилось').count() > 0)
await A.reload(); await A.locator('.pcard').first().waitFor(); await sleep(800)
const x1 = await place(A)
ok('the place survives a reload', Math.abs(x1 - x0) > 100, `${Math.round(x1 - x0)} on the chart`)
const B = await open(await invite('editor', 'Пётр'))
ok('another person sees it too', Math.abs((await place(B)) - x1) < 1)
await menu(A); await A.getByRole('button', { name: 'Вернуть карточки на их места' }).click(); await sleep(900); await closeMenu(A)
ok('cards go back in place', Math.abs((await place(A)) - x0) < 1)
await sleep(800)
ok('live: the other screen follows', Math.abs((await place(B)) - x0) < 1)

// A plain click and a pan still work.
await A.locator('.pcard .nm', { hasText: 'Варвара' }).first().click(); await sleep(400)
ok('a click on the caption still opens the card', await A.locator('.panel').count() === 1)
await A.locator('.panel button[aria-label="Закрыть"]').first().click(); await sleep(300)
const free = await A.evaluate(() => { for (let y = 120; y < 860; y += 29) for (let x = 200; x < 1300; x += 37) { const e = document.elementFromPoint(x, y); if (e?.classList.contains('canvas') || e?.classList.contains('world')) return { x, y } } return null })
const before = await box(A)
await A.mouse.move(free.x, free.y); await A.mouse.down(); await A.mouse.move(free.x + 80, free.y + 30, { steps: 5 }); await A.mouse.up(); await sleep(200)
const after = await box(A)
ok('dragging the background still pans', Math.abs(after.x - before.x - 80) < 4)

// A reader looks but cannot move.
const R = await open(await invite('reader', 'Читатель'))
ok('a reader has no card to move', await R.locator('.pcard .movable').count() === 0)
await menu(R)
ok('a reader cannot save a view', await R.getByPlaceholder('Например, мамина ветка').count() === 0)
await closeMenu(R)
ok('no page errors', errs.length === 0, errs.join(' | '))
await br.close(); sh('docker rm -f fg-views')
process.exit(process.exitCode ?? 0)
