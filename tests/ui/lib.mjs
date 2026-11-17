// Shared by the browser checks in tests/ui: a result line per check, a signed-in browser, screenshots for the pull request.
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { cookiesFor } from './serve.mjs'

export const O = process.env.FG_URL
export const COOKIE = process.env.FG_COOKIE
if (!O || !COOKIE) { console.error('Run through `node scripts/ui-check.mjs`, which starts the app and sets FG_URL and FG_COOKIE.'); process.exit(2) }
export const SHOTS = path.resolve(process.env.UI_SHOTS ?? 'ui-shots')
mkdirSync(SHOTS, { recursive: true })
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = 0
/** One line per check: PASS or FAIL, and the number to look at when it fails. */
export const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`); if (!cond) failed++ }
export const finish = () => { console.log(failed ? `\n${failed} FAILED` : '\nall passed'); process.exit(failed ? 1 : 0) }

export const browser = () => chromium.launch({ channel: 'chrome', headless: true })
/** Sizes people use: a small phone, a large phone, a tablet, a laptop. */
export const SIZES = { 'phone-375': { width: 375, height: 812 }, 'phone-390': { width: 390, height: 844 }, 'tablet-768': { width: 768, height: 1024 }, 'desktop-1440': { width: 1440, height: 900 } }
export const isPhone = (v) => v.width <= 640

/** A page signed in as the owner, at a size; touch and a phone's pixel density when it is a phone. */
export async function open(br, size, { lang } = {}) {
  const phone = isPhone(size)
  const ctx = await br.newContext({ viewport: size, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 3 : 1, locale: 'en-GB' })
  await ctx.addCookies(cookiesFor(O, COOKIE))
  await ctx.addInitScript(() => { try { localStorage.setItem('folkbranch-tour', '1') } catch {} })
  if (lang) await ctx.addCookies([{ name: 'folkbranch-lang', value: lang, url: O }])
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)))
  return { page, ctx, errors }
}
export const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
/** The map with faces on it. */
export async function openMap(page, query = '') {
  await page.goto(`${O}/?view=map${query}`)
  await page.locator('.map-face').first().waitFor({ state: 'attached', timeout: 60000 })
  await sleep(1500)
}
