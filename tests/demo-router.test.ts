// The demo router with fake slots: tiny servers on real ports that stand in for app copies, so assignment, the
// per-visitor binding, expiry, the limits and the proxying are all checked as the browser meets them.
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// @ts-expect-error plain JavaScript, run by Node as it is
import { COOKIE, createRouter, sign, startupProblem, verify } from '../demo/router-lib.mjs'

const SECRET = 'a-long-router-secret-for-tests'
const SLOT_SECRET_HEADER = 'x-demo-secret'

type Slot = { id: number; port: number; ready: boolean; visitor: string | null; lang: string }

/** Stands in for the app copies: answers who it is, signs a visitor in with a cookie, streams, and echoes a body. */
function fakeDriver() {
  const servers = new Map<number, http.Server>()
  const opts = { gate: null as Promise<void> | null, failKeep: false, spent: new Map<number, number>() }
  const log = { off: [] as { slot: number; day: string }[], starts: [] as { slot: number; lang: string; keep: boolean }[], stops: [] as number[], seen: [] as { slot: number; headers: http.IncomingHttpHeaders }[] }
  return {
    log, opts,
    async usage(slot: Slot) { return opts.spent.get(slot.id) ?? 0 },
    async setAiOff(slot: Slot, day: string) { log.off.push({ slot: slot.id, day }) },
    async stop(slot: Slot) {
      const s = servers.get(slot.id)
      if (!s) return
      servers.delete(slot.id)
      log.stops.push(slot.id)
      s.closeAllConnections()
      await new Promise((r) => s.close(r))
    },
    async start(slot: Slot, lang: string, { keep }: { keep: boolean }) {
      log.starts.push({ slot: slot.id, lang, keep })
      if (opts.gate) await opts.gate
      if (opts.failKeep && keep) throw new Error('will not start with its data')
      const s = http.createServer((req, res) => {
        log.seen.push({ slot: slot.id, headers: req.headers })
        if (req.url === '/api/health') return void res.end('{"ok":true}')
        if (req.url === '/api/demo/session') {
          if (req.headers[SLOT_SECRET_HEADER] !== SECRET) return void res.writeHead(404).end()
          return void res.writeHead(200, { 'set-cookie': `better-auth.session_token=owner-of-${slot.id}; Path=/; HttpOnly` }).end('{"ok":true}')
        }
        if (req.url === '/api/events') {
          res.writeHead(200, { 'content-type': 'text/event-stream' })
          res.write('data: first\n\n')
          setTimeout(() => res.end('data: last\n\n'), 600)
          return
        }
        let body = ''
        req.on('data', (c) => { body += c })
        req.on('end', () => res.end(`slot ${slot.id} lang ${lang} ${req.method} ${req.url} body ${body}`))
      })
      await new Promise<void>((r) => s.listen(slot.port, '127.0.0.1', r))
      servers.set(slot.id, s)
    },
    async stopAll() { await Promise.all([...servers.keys()].map((id) => this.stop({ id } as Slot))) },
  }
}

let clock = 1_000_000
const base = 21000 + Math.floor(Math.random() * 3000) * 4
let driver: ReturnType<typeof fakeDriver>
let router: ReturnType<typeof createRouter>
let front: http.Server
let B = ''
let logged: { event: string; [k: string]: unknown }[] = []

async function boot({ noInit = false, ...opts }: Record<string, unknown> = {}) {
  driver = fakeDriver()
  logged = []
  router = createRouter({ secret: SECRET, size: 2, driver, retryMs: 5, now: () => clock, port: (id: number) => base + id, log: (event: string, f: object) => logged.push({ event, ...f }), ...opts })
  if (!noInit) await router.init()
  front = http.createServer(router.handle)
  await new Promise<void>((r) => front.listen(0, '127.0.0.1', r))
  B = `http://127.0.0.1:${(front.address() as AddressInfo).port}`
}

const startAs = (ip: string, body = 'lang=en', extra: Record<string, string> = {}) =>
  fetch(`${B}/start`, { method: 'POST', redirect: 'manual', headers: { 'cf-connecting-ip': ip, 'content-type': 'application/x-www-form-urlencoded', ...extra }, body })
/** What the browser would keep: every cookie of the answer, as name=value. */
const jar = (res: Response) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')

beforeEach(() => { clock = 1_000_000 })
afterEach(async () => { router.stop(); driver.opts.gate = null; await router.idle(); front.closeAllConnections(); await new Promise((r) => front.close(r)); await driver.stopAll() })

describe('the start page', () => {
  beforeEach(() => boot())

  it('is in Russian for a Russian browser, English otherwise, with a start button', async () => {
    expect(await (await fetch(`${B}/`)).text()).toContain('Start the demo')
    const ru = await (await fetch(`${B}/`, { headers: { 'accept-language': 'ru-RU,ru;q=0.9' } })).text()
    expect(ru).toContain('Начать демо')
    expect(await (await fetch(`${B}/?lang=ru`, { headers: { 'accept-language': 'en' } })).text()).toContain('Начать демо')
  })

  it('is what a visitor without a cookie gets, whatever address they ask for', async () => {
    const res = await fetch(`${B}/api/v1/graph`, { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/')
  })

  it('answers /health, and /stats only to the secret, with no personal data', async () => {
    expect((await fetch(`${B}/health`)).status).toBe(200)
    expect((await fetch(`${B}/stats`)).status).toBe(404)
    expect((await fetch(`${B}/stats`, { headers: { [SLOT_SECRET_HEADER]: 'wrong' } })).status).toBe(404)
    await startAs('203.0.113.5')
    const stats = await (await fetch(`${B}/stats`, { headers: { [SLOT_SECRET_HEADER]: SECRET } })).json()
    expect(stats).toMatchObject({ slots: 2, inUse: 1, free: 1, starting: 0, startsLastHour: 1, tokensToday: 0, assistantOff: false })
    expect(JSON.stringify(stats)).not.toContain('203.0.113.5')
  })
})

describe('giving a visitor a copy', () => {
  beforeEach(() => boot({ size: 3, startsPerHour: 3 }))

  it('gives each visitor their own slot and sends every later request there, with the app cookie and without the router one', async () => {
    const a = await startAs('198.51.100.1')
    const b = await startAs('198.51.100.2')
    expect(a.status).toBe(303)
    expect(a.headers.get('location')).toBe('/')
    expect(jar(a)).toMatch(/better-auth\.session_token=owner-of-\d/)
    const [ca, cb] = [jar(a), jar(b)]
    const sa = await (await fetch(`${B}/api/v1/graph`, { headers: { cookie: ca } })).text()
    const sb = await (await fetch(`${B}/api/v1/graph`, { headers: { cookie: cb } })).text()
    expect(sa).toMatch(/^slot \d lang en GET \/api\/v1\/graph/)
    expect(sa.split(' ')[1]).not.toBe(sb.split(' ')[1])
    // The slot saw the app's own cookie and never the router's, and never the router's secret.
    const seen = driver.log.seen.at(-1)!.headers
    expect(seen.cookie).toContain('better-auth.session_token')
    expect(seen.cookie).not.toContain(COOKIE)
    expect(seen['x-demo-secret']).toBeUndefined()
  })

  it('keeps the router cookie past the life of the copy, so a late visitor is told it ended', async () => {
    const res = await startAs('198.51.100.1')
    const maxAge = Number(res.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE}=`))!.match(/Max-Age=(\d+)/)![1])
    expect(maxAge).toBeGreaterThan(3600 + 3600)
  })

  it('does not let a visitor pass the router secret on to their slot', async () => {
    const cookie = jar(await startAs('198.51.100.1'))
    await fetch(`${B}/api/demo/session`, { method: 'POST', headers: { cookie, [SLOT_SECRET_HEADER]: SECRET } })
    expect(driver.log.seen.at(-1)!.headers[SLOT_SECRET_HEADER]).toBeUndefined()
  })

  it('carries bodies out and streams answers back before they end', async () => {
    const cookie = jar(await startAs('198.51.100.1'))
    const echoed = await (await fetch(`${B}/api/v1/media`, { method: 'POST', headers: { cookie }, body: 'a photo' })).text()
    expect(echoed).toContain('POST /api/v1/media body a photo')
    const res = await fetch(`${B}/api/events`, { headers: { cookie } })
    const reader = res.body!.getReader()
    const t0 = Date.now()
    const first = new TextDecoder().decode((await reader.read()).value)
    expect(first).toContain('data: first')
    expect(Date.now() - t0).toBeLessThan(400)
    await reader.cancel()
  })

  it('makes a copy in the visitor\'s language fresh when the slot held another', async () => {
    await startAs('198.51.100.1', 'lang=ru')
    const started = driver.log.starts.filter((s) => s.lang === 'ru')
    expect(started).toHaveLength(1)
    expect(started[0].keep).toBe(false)
  })

  it('stops a connection after its starts per hour, counted by the address Cloudflare names', async () => {
    // Each copy ends before the address starts the next, since an address holds one live copy at a time.
    for (let i = 0; i < 3; i++) {
      expect((await startAs('192.0.2.9')).status).toBe(303)
      // The visitor leaves, so the address holds no copy.
      for (const sl of router.pool.slots) { sl.visitor = null; sl.owner = null }
    }
    const fourth = await startAs('192.0.2.9')
    expect(fourth.status).toBe(429)
    expect(await fourth.text()).toContain('Too many demos')
    // Another address is not held back, and the hour lets the first one in again.
    expect(logged.some((l) => l.event === 'start-limited')).toBe(true)
    expect(JSON.stringify(logged)).not.toContain('192.0.2.9')
    clock += 3_600_001
    expect((await startAs('192.0.2.9')).status).toBe(303)
  })

  it('says when all copies are in use, and when the soonest one frees', async () => {
    for (const ip of ['1', '2', '3']) expect((await startAs(`198.51.100.${ip}`)).status).toBe(303)
    clock += 5 * 60_000
    const busy = await startAs('198.51.100.9')
    expect(busy.status).toBe(503)
    // Idle time (20 minutes) runs out before the hour, and five have passed.
    expect(await busy.text()).toContain('All demo copies are in use. Try again in about 15 minutes.')
  })
})

describe('what a copy may not be used for', () => {
  beforeEach(() => boot({ size: 2 }))

  it('rejects a cookie that was changed or signed by someone else, as no cookie at all', async () => {
    const cookie = jar(await startAs('198.51.100.1'))
    const value = cookie.split('; ').find((c) => c.startsWith(`${COOKIE}=`))!.slice(COOKIE.length + 1)
    const [payload, mac] = value.split('.')
    const other = Buffer.from(payload, 'base64url').toString().replace(/^\d+/, '1')
    const forged = [
      `${Buffer.from(other).toString('base64url')}.${mac}`,
      sign(Buffer.from(payload, 'base64url').toString(), 'a-different-secret-entirely'),
      `${payload}.`,
      payload,
    ]
    for (const f of forged) {
      const res = await fetch(`${B}/api/v1/graph`, { redirect: 'manual', headers: { cookie: `${COOKIE}=${f}` } })
      expect(res.status, f).toBe(302)
      const page = await (await fetch(`${B}/`, { headers: { cookie: `${COOKIE}=${f}` } })).text()
      expect(page).toContain('Start the demo')
    }
    expect(verify(value, SECRET)).toBeTruthy()
  })

  it('stops proxying when the time is up, shows that the demo ended, and wipes the slot', async () => {
    const cookie = jar(await startAs('198.51.100.1'))
    const used = driver.log.starts.length
    clock += 21 * 60_000
    // Even before the sweep has run, a late visitor is not let in.
    expect((await fetch(`${B}/api/v1/graph`, { headers: { cookie } })).status).toBe(401)
    expect(router.sweep()).toHaveLength(1)
    await router.reset(router.pool.slots[0], 'en').catch(() => {})
    const ended = await fetch(`${B}/`, { headers: { cookie } })
    expect(await ended.text()).toContain('Your demo has ended')
    expect(driver.log.starts.length).toBeGreaterThan(used)
    expect(driver.log.starts.at(-1)!.keep).toBe(false)
  })

  it('keeps a visitor alive while they work and expires them after the whole hour even so', async () => {
    const cookie = jar(await startAs('198.51.100.1'))
    for (let i = 0; i < 3; i++) {
      clock += 15 * 60_000
      expect((await fetch(`${B}/api/v1/graph`, { headers: { cookie } })).status).toBe(200)
    }
    // 61 minutes in: idle never ran out, but the hour did.
    clock += 16 * 60_000
    expect((await fetch(`${B}/api/v1/graph`, { headers: { cookie } })).status).toBe(401)
  })

  it('does not count an open page\'s live line as someone being there', async () => {
    const cookie = jar(await startAs('198.51.100.1'))
    clock += 19 * 60_000
    const live = await fetch(`${B}/api/events`, { headers: { cookie } })
    await live.body!.cancel()
    clock += 2 * 60_000
    expect((await fetch(`${B}/api/v1/graph`, { headers: { cookie } })).status).toBe(401)
  })

  it('does not hand the old visitor\'s cookie the next visitor\'s copy', async () => {
    const first = jar(await startAs('198.51.100.1'))
    clock += 21 * 60_000
    router.sweep()
    await router.reset(router.pool.slots[0], 'en')
    await router.reset(router.pool.slots[1], 'en')
    const second = jar(await startAs('198.51.100.2'))
    expect((await fetch(`${B}/api/v1/graph`, { headers: { cookie: second } })).status).toBe(200)
    const old = await fetch(`${B}/`, { headers: { cookie: first } })
    expect(await old.text()).toContain('Your demo has ended')
  })

  it('starts a crashed slot again and keeps what its visitor had made', async () => {
    const cookie = jar(await startAs('198.51.100.1'))
    const slot = router.pool.slots.find((s: Slot) => s.visitor)!
    await driver.stop(slot)
    router.crashed(slot)
    await router.reset(slot, 'en', { keep: true })
    expect(driver.log.starts.at(-1)).toMatchObject({ slot: slot.id, keep: true })
    expect((await fetch(`${B}/api/v1/graph`, { headers: { cookie } })).status).toBe(200)
  })
})

describe('the check against bots', () => {
  const asked: { secret: string; response: string; remoteip?: string }[] = []
  beforeEach(() => {
    asked.length = 0
    return boot({
      size: 2,
      turnstile: { secret: 'ts-secret', siteKey: 'site-key' },
      fetchImpl: async (_url: string, init: { body: URLSearchParams }) => {
        const body = Object.fromEntries(init.body) as { secret: string; response: string; remoteip?: string }
        asked.push(body)
        return { json: async () => ({ success: body.response === 'good' }) }
      },
    })
  })

  it('shows the widget with the site key and gives no copy without a passing token', async () => {
    expect(await (await fetch(`${B}/`)).text()).toContain('data-sitekey="site-key"')
    const none = await startAs('198.51.100.1')
    expect(none.status).toBe(403)
    const bad = await startAs('198.51.100.1', 'lang=en&cf-turnstile-response=bad')
    expect(bad.status).toBe(403)
    expect(router.pool.stats().inUse).toBe(0)
    const good = await startAs('198.51.100.1', 'lang=en&cf-turnstile-response=good')
    expect(good.status).toBe(303)
    expect(asked.at(-1)).toMatchObject({ secret: 'ts-secret', response: 'good', remoteip: '198.51.100.1' })
  })
})

describe('a crashed copy, and wiping', () => {
  beforeEach(() => boot({ size: 1 }))

  it('wipes again after a restart that kept the data, when the visitor had run out of time meanwhile', async () => {
    await startAs('198.51.100.1')
    const slot = router.pool.slots[0]
    let release = () => {}
    driver.opts.gate = new Promise<void>((r) => { release = r })
    await driver.stop(slot)
    router.crashed(slot)
    await new Promise((r) => setTimeout(r, 20))
    clock += 21 * 60_000
    router.sweep()
    driver.opts.gate = null
    release()
    await router.reset(slot, 'en', { keep: true })
    const after = driver.log.starts.slice(1)
    expect(after.map((x: { keep: boolean }) => x.keep)).toEqual([true, false])
    expect(slot.ready).toBe(true)
    expect(slot.visitor).toBeNull()
  })

  it('wipes a copy that will not start with its data, after a few tries', async () => {
    await startAs('198.51.100.1')
    const slot = router.pool.slots[0]
    driver.opts.failKeep = true
    await driver.stop(slot)
    router.crashed(slot)
    await router.reset(slot, 'en', { keep: true })
    expect(driver.log.starts.at(-1)).toMatchObject({ keep: false })
    expect(logged.filter((l) => l.event === 'slot-start-failed').length).toBe(3)
    expect(slot.ready).toBe(true)
  })

  it('starts nothing once the router is stopping', async () => {
    await startAs('198.51.100.1')
    const before = driver.log.starts.length
    router.stop()
    clock += 21 * 60_000
    router.sweep()
    await new Promise((r) => setTimeout(r, 30))
    expect(driver.log.starts.length).toBe(before)
  })
})

describe('slow and large requests to /start', () => {
  beforeEach(() => boot({ bodyTimeoutMs: 150 }))
  const raw = (head: string, body = '', hold = 600) => new Promise<string>((resolve) => {
    const sock = net.connect((front.address() as AddressInfo).port, '127.0.0.1', () => { sock.write(head + body) })
    let got = ''
    sock.on('data', (d) => { got += d })
    sock.on('close', () => resolve(got))
    setTimeout(() => sock.destroy(), hold)
  })

  it('cuts off a body that does not arrive, and gives no copy for it', async () => {
    const t0 = Date.now()
    const got = await raw('POST /start HTTP/1.1\r\nHost: x\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: 100\r\n\r\nlang=')
    expect(got).toContain('HTTP/1.1 408')
    expect(Date.now() - t0).toBeLessThan(550)
    expect(router.pool.stats().inUse).toBe(0)
  })

  it('refuses a body larger than a form needs', async () => {
    const got = await raw('POST /start HTTP/1.1\r\nHost: x\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: 5000\r\n\r\n', 'a'.repeat(5000))
    expect(got).toContain('HTTP/1.1 413')
    expect(router.pool.stats().inUse).toBe(0)
  })
})

describe('who may take a copy', () => {
  it('gives one live copy to an address, and a plain refusal for a second', async () => {
    await boot({ size: 2 })
    expect((await startAs('198.51.100.1')).status).toBe(303)
    const again = await startAs('198.51.100.1')
    expect(again.status).toBe(429)
    expect(await again.text()).toContain('already running')
    expect((await startAs('198.51.100.2')).status).toBe(303)
    expect(router.pool.stats().inUse).toBe(2)
  })

  it('believes CF-Connecting-IP only with the header Cloudflare is made to add, when a secret is set', async () => {
    await boot({ size: 3, cfSecret: 'cf-shared-secret' })
    // Without the header every claimed address is the connection's own, so a second start is refused however the header reads.
    expect((await startAs('1.1.1.1')).status).toBe(303)
    expect((await startAs('2.2.2.2')).status).toBe(429)
    // Through Cloudflare, addresses differ.
    expect((await startAs('3.3.3.3', 'lang=en', { 'x-demo-cf': 'cf-shared-secret' })).status).toBe(303)
    expect((await startAs('4.4.4.4', 'lang=en', { 'x-demo-cf': 'cf-shared-secret' })).status).toBe(303)
    expect((await startAs('4.4.4.4', 'lang=en', { 'x-demo-cf': 'wrong' })).status).toBe(429)
  })

  it('will not start on an https address without Turnstile, unless told to', () => {
    expect(startupProblem({ publicUrl: 'https://demo.example', turnstile: null, allowNoTurnstile: false })).toMatch(/Turnstile/)
    expect(startupProblem({ publicUrl: 'https://demo.example', turnstile: { secret: 's', siteKey: 'k' }, allowNoTurnstile: false })).toBeNull()
    expect(startupProblem({ publicUrl: 'https://demo.example', turnstile: null, allowNoTurnstile: true })).toBeNull()
    expect(startupProblem({ publicUrl: 'http://127.0.0.1:3700', turnstile: null, allowNoTurnstile: false })).toBeNull()
  })

  it('counts a start against the address only once it got a copy', async () => {
    await boot({ size: 1, startsPerHour: 3 })
    expect((await startAs('198.51.100.1')).status).toBe(303)
    for (let i = 0; i < 4; i++) expect((await startAs('198.51.100.2')).status).toBe(503)
    router.pool.slots[0].visitor = null
    router.pool.slots[0].owner = null
    expect((await startAs('198.51.100.2')).status).toBe(303)
  })
})

describe('/health', () => {
  it('answers 503 until a copy has been ready once, then stays 200 even when every copy is busy being wiped', async () => {
    await boot({ size: 1, noInit: true })
    expect((await fetch(`${B}/health`)).status).toBe(503)
    await router.init()
    expect((await fetch(`${B}/health`)).status).toBe(200)
    await startAs('198.51.100.1')
    clock += 21 * 60_000
    let release = () => {}
    driver.opts.gate = new Promise<void>((r) => { release = r })
    router.sweep()
    expect(router.pool.stats().starting).toBe(1)
    expect((await fetch(`${B}/health`)).status).toBe(200)
    release()
  })
})

describe('the total across copies', () => {
  const file = path.join(os.tmpdir(), `demo-budget-${process.pid}.json`)
  beforeEach(() => { fs.rmSync(file, { force: true }); return boot({ size: 2, totalTokensDay: 1000, budgetFile: file }) })
  afterEach(() => fs.rmSync(file, { force: true }))
  const statsOf = async (url = B) => (await fetch(`${url}/stats`, { headers: { [SLOT_SECRET_HEADER]: SECRET } })).json()

  it('adds what copies spend, switches the assistant off in every copy when the total is used up, and keeps the total across a restart', async () => {
    await startAs('198.51.100.1')
    await startAs('198.51.100.2')
    driver.opts.spent.set(0, 600)
    await router.pollUsage()
    expect(driver.log.off).toEqual([])
    expect((await statsOf()).tokensToday).toBe(600)
    driver.opts.spent.set(1, 500)
    await router.pollUsage()
    expect(await statsOf()).toMatchObject({ tokensToday: 1100, assistantOff: true })
    expect(new Set(driver.log.off.map((o: { slot: number }) => o.slot))).toEqual(new Set([0, 1]))
    expect(driver.log.off[0].day).toBe('1970-01-01')
    // What a copy spent counts before it is wiped, and a copy started afterwards is switched off at once.
    driver.opts.spent.set(0, 700)
    clock += 21 * 60_000
    router.sweep()
    await router.reset(router.pool.slots[0], 'en')
    expect((await statsOf()).tokensToday).toBe(1200)
    expect(driver.log.off.filter((o: { slot: number }) => o.slot === 0).length).toBeGreaterThan(1)
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).tokens).toBeGreaterThanOrEqual(1200)
    // Another router on the same file starts with the same total.
    const again = createRouter({ secret: SECRET, size: 1, driver: { start: async () => {}, stop: async () => {} }, now: () => clock, totalTokensDay: 1000, budgetFile: file })
    await again.init()
    const probe = http.createServer(again.handle)
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r))
    expect(await statsOf(`http://127.0.0.1:${(probe.address() as AddressInfo).port}`)).toMatchObject({ assistantOff: true })
    probe.close()
    // The next UTC day starts from nothing.
    clock += 24 * 3_600_000
    expect(await statsOf()).toMatchObject({ tokensToday: 0, assistantOff: false })
  })
})
