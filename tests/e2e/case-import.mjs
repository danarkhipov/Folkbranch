// A research case from the screen: choose the folder, read what will happen, add it, see the chart. Needs an archive: pnpm build && node scripts/make-bundle.mjs.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'
import { waitUp } from './lib.mjs'

const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x && !c ? ' · ' + x : ''}`); if (!c) process.exitCode = 1 }
const repo = fileURLToPath(new URL('../..', import.meta.url))
const bundleFile = process.env.FG_BUNDLE ?? path.join(repo, `dist/folkbranch-${process.platform}-${process.arch}.tar.xz`)
if (!fs.existsSync(bundleFile)) { console.error(`No archive at ${bundleFile}. Run: pnpm build && node scripts/make-bundle.mjs`); process.exit(1) }
const SHOTS = process.env.SHOTS
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'folkbranch-case-')))
const dir = path.join(work, 'archive'), port = 3474, B = `http://localhost:${port}`
const env = { ...process.env, FOLKBRANCH_NO_OPEN: '1', HOME: work, FOLKBRANCH_BUNDLE: pathToFileURL(bundleFile).href }
const installed = spawnSync('sh', [path.join(repo, 'install.sh'), '--local', '--dir', dir, '--port', String(port)], { cwd: work, env, encoding: 'utf8', timeout: 180000 })
if (installed.status !== 0) { console.error(installed.stdout, installed.stderr); process.exit(1) }

const br = await chromium.launch({ channel: 'chrome', headless: true })
try {
  await waitUp(B)
  const code = fs.readFileSync(path.join(dir, '.env'), 'utf8').match(/^SETUP_TOKEN=(.*)$/m)[1]
  const ctx = await br.newContext({ locale: 'ru-RU', viewport: { width: 1280, height: 860 } })
  const app = await ctx.newPage()
  const errors = []
  app.on('pageerror', (e) => errors.push(e.message))
  await app.request.post(`${B}/api/auth/family/setup`, { headers: { origin: B }, data: { name: 'Анна', familyName: 'Дело', language: 'ru', demo: false, code } })
  await app.goto(B)
  await app.getByRole('button', { name: 'Настройки' }).click()
  await app.getByRole('dialog').getByRole('button', { name: 'Данные и резервные копии' }).click()
  const picker = app.locator('input[webkitdirectory]')
  // A folder that is not a case says so, and adds nothing.
  const wrong = path.join(work, 'notes'); fs.mkdirSync(wrong); fs.writeFileSync(path.join(wrong, 'notes.txt'), 'hello')
  await picker.setInputFiles(wrong)
  await app.getByRole('alert').filter({ hasText: 'person-register' }).waitFor()
  ok('a wrong folder is explained', true)
  const fixture = path.join(repo, 'tests/fixtures/kinship-case')
  await picker.setInputFiles(fixture)
  const status = app.getByRole('status').filter({ hasText: 'Новых карточек' })
  await status.waitFor()
  const text = await status.innerText()
  ok('it says what will happen first', /Новых карточек: 4/.test(text) && /Кандидатов: 1/.test(text) && /заметками: 1/.test(text), text)
  ok('and nothing has changed yet', (await (await app.request.get(`${B}/api/v1/graph`)).json()).persons.length === 0)
  if (SHOTS) await app.screenshot({ path: `${SHOTS}/case-preview.png` })
  await status.getByRole('button', { name: 'Добавить в архив' }).click()
  await status.waitFor({ state: 'detached' })
  const g = await (await app.request.get(`${B}/api/v1/graph`)).json()
  ok('the cards and established lines are there', g.persons.length === 4 && g.parentChild.length === 2 && g.unions.length === 1, `${g.persons.length} ${g.parentChild.length} ${g.unions.length}`)
  const history = await (await app.request.get(`${B}/api/v1/history?limit=1`)).json()
  const undo = await app.request.post(`${B}/api/v1/history/${history[0].id}/undo`, { headers: { origin: B } })
  ok('one undo takes it all back', undo.ok() && (await (await app.request.get(`${B}/api/v1/graph`)).json()).persons.length === 0, String(undo.status()))
  ok('no page errors', errors.length === 0, errors.join(' | '))
} finally {
  await br.close()
  spawnSync('./folkbranch', ['stop'], { cwd: dir, env })
  fs.rmSync(work, { recursive: true, force: true })
}
process.exit(process.exitCode ?? 0)
