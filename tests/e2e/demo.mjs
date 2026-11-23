// The public demo end to end, on the existing build (`pnpm build` first), with no Docker and no paid model:
// the router with two app copies, a short life for a copy, and the model stub (tests/ui/model-stub.mjs).
//   node tests/e2e/demo.mjs
// Checks: a visitor presses one button and sees the demo family signed in as its owner, with the banner; the assistant
// answers, and the 21st message is refused; a refused screen says so; a second visitor gets another copy and does not
// see the first one's edit; after its time a visitor sees that the demo ended.
import { spawn } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { startModelStub } from '../ui/model-stub.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = 0
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`); if (!cond) failed++ }

const ROUTER = 3700, STUB = 3699, SLOTS_FROM = 3710
const R = `http://127.0.0.1:${ROUTER}`
const SECRET = 'e2e-router-secret-0123456789'
const TTL_MIN = 1.5
const data = mkdtempSync(path.join(tmpdir(), 'folkbranch-demo-e2e-'))

const stub = await startModelStub(STUB, { pause: 10, piece: 10 })
const router = spawn('node', ['demo/router.mjs'], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env, PORT: String(ROUTER), DEMO_ROUTER_SECRET: SECRET, DEMO_SLOTS: '2', DEMO_ROOT: data, DEMO_APP_DIR: root,
    DEMO_APP_CMD: 'node node_modules/next/dist/bin/next start -H 127.0.0.1', DEMO_BASE_PORT: String(SLOTS_FROM), DEMO_PUBLIC_URL: R,
    DEMO_TTL_MIN: String(TTL_MIN), DEMO_SWEEP_MS: '1000', DEMO_STARTS_PER_HOUR: '50',
    AGENT_PROVIDER: 'local', AGENT_BASE_URL: `${stub.url}/v1`, AGENT_MODEL: 'stub-small', AGENT_API_KEY: 'stub',
  },
})
let tail = ''
for (const s of [router.stdout, router.stderr]) s.on('data', (d) => { tail = (tail + d).slice(-4000) })
const SHOTS = path.resolve(process.env.UI_SHOTS ?? 'ui-shots')
const cleanup = () => {
  mkdirSync(SHOTS, { recursive: true })
  for (const f of readdirSync(data).filter((n) => n.endsWith('.png'))) cpSync(path.join(data, f), path.join(SHOTS, `demo-${f}`))
  router.kill('SIGTERM'); stub.stop(); setTimeout(() => rmSync(data, { recursive: true, force: true }), 1500)
}
process.on('exit', () => router.kill('SIGTERM'))

const stats = () => fetch(`${R}/stats`, { headers: { 'x-demo-secret': SECRET } }).then((r) => r.json()).catch(() => null)
async function ready() {
  const end = Date.now() + 180_000
  while (Date.now() < end) {
    const s = await stats()
    if (s && s.free === 2) return s
    await sleep(500)
  }
  throw new Error('the router did not get both copies ready\n' + tail)
}

const br = await chromium.launch({ channel: 'chrome', headless: true })
/** A visitor from their own address, with the newcomers' guide out of the way. */
async function visitor(ip, { size = { width: 1280, height: 860 } } = {}) {
  const ctx = await br.newContext({ viewport: size, locale: 'en-GB', extraHTTPHeaders: { 'cf-connecting-ip': ip } })
  await ctx.addInitScript(() => { try { localStorage.setItem('folkbranch-tour', '1') } catch {} })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  return { ctx, page, errors }
}
const startDemo = async (page) => {
  await page.goto(R + '/')
  await page.getByRole('button', { name: 'Start the demo' }).click()
  await page.locator('.pcard').first().waitFor({ timeout: 60_000 })
}
const ask = async (page, text) => {
  const box = page.getByRole('textbox').last()
  await box.fill(text)
  await box.press('Enter')
}
/** A request from inside the page, with its cookies and origin, as the app's own screens make them. */
const inPage = (page, method, url, body) => page.evaluate(async ([m, u, b]) => {
  const r = await fetch(u, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, text: await r.text() }
}, [method, url, body])

try {
  await ready()
  ok('the router has both app copies ready', true)

  // ---- visitor one: one button, the family, the banner ----
  const one = await visitor('10.0.0.1')
  const t0 = Date.now()
  await startDemo(one.page)
  ok('start: one button leads straight into the demo family, signed in, with no sign-up', (await one.page.locator('.pcard').count()) > 0 && !one.page.url().includes('/login') && !one.page.url().includes('/setup'), one.page.url())
  const banner = one.page.locator('[data-demo-banner]')
  ok('the banner says it is an invented family and links to install', (await banner.innerText()).includes('Demo with an invented family') && (await banner.locator('a').getAttribute('href')) === 'https://folkbranch.com/#install')
  const who = await inPage(one.page, 'GET', '/api/v1/me')
  ok('the visitor is the owner of their copy', JSON.parse(who.text).role === 'owner', who.text)
  await one.page.screenshot({ path: path.join(data, 'one.png') })

  // ---- the assistant answers (stub), and the 21st message is refused ----
  await one.page.getByRole('button', { name: /^AI/ }).first().click()
  await ask(one.page, 'Hello')
  await one.page.getByText('Hello.').first().waitFor({ timeout: 30_000 })
  ok('the assistant answers', true)
  let allowed = 1
  for (let i = 0; i < 19; i++) {
    const r = await inPage(one.page, 'POST', '/api/agent', { messages: [{ id: `m${i}`, role: 'user', parts: [{ type: 'text', text: 'hi' }] }] })
    if (r.status === 200) allowed++
  }
  ok('twenty messages are answered', allowed === 20, `${allowed} answered`)
  await ask(one.page, 'One more')
  const refusal = one.page.getByText(/up to 20 messages/).first()
  await refusal.waitFor({ timeout: 30_000 }).catch(() => {})
  ok('the 21st message is refused, in plain words on the screen', await refusal.isVisible().catch(() => false))
  await one.page.screenshot({ path: path.join(data, 'cap.png') })
  const twentyOne = await inPage(one.page, 'POST', '/api/agent', { messages: [{ id: 'z', role: 'user', parts: [{ type: 'text', text: 'hi' }] }] })
  ok('and the server says 429', twentyOne.status === 429, String(twentyOne.status))

  // ---- a refused screen says so ----
  await one.page.keyboard.press('Escape')
  const sendToken = await inPage(one.page, 'POST', '/api/v1/tokens', { name: 'bot', role: 'editor' })
  ok('making an agent token is refused with the one sentence', sendToken.status === 403 && JSON.parse(sendToken.text).error === 'Not available in the demo: install your own copy to use this.', sendToken.text)
  const addKey = await inPage(one.page, 'PUT', '/api/v1/ai/keys', { service: 'openai', key: 'sk-not-real' })
  ok('adding an AI key is refused', addKey.status === 403, addKey.text)
  const restore = await inPage(one.page, 'POST', '/api/archive')
  ok('restoring a backup is refused', restore.status === 403, restore.text)
  const door = await inPage(one.page, 'POST', '/api/auth/family/setup', { name: 'x', familyName: 'x', language: 'en' })
  ok('making a second account is refused', door.status === 403, door.text)
  // On screen: Settings > Users and access, where the owner would invite someone. The screen says it is refused.
  await one.page.locator('button[title^="Account, people"]').first().click()
  await one.page.getByRole('button', { name: /Users and access/ }).first().click()
  await one.page.getByPlaceholder('For example, Aunt Helen').fill('Aunt')
  await one.page.getByRole('button', { name: 'Create link' }).click()
  const notice = one.page.locator('[data-demo-notice]')
  await notice.waitFor({ timeout: 10_000 }).catch(() => {})
  ok('on the Users and access screen, inviting someone says it is not available in the demo', (await notice.innerText().catch(() => '')) === 'Not available in the demo: install your own copy to use this.')
  await one.page.screenshot({ path: path.join(data, 'refused.png') })
  ok('and no script error came of it', one.errors.length === 0, one.errors.join(' | '))
  await one.page.keyboard.press('Escape')

  // ---- an edit of visitor one ----
  const made = await inPage(one.page, 'POST', '/api/v1/persons', { person: { givenName: 'Zedekiah', surname: 'Onlyhere' } })
  ok('visitor one adds a person to their copy', made.status === 200, made.text.slice(0, 120))
  const graphOne = await inPage(one.page, 'GET', '/api/v1/graph')
  ok('their copy shows that person', graphOne.text.includes('Onlyhere'))

  // ---- visitor two: another copy, not the first one's edit ----
  const two = await visitor('10.0.0.2')
  await startDemo(two.page)
  const graphTwo = await inPage(two.page, 'GET', '/api/v1/graph')
  ok('a second visitor gets another copy of the family', graphTwo.status === 200 && graphTwo.text.includes('Whitlock'))
  ok('and does not see the first visitor\'s edit', !graphTwo.text.includes('Onlyhere'))
  // The banner at a phone's width: it wraps, and nothing is wider than the screen.
  await two.page.setViewportSize({ width: 375, height: 812 })
  await two.page.waitForTimeout(500)
  const phone = await two.page.evaluate(() => ({ wide: document.documentElement.scrollWidth > innerWidth, banner: document.querySelector('[data-demo-banner]')?.getBoundingClientRect().width ?? 0 }))
  ok('at a phone width the banner fits and nothing is wider than the screen', !phone.wide && phone.banner <= 375, JSON.stringify(phone))
  await two.page.screenshot({ path: path.join(data, 'phone.png') })
  const s = await stats()
  ok('/stats counts two copies in use and gives no personal data', s.inUse === 2 && s.startsLastHour === 2 && !JSON.stringify(s).includes('10.0.0'), JSON.stringify(s))
  const third = await visitor('10.0.0.3')
  await third.page.goto(R + '/')
  await third.page.getByRole('button', { name: 'Start the demo' }).click()
  ok('with every copy in use the next visitor is told to wait', (await third.page.locator('body').innerText()).includes('All demo copies are in use. Try again in about'), (await third.page.locator('body').innerText()).slice(0, 100))
  await third.ctx.close()

  // ---- after its time: the demo has ended ----
  const left = TTL_MIN * 60_000 - (Date.now() - t0)
  console.log(`waiting ${Math.max(0, Math.round(left / 1000))} s for the first copy to expire`)
  await sleep(Math.max(0, left) + 3000)
  await one.page.reload()
  ok('after its time the visitor sees that the demo has ended', await one.page.getByText('Your demo has ended').first().waitFor({ timeout: 15_000 }).then(() => true, () => false))
  await one.page.screenshot({ path: path.join(data, 'ended.png') })
  // Starting again gives a fresh copy, without the old edit.
  // The expired copies are being wiped and started again: pressing the button before one is ready would only meet the busy page.
  for (let i = 0; i < 120 && !((await stats())?.free > 0); i++) await sleep(500)
  await one.page.getByRole('button', { name: 'Start again' }).click()
  await one.page.locator('.pcard').first().waitFor({ timeout: 90_000 })
  const fresh = await inPage(one.page, 'GET', '/api/v1/graph')
  ok('starting again gives a fresh copy with the family and without the old edit', fresh.text.includes('Whitlock') && !fresh.text.includes('Onlyhere'))
  await one.ctx.close()
  await two.ctx.close()
} catch (e) {
  failed++
  console.log('FAIL the script stopped:', e.message, '\n--- router output ---\n' + tail)
} finally {
  await br.close()
  cleanup()
}
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
