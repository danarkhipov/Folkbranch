// Two cards found to be one person: found, compared, merged, undone, by hand in a browser.
import { chromium } from 'playwright-core'
import { boot, cookiesOf, IMAGE, sh, sleep } from './lib.mjs'

const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' · ' + x : ''}`); if (!c) process.exitCode = 1 }
const { B, cookie } = await boot('fg-merge', 3450, IMAGE, { people: 0 })
const call = async (method, p, json, c = cookie) => fetch(`${B}/api/v1/${p}`, { method, headers: { cookie: c, origin: B, ...(json ? { 'content-type': 'application/json' } : {}) }, ...(json ? { body: JSON.stringify(json) } : {}) })
const person = async (f) => (await (await call('POST', 'persons', { person: { living: false, ...f } })).json()).id
const graph = async () => (await call('GET', 'graph')).json()
const a = await person({ givenName: 'Мефодий', surname: 'Пастухов', birthDate: '1850', birthPlace: 'Тула', sex: 'M' })
const b = await person({ givenName: 'Мефодий', surname: 'Пастухов', birthDate: '1850', birthPlace: 'Орёл', deathDate: '1910', sex: 'M', facts: [{ kind: 'Служба', date: '1880', place: '', note: '' }] })
const kid = await person({ givenName: 'Ребёнок', surname: 'Пастухов' })
await call('POST', 'relations', { type: 'son', to: b, other: kid })
await call('POST', 'pages', { personId: b, title: 'О нём', markdown: 'Текст о нём.' })

const br = await chromium.launch({ channel: 'chrome', headless: true })
const errs = []
const ctx = await br.newContext({ viewport: { width: 1440, height: 900 } }); await ctx.addCookies(cookiesOf(cookie))
const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message.slice(0, 160)))
await p.goto(B + '/'); await p.locator('.pcard').first().waitFor({ timeout: 20000 }); await sleep(500)
await p.locator('nav[aria-label="Главное меню"]').getByRole('button', { name: /История/ }).click(); await sleep(300)
await p.getByRole('radio', { name: 'Похожие' }).click(); await sleep(500)
ok('the pair is found', await p.getByRole('button', { name: 'Сравнить' }).count() === 1)
ok('with the reason', await p.getByText('Совпадает').first().innerText().then((x) => x.includes('год рождения')))
await p.getByRole('button', { name: 'Сравнить' }).click(); await p.getByRole('dialog').waitFor(); await sleep(400)
const dialog = p.getByRole('dialog')
ok('where they disagree, there is a choice', await dialog.getByRole('radio').count() === 2 && await dialog.getByText('Орёл').count() === 1)
ok('the fuller card stays by default', (await dialog.innerText()).includes('Останется') && await dialog.getByText('Перейдёт').count() === 0)
await dialog.getByRole('button', { name: 'Поменять местами' }).click(); await sleep(400)
ok('swapped, it says what would move', (await dialog.innerText()).includes('Перейдёт на оставшуюся карточку'))
await dialog.getByRole('button', { name: 'Поменять местами' }).click(); await sleep(400)
await p.screenshot({ path: '/tmp/family-merge-dialog.png' })
const before = await graph()
ok('showing the comparison changes nothing', before.persons.length === 3)
await dialog.getByLabel('Орёл').check()
await dialog.getByRole('button', { name: 'Объединить', exact: true }).click()
await p.getByText('Карточки объединены').waitFor({ timeout: 8000 }); await sleep(500)
const after = await graph()
const kept = after.persons.find((x) => x.givenName === 'Мефодий')
ok('one card is left', after.persons.length === 2)
ok('with what was picked, what both knew, and the other value as a version', kept.birthPlace === 'Орёл' && kept.deathDate === '1910' && kept.facts.length === 1 && kept.claims.some((c) => c.value === 'Тула' && c.status === 'possible'))
ok('with the child and the page', after.parentChild.some((l) => l.parentId === kept.id) && (await (await call('GET', `persons/${kept.id}/pages`)).json()).length === 1)
ok('the card opens on the one that stayed', await p.locator('aside.panel').count() === 1)
await p.screenshot({ path: '/tmp/family-merge-after.png' })
await p.getByRole('button', { name: 'Отменить', exact: true }).first().click(); await sleep(1000)
const back = await graph()
ok('one press brings both back', back.persons.length === 3 && back.persons.find((x) => x.id === a).birthPlace === 'Тула' && back.persons.find((x) => x.id === b).birthPlace === 'Орёл' && back.parentChild.some((l) => l.parentId === b))

// Told they are different people, it stops asking.
await p.reload(); await p.locator('.pcard').first().waitFor(); await sleep(400)
await p.locator('nav[aria-label="Главное меню"]').getByRole('button', { name: /История/ }).click(); await sleep(300)
await p.getByRole('radio', { name: 'Похожие' }).click(); await sleep(500)
await p.getByRole('button', { name: 'Это разные люди' }).click(); await sleep(500)
ok('different people are not offered again', await p.getByRole('button', { name: 'Сравнить' }).count() === 0 && await p.getByText('Похожих людей не нашлось').count() === 1)

// From the card, and what cannot be.
await p.goto(`${B}/?p=${b}`); await p.locator('aside.panel').waitFor(); await sleep(300)
await p.getByRole('tab', { name: 'Сведения' }).click(); await sleep(250)
await p.getByRole('button', { name: 'Это тот же человек…' }).click(); await sleep(250)
await p.getByRole('option', { name: /Ребёнок/ }).first().click(); await p.getByRole('dialog').waitFor(); await sleep(400)
const refusal = await p.getByRole('dialog').getByRole('alert').innerText()
ok('a parent and child cannot be one, and it says why', refusal.includes('предок'), refusal.slice(0, 80))
ok('and the button is off', await p.getByRole('dialog').getByRole('button', { name: 'Объединить', exact: true }).isDisabled())
await p.keyboard.press('Escape')

// Who may.
const { token } = await (await call('POST', 'invites', { name: 'Читатель', role: 'reader' })).json()
const rctx = await br.newContext(); const r = await rctx.newPage()
await r.goto(`${B}/invite/${token}`); await r.getByRole('button', { name: 'Принять приглашение' }).click(); await r.locator('.pcard').first().waitFor()
const rc = (await rctx.cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
const seen = { keep: 0, drop: 0 }
ok('a reader can do none of it', (await call('GET', 'duplicates', null, rc)).status === 403 && (await call('GET', `merge/preview?keep=${a}&drop=${b}`, null, rc)).status === 403 && (await call('POST', 'merge', { keepId: a, dropId: b, seen }, rc)).status === 403)
const { token: api } = await (await call('POST', 'tokens', { name: 'робот', role: 'editor', review: false })).json()
ok('nor a token', (await fetch(`${B}/api/v1/merge`, { method: 'POST', headers: { authorization: `Bearer ${api}`, 'content-type': 'application/json' }, body: JSON.stringify({ keepId: a, dropId: b, seen }) })).status === 403)
ok('no page errors', errs.length === 0, errs.join(' | '))
await br.close(); sh('docker rm -fv fg-merge'); try { sh('docker volume rm fg-merge-data') } catch {}
process.exit(process.exitCode ?? 0)
