// A copy from one server, restored on a clean one, compared by content. Then what happens under the limits.
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { boot, IMAGE, sh, sleep, stats, waitUp } from '../e2e/lib.mjs'

// A long pause leaves an idle connection the server has already closed: not a failure of the app, so try once more.
const plainFetch = globalThis.fetch
globalThis.fetch = (url, init) => plainFetch(url, init).catch((e) => { if (e.cause?.code === 'UND_ERR_SOCKET' && !init?.body) return plainFetch(url, init); throw e })

const ok = (name, good, note = '') => { console.log(`${good ? 'PASS' : 'FAIL'} ${name}${note ? ' · ' + note : ''}`); if (!good) process.exitCode = 1 }
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'family-restore-'))
const sum = (b) => createHash('sha256').update(b).digest('hex')
const jpg = fs.readFileSync(new URL('../fixtures/photo.jpg', import.meta.url))

const A = await boot('fg-backup-a', 3450, IMAGE, { people: 300, args: '-m 256m --memory-swap 256m' })
const hA = { cookie: A.cookie, origin: A.B, 'content-type': 'application/json' }
const g0 = await (await fetch(A.B + '/api/v1/graph', { headers: { cookie: A.cookie } })).json()
const someone = g0.persons[0].id
await fetch(`${A.B}/api/v1/persons/${someone}`, { method: 'PATCH', headers: hA, body: JSON.stringify({ birthPlace: 'Город до копии' }) })
const photos = []
for (let i = 0; i < 3; i++) {
  const f = new FormData(); f.set('file', new Blob([jpg]), `${i}.jpg`); f.set('personId', g0.persons[i].id)
  photos.push(await (await fetch(A.B + '/api/v1/media', { method: 'POST', headers: { cookie: A.cookie, origin: A.B }, body: f })).json())
}
// Heavy files: photos in the data folder, far more than the 256 MB heap limit.
sh(`docker exec fg-backup-a sh -c 'for i in 1 2 3 4 5 6; do dd if=/dev/urandom of=/data/media/bulk$i.file.bin bs=1M count=100 2>/dev/null; done; chown -R node:node /data/media'`)
const before = stats('fg-backup-a')
const peak = { v: 0 }
const watch = setInterval(() => { try { peak.v = Math.max(peak.v, stats('fg-backup-a').anonMB) } catch {} }, 500)
const file = path.join(work, 'copy.zip')
const t0 = Date.now()
const res = await fetch(A.B + '/api/archive', { headers: { cookie: A.cookie } })
ok('the owner can download a copy', res.status === 200, `${res.headers.get('content-disposition')}`)
const out = fs.createWriteStream(file)
for await (const c of res.body) if (!out.write(c)) await new Promise((r) => out.once('drain', r))
await new Promise((r) => out.end(r))
clearInterval(watch)
const size = fs.statSync(file).size
ok('a 600 MB copy stays within the memory limit', sh(`docker inspect fg-backup-a -f '{{.State.OOMKilled}} {{.RestartCount}}'`) === 'false 0' && peak.v - before.anonMB < 80, `${Math.round(size / 1048576)} MB in ${Date.now() - t0} ms, program memory ${before.anonMB} → peak ${peak.v} MB`)
ok('nothing temporary is left', !sh(`docker exec fg-backup-a sh -c 'ls -a /data | grep -E "^\\.(archive|restore)" || true'`))
const bytes = fs.readFileSync(file)
ok('no session in the copy', !bytes.includes(A.cookie.split('=')[1].split('.')[0]))

// Who may not.
const reader = await (await fetch(A.B + '/api/v1/invites', { method: 'POST', headers: hA, body: JSON.stringify({ name: 'Читатель', role: 'reader' }) })).json()
const acc = await fetch(A.B + '/api/auth/family/accept', { method: 'POST', headers: { 'content-type': 'application/json', origin: A.B }, body: JSON.stringify({ token: reader.token }) })
const rc = acc.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
ok('a reader cannot download', (await fetch(A.B + '/api/archive', { headers: { cookie: rc } })).status >= 400)
ok('nobody signed out can download', (await fetch(A.B + '/api/archive')).status === 401)
ok('a reader cannot restore', (await fetch(A.B + '/api/archive', { method: 'POST', headers: { cookie: rc, origin: A.B, 'content-type': 'application/zip' }, body: bytes.subarray(0, 10) })).status === 403)
ok('a foreign page cannot restore', (await fetch(A.B + '/api/archive', { method: 'POST', headers: { cookie: A.cookie, origin: 'https://evil.example', 'content-type': 'application/zip' }, body: bytes.subarray(0, 10) })).status === 403)
const garbage = await fetch(A.B + '/api/archive', { method: 'POST', headers: { cookie: A.cookie, origin: A.B, 'content-type': 'application/zip' }, body: randomBytes(4096) })
ok('garbage is refused and the server lives', garbage.status === 400 && (await fetch(A.B + '/api/health')).ok, String(garbage.status))

// A clean server.
const Bname = 'fg-backup-b', Bport = 3451, BB = `http://localhost:${Bport}`
try { sh(`docker rm -fv ${Bname}`) } catch {}
try { sh(`docker volume rm ${Bname}-data`) } catch {}
sh(`docker run -d --name ${Bname} --restart=on-failure -p 127.0.0.1:${Bport}:3000 -v ${Bname}-data:/data -e BETTER_AUTH_URL=${BB} -e SETUP_TOKEN=clean-code ${IMAGE}`)
await waitUp(BB)
const send = (headers) => fetch(BB + '/api/archive', { method: 'POST', headers: { origin: BB, 'content-type': 'application/zip', ...headers }, body: fs.createReadStream(file), duplex: 'half' })
ok('a wrong setup code is refused', (await send({ 'x-setup-code': 'nope' })).status === 403)
const rr = await send({ 'x-setup-code': 'clean-code' })
const rep = await rr.json()
ok('a clean server accepts the copy', rr.status === 200 && rep.people === g0.persons.length, JSON.stringify({ ...rep, login: !!rep.login }))
await sleep(1500); await waitUp(BB)
ok('the server came back by itself', sh(`docker inspect ${Bname} -f '{{.State.Running}}'`) === 'true')
const ac = await fetch(BB + '/api/auth/family/accept', { method: 'POST', headers: { 'content-type': 'application/json', origin: BB }, body: JSON.stringify({ token: rep.login.split('/invite/')[1] }) })
const ck = ac.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
ok('the owner gets in with the link from the reply', ac.ok && !!ck)
const g1 = await (await fetch(BB + '/api/v1/graph', { headers: { cookie: ck } })).json()
const strip = (g) => JSON.stringify(g)
ok('everyone and all links are the same', strip(g1) === strip(await (await fetch(A.B + '/api/v1/graph', { headers: { cookie: A.cookie } })).json()), `${g1.persons.length} people`)
ok('the edit made before the copy is there', g1.persons.find((p) => p.id === someone)?.birthPlace === 'Город до копии')
for (const size of ['orig', 'thumb']) {
  const [a, b] = await Promise.all([A.B, BB].map((base, i) => fetch(`${base}/api/v1/media/${photos[0].id}/file?size=${size}`, { headers: { cookie: i ? ck : A.cookie } }).then((r) => r.arrayBuffer()).then((x) => sum(Buffer.from(x)))))
  ok(`photo ${size} is identical`, a === b)
}
const bulk = (name) => sh(`docker exec ${name} sh -c 'cat /data/media/bulk*.file.bin | sha256sum'`)
ok('every heavy file is identical', bulk('fg-backup-a') === bulk(Bname))
const hist = await fetch(BB + '/api/v1/history?limit=5', { headers: { cookie: ck } }); ok('history came along', hist.ok && (await hist.json()).length > 0)
ok('a used link does not work twice', !(await fetch(BB + '/api/auth/family/accept', { method: 'POST', headers: { 'content-type': 'application/json', origin: BB }, body: JSON.stringify({ token: rep.login.split('/invite/')[1] }) })).ok)
const w = await fetch(`${BB}/api/v1/persons/${someone}`, { method: 'PATCH', headers: { cookie: ck, origin: BB, 'content-type': 'application/json' }, body: JSON.stringify({ birthPlace: 'После восстановления' }) })
ok('the restored archive takes new edits', w.ok)
sh(`docker restart ${Bname}`); await waitUp(BB)
const g2 = await (await fetch(BB + '/api/v1/graph', { headers: { cookie: ck } })).json()
ok('they survive a restart, and so does the sign-in', g2.persons?.find((p) => p.id === someone)?.birthPlace === 'После восстановления')

// Over an archive in use: the old one is kept.
const over = await fetch(BB + '/api/archive', { method: 'POST', headers: { cookie: ck, origin: BB, 'content-type': 'application/zip' }, body: fs.createReadStream(file), duplex: 'half' })
ok('the owner can restore over the archive', over.status === 200)
await sleep(1500); await waitUp(BB)
ok('the previous archive is kept', sh(`docker exec ${Bname} sh -c 'ls /data/backups/before-restore'`).includes('family.db'))
// By hand, in a browser: the setup screen of a third, clean server.
const { chromium } = await import('playwright-core')
const Cname = 'fg-backup-c', Cport = 3452, CC = `http://localhost:${Cport}`
try { sh(`docker rm -fv ${Cname}`) } catch {}
try { sh(`docker volume rm ${Cname}-data`) } catch {}
sh(`docker run -d --name ${Cname} --restart=on-failure -p 127.0.0.1:${Cport}:3000 -v ${Cname}-data:/data -e BETTER_AUTH_URL=${CC} -e SETUP_TOKEN=clean-code ${IMAGE}`)
await waitUp(CC)
const br = await chromium.launch({ channel: 'chrome', headless: true })
const page = await (await br.newContext({ locale: 'ru-RU',  viewport: { width: 1280, height: 900 } })).newPage()
await page.goto(`${CC}/setup?code=clean-code`)
await page.getByText('У меня есть копия архива').click()
await page.locator('input[type=file]').setInputFiles(file)
await page.getByRole('button', { name: 'Восстановить из этого файла' }).click()
await page.getByText('Архив восстановлен.').waitFor({ timeout: 120000 })
await page.getByRole('link', { name: 'Войти в архив' }).click()
await page.getByRole('button', { name: 'Принять приглашение' }).click()
await page.locator('.pcard').first().waitFor({ timeout: 30000 })
ok('in a browser: copy chosen on the setup screen, then signed in and the chart is there', true)
await page.locator('nav button[aria-label="Проверка"]').click()
await page.getByRole('radio', { name: 'Что заполнить' }).click()
await page.getByText('Не указано:').first().waitFor({ timeout: 10000 })
ok('the list of what to check opens', true)
await page.locator('nav button[aria-label="Настройки"]').click()
await page.locator('[role=dialog]').getByRole('button', { name: 'Данные и резервные копии' }).click()
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByRole('link', { name: 'Скачать полную копию' }).click()])
await dl.cancel()
ok('the owner finds the download in settings', dl.suggestedFilename().startsWith('folkbranch-archive-'), dl.suggestedFilename())
await br.close()
sh(`docker rm -fv ${Cname}`)
try { sh(`docker volume rm ${Cname}-data`) } catch {}
sh(`docker rm -fv fg-backup-a ${Bname}`)
try { sh(`docker volume rm fg-backup-a-data ${Bname}-data`) } catch {}
fs.rmSync(work, { recursive: true, force: true })
