// The public demo's front door: `node demo/router.mjs`. It keeps a pool of app processes, each with its own data
// folder and port, gives every visitor one of them as their own copy, and wipes the copy after a while.
// Nothing here needs a package: only Node. docs/DEMO.md lists every setting.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { createRouter, startupProblem } from './router-lib.mjs'

const env = process.env
const num = (name, fallback) => { const n = Number(env[name]); return env[name] !== undefined && env[name] !== '' && Number.isFinite(n) && n > 0 ? n : fallback }

const secret = env.DEMO_ROUTER_SECRET
if (!secret || secret.length < 16) { console.error('DEMO_ROUTER_SECRET is required: at least 16 characters, a long random string.'); process.exit(1) }

const turnstile = env.TURNSTILE_SECRET ? { secret: env.TURNSTILE_SECRET, siteKey: env.TURNSTILE_SITE_KEY ?? '' } : null
const problem = startupProblem({ publicUrl: (env.DEMO_PUBLIC_URL || env.BETTER_AUTH_URL || '').replace(/\/+$/, ''), turnstile, allowNoTurnstile: env.DEMO_ALLOW_NO_TURNSTILE === '1' })
if (problem) { console.error(problem); process.exit(1) }

const size = num('DEMO_SLOTS', 8)
const root = path.resolve(env.DEMO_ROOT || '/tmp/folkbranch-demo')
const appDir = path.resolve(env.DEMO_APP_DIR || process.cwd())
// What starts one app copy: the standalone server of the image. Another command can be named for a development checkout.
const command = (env.DEMO_APP_CMD || 'node server.js').split(/\s+/).filter(Boolean)
const listen = num('PORT', 8080)
const publicUrl = (env.DEMO_PUBLIC_URL || env.BETTER_AUTH_URL || `http://127.0.0.1:${listen}`).replace(/\/+$/, '')
const basePort = num('DEMO_BASE_PORT', 4100)

/** One JSON line per event, with no address in clear: the router hashes them before they get here. */
const log = (event, fields = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), event, ...fields }))

// The router's own settings stay with it; the app copies get the AI settings and everything else of the environment.
const SECRETS_OF_THE_ROUTER = ['TURNSTILE_SECRET', 'TURNSTILE_SITE_KEY', 'DEMO_ROOT', 'DEMO_APP_CMD', 'DEMO_APP_DIR', 'RAILWAY_VOLUME_MOUNT_PATH']

const children = new Map()
let stopping = false

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function healthy(slot, ms = 120_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (!children.has(slot.id)) throw new Error('the app exited while starting')
    if (await fetch(`http://127.0.0.1:${slot.port}/api/health`).then((r) => r.ok).catch(() => false)) return
    await wait(250)
  }
  throw new Error('the app did not come up')
}

const call = (slot, init = {}) => fetch(`http://127.0.0.1:${slot.port}/api/demo/usage`, { ...init, headers: { 'x-demo-secret': secret, 'content-type': 'application/json' }, signal: AbortSignal.timeout(5000) })

const driver = {
  /** Tokens the copy's assistant has spent today. */
  async usage(slot) { const r = await call(slot); if (!r.ok) throw new Error(`usage answered ${r.status}`); return (await r.json()).tokens },
  /** Switches the copy's assistant off for the UTC day named. */
  async setAiOff(slot, day) { const r = await call(slot, { method: 'POST', body: JSON.stringify({ aiOffDay: day }) }); if (!r.ok) throw new Error(`switch answered ${r.status}`) },
  async stop(slot) {
    const child = children.get(slot.id)
    if (!child) return
    children.delete(slot.id)
    child.removeAllListeners('exit')
    if (child.exitCode !== null || child.signalCode !== null) return
    await new Promise((resolve) => {
      child.once('exit', resolve)
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 5000).unref()
    })
  },
  async start(slot, lang, { keep }) {
    if (stopping) throw new Error('the router is stopping')
    const dir = path.join(root, `slot-${slot.id}`)
    if (!keep) fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    const appEnv = {
      ...Object.fromEntries(Object.entries(env).filter(([k]) => !SECRETS_OF_THE_ROUTER.includes(k))),
      NODE_ENV: 'production',
      FOLKBRANCH_DEMO: '1',
      DEMO_ROUTER_SECRET: secret,
      DEMO_LANG: lang,
      DATA_DIR: dir,
      PORT: String(slot.port),
      HOSTNAME: '127.0.0.1',
      BETTER_AUTH_URL: publicUrl,
      // No daily copy of a database that is thrown away, and no call out to GitHub.
      FOLKBRANCH_AUTO_BACKUP: '0',
      FOLKBRANCH_UPDATE_CHECK: 'off',
      AGENT_DAILY_TOKENS: env.AGENT_DAILY_TOKENS || '200000',
    }
    // Each copy makes its own signing secret in its own folder: a cookie from one is worth nothing in another.
    delete appEnv.BETTER_AUTH_SECRET
    const child = spawn(command[0], command.slice(1), { cwd: appDir, env: appEnv, stdio: ['ignore', 'pipe', 'pipe'] })
    children.set(slot.id, child)
    const echo = (stream) => stream.on('data', (d) => { for (const line of String(d).split('\n')) if (line.trim()) console.log(`[slot ${slot.id}] ${line}`) })
    echo(child.stdout)
    echo(child.stderr)
    child.once('exit', (code) => {
      if (children.get(slot.id) !== child) return
      children.delete(slot.id)
      if (!stopping) { log('slot-exit', { slot: slot.id, code }); router.crashed(slot) }
    })
    await healthy(slot)
  },
}

const router = createRouter({
  secret, size, driver, publicUrl, log, port: (id) => basePort + id,
  ttlMs: num('DEMO_TTL_MIN', 60) * 60_000,
  idleMs: num('DEMO_IDLE_MIN', 20) * 60_000,
  startsPerHour: num('DEMO_STARTS_PER_HOUR', 3),
  defaultLang: env.DEMO_LANG === 'ru' ? 'ru' : 'en',
  turnstile,
  totalTokensDay: num('DEMO_TOTAL_TOKENS_DAY', 5_000_000),
  budgetFile: path.join(root, 'budget.json'),
  cfSecret: env.DEMO_CF_SECRET || '',
})

const server = http.createServer(router.handle)
// Receiving a request is limited (an upload gets minutes); a live line the router streams back is not a request in this sense, so it may last.
server.requestTimeout = num('DEMO_REQUEST_TIMEOUT_MIN', 5) * 60_000
server.headersTimeout = 30_000
server.keepAliveTimeout = 65_000
server.listen(listen, () => log('listening', { port: listen, slots: size, publicUrl }))

router.init().then(() => log('slots-ready', router.pool.stats()))
setInterval(router.sweep, num('DEMO_SWEEP_MS', 5000)).unref()
setInterval(() => router.pollUsage().catch(() => {}), num('DEMO_USAGE_POLL_MS', 30_000)).unref()

async function shutdown() {
  stopping = true
  router.stop()
  server.close()
  await Promise.all([...children.keys()].map((id) => driver.stop({ id })))
  process.exit(0)
}
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, shutdown)
