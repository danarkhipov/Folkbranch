// The person's card under pressure: every tab, for owner and reader, at five widths, with too much text and with none.
// Measures what a person would notice. Prints a score; screenshots and details go to CARD_OUT.
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { boot, cookiesOf, IMAGE, sh, sleep } from './lib.mjs'

const OUT = process.env.CARD_OUT ?? '/tmp/family-card'
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true })
const { B, cookie } = await boot('fg-card', 3448, IMAGE, { people: 0 })
const call = async (method, p, json) => {
  const r = await fetch(`${B}/api/v1/${p}`, { method, headers: { cookie, origin: B, ...(json ? { 'content-type': 'application/json' } : {}) }, ...(json ? { body: JSON.stringify(json) } : {}) })
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${(await r.text()).slice(0, 200)}`)
  return r.json()
}
const person = async (fields) => (await call('POST', 'persons', { person: { living: false, ...fields } })).id
const WORD = 'Константинопольская'.repeat(6)
const SENTENCE = 'Служил писарем в уездном управлении, потом переехал к родне и больше никогда не возвращался в родные места, хотя писал письма каждый год. '
const URL_LONG = 'https://archive.example.org/information/history.html?type=contrast&from=' + 'archive-record-'.repeat(8)
const refs = `# Источники\n\n- S-1000 1000.jpg — скриншот семейной переписки/архивный предмет\n- TG-2000 result.json#message=2000 — семейное сообщение в Telegram\n- TG-3000 result.json#message=3000; photos/photo_1@01-01-2020_10-00-00.jpg — фотография Telegram с подписью/контекстом сообщения\n- WEB-011 ${URL_LONG} — официальная местная история/мемориал\n- WEB-012 https://example.org/a — короткая ссылка\n`

const parent = await person({ givenName: 'Родитель', surname: 'Старший', birthDate: '1850' })
const cases = {
  empty: await person({ givenName: 'Я', surname: '' }),
  typical: await person({ givenName: 'Николай', patronymic: 'Иванович', surname: 'Соколов', birthDate: '12.03.1890', birthPlace: 'Кострома', deathDate: '1962', deathPlace: 'Вологда', sex: 'M' }),
  longName: await person({ givenName: 'Неустановленная мать в доме Воскресенских-Петропавловских, предположительно жена старшего брата', patronymic: 'Александровна-Константиновна', surname: 'Воскресенская-Преображенская-Петропавловская', maidenName: 'Рождественская-Благовещенская', sex: 'F' }),
  unbroken: await person({ givenName: WORD, surname: WORD, patronymic: WORD, maidenName: WORD, otherNames: WORD + WORD, birthDate: 'около '.repeat(18), birthPlace: (WORD + WORD).slice(0, 200), deathDate: '1'.repeat(100), deathPlace: (WORD + WORD).slice(0, 200), sex: 'F' }),
  heavy: await person({ givenName: 'Пётр', surname: 'Вымышленов', birthDate: '~1883 или 1886', birthPlace: 'Село Большая Придуманная вымышленного уезда несуществующей области старой империи', deathDate: '02.03.1942', deathPlace: 'Город Новоградов, отделение номер семь, очень длинное название учреждения с уточнениями и подробностями', otherNames: 'Пётр Вымышленович, он же Константин, прозвище в семье «Дед Костя», в документах встречается как Петя и Петруша', sex: 'M' }),
}
await call('POST', 'relations', { type: 'son', to: parent, other: cases.typical })
for (const id of [cases.heavy, cases.longName, cases.unbroken]) await call('POST', 'relations', { type: 'son', to: parent, other: id })
for (let i = 0; i < 30; i++) await call('POST', 'relations', { type: i % 2 ? 'son' : 'daughter', to: cases.heavy, other: await person({ givenName: i % 5 ? `Ребёнок${i}` : `Очень длинное имя ребёнка номер ${i} с двойной фамилией`, surname: 'Воскресенская-Преображенская', birthDate: `19${10 + i}` }) })
await call('PATCH', `persons/${cases.heavy}`, {
  facts: Array.from({ length: 14 }, (_, i) => ({ kind: i % 3 ? `Служба ${i}` : 'Профессия, которая называлась очень длинно и не влезает в одну строку карточки', date: i % 2 ? '1912–1917, точная дата неизвестна, возможно позже' : '1912', place: SENTENCE.slice(0, 118), note: SENTENCE.repeat(4).slice(0, 700), source: `${URL_LONG}`.slice(0, 290) })),
  sources: Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, title: i % 2 ? 'Метрическая книга' : 'Государственный архив Кировской области, фонд Р-1234, очень длинное название документа с уточнением, 1890–1917 годы', ref: 'Ф. 237, оп. 74, д. 1234 с очень длинным уточнением, где и что искать, и ещё немного', page: 'л. 12–14 об.', url: URL_LONG.slice(0, 180), reliability: 'copy' })),
  tags: ['Соколовы', 'Родня по отцу, очень длинное название', WORD.slice(0, 40), ...Array.from({ length: 12 }, (_, i) => `Группа ${i}`)],
})
await call('PATCH', `persons/${cases.unbroken}`, { facts: [{ kind: WORD.slice(0, 80), date: WORD.slice(0, 60), place: WORD.slice(0, 120), note: WORD + WORD, source: WORD }], sources: [{ id: 'u1', title: WORD, ref: WORD, page: WORD.slice(0, 30), url: URL_LONG, reliability: 'copy' }], tags: [WORD.slice(0, 40)] })
// Versions of a value that disagree, with a source.
const h = (await call('GET', 'graph')).persons.find((p) => p.id === cases.heavy)
await call('PATCH', `persons/${cases.heavy}`, { claims: [{ id: 'c1', field: 'birthDate', value: h.birthDate, status: 'accepted', sourceId: 's0', reason: '', at: 1 }, { id: 'c2', field: 'birthDate', value: '1880 по записи в очень длинном документе', status: 'possible', sourceId: 's1', reason: '', at: 2 }, { id: 'c3', field: 'birthDate', value: '1877', status: 'rejected', sourceId: null, reason: 'опечатка', at: 3 }] }).catch((e) => console.log('claims', e.message))
// Pages.
await call('POST', 'pages', { personId: cases.heavy, title: 'Биография', markdown: `${SENTENCE.repeat(12)}\n\n${refs}` })
for (let i = 0; i < 16; i++) await call('POST', 'pages', { personId: cases.heavy, title: i % 3 ? `Страница ${i}` : 'Очень длинное название страницы о службе и переездах, которое занимает несколько строк в списке', markdown: 'Текст.' })
await call('POST', 'pages', { personId: cases.unbroken, title: WORD, markdown: `${WORD}${WORD}\n\n${URL_LONG}${URL_LONG}\n\n| колонка | другая |\n|---|---|\n| ${WORD} | ${WORD} |\n` })
await call('POST', 'pages', { personId: cases.longName, title: 'Биография', markdown: 'предок / представитель старшего поколения (точная связь неизвестна). Статус в каноне: single-source (публикация семейного дневника)\n\nВ семейной возрастной записи «матери — 65» на 1900 год; без уточнения нельзя утверждать, мать ли это Ивана или Ольги.' })
// Photos.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAwMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64')
for (let i = 0; i < 14; i++) {
  const f = new FormData(); f.set('file', new Blob([PNG], { type: 'image/png' }), `фото ${i}.png`); f.set('personId', cases.heavy)
  await fetch(`${B}/api/v1/media`, { method: 'POST', headers: { cookie, origin: B }, body: f })
}
// Stories.
for (const s of [{ title: 'Очень длинное название рассказа, который бабушка рассказывала каждый год на семейном празднике', tellerName: 'Соседка Нина Александровна Воскресенская-Преображенская', toldOn: 'зимой, примерно в начале шестидесятых', body: SENTENCE.repeat(8) }, { title: WORD, tellerName: WORD.slice(0, 100), toldOn: WORD.slice(0, 50), body: WORD + WORD + '\n\n' + URL_LONG }, { body: 'Коротко.' }]) {
  const f = new FormData(); f.set('story', JSON.stringify({ about: [cases.heavy], ...s }))
  await fetch(`${B}/api/v1/stories`, { method: 'POST', headers: { cookie, origin: B }, body: f })
}

const br = await chromium.launch({ channel: 'chrome', headless: true })
const WIDTHS = [
  { name: 'wide480', w: 1440, h: 900 }, { name: 'narrow360', w: 1440, h: 900, panel: 360 }, { name: 'full', w: 1440, h: 900, full: true },
  { name: 'phone375', w: 375, h: 812, mobile: true }, { name: 'phone320', w: 320, h: 640, mobile: true },
]
const TABS = ['Биография', 'Сведения', 'Семья', 'Фото', 'Рассказы']
const SHOTS = new Set((process.env.CARD_SHOTS ?? 'wide480,phone375').split(','))

/** What a person would notice, measured in the page. Each key is a kind of defect, each entry one instance. */
const scan = (rootSel) => {
  const root = document.querySelector(rootSel)
  if (!root) return { missing: ['no root'] }
  const box = root.getBoundingClientRect()
  const out = { tabsCut: [], noRoom: [], offPanel: [], cutText: [], cutInput: [], overlap: [], tiny: [], smallTarget: [], rawUrl: [], menuSelect: [], hscroll: [], blank: [] }
  const label = (e) => `${e.tagName.toLowerCase()}${e.getAttribute('aria-label') ? `[${e.getAttribute('aria-label')}]` : ''} "${(e.value ?? e.textContent ?? '').trim().slice(0, 40)}"`
  const seen = (e) => { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || e.closest('[hidden]')) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const skip = (e) => e.matches('select[aria-hidden="true"]') || e.closest('.bn-side-menu, .bn-formatting-toolbar, .panel-edge') || (e.closest('details:not([open])') && !e.closest('summary'))
  const all = [...root.querySelectorAll('*')].filter((e) => seen(e) && !skip(e))
  const scroller = (e) => { let p = e.parentElement; while (p && p !== root.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowX)) return p; p = p.parentElement } return null }
  const mobile = innerWidth < 640
  const tabs = root.querySelector('[role=tablist]')
  if (tabs && innerWidth >= 375 && tabs.scrollWidth > tabs.clientWidth + 1) out.tabsCut.push(`${tabs.scrollWidth}>${tabs.clientWidth}`)
  if (tabs && Math.max(...[...tabs.children].map((t) => t.getBoundingClientRect().height)) > tabs.getBoundingClientRect().height) out.tabsCut.push('tab taller than its row')
  // However long the name, there is room left to read what the tab holds.
  const content = root.querySelector('[role=tabpanel]:not([hidden])')
  if (content && content.getBoundingClientRect().height < 120) out.noRoom.push(`${Math.round(content.getBoundingClientRect().height)}px`)
  for (const e of all) {
    const s = getComputedStyle(e), r = e.getBoundingClientRect()
    if (!scroller(e) && (r.right > box.right + 1 || r.left < box.left - 1)) out.offPanel.push(label(e))
    if (/(auto|scroll)/.test(s.overflowX) && e.scrollWidth > e.clientWidth + 1 && !e.matches('[role=tablist]')) out.hscroll.push(`${label(e).slice(0, 30)} ${e.scrollWidth}>${e.clientWidth}`)
    if (e.matches('input:not([type=radio]):not([type=checkbox]):not([type=file])')) { if (e.value && e.scrollWidth > e.clientWidth + 1) out.cutInput.push(label(e)) }
    else if (e.matches('textarea')) { if (e.value && (e.scrollHeight > e.clientHeight + 2 || e.scrollWidth > e.clientWidth + 1)) out.cutInput.push(label(e)) }
    else if (e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
      if (s.overflowX !== 'visible' && e.scrollWidth > e.clientWidth + 1 && !/(auto|scroll)/.test(s.overflowX) && !e.title) out.cutText.push(label(e))
      if (s.overflowY === 'hidden' && e.scrollHeight > e.clientHeight + 2 && !e.title) out.cutText.push(label(e))
      if (parseFloat(s.fontSize) < 11) out.tiny.push(`${label(e)} ${s.fontSize}`)
    }
    if (e.matches('button, a, select, [role=tab], [role=radio], summary') && s.opacity !== '0' && s.display !== 'inline') {
      const min = mobile ? 32 : 24
      if (r.height < min - 0.5 || r.width < min - 0.5) { if (!e.closest('.bn-editor')) out.smallTarget.push(`${label(e)} ${Math.round(r.width)}x${Math.round(r.height)}`) }
    }
    if (e.matches('select') && e.options[0] && /^\s*\+/.test(e.options[0].textContent)) out.menuSelect.push(label(e))
  }
  // A web address someone has to copy by hand.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) { const n = walker.currentNode; if (/https?:\/\//.test(n.textContent) && !n.parentElement.closest('a, textarea, option') && seen(n.parentElement)) out.rawUrl.push(n.textContent.trim().slice(0, 50)) }
  for (const i of root.querySelectorAll('input')) if (/^https?:\/\//.test(i.value) && i.readOnly && seen(i)) out.rawUrl.push(i.value.slice(0, 50))
  // Things on top of each other: controls and lines of text, inside what can be seen right now.
  const atoms = []
  for (const e of all) {
    if (e.closest('.bn-editor')) continue
    if (!e.matches('button, a, select, input, textarea, [role=tab]') && !(e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))) continue
    if (getComputedStyle(e).opacity === '0') continue
    const sc = scroller(e) ?? e.closest('.overflow-auto')
    const v = sc?.getBoundingClientRect()
    let rs = [e.getBoundingClientRect()]
    if (!e.matches('button, a, select, input, textarea, [role=tab]')) { const range = document.createRange(); range.selectNodeContents(e); rs = [...range.getClientRects()] }
    // What a cut box or a scrolling list hides is not on top of anything.
    const own = /(hidden|clip)/.test(getComputedStyle(e).overflowY) ? e.getBoundingClientRect() : null
    for (const r of rs) {
      const c = { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
      for (const b of [v, own]) if (b) { c.left = Math.max(c.left, b.left); c.right = Math.min(c.right, b.right); c.top = Math.max(c.top, b.top); c.bottom = Math.min(c.bottom, b.bottom) }
      if (c.right - c.left > 1 && c.bottom - c.top > 1) atoms.push({ e, r: c })
    }
  }
  const list = atoms.slice(0, 500)
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j]
    if (a.e === b.e || a.e.contains(b.e) || b.e.contains(a.e)) continue
    const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top)
    if (x > 2 && y > 3) out.overlap.push(`${label(a.e).slice(0, 34)} × ${label(b.e).slice(0, 34)}`)
  }
  for (const k of Object.keys(out)) out[k] = [...new Set(out[k])]
  return out
}

const score = { total: 0, passed: 0 }
const bad = {}
const counts = {}
const timing = []
const errors = []
const note = (key, res) => {
  for (const [kind, list] of Object.entries(res)) {
    score.total++
    if (!list.length) { score.passed++; continue }
    counts[kind] = (counts[kind] ?? 0) + 1
    ;(bad[kind] ??= {})[key] = list.slice(0, 6)
  }
}

for (const role of ['owner', 'reader']) {
  for (const W of WIDTHS) {
    const ctx = await br.newContext({ viewport: { width: W.w, height: W.h }, hasTouch: !!W.mobile, isMobile: !!W.mobile })
    if (role === 'owner') await ctx.addCookies(cookiesOf(cookie))
    const page = await ctx.newPage()
    page.on('pageerror', (e) => errors.push(`${role}/${W.name}: ${e.message.slice(0, 150)}`))
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(`${role}/${W.name}: ${m.text().slice(0, 150)}`) })
    if (role === 'reader') { const { token } = await call('POST', 'invites', { name: 'Читатель', role: 'reader' }); await page.goto(`${B}/invite/${token}`); await page.getByRole('button', { name: 'Принять приглашение' }).click(); await page.waitForURL(`${B}/`); await page.locator('.pcard').first().waitFor() }
    if (W.panel) await page.addInitScript((p) => { try { localStorage.setItem('person-panel-width', String(p)) } catch {} }, W.panel)
    for (const [name, id] of Object.entries(cases)) {
      await page.goto(`${B}/?p=${id}`)
      await page.locator('aside.panel').waitFor({ timeout: 15000 })
      if (W.full) await page.getByRole('button', { name: 'Развернуть' }).click()
      await sleep(350)
      for (const tab of TABS) {
        const t0 = Date.now()
        await page.getByRole('tab', { name: tab }).click()
        await page.waitForFunction(() => !document.querySelector('.h-40'), null, { timeout: 8000 }).catch(() => {})
        timing.push({ key: `${name}/${tab}`, ms: Date.now() - t0 })
        await sleep(tab === 'Биография' ? 450 : 200)
        const key = `${role}/${W.name}/${name}/${tab}`
        note(key, await page.evaluate(scan, 'aside.panel'))
        if (SHOTS.has(W.name) && (role === 'owner' || name === 'heavy')) await page.screenshot({ path: path.join(OUT, `${role}-${W.name}-${name}-${tab}.png`) })
        // The value versions: the popover that opens from a field.
        if (tab === 'Сведения' && name === 'heavy' && role === 'owner') {
          const v = page.locator('aside.panel button', { hasText: /⚠/ }).first()
          if (await v.count()) {
            await v.click(); await sleep(250)
            note(`${key}/версии`, await page.evaluate(scan, '[data-slot=popover-content]'))
            if (SHOTS.has(W.name)) await page.screenshot({ path: path.join(OUT, `${role}-${W.name}-${name}-версии.png`) })
            await page.keyboard.press('Escape'); await sleep(150)
          }
        }
        // Scrolled half way: what sits on top of the text.
        if (tab === 'Биография' && name === 'heavy' && SHOTS.has(W.name)) {
          await page.evaluate(() => { const s = [...document.querySelectorAll('aside.panel .overflow-auto')].find((x) => x.scrollHeight > x.clientHeight + 200); if (s) s.scrollTop = s.scrollHeight })
          await sleep(200)
          await page.screenshot({ path: path.join(OUT, `${role}-${W.name}-${name}-Биография-низ.png`) })
        }
      }
    }
    await ctx.close()
  }
}
// Beyond the look: the same card still has to work.
const works = []
const ok = (name, good, extra = '') => { works.push({ name, good }); if (!good) console.log(`FAIL ${name} ${extra}`) }
{
  const ctx = await br.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies(cookiesOf(cookie))
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`works: ${e.message.slice(0, 150)}`))
  const panel = page.locator('aside.panel')
  const open = async (id, tab) => { await page.goto(`${B}/?p=${id}`); await panel.waitFor(); await sleep(300); if (tab) { await panel.getByRole('tab', { name: tab }).click(); await sleep(350) } }
  const fresh = async (id) => (await call('GET', 'graph')).persons.find((p) => p.id === id)

  const before = (await call('GET', `persons/${cases.heavy}/pages`))[0]
  await open(cases.heavy, 'Биография'); await sleep(1500)
  const link = panel.locator('.bn-editor a', { hasText: 'archive.example.org' }).first()
  ok('an address in a biography is a link', (await link.getAttribute('href'))?.startsWith('https://archive.example.org/'))
  ok('and shows short', (await link.innerText()).length < 60)
  ok('a file name is quiet', await panel.locator('.bn-editor code', { hasText: 'result.json#message=2000' }).count() === 1)
  ok('and in the same typeface as the text', !/mono|courier|consolas/i.test(await panel.locator('.bn-editor code').first().evaluate((e) => getComputedStyle(e).fontFamily)))
  // The handles beside a paragraph show only on hover, and were once cut by the edge of the card.
  const para = panel.locator('.bn-editor p', { hasText: 'Служил писарем' }).first()
  await para.scrollIntoViewIfNeeded(); const at = await para.boundingBox()
  await page.mouse.move(at.x + 30, at.y + 8); await page.mouse.move(at.x + 40, at.y + 10)
  await page.waitForFunction(() => [...document.querySelectorAll('.bn-side-menu button')].some((b) => b.getBoundingClientRect().width), null, { timeout: 4000 }).catch(() => {})
  const handles = await page.evaluate(() => { const edge = document.querySelector('aside.panel').getBoundingClientRect().left; return [...document.querySelectorAll('.bn-side-menu button')].map((b) => b.getBoundingClientRect()).filter((r) => r.width).map((r) => Math.round(r.left - edge)) })
  ok('the handles beside a paragraph are whole', handles.length >= 2 && handles.every((x) => x >= 0), JSON.stringify(handles))
  ok('opening a page writes nothing', (await call('GET', `persons/${cases.heavy}/pages`))[0].updatedAt === before.updatedAt)
  ok('the marks stay away while reading', await panel.getByText('Отметить абзац').count() === 0)
  await panel.locator('.bn-editor p', { hasText: 'Служил писарем' }).first().click(); await sleep(200)
  ok('and come when writing', await panel.getByText('Отметить абзац').count() === 1)
  await panel.getByRole('button', { name: /Не проверено/ }).click(); await sleep(200)
  ok('the mark says it is on', await panel.getByRole('button', { name: '✓ Не проверено' }).count() === 1)
  await panel.getByRole('button', { name: /Не проверено/ }).click(); await sleep(300)
  // Menus of the editor float over the page, and the card must not shift them away from the cursor.
  const caret = panel.locator('.bn-editor p', { hasText: 'Служил писарем' }).first()
  await caret.click(); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.press('Enter'); await page.keyboard.type('/'); await sleep(500)
  const menu = await page.evaluate(() => { const m = document.querySelector('.bn-suggestion-menu'); const a = getSelection().getRangeAt(0).getBoundingClientRect(); if (!m) return null; const r = m.getBoundingClientRect(); return { inView: r.top >= 0 && r.bottom <= innerHeight + 1 && r.left >= 0 && r.right <= innerWidth + 1, far: Math.abs(r.left - a.left), h: r.height } })
  ok('the slash menu opens beside the cursor', !!menu && menu.inView && menu.far < 120 && menu.h > 40, JSON.stringify(menu))
  await page.keyboard.press('Escape'); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace'); await sleep(1500)

  await open(cases.typical, 'Сведения')
  const place = panel.getByLabel('например, Пермь').first()
  await place.click(); await page.keyboard.press('Meta+A'); await page.keyboard.type('Село'); await sleep(200)
  ok('places typed before are offered', await panel.locator('button', { hasText: 'Село Большая Придуманная' }).count() > 0)
  await panel.locator('button', { hasText: 'Село Большая Придуманная' }).first().hover()
  await page.mouse.down(); await page.mouse.up(); await sleep(600)
  ok('picking one saves it whole', (await fresh(cases.typical)).birthPlace.startsWith('Село Большая Придуманная'))
  await place.click(); await page.keyboard.press('Meta+A'); await page.keyboard.type('Тула'); await page.keyboard.press('Enter'); await sleep(600)
  ok('Enter saves and adds no line break', (await fresh(cases.typical)).birthPlace === 'Тула')
  await panel.getByRole('button', { name: 'Добавить факт' }).click(); await sleep(150)
  ok('adding a fact opens a list with nothing ticked', await page.locator('[data-slot=popover-content] button', { hasText: 'Профессия' }).count() === 1 && await page.locator('aside.panel select[aria-label="Добавить факт"]').count() === 0)
  await page.locator('[data-slot=popover-content] button', { hasText: 'Профессия' }).click(); await sleep(400)
  ok('the fact is added with the cursor in it', (await fresh(cases.typical)).facts.at(-1)?.kind === 'Профессия' && await page.evaluate(() => document.activeElement?.tagName) === 'TEXTAREA')
  await page.keyboard.type('1912'); await page.keyboard.press('Enter'); await sleep(500)
  ok('its fields save', (await fresh(cases.typical)).facts.at(-1)?.date === '1912')
  await panel.getByRole('button', { name: 'Добавить источник' }).click(); await sleep(150)
  await page.locator('[data-slot=popover-content] button', { hasText: 'Перепись' }).click(); await sleep(400)
  await panel.getByLabel('https://…').last().fill('https://example.org/x'); await page.keyboard.press('Tab'); await sleep(500)
  ok('a source with an address gets a way to open it', await panel.getByRole('link', { name: 'Открыть ссылку' }).count() === 1)
  const text = panel.getByLabel('например, Пермь').first()
  await text.click(); await page.keyboard.press('Meta+A'); await page.keyboard.insertText('строка\nвторая'); await page.keyboard.press('Enter'); await sleep(500)
  ok('a pasted line break becomes a space', (await fresh(cases.typical)).birthPlace === 'строка вторая')

  await open(cases.longName)
  const name = await panel.getByLabel('Имя').inputValue()
  ok('a long name is all there', name.endsWith('старшего брата'))
  const [nameBox, bin] = await Promise.all([panel.getByLabel('Имя').boundingBox(), panel.getByRole('button', { name: 'Ещё' }).boundingBox()])
  ok('and clear of the buttons', nameBox.x + nameBox.width <= bin.x || nameBox.y >= bin.y + bin.height)
  await open(cases.heavy, 'Семья')
  ok('a big family shows its first few', await panel.getByRole('button', { name: /Показать всех: 30/ }).count() === 1)
  await panel.getByRole('button', { name: /Показать всех: 30/ }).click(); await sleep(150)
  ok('and the rest on a press', await panel.getByText('Ребёнок29').count() === 1)
  await ctx.close()
}
await br.close()
sh('docker rm -fv fg-card'); try { sh('docker volume rm fg-card-data') } catch {}
const slow = timing.sort((a, b) => b.ms - a.ms).slice(0, 3)
const failedWorks = works.filter((w) => !w.good).map((w) => w.name)
const report = { works: `${works.length - failedWorks.length}/${works.length}`, failedWorks, score: `${score.passed}/${score.total}`, percent: +(score.passed / score.total * 100).toFixed(1), defects: counts, slowest: slow, errors: [...new Set(errors)].slice(0, 12), bad }
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1))
console.log(`SCORE ${report.score} = ${report.percent}%  works ${report.works}`)
console.log('defects', JSON.stringify(counts)); console.log('slowest', JSON.stringify(slow)); console.log('errors', report.errors.length, report.errors.slice(0, 4).join(' | '))
process.exit(score.passed === score.total && !errors.length && !failedWorks.length ? 0 : 1)
