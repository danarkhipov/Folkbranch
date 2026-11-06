import { chromium } from 'playwright-core'
import { execSync as sh } from 'node:child_process'
const PORT = 3499, O = `http://127.0.0.1:${PORT}`
const q = (c) => { try { return sh(c, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim() } catch (e) { return 'ERR ' + e.stderr } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ok = (n, c, x = '') => console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`)
q('docker rm -fv fgb'); q(`docker run -d --name fgb -p 127.0.0.1:${PORT}:3000 -e BETTER_AUTH_URL=${O} -e BETTER_AUTH_SECRET=${'c'.repeat(64)} ${process.env.FG_IMAGE ?? 'folkbranch:check'}`)
for (let i = 0; i < 60; i++) { try { if ((await fetch(O + '/api/health')).ok) break } catch {} await sleep(500) }
await sleep(1000); const code = q('docker logs fgb').match(/setup\?code=(\S+)/)[1]
const br = await chromium.launch({ channel: 'chrome', headless: true })
const errs = []
const session = async () => { const c = await br.newContext({ locale: 'ru-RU',  viewport: { width: 1440, height: 900 } }); const p = await c.newPage(); p.on('pageerror', (e) => errs.push(e.message.slice(0, 140))); p.on('response', (r) => { if (r.status() >= 500) errs.push(`${r.status()} ${r.url().slice(0, 80)}`) }); return p }
const A = await session(); await A.goto(`${O}/setup?code=${code}`); await A.getByLabel('Ваше имя').fill('Анна'); await A.getByLabel('Название семьи').fill('Лесные'); await A.locator('input[type=checkbox]').check(); await A.getByRole('button', { name: 'Создать архив' }).click(); await A.getByRole('button', { name: 'Перейти к архиву' }).click({ timeout: 20000 }); await A.waitForSelector('.pcard', { timeout: 20000 })
const invite = async (name, role) => (await A.evaluate(async (b) => (await fetch('/api/v1/invites', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json(), { name, role })).token
const enter = async (name, role) => { const p = await session(); await p.goto(`${O}/invite/${await invite(name, role)}`); await p.getByRole('button', { name: 'Принять приглашение' }).click(); await p.waitForSelector('.pcard', { timeout: 15000 }); return p }
const B = await enter('Пётр', 'editor'); const R = await enter('Читатель', 'reader')
await sleep(800)
const label = (p) => p.locator('.presence').getAttribute('aria-label').catch(() => '')
ok('presence: Анна sees who else is here', /Пётр/.test(await label(A)) && /Читатель/.test(await label(A)), await label(A))
const open = async (p, name) => { await p.locator('.pcard', { hasText: name }).first().click(); await p.waitForSelector('aside.panel') }
await open(A, 'Иван'); await open(B, 'Иван'); await sleep(600)
ok('presence: card says who else has it open', (await A.locator('aside.panel').innerText()).includes('Здесь также: Пётр'))
await A.getByRole('tab', { name: 'Сведения' }).click(); await B.getByRole('tab', { name: 'Сведения' }).click()
await A.locator('#f-birth-place').fill('Рига'); await A.locator('#f-birth-place').blur()
await B.waitForFunction(() => document.querySelector('#f-birth-place')?.value === 'Рига', null, { timeout: 4000 }).then(() => ok('live: edit reaches the other screen without reload', true)).catch(() => ok('live: edit reaches the other screen without reload', false))
await B.locator('#f-death-place').click(); await B.keyboard.type('Пишу медленно')
await A.locator('#f-death-place').fill('Москва'); await A.locator('#f-death-place').blur(); await sleep(1500)
ok('typing is not wiped by an arriving edit', (await B.locator('#f-death-place').inputValue()) === 'Пишу медленно')
await B.locator('#f-death-place').blur(); await sleep(1500)
const notice = await B.locator('body').innerText()
ok('conflict: told plainly', notice.includes('только что изменил другой человек'))
ok('conflict: shows the value that stands', (await B.locator('#f-death-place').inputValue()) === 'Москва', await B.locator('#f-death-place').inputValue())
const server = await A.evaluate(async () => { const g = await (await fetch('/api/v1/graph')).json(); return g.persons.find((p) => p.givenName === 'Иван') })
ok('conflict: first edit kept on the server', server.deathPlace === 'Москва')
const addFact = async (p, kind) => { await p.locator('aside.panel').getByRole('button', { name: 'Добавить факт' }).click(); await p.locator('[data-slot=popover-content]').getByRole('button', { name: kind, exact: true }).click() }
await Promise.all([addFact(A, 'Служба'), addFact(B, 'Награда')]); await sleep(1800)
const facts = (await A.evaluate(async () => (await (await fetch('/api/v1/graph')).json()).persons.find((p) => p.givenName === 'Иван').facts)).map((f) => f.kind)
ok('lists: two facts added at once both survive', facts.includes('Служба') && facts.includes('Награда'), facts.join(','))
const id = server.id
const burst = await A.evaluate(async ({ id }) => { const r = await Promise.all([...Array(30)].map((_, i) => fetch(`/api/v1/persons/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tags: [`метка${i}`], seen: { tags: [] } }) }).then((x) => x.status))); const g = await (await fetch('/api/v1/graph')).json(); return { codes: [...new Set(r)], tags: g.persons.find((p) => p.id === id).tags.length } }, { id })
ok('30 writes at once: all merged, none failed', burst.tags === 30 && burst.codes.join() === '200', JSON.stringify(burst))
// What a reader's line can reveal.
const living = await A.evaluate(async () => { const g = await (await fetch('/api/v1/graph')).json(); return g.persons.find((p) => p.living && p.id).id })
await A.keyboard.press('Escape'); await A.goto(`${O}/?person=${living}`); await A.waitForSelector('.pcard'); await open(A, 'Алиса'); await sleep(500)
const heard = await R.evaluate(() => new Promise((res) => { const out = []; const s = new EventSource('/api/events'); s.addEventListener('presence', (e) => out.push(e.data)); setTimeout(() => { s.close(); res(out.join('|')) }, 900) }))
ok('reader: told nothing about whose living card is open', !heard.includes(living) && !/Алиса|Соколов/.test(heard), heard.slice(0, 120))
const gr = await R.evaluate(async () => await (await fetch('/api/v1/graph')).text())
ok('reader: no living names in the graph', !gr.includes('Алиса'))
const e1 = await A.evaluate(async () => { const a = await fetch('/api/v1/graph'); const tag = a.headers.get('etag'); const b = await fetch('/api/v1/graph', { cache: 'no-store', headers: { 'if-none-match': tag } }); return { tag, status: b.status } })
ok('unchanged graph travels as 304', e1.status === 304, JSON.stringify(e1))
// A person deleted while another has them open.
await A.goto(O + '/'); await A.waitForSelector('.pcard'); await B.goto(O + '/'); await B.waitForSelector('.pcard')
const victim = await A.evaluate(async () => { const r = await fetch('/api/v1/persons', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ person: { givenName: 'Временный', surname: 'Тестов', birthDate: '1900', deathDate: '1950' } }) }); return (await r.json()).id })
await B.waitForSelector('.pcard:has-text("Временный")', { timeout: 5000 }); ok('new person appears on the other screen by itself', true)
await open(B, 'Временный'); await B.getByRole('tab', { name: 'Сведения' }).click(); await B.locator('#f-birth-place').click(); await B.keyboard.type('Город')
await A.evaluate(async (id) => fetch(`/api/v1/persons/${id}`, { method: 'DELETE' }), victim); await sleep(1500)
ok('deleted person disappears from the other screen, card closes', !(await B.locator('.pcard:has-text("Временный")').count()) && !(await B.locator('aside.panel').count()))
// Links made twice at once.
const pair = await A.evaluate(async () => { const g = await (await fetch('/api/v1/graph')).json(); const m = g.persons.filter((p) => !p.living).slice(0, 2); const r = await Promise.all([1, 2, 3, 4].map(() => fetch('/api/v1/relations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'spouse', other: m[1].id, to: m[0].id }) }).then((x) => x.status))); return r })
ok('same link four times at once: no server error', !pair.some((s) => s >= 500), pair.join())
// A big upload under the memory ceiling.
const before = q(`docker stats fgb --no-stream --format '{{.MemUsage}}'`).split('/')[0]
const big = await A.evaluate(async () => { const n = 30 * 1024 * 1024; const b = new Uint8Array(n); for (let i = 0; i < n; i += 4096) crypto.getRandomValues(b.subarray(i, i + 4096)); const fd = new Blob([b]); const d = await new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result.split(',')[1]); f.readAsDataURL(fd) }); const res = await fetch('/api/v1/media', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filename: 'big.bin', base64: d }) }); return res.status })
await sleep(1500); const after = q(`docker stats fgb --no-stream --format '{{.MemUsage}}'`).split('/')[0]; const up = (await fetch(O + '/api/health')).ok
ok('30 MB upload: server survives under the ceiling', up && big < 500, `status ${big}, ${before}→${after}`)
ok('no page or server errors in any browser', errs.length === 0, errs.slice(0, 4).join(' | '))
console.log('table sizes:', q(`docker exec fgb node -e "const D=require('better-sqlite3');const d=new D('/data/family.db',{readonly:true});try{console.log(JSON.stringify(d.prepare('select name,sum(pgsize) s from dbstat group by name order by s desc limit 6').all()))}catch(e){console.log(e.message)}"`).slice(0, 300))
await br.close(); q('docker rm -fv fgb')
