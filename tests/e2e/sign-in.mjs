// The owner switches ways to sign in on; the sign-in page and My account show them, on a computer and a phone.
import { chromium } from 'playwright-core'
import { execSync as sh } from 'node:child_process'
const PORT = 3486, B = `http://127.0.0.1:${PORT}`
const q = (c) => { try { return sh(c, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim() } catch (e) { return 'ERR ' + e.stderr } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
q('docker rm -fv fg-signin'); q(`docker run -d --name fg-signin -p 127.0.0.1:${PORT}:3000 -e BETTER_AUTH_URL=${B} -e BETTER_AUTH_SECRET=${'s'.repeat(64)} ${process.env.FG_IMAGE ?? 'folkbranch:check'}`)
for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/api/health')).ok) break } catch {} await sleep(500) }
await sleep(1000)
const ok = (n, c, x = '') => console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x && !c ? ' · ' + x : ''}`)
const br = await chromium.launch({ channel: 'chrome', headless: true })
const errs = [], csp = []
const A = await br.newContext({ locale: 'ru-RU', viewport: { width: 1280, height: 800 } })
const code = q('docker logs fg-signin').match(/setup\?code=(\S+)/)[1]
await A.request.post(B + '/api/auth/family/setup', { headers: { origin: B }, data: { name: 'Анна', familyName: 'Проба', language: 'ru', demo: true, code } })
const p = await A.newPage()
p.on('pageerror', (e) => errs.push(e.message))
p.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) csp.push(m.text()) })
await p.goto(B); await p.locator('.pcard').first().waitFor()
await p.getByRole('button', { name: 'Настройки' }).first().click()
await p.getByRole('navigation').getByRole('button', { name: /Способы входа/ }).click()
await p.getByText('Как родные входят').waitFor()
// Yandex with keys in the right shape
const row = (name) => p.locator('div.py-3').filter({ hasText: name }).first()
await row('Яндекс ID').getByRole('button', { name: 'Включить' }).click()
await p.getByText('Адрес возврата', { exact: true }).waitFor()
ok('the return address is shown to copy', (await p.locator('input[readonly], [data-copy], code').filter({ hasText: '' }).count()) >= 0 && (await p.content()).includes('/api/auth/callback/yandex'))
await p.getByLabel('ClientID').fill('0123456789abcdef0123456789abcdef')
await p.getByLabel('Client secret').fill('test-secret-1234')
await p.getByRole('button', { name: 'Проверить и включить' }).click()
await p.waitForTimeout(800)
ok('Yandex is on after saving', (await row('Яндекс ID').innerText()).includes('включён'))
ok('the secret is not shown back', !(await p.content()).includes('test-secret-1234'))
// a wrong shape is refused with words
await row('VK ID').getByRole('button', { name: 'Включить' }).click()
await p.getByLabel('ID приложения').fill('abc')
await p.getByLabel('Защищённый ключ').fill('x')
await p.getByRole('button', { name: 'Проверить и включить' }).click()
await p.waitForTimeout(500)
ok('a wrong VK id is refused with a reason', (await p.getByRole('alert').innerText().catch(() => '')).length > 0, await p.getByRole('alert').innerText().catch(() => 'no alert'))
await p.getByRole('button', { name: 'Отмена' }).click()
// Telegram with a made-up token: Telegram is asked and says no
await row('Telegram').getByRole('button', { name: 'Включить' }).click()
await p.getByLabel('Токен бота').fill('123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij')
await p.getByRole('button', { name: 'Проверить и включить' }).click()
await p.getByRole('alert').waitFor({ timeout: 15000 }).catch(() => {})
ok('a token Telegram does not know is refused', /Telegram не узнал/.test(await p.getByRole('alert').innerText().catch(() => '')), await p.getByRole('alert').innerText().catch(() => 'no alert'))
await p.getByRole('button', { name: 'Отмена' }).click()
// mail with a server that is not there
await row('Код на почту').getByRole('button', { name: 'Включить' }).click()
await p.getByRole('button', { name: 'Другая' }).click()
await p.getByLabel('Сервер SMTP').fill('127.0.0.1')
await p.getByLabel('Порт').fill('2599')
await p.getByLabel('Адрес ящика').fill('archive@example.org')
await p.getByLabel('Пароль приложения').fill('app-password')
await p.getByRole('button', { name: 'Проверить и включить' }).click()
await p.getByRole('alert').waitFor({ timeout: 20000 }).catch(() => {})
ok('a mail server that does not answer is reported', /Почтовый сервер не отвечает/.test(await p.getByRole('alert').innerText().catch(() => '')), await p.getByRole('alert').innerText().catch(() => 'no alert'))
await p.getByRole('button', { name: 'Отмена' }).click()
// My account offers to link Yandex
await p.getByRole('navigation').getByRole('button', { name: /Мой аккаунт/ }).click()
await p.getByText('Вход без ссылки').waitFor()
ok('My account offers to link Yandex ID', await p.getByRole('button', { name: 'Привязать Яндекс ID' }).isVisible())
// the sign-in page, in a browser with nobody signed in
for (const [w, h, tag] of [[1280, 800, 'd'], [375, 812, 'm'], [320, 640, 's']]) {
  const L = await br.newContext({ locale: 'ru-RU', viewport: { width: w, height: h }, isMobile: w < 700, hasTouch: w < 700 })
  const lp = await L.newPage()
  lp.on('pageerror', (e) => errs.push(e.message))
  await lp.goto(B + '/login')
  await lp.getByText('Вход только по приглашению').waitFor()
  const btn = lp.getByRole('button', { name: 'Войти через Яндекс ID' })
  ok(`${tag} sign-in page shows Yandex ID`, await btn.isVisible())
  if (tag === 'd') {
    let to = ''
    await lp.route(/oauth\.yandex\.(ru|com)/, (r) => { to = r.request().url(); r.abort() })
    await btn.click()
    await lp.waitForTimeout(1500)
    ok('the Yandex button leads to Yandex with our app and return address', /^https:\/\/oauth\.yandex\.(ru|com)\/authorize/.test(to) && to.includes('client_id=0123456789abcdef0123456789abcdef') && to.includes(encodeURIComponent(`${B}/api/auth/callback/yandex`)), to.slice(0, 200))
    const back = await (await fetch(`${B}/login?error=account_not_linked`)).text()
    ok('a refusal from a provider is explained', back.includes('сначала откройте ссылку-приглашение'))
  }
  const over = await lp.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  ok(`${tag} no sideways scroll`, over <= 0, String(over))
  await L.close()
}
ok('no page errors', errs.length === 0, errs.join(' | ').slice(0, 300))
ok('nothing blocked by page rules', csp.length === 0, csp.join(' | ').slice(0, 300))
await br.close()
q('docker rm -fv fg-signin')
