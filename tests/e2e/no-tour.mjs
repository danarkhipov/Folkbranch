// Loaded before each browser test (NODE_OPTIONS in run-all.sh). The guide opens by itself for an editor or a reader on a device that
// has not seen it, and would sit in front of what a test is looking at. Only tour.mjs wants it.
import { chromium } from 'playwright-core'

if (!/tour\.mjs$/.test(process.argv[1] ?? '')) {
  const launch = chromium.launch.bind(chromium)
  chromium.launch = async (...args) => {
    const browser = await launch(...args)
    const newContext = browser.newContext.bind(browser)
    browser.newContext = async (...options) => {
      const context = await newContext(...options)
      await context.addInitScript(() => { try { localStorage.setItem('folkbranch-tour', '1') } catch {} })
      return context
    }
    browser.newPage = async (...options) => (await browser.newContext(...options)).newPage()
    return browser
  }
}
