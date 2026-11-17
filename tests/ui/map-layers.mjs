// The map's layers as a person uses them: switches and check boxes that say what is on, a dot and a Reset when something
// is off, a choice that survives a reload, the last choice that cannot be taken away, and every word in all four languages.
import { browser, finish, ok, open, openMap, O, shot, sleep } from './lib.mjs'

const KINDS = ['Births', 'Marriages and unions', 'Moves and places of residence', 'Work, service, study', 'Deaths', 'Other']
const br = await browser()
const { page, errors } = await open(br, { width: 1440, height: 900 })
await openMap(page)
const button = () => page.getByRole('button', { name: /^Map layers/ })
const panel = () => page.locator('.map-key')
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('folkbranch.map.layers') ?? 'null'))
const checkbox = (name) => page.getByRole('checkbox', { name })
const toggle = (name) => page.getByRole('switch', { name, exact: true })

await button().click(); await sleep(400)
ok('the layers button opens a panel', await panel().isVisible())
for (const s of ['People', 'Events', 'Routes', 'All past moves']) ok(`a switch for ${s}`, (await toggle(s).count()) === 1)
for (const k of KINDS) ok(`a check box for ${k}`, (await checkbox(k).count()) === 1 && (await checkbox(k).getAttribute('aria-checked')) === 'true')
ok('nothing is switched off at first: no Reset, no dot', (await page.getByRole('button', { name: 'Reset', exact: true }).count()) === 0 && (await button().getAttribute('title')) === 'Map layers')
ok('the old All / People / Events choice is not on the timeline any more', (await page.getByRole('radiogroup', { name: 'What to show' }).count()) === 0)
await shot(page, 'layers-default')

// Switching a kind of place off says so at once, and is kept.
await checkbox('Births').click(); await sleep(800)
ok('Births is unchecked', (await checkbox('Births').getAttribute('aria-checked')) === 'false')
ok('Reset appears and the button says something is off', (await page.getByRole('button', { name: 'Reset', exact: true }).count()) === 1 && /something is turned off/.test(await button().getAttribute('title')))
ok('the choice is saved in the browser', JSON.stringify((await saved())?.hidden) === '["birth"]')
await shot(page, 'layers-births-off')
await page.keyboard.press('Escape'); await sleep(300)
ok('Escape closes the panel', !(await panel().isVisible().catch(() => false)))
await page.reload(); await page.locator('.map-face').first().waitFor({ state: 'attached', timeout: 60000 }); await sleep(1200)
await button().click(); await sleep(400)
ok('the choice survives a reload', (await checkbox('Births').getAttribute('aria-checked')) === 'false')

// Reset puts everything back.
await page.getByRole('button', { name: 'Reset', exact: true }).click(); await sleep(500)
ok('Reset checks every kind again', (await Promise.all(KINDS.map((k) => checkbox(k).getAttribute('aria-checked')))).every((v) => v === 'true'))
ok('and the saved choice is the default', JSON.stringify(await saved()) === JSON.stringify({ people: true, events: true, trails: true, routes: 'recent', hidden: [] }))

// The last kind cannot go: a map of nothing is not a choice anyone means.
for (const k of KINDS.slice(0, -1)) await checkbox(k).click()
ok('the last kind left cannot be unchecked', await checkbox('Other').isDisabled())
await page.getByRole('button', { name: 'Reset', exact: true }).click(); await sleep(300)

// People and events: one of the two always stays.
await toggle('Events').click(); await sleep(300)
ok('with events off, People cannot be switched off', await toggle('People').isDisabled())
await toggle('Events').click(); await sleep(200)
await toggle('Routes').click(); await sleep(300)
ok('with routes off, All past moves is disabled', await toggle('All past moves').isDisabled() && (await saved()).trails === false)
await toggle('Routes').click(); await toggle('All past moves').click(); await sleep(300)
ok('All past moves is saved', (await saved()).routes === 'all')
await page.getByRole('button', { name: 'Reset', exact: true }).click()
ok('the page raised no error', errors.length === 0, errors.join(' | '))
await page.close()

// Every word of the panel in Spanish and Catalan: no Russian, no English left in.
const CYR = /[А-Яа-яЁё]/
for (const [lang, title, expected] of [['es', 'Capas del mapa', 'Nacimientos'], ['ca', 'Capes del mapa', 'Naixements'], ['ru', 'Слои карты', 'Рождения']]) {
  const l = await open(br, { width: 1440, height: 900 }, { lang })
  await openMap(l.page)
  await l.page.getByRole('button', { name: new RegExp(`^${title}`) }).click(); await sleep(500)
  const text = await l.page.locator('.map-key').innerText()
  ok(`the panel speaks ${lang}`, text.includes(title) && text.includes(expected), text.split('\n').slice(0, 3).join(' / '))
  if (lang !== 'ru') ok(`and leaves no Russian or English word in it (${lang})`, !CYR.test(text) && !/\b(Births|Deaths|Routes|People|Events|Reset|Other)\b/.test(text), text.match(/\b(Births|Deaths|Routes|People|Events|Reset|Other)\b|[А-Яа-я]+/)?.[0] ?? '')
  await shot(l.page, `layers-${lang}`)
  await l.ctx.close()
}
await br.close()
finish()
