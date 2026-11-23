#!/usr/bin/env node
// Real screenshots of the app on the invented demo family, for the README, the website and GitHub's social preview.
// Nothing real is read: a built copy (pnpm build) starts on a throwaway data folder.
//   node scripts/readme-shots.mjs [outDir]       default docs/images
// With --landing <dir> it writes only the website's how-it-works shots instead (see below).
// Writes chart-<lang>.png, card-<lang>.png, map-<lang>.png, story-phone-<lang>.png and social-preview.png (1280x640).
import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startApp, cookiesFor } from '../tests/ui/serve.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = path.resolve(process.argv[2]?.startsWith('--') ? path.join(root, 'docs/images') : (process.argv[2] ?? path.join(root, 'docs/images')))
mkdirSync(out, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const br = await chromium.launch({ channel: 'chrome', headless: true })
const P = (name) => path.join(out, name)

async function session(app, size, { phone = false, lang = 'en' } = {}) {
  const ctx = await br.newContext({ viewport: size, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1, locale: lang === 'ru' ? 'ru-RU' : 'en-GB' })
  await ctx.addCookies(cookiesFor(app.B, app.cookie))
  await ctx.addInitScript(() => { try { localStorage.setItem('folkbranch-tour', '1') } catch {} })
  return { ctx, page: await ctx.newPage() }
}

// --landing <dir>: the four steps of folkbranch.com ("how it works") and the phone shot for its first screen, from the same invented family.
//   node scripts/readme-shots.mjs --landing landing/site/assets   writes step-*-<lang>.png and phone-page-<lang>.png; convert them to webp for the site.
if (process.argv.includes('--landing')) {
  const dir = path.resolve(process.argv[process.argv.indexOf('--landing') + 1] ?? path.join(root, 'landing/site/assets'))
  mkdirSync(dir, { recursive: true })
  for (const [i, lang] of ['en', 'ru'].entries()) {
    const words = lang === 'ru' ? JSON.parse(readFileSync(path.join(root, 'locales/ru.json'), 'utf8')) : {}
    const tr = (k) => words[k] ?? k
    const app = await startApp({ port: 3950 + i, language: lang })
    try {
      const H = { cookie: app.cookie, origin: app.B, 'content-type': 'application/json' }
      const graph = await (await fetch(app.B + '/api/v1/graph', { headers: H })).json()
      const links = new Map()
      for (const l of graph.parentChild) for (const id of [l.parentId, l.childId]) links.set(id, (links.get(id) ?? 0) + 1)
      const hub = [...links].sort((a, b) => b[1] - a[1])[0][0]
      const question = tr('How did you meet Grandpa?')
      const { ctx, page } = await session(app, { width: 1440, height: 900 }, { lang })
      const storiesTab = () => page.getByRole('tab', { name: tr('Stories'), exact: true }).click()
      await page.goto(`${app.B}/?p=${hub}`)
      await page.locator('img').first().waitFor({ timeout: 60000 })
      await sleep(2500)
      // 1. The owner asks a relative by a link.
      await storiesTab()
      await page.getByRole('button', { name: tr('Ask to tell by a link') }).click()
      await page.getByPlaceholder(tr('For example, Grandma Nina')).fill(lang === 'ru' ? 'Бабушка Нина' : 'Grandma Nina')
      await page.getByRole('button', { name: question, exact: true }).click().catch(() => {})
      await page.getByRole('button', { name: tr('Create a story link') }).click()
      await page.getByRole('button', { name: tr('Done') }).waitFor()
      await sleep(500)
      const token = (await page.locator('[role=dialog]').innerText()).match(/\/tell\/(\S+)/)[1].replace(/\s/g, '')
      await page.locator('[role=dialog]').screenshot({ path: path.join(dir, `step-ask-${lang}.png`) })
      await page.getByRole('button', { name: tr('Done') }).click()
      // 2. The relative's recording arrives from the phone (that page is the story-phone shot).
      const n = 8000 * 3, buf = Buffer.alloc(44 + n * 2)
      buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(8000, 24); buf.writeUInt32LE(16000, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
      const form = new FormData(); form.append('audio', new File([buf], 'a.wav', { type: 'audio/wav' })); form.append('seconds', '192'); form.append('topic', '0')
      const sent = await fetch(app.B + '/api/tell/' + token, { method: 'POST', headers: { origin: app.B, referer: app.B + '/tell/' + token }, body: form })
      if (!sent.ok) throw new Error('recording answered ' + sent.status)
      // 3. The owner checks it before it joins the archive.
      await page.goto(`${app.B}/?p=${hub}`)
      await sleep(2500)
      await page.getByRole('button', { name: new RegExp(tr('Review')) }).first().click()
      await page.getByRole('button', { name: tr('Accept') }).first().waitFor()
      await sleep(800)
      await page.screenshot({ path: path.join(dir, `step-review-${lang}.png`), clip: { x: 12, y: 60, width: 388, height: 290 } })
      // 4. Accepted: it sits on the person's page.
      await page.getByRole('button', { name: tr('Accept') }).first().click()
      await sleep(1500)
      await page.goto(`${app.B}/?p=${hub}`)
      await sleep(2500)
      await storiesTab()
      await sleep(1200)
      // The link has done its job; closing it leaves the story alone on the page.
      await page.getByRole('button', { name: new RegExp(tr('Close the link')) }).click()
      await page.getByRole('button', { name: tr('Close'), exact: true }).last().click()
      await sleep(1500)
      await page.screenshot({ path: path.join(dir, `step-page-${lang}.png`), clip: { x: 948, y: 12, width: 480, height: 420 } })
      await ctx.close()
      // The same page on a phone, for the first screen.
      const ph = await session(app, { width: 390, height: 844 }, { phone: true, lang })
      await ph.page.goto(`${app.B}/?p=${hub}`)
      await sleep(3000)
      await ph.page.getByRole('tab', { name: tr('Biography'), exact: true }).click()
      await sleep(1200)
      await ph.page.screenshot({ path: path.join(dir, `phone-page-${lang}.png`) })
      await ph.ctx.close()
    } finally { app.stop() }
  }
  await br.close()
  process.exit(0)
}

for (const [i, lang] of ['en', 'ru'].entries()) {
  const app = await startApp({ port: 3930 + i, language: lang })
  try {
    const graph = await (await fetch(app.B + '/api/v1/graph', { headers: { cookie: app.cookie, origin: app.B } })).json()
    // The person with the most links stands in the middle of a family worth showing.
    const links = new Map()
    for (const l of graph.parentChild) for (const id of [l.parentId, l.childId]) links.set(id, (links.get(id) ?? 0) + 1)
    const hub = [...links].sort((a, b) => b[1] - a[1])[0][0]

    // The whole chart: a few generations, faces and names readable.
    let { ctx, page } = await session(app, { width: 1600, height: 1100 }, { lang })
    await page.goto(`${app.B}/`)
    await page.locator('img').first().waitFor({ timeout: 60000 })
    await sleep(2500)
    // The hint about moving the chart goes by itself; a picture without it is cleaner.
    await page.getByText(/wider than the screen|шире экрана/).waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
    await page.screenshot({ path: P(`chart-${lang}.png`) })
    // The same family with a person's card open beside it.
    await page.goto(`${app.B}/?p=${hub}`)
    await sleep(3000)
    // The card takes the right third; slide the chart right a little so nobody at the left edge is cut off.
    await page.mouse.move(300, 1060); await page.mouse.down(); await page.mouse.move(380, 1060, { steps: 8 }); await page.mouse.up()
    await sleep(600)
    await page.screenshot({ path: P(`card-${lang}.png`) })
    // The family on the map, at a moment with many people placed.
    await page.goto(`${app.B}/?view=map&y=1975`)
    await page.locator('.map-face').first().waitFor({ state: 'attached', timeout: 60000 })
    await sleep(3500)
    await page.screenshot({ path: P(`map-${lang}.png`) })
    await ctx.close()

    // What a relative sees on a phone when asked for a story: no account, one button.
    const made = await (await fetch(app.B + '/api/v1/story-requests', { method: 'POST', headers: { cookie: app.cookie, origin: app.B, 'content-type': 'application/json' }, body: JSON.stringify({ personId: hub, tellerName: lang === 'ru' ? 'Анна' : 'Ann', question: lang === 'ru' ? 'Расскажите, как вы познакомились с дедушкой' : 'Tell us how you met grandfather' }) })).json()
    if (made.token) {
      ;({ ctx, page } = await session(app, { width: 390, height: 844 }, { phone: true, lang }))
      await page.goto(`${app.B}/tell/${made.token}`)
      await sleep(2500)
      await page.screenshot({ path: P(`story-phone-${lang}.png`) })
      await ctx.close()
    }
  } finally { app.stop() }
}

// The social preview: one headline, a big real screen, three words. Legible at 600x300.
const uri = (file, type) => `data:${type};base64,${readFileSync(file).toString('base64')}`
const css = `
@font-face { font-family: Lit; src: url(${uri(path.join(root, 'public/fonts/Literata-SemiBold.ttf'), 'font/ttf')}) }
@font-face { font-family: Gol; src: url(${uri(path.join(root, 'public/fonts/GolosText-Regular.ttf'), 'font/ttf')}) }
body { margin: 0; width: 1280px; height: 640px; background: #f6f2ea; font-family: Gol, sans-serif; color: #2a2620; display: flex; overflow: hidden }
.t { width: 500px; padding: 64px 0 0 64px; box-sizing: border-box }
.logo { display: flex; align-items: center; gap: 14px; font: 600 30px Lit, serif }
h1 { font: 600 54px/1.08 Lit, serif; margin: 44px 0 20px }
p { font-size: 25px; line-height: 1.35; margin: 0; color: #5d554a }
.w { position: absolute; left: 64px; bottom: 54px; font-size: 24px; letter-spacing: .02em; color: #8a3a1c }
/* The whole window inside the picture with room on every side: a screen cut off at the edge reads as a broken image. */
.s { position: absolute; left: 520px; top: 80px; width: 700px; height: 481px; border-radius: 14px; overflow: hidden; box-shadow: 0 10px 40px #2a262033; border: 1px solid #d9d2c3 }
.s img { width: 700px; display: block }`
const page = await (await br.newContext({ viewport: { width: 1280, height: 640 } })).newPage()
await page.setContent(`<style>${css}</style><div class=t><div class=logo><img src="${uri(path.join(root, 'docs/brand/logo.svg'), 'image/svg+xml')}" width=44 height=44>Folkbranch</div><h1>Your family's story, together</h1><p>Family tree, photos and voice stories on your own computer or server.</p></div><div class=w>Free · Private · Open source</div><div class=s><img src="${uri(P('card-en.png'), 'image/png')}"></div>`)
await sleep(800)
await page.screenshot({ path: P('social-preview.png') })
await br.close()
for (const f of ['chart-en', 'card-en', 'map-en', 'story-phone-en', 'chart-ru', 'card-ru', 'map-ru', 'story-phone-ru', 'social-preview']) { try { console.log(f, Math.round(statSync(P(f + '.png')).size / 1024) + ' KB') } catch { console.log(f, 'missing') } }
