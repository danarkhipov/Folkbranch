// One person on two devices, two accounts in one browser, and what signing out leaves on the device.
import { chromium } from 'playwright-core'
import { execSync as sh } from 'node:child_process'
import fs from 'node:fs'
const PORT = 3488, B = `http://127.0.0.1:${PORT}`
const q = (c) => { try { return sh(c, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim() } catch (e) { return 'ERR ' + e.stderr } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
q('docker rm -fv fg-dev'); q(`docker run -d --name fg-dev -p 127.0.0.1:${PORT}:3000 -e BETTER_AUTH_URL=${B} -e BETTER_AUTH_SECRET=${'d'.repeat(64)} ${process.env.FG_IMAGE ?? 'folkbranch:check'}`)
for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/api/health')).ok) break } catch {} await sleep(500) }
await sleep(1000)
const ok = (n, c, x = '') => console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x && !c ? '  ' + x : ''}`)
const info = () => {}
const br = await chromium.launch({ channel: 'chrome', headless: true })
const mk = () => br.newContext({ locale: 'ru-RU', viewport: { width: 1280, height: 800 } })
const errs = []
const page = async (ctx) => { const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); return p }
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t) } catch { return t } }

const A = await mk()
const code = q('docker logs fg-dev').match(/setup\?code=(\S+)/)[1]
info('setup', (await A.request.post(B + '/api/auth/family/setup', { headers: { origin: B }, data: { name: 'Анна', familyName: 'Проба', language: 'ru', demo: true, code } })).status())
const graph = async (ctx) => j(await ctx.request.get(B + '/api/v1/graph'))
const g0 = await graph(A)
const users = await j(await A.request.get(B + '/api/v1/users'))
const owner = (users.users ?? users).find((u) => u.role === 'owner')
const invite = async (body) => (await j(await A.request.post(B + '/api/v1/invites', { headers: { origin: B }, data: body }))).token
const accept = async (ctx, token) => (await ctx.request.post(B + '/api/auth/family/accept', { headers: { origin: B }, data: { token } })).status()
const Bd = await mk()
info('device B signs in as the owner', await accept(Bd, await invite({ name: 'Анна', role: 'owner', userId: owner.id })))

// ---------- 1. one person, two devices, the same card at once ----------
const dead = g0.persons.filter((p) => !p.living).at(3)
const P = dead ?? g0.persons[3]
const name = [P.givenName, P.surname].filter(Boolean).join(' ')
info('card', name)
const pa = await page(A), pb = await page(Bd)
const open = async (p) => {
  await p.goto(`${B}/?p=${P.id}`); await p.locator('.pcard').first().waitFor(); await p.waitForTimeout(800)
  if (!(await p.getByRole('tab', { name: 'Сведения' }).count())) {
    await p.getByRole('button', { name: 'Поиск' }).first().click(); await p.keyboard.type(name); await p.waitForTimeout(500); await p.keyboard.press('Enter'); await p.waitForTimeout(800)
  }
  await p.getByRole('tab', { name: 'Сведения' }).click(); await p.waitForTimeout(300)
}
await open(pa); await open(pb)
const addFact = async (p, kind, label, text) => {
  await p.getByRole('button', { name: 'Добавить факт' }).click(); await p.waitForTimeout(200)
  await p.getByRole('menuitem', { name: kind }).or(p.getByRole('button', { name: kind })).first().click(); await p.waitForTimeout(300)
  await p.getByLabel(label).last().click(); await p.keyboard.type(text); await p.keyboard.press('Tab'); await p.waitForTimeout(1200)
}
await addFact(pa, 'Ранение', 'Какое', 'в ногу, 1943')
await addFact(pb, 'Плен', 'Где содержался', 'шталаг 326')
await pa.waitForTimeout(2500)
let facts = (await graph(A)).persons.find((x) => x.id === P.id).facts
const kept = JSON.stringify(facts)
ok('both devices add a fact: neither is lost', kept.includes('в ногу') && kept.includes('шталаг'), kept.slice(0, 300))
ok('device A sees B\'s fact without reloading', (await pa.getByText('шталаг 326').count()) > 0 || (await pa.locator('textarea, input').evaluateAll((es) => es.some((e) => e.value.includes('шталаг')))))
ok('device B sees A\'s fact without reloading', (await pb.locator('textarea, input').evaluateAll((es) => es.some((e) => e.value.includes('в ногу')))))

// same fact text edited on both, the second without seeing the first
const fid = facts.find((f) => JSON.stringify(f).includes('в ногу')).id
const base = facts
const put = (ctx, list) => ctx.request.patch(`${B}/api/v1/persons/${P.id}`, { headers: { origin: B }, data: { facts: list, seen: { facts: base } } })
const edit = (txt) => base.map((f) => (f.id === fid ? { ...f, fields: { ...(f.fields ?? {}), 'Какое': txt } } : f))
const r1 = await put(A, edit('в ногу, Курск'))
const r2 = await put(Bd, edit('в руку'))
facts = (await graph(A)).persons.find((x) => x.id === P.id).facts
ok('one fact changed on both: the second is told and the first stays', !!fid && r1.status() === 200 && r2.status() === 409 && facts.find((f) => f.id === fid)?.fields?.['Какое'] === 'в ногу, Курск', `${fid} ${r1.status()} ${r2.status()} ${JSON.stringify(facts.find((f) => f.id === fid)?.fields)}`)

// a plain field on both: the second must be told, not silently win
const note0 = P.birthPlace ?? ''
const n1 = await A.request.patch(`${B}/api/v1/persons/${P.id}`, { headers: { origin: B }, data: { birthPlace: 'Курск', seen: { birthPlace: note0 } } })
const n2 = await Bd.request.patch(`${B}/api/v1/persons/${P.id}`, { headers: { origin: B }, data: { birthPlace: 'Орёл', seen: { birthPlace: note0 } } })
ok('a field changed on both: the later one gets a conflict', n1.status() === 200 && n2.status() === 409, `${n1.status()} ${n2.status()}`)

// the biography typed on both devices at once
const bio = async (p) => { await p.getByRole('tab', { name: 'Биография' }).click(); await p.waitForTimeout(600); const ed = p.locator('[contenteditable="true"]').first(); if (!(await ed.count())) { await p.getByRole('button', { name: /Начать|Написать|Создать/ }).first().click().catch(() => {}); await p.waitForTimeout(600) } return p.locator('[contenteditable="true"]').first() }
const ea = await bio(pa), eb = await bio(pb)
await ea.click(); await pa.keyboard.press('End'); await pa.keyboard.type(' Текст с телефона.'); await pa.waitForTimeout(400)
await eb.click(); await pb.keyboard.press('End'); await pb.keyboard.type(' Текст с ноутбука.'); await pb.waitForTimeout(3000)
const pages = await j(await A.request.get(`${B}/api/v1/persons/${P.id}/pages`))
const ptxt = JSON.stringify(pages)
const conflictShown = (await pb.getByText(/изменил|другом устройстве|новее|Кто-то/).count()) + (await pa.getByText(/изменил|другом устройстве|новее|Кто-то/).count())
info('biography on server has phone:', ptxt.includes('с телефона'), 'laptop:', ptxt.includes('с ноутбука'), 'conflict shown:', conflictShown)
ok('biography: nothing silently lost', (ptxt.includes('с телефона') && ptxt.includes('с ноутбука')) || conflictShown > 0)

// ---------- 2. sign out on other devices ----------
await pa.evaluate(() => fetch('/api/auth/revoke-other-sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))
const st = (await Bd.request.get(B + '/api/v1/graph')).status()
ok('a device signed out from another loses access at once', st === 401 || st === 403, String(st))
await pb.reload(); await pb.waitForTimeout(1500)
ok('…and its page goes to sign-in', /\/login/.test(pb.url()), pb.url())
await Bd.close()

// ---------- 3. one browser, two accounts, and sign-out ----------
const C = await mk()
info('owner signs in on a shared browser', await accept(C, await invite({ name: 'Анна', role: 'owner', userId: owner.id })))
const readerToken = await invite({ name: 'Читатель', role: 'reader' })
const g = await graph(C)
const living = g.persons.find((p) => p.living && p.avatarMediaId) ?? g.persons.find((p) => p.living)
info('living person with a photo:', !!living?.avatarMediaId, living && [living.givenName, living.surname].join(' '))
const pc = await page(C)
await pc.goto(`${B}/?p=${living.id}`); await pc.locator('.pcard').first().waitFor(); await pc.waitForTimeout(1500)
const png = fs.readFileSync(new URL('../../public/icon-512.png', import.meta.url))
const up = await C.request.post(B + '/api/v1/media', { headers: { origin: B }, multipart: { file: { name: 'secret.png', mimeType: 'image/png', buffer: png }, personId: living.id } })
const media = await j(up); info('photo of the living uploaded', up.status(), media.id ?? JSON.stringify(media).slice(0, 120))
const avatar = `/api/v1/media/${media.id ?? media.media?.id}/file?size=medium`
info('photo loads for the owner', await pc.evaluate((u) => fetch(u).then((r) => r.status), avatar))
// a draft that could not be sent: the server is unreachable for page saves
await pc.route('**/api/v1/pages/**', (r) => (r.request().method() === 'GET' ? r.continue() : r.abort()))
await pc.goto(`${B}/?p=${P.id}`); await pc.locator('.pcard').first().waitFor(); await pc.waitForTimeout(1200)
await pc.getByRole('tab', { name: 'Биография' }).click(); await pc.waitForTimeout(600)
if (!(await pc.locator('[contenteditable="true"]').count())) { await pc.getByRole('button', { name: /Новая страница/ }).first().click({ timeout: 5000 }).catch(() => {}); await pc.waitForTimeout(1200) }
const ed = pc.locator('[contenteditable="true"]').first()
if (await ed.count()) { await ed.click(); await pc.keyboard.type(' Секретный адрес: улица Тайная, 7.'); await pc.waitForTimeout(1500) } else info('no editor for the living person biography')
await pc.unroute('**/api/v1/pages/**')
// the page must not save it behind the test's back before sign-out
await pc.route('**/api/v1/pages/**', (r) => (r.request().method() === 'GET' ? r.continue() : r.abort()))
const before = await pc.evaluate(async () => ({ ls: Object.keys(localStorage), idb: (await indexedDB.databases?.())?.map((d) => d.name) ?? [], caches: await caches.keys() }))
info('before sign-out', JSON.stringify(before))
// sign out the way a person does
await pc.goto(B + '/'); await pc.locator('.pcard').first().waitFor(); await pc.waitForTimeout(500)
await pc.getByRole('button', { name: 'Настройки' }).first().click(); await pc.waitForTimeout(500)
await pc.getByRole('button', { name: /Мой аккаунт/ }).or(pc.getByRole('tab', { name: /Мой аккаунт/ })).first().click(); await pc.waitForTimeout(500)
await pc.getByRole('button', { name: 'Выйти с этого устройства' }).click(); await pc.waitForTimeout(600)
const warned = await pc.getByText(/ещё не дошёл до сервера/).count()
ok('signing out with unsent text asks first', warned > 0)
if (warned) await pc.getByRole('alertdialog').or(pc.getByRole('dialog')).getByRole('button', { name: 'Выйти' }).click()
await pc.waitForURL(/login/, { timeout: 8000 }).catch(() => {})
await pc.waitForTimeout(800)
const after = await pc.evaluate(async (u) => {
  const draft = Object.keys(localStorage).filter((k) => k.startsWith('page-draft')).map((k) => localStorage.getItem(k))
  let photo = null
  if (u) { try { const r = await fetch(u, { cache: 'only-if-cached', mode: 'same-origin' }); photo = r.status } catch (e) { photo = 'not cached' } }
  return { url: location.pathname, ls: Object.keys(localStorage), draft, idb: (await indexedDB.databases?.())?.map((d) => d.name) ?? [], caches: await caches.keys(), photo }
}, avatar)
info('after sign-out', JSON.stringify(after))
ok('sign-out leads to the sign-in page', after.url.startsWith('/login'), after.url)
ok('no unsent family text left in the browser', !after.draft.some((d) => d?.includes('Тайная')), after.draft.join('|').slice(0, 200))
ok('a living relative\'s photo is not left in the browser cache', after.photo !== 200, String(after.photo))
// a reader signs in on the same browser
info('reader signs in on the same browser', await accept(C, readerToken))
const rg = await graph(C)
ok('the reader does not see the living person', rg.persons.find((p) => p.id === living.id)?.hidden === true)
await pc.goto(`${B}/`); await pc.locator('.pcard').first().waitFor(); await pc.waitForTimeout(1000)
const seen = await pc.evaluate(async (u) => { let photo = null; if (u) { try { photo = (await fetch(u, { cache: 'force-cache' })).status } catch { photo = 'err' } } return { text: document.body.innerText.includes('Тайная'), photo } }, avatar)
ok('the reader is not shown the owner\'s unsent text', !seen.text)
ok('the reader cannot open the living person\'s photo, even from the cache', seen.photo !== 200, String(seen.photo))
// a session that ran out without a sign-out, then someone else signs in
const D = await mk(); const pd = await page(D)
info('owner signs in on a second shared browser', await accept(D, await invite({ name: 'Анна', role: 'owner', userId: owner.id })))
await pd.goto(B + '/'); await pd.locator('.pcard').first().waitFor()
info('owner views the photo', await pd.evaluate((u) => fetch(u).then((r) => r.status), avatar))
await D.clearCookies()
info('reader signs in after the session ran out', await accept(D, await invite({ name: 'Читатель 2', role: 'reader' })))
await pd.goto(B + '/'); await pd.locator('.pcard').first().waitFor()
const expired = await pd.evaluate((u) => fetch(u).then((r) => r.status), avatar)
ok('after a session ran out, the next person cannot open a photo the first one saw', expired !== 200, String(expired))
ok('no page errors', errs.length === 0, errs.join(' | ').slice(0, 300))
await br.close()
q('docker rm -fv fg-dev')
