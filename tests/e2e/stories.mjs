// A voice recorded in a real browser with a fake microphone, played back, jumped through, and kept from who should not hear it.
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { IMAGE, sh, sleep, waitUp } from './lib.mjs'

const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' · ' + x : ''}`); if (!c) process.exitCode = 1 }
const O = 'http://localhost:3446'
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'family-stories-'))
try { sh('docker rm -fv fg-stories') } catch {}
sh(`docker run -d --name fg-stories -p 127.0.0.1:3446:3000 -e BETTER_AUTH_URL=${O} -e SETUP_TOKEN=x ${IMAGE}`)
await waitUp(O)
const r = await fetch(O + '/api/auth/family/setup', { method: 'POST', headers: { 'content-type': 'application/json', origin: O }, body: JSON.stringify({ name: 'Анна', familyName: 'Лесные', language: 'ru', demo: true, code: 'x' }) })
const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
const call = async (method, p, json, c = cookie, extra = {}) => fetch(`${O}/api/v1/${p}`, { method, headers: { cookie: c, origin: O, ...(json ? { 'content-type': 'application/json' } : {}), ...extra }, ...(json ? { body: JSON.stringify(json) } : {}) })
const g = await (await call('GET', 'graph')).json()
const dead = g.persons.filter((p) => !p.living)
const living = g.persons.filter((p) => p.living)
const subject = dead[0], tellerCard = dead[1]
const nameOf = (p) => [p.givenName, p.surname].join(' ')

const br = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })
const errs = []
const session = async (name, browser = br) => {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const p = await c.newPage()
  p.on('pageerror', (e) => errs.push(`${name}: ${e.message.slice(0, 160)}`))
  return p
}
const openCard = async (p, person) => {
  await p.locator('.pcard .nm', { hasText: person.givenName }).first().click()
  await p.locator('.panel').waitFor(); await sleep(250)
  await p.getByRole('tab', { name: 'Рассказы' }).click(); await sleep(250)
}
const record = async (p, seconds) => {
  await p.getByRole('button', { name: 'Записать рассказ' }).click()
  await p.getByRole('dialog').waitFor(); await sleep(200)
  await p.getByRole('button', { name: 'Записать голос' }).click()
  await p.getByText('Идёт запись').waitFor({ timeout: 8000 })
  await sleep(seconds * 1000)
  await p.getByRole('button', { name: 'Остановить' }).click()
  await p.locator('[role=dialog] audio').waitFor()
}
const measure = (p, sel = '.panel article audio') => p.locator(sel).first().evaluate(async (a) => {
  for (let i = 0; i < 40 && !(a.duration > 0 && a.duration !== Infinity); i++) await new Promise((r) => setTimeout(r, 150))
  const duration = a.duration
  a.currentTime = duration / 2
  await new Promise((r) => { a.addEventListener('seeked', r, { once: true }); setTimeout(r, 3000) })
  const seeked = a.currentTime
  await a.play().catch(() => {})
  await new Promise((r) => setTimeout(r, 600))
  const moved = a.currentTime > seeked
  a.pause()
  return { duration, seeked, moved, error: a.error?.message ?? null }
})

// The owner records.
const owner = await session('owner')
await owner.context().addCookies(cookie.split('; ').map((x) => ({ name: x.split('=')[0], value: x.slice(x.indexOf('=') + 1), domain: 'localhost', path: '/', httpOnly: true })))
await owner.goto(O + '/'); await owner.locator('.pcard').first().waitFor({ timeout: 20000 }); await sleep(600)
await openCard(owner, subject)
await record(owner, 4)
await owner.screenshot({ path: '/tmp/family-stories-dialog.png' })
ok('the owner can listen before saving', await owner.locator('[role=dialog] audio').count() === 1)
await owner.getByLabel('Название').fill('Как он вернулся')
await owner.getByRole('button', { name: 'Выбрать человека' }).click()
await owner.getByRole('dialog').getByPlaceholder(/Поиск|Найти|Имя/).first().fill(tellerCard.givenName).catch(() => {})
await sleep(300)
await owner.getByRole('option', { name: new RegExp(tellerCard.givenName) }).first().click().catch(async () => { await owner.getByText(nameOf(tellerCard)).last().click() })
await owner.getByLabel('Текст или расшифровка').fill('Вернулся весной, пешком от станции.')
await owner.getByRole('button', { name: 'Сохранить' }).click()
await owner.locator('.panel article').first().waitFor({ timeout: 10000 }); await sleep(400)
const said = await owner.locator('.panel article').first().innerText()
ok('the story stands with its words and who told it', said.includes('Как он вернулся') && said.includes('Вернулся весной') && said.includes(tellerCard.givenName), said.slice(0, 80).replace(/\n/g, ' '))
const played = await measure(owner)
ok('it plays, knows its length and can be jumped through', played.duration > 2 && played.duration < 60 && played.seeked > 0 && played.moved && !played.error, JSON.stringify(played))
await owner.screenshot({ path: '/tmp/family-stories-card.png' })

const [story] = await (await call('GET', `persons/${subject.id}/stories`)).json()
const audio = `stories/${story.id}/audio`
const whole = await call('GET', audio)
const bytes = Buffer.from(await whole.arrayBuffer())
ok('kept as the browser made it', whole.status === 200 && bytes.subarray(0, 4).toString('hex') === '1a45dfa3' && whole.headers.get('content-type') === 'audio/webm', `${bytes.length} bytes`)
const part = await call('GET', audio, null, cookie, { range: 'bytes=10-19' })
ok('a range comes back as a range', part.status === 206 && part.headers.get('content-range') === `bytes 10-19/${bytes.length}` && Buffer.compare(Buffer.from(await part.arrayBuffer()), bytes.subarray(10, 20)) === 0)
const tail = await call('GET', audio, null, cookie, { range: 'bytes=-5' })
ok('the end of the file too', tail.status === 206 && Buffer.compare(Buffer.from(await tail.arrayBuffer()), bytes.subarray(-5)) === 0)
ok('a range past the end is refused', (await call('GET', audio, null, cookie, { range: `bytes=${bytes.length + 5}-` })).status === 416)
ok('the voice is not among the photos', !(await (await call('GET', 'media')).json()).some((m) => m.kind === 'audio'))

// A fact from the story, with the story as its source.
await owner.getByRole('button', { name: 'Сделать фактом' }).first().click()
await owner.getByRole('dialog').waitFor(); await sleep(200)
await owner.getByLabel('Что произошло').fill('Возвращение')
await owner.getByLabel('Дата').fill('1945')
await owner.getByRole('button', { name: 'Сохранить' }).click(); await sleep(800)
const fact = (await (await call('GET', 'graph')).json()).persons.find((p) => p.id === subject.id).facts.at(-1)
ok('the fact says where it came from', fact?.kind === 'Возвращение' && fact.source.includes('Как он вернулся') && fact.source.includes(tellerCard.givenName), fact?.source)

// A file from an old tape.
const wav = path.join(work, 'плёнка.wav')
const samples = Buffer.alloc(16000 * 2, 0)
const head = Buffer.alloc(44); head.write('RIFF', 0); head.writeUInt32LE(36 + samples.length, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(16000, 24); head.writeUInt32LE(32000, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(samples.length, 40)
fs.writeFileSync(wav, Buffer.concat([head, samples]))
await owner.getByRole('button', { name: 'Записать рассказ' }).click(); await owner.getByRole('dialog').waitFor(); await sleep(200)
await owner.locator('[role=dialog] input[type=file]').setInputFiles(wav); await sleep(300)
await owner.getByLabel('Название').fill('С плёнки')
await owner.getByRole('button', { name: 'Сохранить' }).click(); await sleep(1000)
ok('an old recording from a file goes in too', (await (await call('GET', `persons/${subject.id}/stories`)).json()).some((s) => s.title === 'С плёнки' && s.hasAudio))
const fake = path.join(work, 'x.webm'); fs.writeFileSync(fake, '<script>alert(1)</script>'.repeat(10))
await owner.getByRole('button', { name: 'Записать рассказ' }).click(); await owner.getByRole('dialog').waitFor(); await sleep(200)
await owner.locator('[role=dialog] input[type=file]').setInputFiles(fake); await sleep(300)
await owner.getByRole('button', { name: 'Сохранить' }).click()
await owner.locator('[role=dialog] [role=alert]').waitFor()
ok('a file that is not sound is refused, in words', (await owner.locator('[role=dialog] [role=alert]').innerText()).includes('не похож'))
await owner.keyboard.press('Escape'); await sleep(300)

// No microphone allowed.
const noMic = await chromium.launch({ channel: 'chrome', headless: true })
const denied = await session('denied', noMic)
await denied.context().addCookies(cookie.split('; ').map((x) => ({ name: x.split('=')[0], value: x.slice(x.indexOf('=') + 1), domain: 'localhost', path: '/', httpOnly: true })))
await denied.goto(O + '/'); await denied.locator('.pcard').first().waitFor({ timeout: 20000 }); await sleep(500)
await openCard(denied, subject)
await denied.getByRole('button', { name: 'Записать рассказ' }).click(); await denied.getByRole('dialog').waitFor(); await sleep(200)
await denied.getByRole('button', { name: 'Записать голос' }).click()
await denied.locator('[role=dialog] [role=alert]').waitFor({ timeout: 8000 })
ok('without a microphone it says so and offers a file', (await denied.locator('[role=dialog] [role=alert]').innerText()).includes('выберите файл'))
await noMic.close()

// A reader tells a story; the owner hears it first.
const inv = await (await call('POST', 'invites', { name: 'Тётя Зина', role: 'reader' })).json()
const R = await session('reader')
const denials = []
R.on('response', (x) => { if (x.status() >= 400 && x.url().includes('/api/')) denials.push(`${x.status()} ${x.url().replace(O, '')}`) })
await R.goto(`${O}/invite/${inv.token}`)
await R.getByRole('button', { name: 'Принять приглашение' }).click()
await R.locator('.pcard').first().waitFor({ timeout: 20000 }); await sleep(600)
await openCard(R, subject)
const readerSees = await (await call('GET', `persons/${subject.id}/stories`, null, (await R.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; '))).json()
ok('a reader hears a voice whose teller has died', readerSees.find((s) => s.id === story.id)?.hasAudio === true)
ok('a reader gets no name without a card, no voice either', readerSees.find((s) => s.title === 'С плёнки')?.hasAudio === false)
const heard = await measure(R)
ok('and it plays for them', heard.duration > 0 && !heard.error, JSON.stringify(heard))
ok('a reader has no edit buttons', await R.getByRole('button', { name: 'Изменить рассказ' }).count() === 0 && await R.getByRole('button', { name: 'Сделать фактом' }).count() === 0)
await record(R, 2)
await R.getByLabel('Название').fill('Со слов тёти')
await R.getByRole('button', { name: 'Сохранить' }).click()
await R.getByText('Рассказ отправлен').waitFor({ timeout: 8000 })
ok('the reader is told it went', true)
ok('nothing the reader does runs into a refusal', denials.length === 0, denials.slice(0, 3).join(', '))
ok('it is not in the archive yet', !(await (await call('GET', `persons/${subject.id}/stories`)).json()).some((s) => s.title === 'Со слов тёти'))
await sleep(1500)
await owner.locator('nav[aria-label="Главное меню"]').getByRole('button', { name: /История/ }).click(); await sleep(400)
await owner.getByText('Тётя Зина', { exact: true }).waitFor({ timeout: 8000 })
ok('the owner can listen before accepting', await owner.locator('.side-sheet:not([hidden]) audio').count() === 1)
const queued = await owner.locator('.side-sheet:not([hidden]) audio').evaluate(async (a) => { a.preload = 'metadata'; a.load(); await new Promise((r) => { a.addEventListener('loadedmetadata', r, { once: true }); a.addEventListener('error', r, { once: true }); setTimeout(r, 4000) }); return { error: a.error?.message ?? null, ready: a.readyState } })
ok('and it loads', !queued.error && queued.ready > 0, JSON.stringify(queued))
await owner.screenshot({ path: '/tmp/family-stories-review.png' })
await owner.getByRole('button', { name: 'Принять' }).click(); await sleep(800)
ok('accepted, it stands under the reader\'s name', (await (await call('GET', `persons/${subject.id}/stories`)).json()).find((s) => s.title === 'Со слов тёти')?.createdBy === 'Тётя Зина')

// A guest, and everyone else at the door.
const { token } = await (await call('POST', 'shares', { name: 'Кузен' })).json()
const G = await session('guest')
const gDenied = []
G.on('response', (x) => { if (x.status() >= 400 && x.url().includes('/api/')) gDenied.push(`${x.status()} ${x.url().replace(O, '')}`) })
await G.goto(`${O}/share/${token}`); await G.getByRole('button', { name: 'Открыть архив' }).click()
await G.locator('.pcard').first().waitFor({ timeout: 20000 }); await sleep(600)
await openCard(G, subject)
ok('a guest reads the story and has no way to add one', await G.locator('.panel article').count() > 0 && await G.getByRole('button', { name: 'Записать рассказ' }).count() === 0)
ok('nothing the guest does runs into a refusal', gDenied.length === 0, gDenied.slice(0, 3).join(', '))
const gc = (await G.context().cookies()).filter((c) => c.name === 'fb_view').map((c) => `${c.name}=${c.value}`).join('; ')
const form = new FormData(); form.set('story', JSON.stringify({ about: [subject.id], body: 'x' }))
ok('a guest cannot post one', (await fetch(`${O}/api/v1/stories`, { method: 'POST', headers: { cookie: gc, origin: O }, body: form })).status === 403)
ok('a guest cannot change or delete one', (await call('DELETE', `stories/${story.id}`, null, gc)).status === 403 && (await call('GET', `stories/usage`, null, gc)).status === 403)
ok('a stranger hears nothing', (await fetch(`${O}/api/v1/${audio}`)).status === 401)
const { token: api } = await (await call('POST', 'tokens', { name: 'робот', role: 'editor' })).json()
ok('a token hears nothing and tells nothing', (await fetch(`${O}/api/v1/${audio}`, { headers: { authorization: `Bearer ${api}` } })).status === 404 && (await fetch(`${O}/api/v1/persons/${subject.id}/stories`, { headers: { authorization: `Bearer ${api}` } })).status === 403)
const someoneAlive = living[0]
ok('a story cannot be told about someone hidden, through the API', (await fetch(`${O}/api/v1/stories`, { method: 'POST', headers: { cookie: (await R.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; '), origin: O }, body: (() => { const f = new FormData(); f.set('story', JSON.stringify({ about: [someoneAlive.id], body: 'x' })); return f })() })).status === 404)

// In the copy, and on the settings page.
await owner.locator('.side-sheet:not([hidden]) button[aria-label="Закрыть"]').first().click().catch(() => {})
const copy = path.join(work, 'archive.zip')
const zipped = await call('GET', '../archive')
fs.writeFileSync(copy, Buffer.from(await zipped.arrayBuffer()))
const names = execSync(`unzip -l "${copy}"`, { maxBuffer: 1e8 }).toString()
ok('the voices are in the downloaded copy', /\.voice\.webm/.test(names) && /\.voice\.wav/.test(names))
const usage = await (await call('GET', 'stories/usage')).json()
ok('the owner can see the room they take', usage.used > 0 && usage.limit > usage.used, JSON.stringify(usage))
ok('no page errors', errs.length === 0, errs.join(' | '))
await br.close(); sh('docker rm -fv fg-stories')
fs.rmSync(work, { recursive: true, force: true })
process.exit(process.exitCode ?? 0)
