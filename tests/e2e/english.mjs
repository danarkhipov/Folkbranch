// An English archive from the first screen: no Russian word anywhere a person can reach, including tooltips and placeholders.
// FB_BASE points at a running empty server; otherwise a throwaway container is started.
import { chromium } from 'playwright-core'
import { IMAGE, sh, waitUp } from './lib.mjs'

const fails = []
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' · ' + x : ''}`); if (!c) { fails.push(n); process.exitCode = 1 } }
const SHOTS = process.env.SHOTS

let B = process.env.FB_BASE
if (!B) {
  B = 'http://localhost:3453'
  try { sh('docker rm -fv fb-en') } catch {}
  sh(`docker run -d --name fb-en -p 127.0.0.1:3453:3000 -e BETTER_AUTH_URL=${B} -e SETUP_TOKEN=x ${IMAGE}`)
}
await waitUp(B, 180000)

const br = await chromium.launch({ channel: 'chrome', headless: true })

// Everything readable on the page, with what it is. The demo's data is English too, so any Cyrillic is a missed word.
const russian = (page) => page.evaluate(() => {
  const found = new Set()
  const has = (s) => /[А-Яа-яЁё]/.test(s ?? '')
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  while (walk.nextNode()) {
    const el = walk.currentNode.parentElement
    if (!el || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue
    if (has(walk.currentNode.textContent)) found.add(walk.currentNode.textContent.trim().slice(0, 90))
  }
  for (const el of document.querySelectorAll('[title],[aria-label],[placeholder],[alt],[data-placeholder]'))
    for (const a of ['title', 'aria-label', 'placeholder', 'alt', 'data-placeholder'])
      if (has(el.getAttribute(a))) found.add(`${a}: ${el.getAttribute(a).slice(0, 90)}`)
  for (const el of document.querySelectorAll('input,textarea')) if (has(el.value)) found.add(`value: ${el.value.slice(0, 90)}`)
  return [...found]
})
const seen = new Map()
const check = async (page, where) => {
  for (const r of await russian(page)) if (!seen.has(r)) seen.set(r, where)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${where.replace(/\W+/g, '-')}.png` })
}

// The first screen speaks the browser's language.
for (const [locale, heading] of [['ru-RU', 'Семейный архив'], ['en-US', 'Family archive'], ['de-DE', 'Family archive']]) {
  const ctx = await br.newContext({ locale })
  const page = await ctx.newPage()
  await page.goto(`${B}/setup?code=x`)
  await page.getByRole('heading', { name: heading }).waitFor()
  await page.waitForLoadState('networkidle')
  await page.waitForFunction((lang) => document.documentElement.lang === lang, locale === 'ru-RU' ? 'ru' : 'en', { timeout: 15000 })
  ok(`${locale} opens in its language`, true)
  await ctx.close()
}

const ctx = await br.newContext({ locale: 'en-US', viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))
await page.goto(`${B}/setup?code=x`)
await page.waitForLoadState('networkidle')
ok('English comes first', (await page.locator('form button.bar-btn').first().textContent()) === 'English')
// The choice can still be changed, and the screen follows.
await page.getByRole('button', { name: 'Русский' }).click()
await page.getByRole('heading', { name: 'Семейный архив' }).waitFor()
await page.getByRole('button', { name: 'English' }).click()
await page.getByRole('heading', { name: 'Family archive' }).waitFor()
await check(page, 'setup')
await page.getByLabel('Your name').pressSequentially('Ann')
await page.getByLabel('Family name').pressSequentially('The Whitlocks')
await page.getByRole('checkbox').check()
await page.getByRole('button', { name: 'Create archive' }).click()
await page.waitForURL(/\/\?welcome=1/, { timeout: 60000 })
const go = page.getByRole('button', { name: 'Go to the archive' })
await go.waitFor({ timeout: 30000 })
await check(page, 'welcome')
await go.click()
const card = page.getByText('Stephen', { exact: false }).first()
await card.waitFor({ timeout: 30000 })
ok('the logo is in the top bar', await page.locator('.main-bar .bar-logo').isVisible())
// With no card open too, the top bar folds up before it reaches the edge of a narrow window.
for (const width of [1100, 800, 660]) {
  await page.setViewportSize({ width, height: 800 })
  await page.waitForTimeout(250)
  ok(`the top bar fits at ${width}`, await page.locator('.main-bar').evaluate((n) => n.getBoundingClientRect().right <= innerWidth))
}
await page.setViewportSize({ width: 1440, height: 900 })
ok('the demo family is in English', (await page.locator('body').innerText()).includes('Whitlock'))
await check(page, 'chart')

// A person's card and every tab in it.
await card.click()
const panel = page.locator('.panel').filter({ has: page.getByRole('tab') }).first()
await panel.waitFor()
await check(page, 'person')
// Each tab, with its menus and hints open: most words wait behind a click.
const names = await panel.getByRole('tab').allTextContents()
// Escape also closes the card, so it opens again before each step.
const openTab = async (name) => {
  if (!(await panel.getByRole('tab', { name }).isVisible().catch(() => false))) { await card.click(); await panel.getByRole('tab', { name }).waitFor() }
  await panel.getByRole('tab', { name }).click()
  await page.waitForTimeout(300)
}
for (const name of names) {
  await openTab(name)
  await check(page, `person-${name}`)
  const buttons = panel.locator('[role="tabpanel"] button')
  const total = await buttons.count()
  for (let i = 0; i < Math.min(total, 40); i++) {
    await openTab(name)
    const b = buttons.nth(i)
    if (!(await b.isVisible().catch(() => false))) continue
    const label = ((await b.getAttribute('aria-label')) ?? (await b.textContent()) ?? '').trim()
    if (!/add|\+|new|source|version|how/i.test(label) || /delete|remove|undo|stop/i.test(label)) continue
    await b.click({ timeout: 1000 }).catch(() => {})
    await page.waitForTimeout(150)
    await check(page, `person-${name}-${label.slice(0, 24)}`)
    await page.keyboard.press('Escape')
  }
}
await openTab('Details')

// The biography opens with its words, and the demo's mention and quote are English.
await openTab('Biography')
await panel.getByText('Born in Portland').waitFor({ timeout: 20000 })
await check(page, 'person-Biography-page')

// Narrow, for the same screens.
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
ok('nothing sideways at 1440', await overflow() <= 0)
await page.setViewportSize({ width: 375, height: 812 })
await page.waitForTimeout(400)
ok('nothing sideways at 375', await overflow() <= 0, String(await overflow()))
await check(page, 'narrow-person')
await panel.getByRole('tab', { name: 'Details' }).click({ timeout: 3000 }).catch(() => {})
await page.waitForTimeout(300)
await check(page, 'narrow-details')
await page.setViewportSize({ width: 1440, height: 900 })
await page.keyboard.press('Escape')

// The bars, and every button with a name: each opens a panel, a menu or a list.
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
const bars = await page.locator('button[aria-label]').evaluateAll((all) => [...new Set(all.map((b) => b.getAttribute('aria-label')))])
for (const name of bars) {
  if (/delete|remove|undo|log out|sign out/i.test(name)) continue
  const b = page.locator(`button[aria-label=${JSON.stringify(name)}]`).first()
  if (!(await b.isVisible().catch(() => false))) continue
  await b.click({ timeout: 1500 }).catch(() => {})
  // Panels load on first opening, so wait for the network and for what they draw.
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(900)
  await check(page, `open-${name}`)
  // Its own sections, which load when opened.
  for (const label of ['To check', 'Similar']) {
    const inner = page.locator('button, [role="tab"]').filter({ hasText: new RegExp(`^${label}`) }).first()
    if (!(await inner.isVisible().catch(() => false))) continue
    await inner.click({ timeout: 800 }).catch(() => {})
    await page.waitForTimeout(900)
    await check(page, `open-${name}-${label}`)
  }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
}

// Settings, section by section.
await page.keyboard.press('Escape')
const settings = page.getByRole('button', { name: /^Settings/ }).first()
if (await settings.isVisible().catch(() => false)) {
  await settings.click()
  const dialog = page.getByRole('dialog').first()
  await dialog.waitFor()
  for (const name of ['Setup', 'My account', 'People and access', 'Archive', 'Assistant', 'Import and export', 'Agents and MCP']) {
    const b = dialog.getByRole('button', { name, exact: true }).first()
    if (!(await b.isVisible().catch(() => false))) { console.log(`  no settings section "${name}"`); continue }
    await b.click()
    await page.waitForTimeout(200)
    await check(page, `settings-${name}`)
    for (const inner of await dialog.locator('summary, button[aria-expanded="false"]').all()) {
      await inner.click({ timeout: 800 }).catch(() => {})
    }
    await check(page, `settings-${name}-open`)
  }
  await page.keyboard.press('Escape')
}

// The language can change inside the app, both ways, and everything follows.
const language = async (value, word) => {
  await page.getByRole('button', { name: /^(Settings|Настройки)/ }).first().click()
  const d = page.getByRole('dialog').first()
  await d.getByRole('button', { name: /^(Name and language|Название и язык)$/ }).click()
  await d.getByRole('combobox', { name: /^(Language|Язык)$/ }).click()
  await page.getByRole('option', { name: value === 'ru' ? 'Русский' : 'English' }).click()
  await page.waitForLoadState('load')
  await page.getByRole('button', { name: word }).first().waitFor({ timeout: 15000 })
  await page.waitForFunction((l) => document.documentElement.lang === l, value)
  ok(`switches to ${value}`, true)
}
await language('ru', 'Настройки')
if (SHOTS) await page.screenshot({ path: `${SHOTS}/switched-ru.png` })
await language('en', 'Settings')

// A signed-out person sees the archive's language too.
const out = await br.newContext({ locale: 'ru-RU' })
const guest = await out.newPage()
await guest.goto(`${B}/login`)
await guest.waitForLoadState('networkidle')
ok('the sign-in page follows the archive, not the browser', await guest.evaluate(() => document.documentElement.lang) === 'en')
await check(guest, 'login')
await guest.goto(`${B}/share/nope`)
await check(guest, 'share-bad-link')
await guest.goto(`${B}/invite/nope`)
await check(guest, 'invite-bad-link')
await out.close()

ok('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
seen.delete('Русский') // The language's own name on the first screen.
ok('no Russian on any screen', seen.size === 0, `${seen.size} found`)
for (const [text, where] of seen) console.log(`  [${where}] ${text}`)
await br.close()
if (!process.env.FB_BASE) sh('docker rm -fv fb-en')
if (fails.length) console.log('FAILED:', fails.join(', '))
