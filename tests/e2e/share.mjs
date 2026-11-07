// A relative suggests, a stranger with a link looks: in a browser, and then by hand at the API as someone who wants more.
import { chromium } from 'playwright-core'
import { IMAGE, sh, sleep, waitUp } from './lib.mjs'

const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' · ' + x : ''}`); if (!c) process.exitCode = 1 }
const O = 'http://localhost:3445'
try { sh('docker rm -fv fg-share') } catch {}
sh(`docker run -d --name fg-share -p 127.0.0.1:3445:3000 -e BETTER_AUTH_URL=${O} -e SETUP_TOKEN=x ${IMAGE}`)
await waitUp(O)
const r = await fetch(O + '/api/auth/family/setup', { method: 'POST', headers: { 'content-type': 'application/json', origin: O }, body: JSON.stringify({ name: 'Анна', familyName: 'Лесные', language: 'ru', demo: true, code: 'x' }) })
const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
const call = async (method, path, json, c = cookie) => fetch(`${O}/api/v1/${path}`, { method, headers: { cookie: c, origin: O, ...(json ? { 'content-type': 'application/json' } : {}) }, ...(json ? { body: JSON.stringify(json) } : {}) })
const g = await (await call('GET', 'graph')).json()
const living = g.persons.filter((p) => p.living)
const dead = g.persons.filter((p) => !p.living)
const invite = async (role, name) => (await (await call('POST', 'invites', { name, role })).json()).token

const br = await chromium.launch({ channel: 'chrome', headless: true })
const errs = []
const session = async (name) => {
  const c = await br.newContext({ viewport: { width: 1440, height: 900 } })
  await c.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: O })
  const p = await c.newPage()
  p.on('pageerror', (e) => errs.push(`${name}: ${e.message.slice(0, 160)}`))
  return p
}
const owner = await session('owner')
await owner.context().addCookies(cookie.split('; ').map((x) => ({ name: x.split('=')[0], value: x.slice(x.indexOf('=') + 1), domain: 'localhost', path: '/', httpOnly: true })))
await owner.goto(O + '/'); await owner.locator('.pcard').first().waitFor({ timeout: 20000 }); await sleep(600)

// The owner makes a link in the settings.
await owner.getByRole('button', { name: 'Настройки' }).click()
await owner.getByRole('button', { name: 'Люди и доступ' }).click()
await owner.getByLabel('Для кого').fill('Кузен')
await owner.getByRole('button', { name: 'Создать ссылку' }).click()
const code = owner.locator('code', { hasText: '/share/' })
await code.waitFor()
const link = await code.innerText()
ok('the owner gets a link', link.startsWith(`${O}/share/`))
await owner.screenshot({ path: '/tmp/family-share-settings.png' })
await owner.keyboard.press('Escape')

// What a messenger's preview sees.
const preview = await fetch(link)
const html = await preview.text()
ok('a preview learns nothing about the family', !html.includes('Лесные') && !dead.some((p) => p.surname && html.includes(p.surname)))
ok('search engines and referrers are kept out', preview.headers.get('x-robots-tag')?.includes('noindex') && preview.headers.get('referrer-policy') === 'no-referrer')
ok('looking at the link sets no cookie', !preview.headers.get('set-cookie'))
ok('without a click, nothing opens', (await fetch(O + '/api/v1/graph')).status === 401)

// The guest.
const guest = await session('guest')
const denied = []
guest.on('response', (x) => { if (x.status() >= 400 && x.url().includes('/api/')) denied.push(`${x.status()} ${x.url().replace(O, '')}`) })
await guest.goto(link)
await guest.screenshot({ path: '/tmp/family-share-landing.png' })
await guest.getByRole('button', { name: 'Открыть архив' }).click()
await guest.locator('.pcard').first().waitFor({ timeout: 20000 }); await sleep(800)
ok('the link is gone from the address bar', new URL(guest.url()).pathname === '/')
ok('the guest knows how they are looking', await guest.getByText('Просмотр по ссылке').count() === 1)
for (const b of ['ИИ-ассистент', 'История', 'Настройки']) ok(`no ${b} button`, await guest.getByRole('button', { name: b }).count() === 0)
ok('no live channel', !(await guest.evaluate(() => performance.getEntriesByType('resource').some((x) => x.name.includes('/api/events')))))
const text = await guest.locator('body').innerText()
ok('no living names on the chart', !living.some((p) => p.givenName && text.includes(p.givenName)), `${living.length} checked`)
await guest.locator('.pcard .nm', { hasText: dead[0].givenName }).first().click()
await guest.locator('.panel').waitFor(); await sleep(500)
const card = await guest.locator('.panel header').evaluate((e) => e.innerText + [...e.querySelectorAll('input')].map((i) => i.value).join(' '))
ok('a card opens', card.includes(dead[0].givenName), card.slice(0, 80))
ok('a guest has nothing to suggest with', await guest.getByText('Предложить правку').count() === 0)
for (const tab of ['Сведения', 'Семья', 'Фото', 'Биография']) { await guest.getByRole('tab', { name: tab }).click(); await sleep(250) }
await guest.screenshot({ path: '/tmp/family-share-guest.png' })
await guest.keyboard.press('Escape')
ok('nothing the guest does runs into a refusal', denied.length === 0, denied.slice(0, 4).join(', '))

// The same cookie, by hand.
const gc = (await guest.context().cookies()).filter((c) => c.name === 'fb_view')
ok('the cookie cannot be read by scripts', gc[0]?.httpOnly && gc[0]?.sameSite === 'Lax')
const gcookie = `fb_view=${gc[0].value}`
const graph = await (await call('GET', 'graph', null, gcookie)).json()
ok('the graph holds no living names', graph.persons.filter((p) => p.hidden).length === living.length && !living.some((p) => p.givenName && JSON.stringify(graph).includes(`"${p.givenName}"`)))
const refused = [['PATCH', `persons/${dead[0].id}`, { givenName: 'Х' }], ['POST', 'persons', { givenName: 'Х' }], ['DELETE', `persons/${dead[0].id}`], ['POST', 'proposals/suggest', { personId: dead[0].id, text: 'x' }], ['POST', 'presence', { client: 'x', focusId: null }], ['POST', 'views', { name: 'x', scope: 'all', focusId: null, collapsed: [] }], ['POST', 'shares', { name: 'x' }], ['POST', 'invites', { name: 'x', role: 'owner' }], ['POST', 'tokens', { name: 'x', role: 'editor' }], ['PATCH', 'settings', { familyName: 'x' }], ['POST', 'media', {}], ['GET', 'history'], ['GET', 'users'], ['GET', 'settings'], ['GET', 'tokens'], ['GET', 'shares'], ['GET', 'invites'], ['GET', 'proposals'], ['GET', 'proposals/mine'], ['GET', 'media'], ['GET', 'gaps'], ['GET', 'export/gedcom'], ['GET', 'assistant/provider']]
const leaks = []
for (const [m, p, b] of refused) { const s = (await call(m, p, b, gcookie)).status; if (s !== 403 && s !== 404) leaks.push(`${m} ${p}: ${s}`) }
ok('every other route refuses a guest', leaks.length === 0, leaks.join(', ') || `${refused.length} tried`)
const beyond = []
for (const p of ['/api/events', '/api/archive', '/api/agent', '/api/mcp']) { const s = (await fetch(O + p, { headers: { cookie: gcookie } })).status; if (s !== 401 && s !== 403 && s !== 405) beyond.push(`${p}: ${s}`) }
ok('the live channel, copy, assistant and MCP do not know a guest', beyond.length === 0, beyond.join(', '))
ok('a wrong bearer does not fall back to the link', (await fetch(O + '/api/v1/graph', { headers: { cookie: gcookie, authorization: 'Bearer nope' } })).status === 401)
ok('a forged cookie gets nothing', (await call('GET', 'graph', null, gcookie.slice(0, -2) + 'zz')).status === 401)

// One branch, with a password.
const root = dead.find((p) => g.parentChild.some((l) => l.parentId === p.id))
const { id: viewId } = await (await call('POST', 'views', { name: 'Ветка', scope: 'descendants', focusId: root.id, collapsed: [] })).json()
const { token: t2 } = await (await call('POST', 'shares', { name: 'Ветка', viewId, password: 'лес123' })).json()
const open2 = async (password) => fetch(O + '/api/share', { method: 'POST', headers: { 'content-type': 'application/json', origin: O }, body: JSON.stringify({ token: t2, password }) })
ok('a wrong password does not open', (await open2('нет')).status === 403)
const opened = await open2('лес123')
const c2 = opened.headers.getSetCookie()[0].split(';')[0]
const branch = await (await call('GET', 'graph', null, c2)).json()
ok('a branch link holds only the branch', branch.persons.length < g.persons.length && branch.persons.some((p) => p.id === root.id), `${branch.persons.length} of ${g.persons.length}`)
const outside = g.persons.find((p) => !branch.persons.some((x) => x.id === p.id))
ok('and nothing about those outside it', [(await call('GET', `persons/${outside.id}/pages`, null, c2)).status, (await call('GET', `persons/${outside.id}/media`, null, c2)).status, (await call('GET', `persons/${outside.id}/avatar`, null, c2)).status].includes(404) && (await (await call('GET', 'views', null, c2)).json()).every((v) => !v.name))
const pw = await session('password')
await pw.goto(`${O}/share/${t2}`)
await pw.getByLabel('Пароль').fill('неверно'); await pw.getByRole('button', { name: 'Открыть архив' }).click()
await pw.locator('form [role=alert]').waitFor()
ok('the page says the password is wrong', (await pw.locator('form [role=alert]').innerText()).includes('Неверный пароль'))
await pw.getByLabel('Пароль').fill('лес123'); await pw.getByRole('button', { name: 'Открыть архив' }).click()
await pw.locator('.pcard').first().waitFor({ timeout: 20000 })
ok('the right one opens the branch', await pw.locator('.pcard').count() <= branch.persons.length)
const guesses = []
for (let i = 0; i < 12; i++) guesses.push((await open2('мимо')).status)
ok('guessing is cut off', guesses.at(-1) === 429, guesses.join(' '))

// Closing.
const shares = await (await call('GET', 'shares')).json()
await call('DELETE', `shares/${shares.find((s) => s.name === 'Кузен').id}`)
ok('a closed link stops at once', (await call('GET', 'graph', null, gcookie)).status === 401)
await guest.reload(); await guest.waitForURL(/login/, { timeout: 10000 }).catch(() => {})
ok('the page sends them away', guest.url().includes('/login'))
const dead2 = await fetch(link).then((x) => x.text())
ok('the link says it no longer works', dead2.includes('Ссылка недействительна'))

// A reader suggests in the browser.
const R = await session('reader')
await R.goto(`${O}/invite/${await invite('reader', 'Тётя Зина')}`)
await R.getByRole('button', { name: 'Принять приглашение' }).click()
await R.locator('.pcard').first().waitFor({ timeout: 20000 }); await sleep(600)
const subject = dead.find((p) => !p.deathPlace) ?? dead[0]
await R.locator('.pcard .nm', { hasText: subject.givenName }).first().click(); await R.locator('.panel').waitFor(); await sleep(300)
await R.getByRole('button', { name: 'Предложить правку' }).click()
await R.getByRole('dialog').waitFor(); await sleep(200)
await R.getByLabel('Место смерти').fill('Вологда')
await R.getByLabel('Что ещё рассказать').fill('Он хорошо играл на гармони.')
await R.getByLabel('Откуда это известно').fill('Со слов бабушки')
await R.screenshot({ path: '/tmp/family-share-suggest.png' })
await R.getByRole('button', { name: 'Отправить' }).click()
await R.getByText('Предложение отправлено').waitFor()
ok('the reader is told it went', true)
ok('the archive has not changed', (await (await call('GET', 'graph')).json()).persons.find((p) => p.id === subject.id).deathPlace === subject.deathPlace)
await R.getByRole('button', { name: 'Предложить правку' }).click(); await R.getByRole('dialog').waitFor(); await sleep(300)
ok('the reader sees it waiting', await R.getByText('Ждёт проверки').count() === 2)
await R.keyboard.press('Escape')

// The owner hears about it without reloading, reads it, and accepts.
await sleep(1500)
ok('the owner sees it arrive', await owner.locator('nav[aria-label="Главное меню"]').getByRole('button', { name: /Проверка/ }).locator('.absolute, span').count() > 0)
await owner.locator('nav[aria-label="Главное меню"]').getByRole('button', { name: /Проверка/ }).click(); await sleep(400)
await owner.getByText('Тётя Зина', { exact: true }).waitFor({ timeout: 6000 })
const panel = await owner.locator('.side-sheet:not([hidden])').innerText()
ok('the owner reads old, new, the story and where it came from', panel.includes('Вологда') && panel.includes('Он хорошо играл на гармони.') && panel.includes('Со слов бабушки'))
await owner.screenshot({ path: '/tmp/family-share-review.png' })
await owner.getByRole('button', { name: 'Принять' }).click(); await sleep(800)
const after = (await (await call('GET', 'graph')).json()).persons.find((p) => p.id === subject.id)
ok('accepted, it is in the archive', after.deathPlace === 'Вологда')
const written = await (await call('GET', `persons/${subject.id}/pages`)).json()
ok('the story became a page', written.some((p) => p.title.includes('Тётя Зина')))
await sleep(600)
if (!(await R.locator('.panel').count())) { await R.locator('.pcard .nm', { hasText: subject.givenName }).first().click(); await R.locator('.panel').waitFor(); await sleep(300) }
await R.getByRole('button', { name: 'Предложить правку' }).click(); await R.getByRole('dialog').waitFor(); await sleep(400)
ok('the reader sees it was accepted', await R.getByText('Принято').count() === 2)
await R.keyboard.press('Escape')

// What a reader cannot do at the API.
const rc = (await R.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
const hiddenOne = living.find((p) => p.id)
ok('a reader cannot suggest about someone hidden', (await call('POST', 'proposals/suggest', { personId: hiddenOne.id, patch: { givenName: 'Х' } }, rc)).status === 404)
ok('a reader still cannot write directly', (await call('PATCH', `persons/${subject.id}`, { givenName: 'Х' }, rc)).status === 403)
ok('a reader cannot accept their own suggestion', (await call('POST', 'proposals/x/accept', {}, rc)).status === 403)

ok('no page errors', errs.length === 0, errs.join(' | '))
await br.close(); sh('docker rm -fv fg-share')
process.exit(process.exitCode ?? 0)
