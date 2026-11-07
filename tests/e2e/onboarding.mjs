// The first minutes of a new install: the one-command setup, what the app says is missing, connecting an agent.
import { execSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { IMAGE, sh, sleep, waitUp } from './lib.mjs'

const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' · ' + x : ''}`); if (!c) process.exitCode = 1 }
const SHOTS = process.env.SHOTS
const scanFile = process.env.SCAN_JS
const repo = fileURLToPath(new URL('../..', import.meta.url))

// The app says when it is opened on an address it was not told about.
try { sh('docker rm -fv fg-onb') } catch {}
sh(`docker run -d --name fg-onb -p 127.0.0.1:3452:3000 -e BETTER_AUTH_URL=https://family.example.org -e SETUP_TOKEN=x ${IMAGE}`)
await waitUp('http://localhost:3452')
const br = await chromium.launch({ channel: 'chrome', headless: true })
{
  const p = await br.newPage({ locale: 'ru-RU' })
  await p.goto('http://localhost:3452/setup?code=x')
  ok('opened on the wrong address, setup says so before anything is typed', (await p.locator('main').innerText()).includes('https://family.example.org'))
  await p.close()
  sh('docker rm -fv fg-onb')
}

// One command.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folkbranch-install-'))
for (const f of ['docker-compose.yml', 'Caddyfile', 'folkbranch']) fs.copyFileSync(path.join(repo, f), path.join(dir, f))
const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'family-bin-'))
const seen = path.join(dir, 'agents.log')
for (const a of ['claude', 'codex']) fs.writeFileSync(path.join(bin, a), `#!/bin/sh\necho "${a} $*" >> "${seen}"\n`, { mode: 0o755 })
const env = { ...process.env, FOLKBRANCH_IMAGE: IMAGE, COMPOSE_PROJECT_NAME: 'fg-install', PATH: `${bin}:${process.env.PATH}` }
const run = (cmd, cwd = dir) => spawnSync('sh', ['-c', cmd], { cwd, env, encoding: 'utf8', timeout: 240000 })
// Piped, as in the README: a command that reads stdin would swallow the rest of the script.
const first = run(`cat "${repo}/install.sh" | sh -s -- --dir "${dir}" --port 3493`)
const link = first.stdout.match(/http:\/\/localhost:3493\/setup\?code=\S+/)?.[0]
ok('one command starts it and prints the link', !!link, first.stderr.slice(-160))
ok('with no build', !/building here/i.test(first.stdout))
const secrets = fs.readFileSync(path.join(dir, '.env'), 'utf8')
ok('settings are generated and private', /BETTER_AUTH_SECRET=\S{40}/.test(secrets) && (fs.statSync(path.join(dir, '.env')).mode & 0o077) === 0)
const again = run(`sh "${repo}/install.sh" --dir "${dir}" --port 3493`)
ok('running it again keeps the settings', fs.readFileSync(path.join(dir, '.env'), 'utf8') === secrets && again.status === 0)

const B = 'http://localhost:3493'
const errs = []
const ctx = await br.newContext({ locale: 'ru-RU',  viewport: { width: 1280, height: 860 } })
const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message.slice(0, 160)))
await p.goto(link)
ok('the example family is not ticked by default', !(await p.getByRole('checkbox').first().isChecked()))
await p.getByLabel('Ваше имя').fill('Анна'); await p.getByLabel('Название семьи').fill('Лесные')
await p.getByRole('button', { name: 'Создать архив' }).click()
const dialog = p.getByRole('dialog')
await dialog.waitFor({ timeout: 20000 }); await sleep(600)
ok('the app says what is next', (await dialog.innerText()).includes('Что дальше'))
for (const step of ['Адрес и хранилище', 'Ваша семья', 'Подключить внешнюю программу', 'ИИ-ассистент', 'Позвать родственников', 'Вход: Google, Яндекс', 'Сделать копию']) ok(`step: ${step}`, await dialog.getByRole('button', { name: step }).count() === 1)
ok('steps show the services by their logos', await dialog.locator('svg[aria-hidden=true][viewBox="0 0 24 24"] path').count() > 10)
if (SHOTS) await p.screenshot({ path: `${SHOTS}/onboarding.png` })
const scan = async (label) => { if (!scanFile) return; const code = fs.readFileSync(scanFile, 'utf8').replace(/^\/\/.*$/gm, '').trim(); const r = await p.evaluate(`${code}("[role=dialog]")`); const { smallTarget, ...rest } = r; ok(`nothing cut or on top of something: ${label}`, Object.keys(rest).length === 0, JSON.stringify(rest).slice(0, 260)) }
await scan('steps closed')

await dialog.getByRole('button', { name: 'Подключить внешнюю программу' }).click(); await sleep(300)
ok('it names the address to connect to', await dialog.getByText(`${B}/api/mcp`).count() > 0)
await dialog.getByLabel('Название ключа').fill('Мой агент')
await dialog.getByRole('button', { name: 'Создать ключ доступа' }).click(); await sleep(500)
const shown = async (name) => { await dialog.getByRole('radio', { name }).click(); await sleep(150); return dialog.locator('code.whitespace-pre-wrap').last().innerText() }
ok('Claude Code gets its command', (await shown('Claude Code')).includes('claude mcp add --transport http folkbranch'))
ok('Codex gets its command', (await shown('Codex')).includes('codex mcp add folkbranch --url'))
ok('Cursor gets the text, and where to paste it', (await shown('Cursor')).includes('mcpServers') && (await dialog.innerText()).includes('~/.cursor/mcp.json'))
await scan('MCP open')
if (SHOTS) await p.screenshot({ path: `${SHOTS}/connect.png` })
await dialog.getByRole('button', { name: 'Подключить внешнюю программу' }).click(); await sleep(150)
await dialog.getByRole('button', { name: 'ИИ-ассистент' }).click(); await sleep(300)
ok('the assistant step lists the providers, each with its logo', await dialog.locator('fieldset label svg').count() === 4)
await scan('assistant open')
await dialog.getByRole('button', { name: 'ИИ-ассистент' }).click()
await dialog.getByRole('button', { name: 'Вход: Google, Яндекс' }).click(); await sleep(200)
ok('sign-in step gives the exact return address', (await dialog.innerText()).includes(`${B}/api/auth/callback/google`))
await dialog.getByRole('button', { name: 'Перейти к архиву' }).click(); await sleep(400)
ok('then it goes away, and the address is clean', await dialog.count() === 0 && !p.url().includes('welcome'))
await p.reload(); await sleep(800)
ok('and does not come back', await p.getByRole('dialog').count() === 0)
await p.getByRole('button', { name: 'Настройки' }).click(); await sleep(400)
ok('it stays in the settings', await p.getByRole('button', { name: 'Адрес и хранилище' }).count() === 1)
await p.keyboard.press('Escape')

// One command connects the agent programs on this computer.
const conn = run('./folkbranch connect')
const log = fs.readFileSync(seen, 'utf8')
ok('./folkbranch connect finds Claude Code and Codex', conn.status === 0 && conn.stdout.includes('Claude Code Codex') && /claude mcp add --scope user --transport http folkbranch http:\/\/localhost:3493\/api\/mcp --header Authorization: Bearer fb_/.test(log) && log.includes('codex mcp add folkbranch --url'), conn.stdout.slice(-120))
const token = log.match(/Bearer (fb_\S+)/)?.[1]
const mcp = await fetch(`${B}/api/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })
const tools = await mcp.text()
ok('and that key really opens MCP', mcp.ok && tools.includes('get_overview'), `${mcp.status} ${tools.slice(0, 80)}`)
ok('a person who is not the owner gets no setup status', (await fetch(`${B}/api/v1/setup/status`)).status === 401)
ok('no page errors', errs.length === 0, errs.join(' | '))
await br.close()
run('docker compose --profile https down -v')
execSync(`rm -rf "${dir}" "${bin}"`)
process.exit(process.exitCode ?? 0)
