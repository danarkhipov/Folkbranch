// screens.mjs <outdir>: walks every screen on a throwaway fictional demo, saves a screenshot and an inventory of all text, and scores it.
// The assistant talks only to a local stub with a fake key, so no model is ever paid for.
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { IMAGE, sh, sleep, waitUp } from './lib.mjs'
const OUT = process.argv[2] ?? '/tmp/family-screens'
const img = IMAGE
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true })
const stub = spawn('node', [fileURLToPath(new URL('model-stub.mjs', import.meta.url))], { stdio: 'ignore' })

async function demo(name, port, env = '') {
  try { sh(`docker rm -fv ${name}`) } catch {}
  const B = `http://localhost:${port}`
  sh(`docker run -d --name ${name} -p 127.0.0.1:${port}:3000 -e BETTER_AUTH_URL=${B} -e SETUP_TOKEN=demo-code ${env} ${img}`)
  await waitUp(B)
  return B
}
const signUp = async (B) => {
  const r = await fetch(B + '/api/auth/family/setup', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ name: 'Анна', familyName: 'Лесные', language: 'ru', demo: true, code: 'demo-code' }) })
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
}
const br = await chromium.launch({ channel: 'chrome', headless: true })
const inventory = {}
const errors = []

const auditFn = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(), c = getComputedStyle(el); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none' && +c.opacity > 0.05 }
  const parse = (s) => { const m = s.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0]; return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 } }
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const bgOf = (el) => { const stack = []; let e = el; while (e) { const c = parse(getComputedStyle(e).backgroundColor); if (c.a > 0) { stack.push(c); if (c.a >= 1) break } e = e.parentElement } let out = { r: 255, g: 255, b: 255 }; for (const c of stack.reverse()) out = { r: c.r * c.a + out.r * (1 - c.a), g: c.g * c.a + out.g * (1 - c.a), b: c.b * c.a + out.b * (1 - c.a) }; return out }
  const texts = []
  const seen = new Set()
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const el = n.parentElement, t = n.textContent.replace(/\s+/g, ' ').trim()
    if (!t || !el || !vis(el) || el.closest('script, style, svg, .pcard, .sr-only, .bn-container [data-content-type]') || seen.has(el)) continue
    seen.add(el)
    const c = getComputedStyle(el), fg = parse(c.color), bg = bgOf(el)
    const L1 = lum(fg.a < 1 ? { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) } : fg), L2 = lum(bg)
    const r = el.getBoundingClientRect(), size = parseFloat(c.fontSize), lh = c.lineHeight === 'normal' ? size * 1.2 : parseFloat(c.lineHeight)
    const pad = parseFloat(c.paddingTop) + parseFloat(c.paddingBottom), lines = Math.round((r.height - pad) / lh)
    const full = (el.querySelector('select') ? t : el.textContent ?? '').replace(/\s+/g, ' ').trim()
    const cut = c.overflow !== 'visible' && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2) && !el.closest('[title]')
    texts.push({ t: full.slice(0, 220), size, weight: +c.fontWeight, font: c.fontFamily.split(',')[0].replace(/"/g, ''), lh: +(lh / size).toFixed(2), lines, widthCh: Math.round(r.width / (size * 0.52)), contrast: +(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05))).toFixed(2), tag: el.tagName.toLowerCase(), cut, control: !!el.closest('button, a, [role=tab], label, select, option'), upper: c.textTransform === 'uppercase', italic: c.fontStyle === 'italic' })
  }
  const controls = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=tab], [role=menuitem]')].filter(vis).filter((e) => !e.closest('.pcard, .bn-container')).map((e) => ({ tag: e.tagName.toLowerCase(), text: (e.tagName === 'SELECT' ? '' : e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80), aria: e.getAttribute('aria-label') ?? '', title: e.getAttribute('title') ?? '', placeholder: e.getAttribute('placeholder') ?? '', label: e.labels?.[0]?.textContent?.trim().slice(0, 60) ?? '', options: e.tagName === 'SELECT' ? [...e.options].map((o) => o.text) : undefined, h: e.classList.contains('inline-input') ? 0 : Math.round(e.getBoundingClientRect().height) }))
  return { texts, controls }
}

async function surface(p, name, go) {
  try {
    await go()
    await sleep(450)
    const a = await p.evaluate(auditFn)
    inventory[name] = a
    await p.screenshot({ path: `${OUT}/${name}.png` })
  } catch (e) { errors.push(`${name}: ${String(e.message).split('\n')[0].slice(0, 140)}`) }
}
const session = async (B, cookie, opts = {}) => {
  const ctx = await br.newContext({ viewport: { width: 1440, height: 900 }, ...opts })
  if (cookie) await ctx.addCookies(cookie.split('; ').map((c) => ({ name: c.split('=')[0], value: c.slice(c.indexOf('=') + 1), domain: 'localhost', path: '/', httpOnly: true })))
  const p = await ctx.newPage()
  p.on('pageerror', (e) => errors.push('page: ' + e.message.slice(0, 120)))
  return p
}
const esc = async (p) => { for (let i = 0; i < 2; i++) { await p.keyboard.press('Escape'); await sleep(120) } }

// ---- With the assistant connected to the stub.
const A = await demo('fg-typ', 3434, `-e AGENT_PROVIDER=anthropic -e ANTHROPIC_API_KEY=fake-key-not-real -e ANTHROPIC_BASE_URL=http://host.docker.internal:3499/v1 -e AGENT_MODEL=stub --add-host=host.docker.internal:host-gateway`)
// Before anyone signs up.
{
  const p = await session(A)
  await surface(p, 'a01-setup', () => p.goto(A + '/setup?code=demo-code'))
}
const cookie = await signUp(A)
const h = { cookie, origin: A, 'content-type': 'application/json' }
const inv = await (await fetch(A + '/api/v1/invites', { method: 'POST', headers: h, body: JSON.stringify({ name: 'Пётр', role: 'editor' }) })).json()
{
  const p = await session(A)
  await surface(p, 'a02-login', () => p.goto(A + '/login'))
  await surface(p, 'a03-invite', () => p.goto(`${A}/invite/${inv.token}`))
}
const p = await session(A, cookie)
const home = async () => { await p.goto(A + '/'); await p.locator('.pcard').first().waitFor(); await sleep(600) }
const nav = (label) => p.locator(`nav button[aria-label="${label}"]`).click({ timeout: 4000 })
const viewBtn = (label) => p.locator(`button[aria-label="${label}"]`).first().click({ timeout: 4000 })
await home()
await surface(p, 'b01-chart', async () => {})
await surface(p, 'b02-card-hover', async () => { const c = p.locator('.pcard', { hasText: 'Иван Соколов' }).first(); await c.locator('.nm').hover(); await sleep(350) })
await p.mouse.move(5, 500)
await surface(p, 'b03-legend', () => viewBtn('Как читать схему')); await esc(p)
await surface(p, 'b04-search', async () => { await p.keyboard.press('Meta+k'); await sleep(200); await p.keyboard.type('Иван') }); await esc(p)
await surface(p, 'b05-search-empty', async () => { await p.keyboard.press('Meta+k'); await sleep(200); await p.keyboard.type('Ъъъ') }); await esc(p)
await surface(p, 'b06-related', () => nav('Кем приходится?')); await nav('Кем приходится?').catch(() => {})
await surface(p, 'b07-history', () => nav('История')); await home()
await surface(p, 'b08-quickadd', async () => { const c = p.locator('.pcard', { hasText: 'Иван Соколов' }).first(); await c.locator('.nm').hover(); await sleep(300); await c.locator('.tool.add.right').first().click() }); await esc(p)
await home()
await surface(p, 'c01-card-biography', async () => { await p.locator('.pcard .nm', { hasText: 'Иван Соколов' }).first().click(); await p.locator('.panel').waitFor(); await sleep(500) })
for (const [tab, f] of [['Сведения', 'c02-card-details'], ['Семья', 'c03-card-family'], ['Фото', 'c04-card-photos']]) await surface(p, f, () => p.getByRole('tab', { name: tab }).click())
await surface(p, 'c05-card-delete-confirm', () => p.locator('.panel button[aria-label="Удалить человека"]').first().click()); await esc(p)
await home()
await surface(p, 'd00-assistant-off', () => nav('Ассистент'))
await surface(p, 'd01-assistant', async () => { await p.getByRole('button', { name: 'Включить ассистента' }).click({ timeout: 3000 }); await p.locator('.assistant textarea').waitFor({ timeout: 8000 }) })
await home(); await nav('Ассистент').catch(() => {}); await p.locator('.assistant textarea').waitFor({ timeout: 8000 }).catch(() => {})
await surface(p, 'd02-assistant-reply', async () => { const b = p.locator('.assistant textarea'); await b.fill('Кто в Костроме?'); await b.press('Enter'); await sleep(1800) })
await surface(p, 'd03-assistant-ask', async () => { const b = p.locator('.assistant textarea'); await b.fill('Добавь человека'); await b.press('Enter'); await p.getByText('Разрешить один раз', { exact: true }).waitFor({ timeout: 8000 }) })
await home()
await nav('Настройки'); await sleep(500)
const sections = await p.evaluate(() => [...document.querySelectorAll('[role=dialog] nav button, [role=dialog] [role=tab]')].map((b) => b.textContent.trim()))
for (let i = 0; i < sections.length; i++) await surface(p, `e${i}-settings-${sections[i].replace(/[^a-zа-я0-9]+/gi, '_')}`, () => p.locator('[role=dialog] nav button, [role=dialog] [role=tab]').nth(i).click())
await esc(p); await home()
// Photo viewer, on a demo photo if there is one.
await surface(p, 'f01-import', async () => { await nav('Настройки'); await sleep(300); await p.locator('[role=dialog]').getByText('Файлы').first().click(); await sleep(200); const b = p.locator('[role=dialog] button', { hasText: /Загрузить|Импорт|файл/ }).first(); await b.click({ timeout: 3000 }) })
await home()
// A line selected on the chart.
await surface(p, 'f02-line-selected', async () => { const box = await p.locator('path.line-hit').nth(2).boundingBox(); await p.locator('path.line-hit').nth(2).click({ force: true, position: { x: box.width / 2, y: box.height / 2 } }) })
await home()
// Phone
{
  const q = await session(A, cookie, { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  await surface(q, 'g01-phone-chart', async () => { await q.goto(A + '/'); await q.locator('.pcard').first().waitFor() })
  await surface(q, 'g02-phone-card', async () => { await q.locator('.pcard .nm', { hasText: 'Иван Соколов' }).first().tap(); await q.locator('.panel').waitFor() })
  await surface(q, 'g03-phone-details', () => q.getByRole('tab', { name: 'Сведения' }).tap())
}
// ---- Without any model: what a new owner sees first.
const N = await demo('fg-typ2', 3435)
const ck2 = await signUp(N)
{
  const q = await session(N, ck2)
  await q.goto(N + '/'); await q.locator('.pcard').first().waitFor(); await sleep(500)
  await surface(q, 'h01-assistant-setup', () => q.locator('nav button[aria-label="Ассистент"]').click())
}
await br.close(); stub.kill()
try { sh('docker rm -fv fg-typ fg-typ2') } catch {}

// ---- Measures.
const BAD_WORDS = /(^|[^а-яёa-z])(токен\w*|MCP|REST|API|провайдер\w*|JSON|CSV|SSE|OAuth|URL|эндпоинт\w*|промпт\w*|Parameters|Result|Submit|Close)($|[^а-яёa-z])|(?<!файл |\()GEDCOM/i
const all = Object.entries(inventory)
const list = (fn) => [...new Set(all.flatMap(([s, a]) => fn(a, s)))]
const uiTexts = (a) => a.texts
const measures = {
  'T1 размеров шрифта в интерфейсе (≤6)': { v: list((a) => uiTexts(a).map((t) => t.size)).length, ok: (v) => v <= 6, d: list((a) => uiTexts(a).map((t) => t.size)).sort((x, y) => x - y) },
  'T2 текстов мельче 14px, кроме панели телефона (0)': { d: list((a, s) => uiTexts(a).filter((t) => t.size < (s.startsWith('g') ? 13 : 14)).map((t) => `${s}: ${t.t.slice(0, 40)} ${t.size}`)) },
  'T3 многострочных текстов с плохим межстрочным (0)': { d: list((a, s) => uiTexts(a).filter((t) => t.lines > 1 && (t.size < 18 ? t.lh < 1.35 || t.lh > 1.75 : t.lh < 1.15)).map((t) => `${s}: ${t.t.slice(0, 40)} lh ${t.lh}`)) },
  'T4 строк длиннее 80 знаков (0)': { d: list((a, s) => uiTexts(a).filter((t) => t.lines > 1 && t.widthCh > 80).map((t) => `${s}: ${t.t.slice(0, 40)} ~${t.widthCh}`)) },
  'T5 контраст ниже AA (0)': { d: list((a, s) => uiTexts(a).filter((t) => t.contrast < 4.5).map((t) => `${s}: ${t.t.slice(0, 30)} ${t.contrast}`)) },
  'T6 обрезанный текст без подсказки (0)': { d: list((a, s) => uiTexts(a).filter((t) => t.cut).map((t) => `${s}: ${t.t.slice(0, 40)}`)) },
  'T7 начертаний (≤3)': { v: list((a) => uiTexts(a).map((t) => t.weight)).length, ok: (v) => v <= 3, d: list((a) => uiTexts(a).map((t) => t.weight)).sort() },
  'T8 технических слов на экране (0)': { d: list((a) => [...uiTexts(a).map((t) => t.t), ...a.controls.flatMap((c) => [c.aria, c.title, c.placeholder, ...(c.options ?? [])])].filter((t) => BAD_WORDS.test(t.replace(/«[^»]*»/g, ''))).map((t) => t.slice(0, 70))) },
  'T9 кнопок длиннее 4 слов (0)': { d: list((a) => a.controls.filter((c) => c.tag === 'button' && c.text.split(' ').length > 4 && c.text.length < 60 && !c.text.endsWith('?')).map((c) => c.text)) },
  'T10 фраз длиннее 20 слов (0)': { d: list((a, s) => uiTexts(a).flatMap((t) => t.t.split(/(?<=[.!?])\s+/)).filter((x) => x.split(' ').length > 20).map((x) => x.slice(0, 90))) },
  'T11 подсказок, повторяющих подпись (0)': { d: list((a) => a.controls.filter((c) => c.title && c.text && c.title === c.text).map((c) => c.title)) },
  'T12 значков без имени или подсказки (0)': { d: list((a, s) => a.controls.filter((c) => c.tag === 'button' && !c.text && !(c.aria && c.title)).map((c) => `${s}: ${c.aria || c.title || 'без имени'}`)) },
  'T13 типографских ошибок (0)': { d: list((a) => [...uiTexts(a).map((t) => t.t), ...a.controls.flatMap((c) => [c.aria, c.title, c.placeholder])].filter((t) => /\.\.\.|"|(^|\s)-(\s|$)|\s,|ё{2}/.test(t)).map((t) => t.slice(0, 60))) },
  'T14 точек в конце кнопок, заглавных и курсива (0)': { d: list((a) => [...a.controls.filter((c) => /\.$/.test(c.text)).map((c) => c.text), ...uiTexts(a).filter((t) => t.upper || (t.t.length > 3 && t.t === t.t.toUpperCase() && /[А-Я]{4}/.test(t.t))).map((t) => t.t.slice(0, 40))]) },
  'T15 высот элементов управления (≤6)': { v: list((a) => a.controls.filter((c) => c.h >= 24 && c.h <= 60 && c.tag !== 'textarea').map((c) => c.h)).length, ok: (v) => v <= 6, d: list((a) => a.controls.filter((c) => c.h >= 24 && c.h <= 60 && c.tag !== 'textarea').map((c) => c.h)).sort((x, y) => x - y) },
  'T16 полей без подписи (0)': { d: list((a, s) => a.controls.filter((c) => ['input', 'select', 'textarea'].includes(c.tag) && !c.label && !c.aria).map((c) => `${s}: ${c.placeholder || c.tag}`)) },
  'T17 сбоев обхода и ошибок страницы (0)': { d: errors },
}
let passed = 0
const lines = []
for (const [k, m] of Object.entries(measures)) {
  const v = m.v ?? m.d.length, good = m.ok ? m.ok(v) : v === 0
  if (good) passed++
  lines.push(`${good ? 'OK  ' : 'FAIL'} ${k}: ${v}  ${good && !m.v ? '' : JSON.stringify(m.d).slice(0, 700)}`)
}
const n = Object.keys(measures).length
lines.push(`ИТОГО ${passed}/${n} = ${Math.round(passed / n * 100)}%`)
fs.writeFileSync(`${OUT}/score.txt`, lines.join('\n') + '\n')
// A readable list for the reviewers: every word on every screen.
fs.writeFileSync(`${OUT}/inventory.md`, all.map(([s, a]) => `## ${s}\nТексты: ${[...new Set(a.texts.map((t) => `${t.t} [${t.size}px/${t.weight}${t.font.startsWith('Lit') ? '/serif' : ''}]`))].join(' | ')}\nКнопки и поля: ${a.controls.map((c) => [c.tag, c.text && `текст="${c.text}"`, c.aria && c.aria !== c.text && `имя="${c.aria}"`, c.title && c.title !== c.aria && c.title !== c.text && `подсказка="${c.title}"`, c.placeholder && `пример="${c.placeholder}"`, c.label && `подпись="${c.label}"`, c.options && `варианты=${c.options.join('/')}`].filter(Boolean).join(' ')).join(' | ')}`).join('\n\n') + '\n')
fs.writeFileSync(`${OUT}/heights.txt`, [...new Set(all.flatMap(([s, a]) => a.controls.filter((c) => c.h >= 24 && c.h <= 60 && c.tag !== 'textarea').map((c) => `${c.h} ${c.tag} ${(c.aria || c.text || c.placeholder).slice(0, 30)}`)))].sort((x, y) => parseInt(x) - parseInt(y)).join('\n'))
console.log(lines.join('\n').slice(0, 6000))
process.exit(passed === n ? 0 : 1)
