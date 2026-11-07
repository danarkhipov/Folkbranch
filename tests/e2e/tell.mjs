// Asking for a story, both ends: the owner makes the link, a relative with no account records on a phone, the owner accepts.
// Needs an archive: pnpm build && node scripts/make-bundle.mjs. The microphone is Chrome's fake one.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'
import { sleep, waitUp } from './lib.mjs'

const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x && !c ? ' · ' + x : ''}`); if (!c) process.exitCode = 1 }
const repo = fileURLToPath(new URL('../..', import.meta.url))
const bundleFile = process.env.FG_BUNDLE ?? path.join(repo, `dist/folkbranch-${process.platform}-${process.arch}.tar.xz`)
if (!fs.existsSync(bundleFile)) { console.error(`No archive at ${bundleFile}. Run: pnpm build && node scripts/make-bundle.mjs`); process.exit(1) }
const SHOTS = process.env.SHOTS
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'folkbranch-tell-')))
const dir = path.join(work, 'archive'), port = 3475, B = `http://localhost:${port}`
const env = { ...process.env, FOLKBRANCH_NO_OPEN: '1', HOME: work, FOLKBRANCH_BUNDLE: pathToFileURL(bundleFile).href }
const installed = spawnSync('sh', [path.join(repo, 'install.sh'), '--local', '--dir', dir, '--port', String(port)], { cwd: work, env, encoding: 'utf8', timeout: 180000 })
if (installed.status !== 0) { console.error(installed.stdout, installed.stderr); process.exit(1) }

const br = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
try {
  await waitUp(B)
  const code = fs.readFileSync(path.join(dir, '.env'), 'utf8').match(/^SETUP_TOKEN=(.*)$/m)[1]
  const ownerCtx = await br.newContext({ locale: 'ru-RU', viewport: { width: 1280, height: 860 } })
  const owner = await ownerCtx.newPage()
  await owner.request.post(`${B}/api/auth/family/setup`, { headers: { origin: B }, data: { name: 'Анна', familyName: 'Лесные', language: 'ru', demo: true, code } })
  const g = await (await owner.request.get(`${B}/api/v1/graph`)).json()
  const about = g.persons.find((p) => !p.living)
  await owner.goto(B)
  await owner.getByRole('button', { name: 'Настройки' }).click()
  await owner.getByRole('dialog').getByRole('button', { name: 'Пользователи и доступ' }).click()
  const made = await owner.request.post(`${B}/api/v1/story-requests`, { headers: { origin: B }, data: { personId: about.id, tellerName: 'Бабушка Нина', question: 'Как вы познакомились?' } })
  const { token } = await made.json()
  ok('the owner gets a link', made.ok() && !!token, String(made.status()))
  const section = owner.getByRole('heading', { name: 'Попросить рассказать' })
  await section.scrollIntoViewIfNeeded()
  ok('and can make one from settings', await section.isVisible())
  if (SHOTS) await owner.screenshot({ path: `${SHOTS}/tell-settings.png` })

  // The relative: no account, a phone.
  for (const [label, viewport] of [['phone', { width: 375, height: 700 }], ['narrow', { width: 320, height: 568 }]]) {
    const c = await br.newContext({ locale: 'ru-RU', viewport, hasTouch: true, permissions: ['microphone'] })
    const p = await c.newPage()
    const errors = []
    p.on('pageerror', (e) => errors.push(e.message))
    await p.goto(`${B}/tell/${token}`)
    const main = await p.locator('main').innerText()
    ok(`${label}: it greets by name and asks the question`, main.includes('Бабушка Нина') && main.includes('Как вы познакомились?'))
    ok(`${label}: it fits`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    const start = p.getByRole('button', { name: 'Начать запись' })
    const size = await start.boundingBox()
    ok(`${label}: the button is big enough for an old hand`, size.height >= 60 && size.width >= 250, JSON.stringify(size))
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/tell-${label}.png`, fullPage: true })
    ok(`${label}: the link opens nothing else`, (await p.request.get(`${B}/api/v1/graph`)).status() === 401 && (await p.request.get(`${B}/api/archive`)).status() === 401)
    await start.click()
    await p.getByRole('button', { name: /Закончить/ }).waitFor()
    await sleep(1500)
    if (SHOTS && label === 'phone') await p.screenshot({ path: `${SHOTS}/tell-recording.png` })
    await p.getByRole('button', { name: /Закончить/ }).click()
    await p.getByRole('button', { name: 'Отправить семье' }).waitFor()
    if (SHOTS && label === 'phone') await p.screenshot({ path: `${SHOTS}/tell-preview.png` })
    await p.getByRole('button', { name: 'Отправить семье' }).click()
    await p.getByRole('status').filter({ hasText: 'Спасибо' }).waitFor()
    ok(`${label}: the recording goes, and it says thank you`, true)
    ok(`${label}: no page errors`, errors.length === 0, errors.join(' | '))
    await c.close()
  }

  // Where the browser cannot record: a sound file from the phone.
  const c = await br.newContext({ locale: 'ru-RU', viewport: { width: 375, height: 700 } })
  const p = await c.newPage()
  await p.goto(`${B}/tell/${token}`)
  await p.locator('input[type=file]').setInputFiles({ name: 'memo.ogg', mimeType: 'audio/ogg', buffer: Buffer.concat([Buffer.from('OggS'), Buffer.alloc(300)]) })
  await p.getByRole('button', { name: 'Отправить семье' }).click()
  await p.getByRole('status').filter({ hasText: 'Спасибо' }).waitFor()
  ok('a file from the phone goes too', true)
  await p.locator('input[type=file]').setInputFiles({ name: 'evil.html', mimeType: 'audio/ogg', buffer: Buffer.from('<script>alert(1)</script>') })
  await p.getByRole('button', { name: 'Отправить семье' }).click()
  await p.getByRole('alert').waitFor()
  ok('something that is not sound is refused, and the page says so', true)
  await c.close()

  // Back at the owner: nothing on the card until accepted.
  const stories = async () => (await (await owner.request.get(`${B}/api/v1/persons/${about.id}/stories`)).json()).length
  ok('nothing on the card yet', await stories() === 0)
  const proposals = await (await owner.request.get(`${B}/api/v1/proposals`)).json()
  const draft = proposals.find((d) => d.ops.some((o) => o.op === 'create_story'))
  ok('all three wait for review, under the name they were asked', draft?.ops.length === 3 && draft.authorName === 'Бабушка Нина', JSON.stringify({ n: draft?.ops.length, a: draft?.authorName }))
  const accepted = await owner.request.post(`${B}/api/v1/proposals/${draft.id}/accept`, { headers: { origin: B } })
  ok('accepting puts them on the card', accepted.ok() && await stories() === 3, String(accepted.status()))
  const list = await (await owner.request.get(`${B}/api/v1/story-requests`)).json()
  await owner.request.delete(`${B}/api/v1/story-requests/${list[0].id}`, { headers: { origin: B } })
  const closed = await br.newContext({ locale: 'ru-RU' })
  const q = await closed.newPage()
  await q.goto(`${B}/tell/${token}`)
  ok('a closed link says so, and shows no names', (await q.locator('main').innerText()).includes('недействительна') && !(await q.content()).includes('Бабушка'))
} finally {
  await br.close()
  spawnSync('./folkbranch', ['stop'], { cwd: dir, env })
  fs.rmSync(work, { recursive: true, force: true })
}
process.exit(process.exitCode ?? 0)
