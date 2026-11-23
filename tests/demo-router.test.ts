// The demo router with fake slots: tiny servers on real ports that stand in for app copies, so assignment, the
// per-visitor binding, expiry, the limits and the proxying are all checked as the browser meets them.
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// @ts-expect-error plain JavaScript, run by Node as it is
import { COOKIE, createRouter, sign, verify } from '../demo/router-lib.mjs'

const SECRET = 'a-long-router-secret-for-tests'
const SLOT_SECRET_HEADER = 'x-demo-secret'

type Slot = { id: number; port: number; ready: boolean; visitor: string | null; lang: string }

/** Stands in for the app copies: answers who it is, signs a visitor in with a cookie, streams, and echoes a body. */
function fakeDriver() {
  const servers = new Map<number, http.Server>()
  const log = { starts: [] as { slot: number; lang: string; keep: boolean }[], stops: [] as number[], seen: [] as { slot: number; headers: http.IncomingHttpHeaders }[] }
  return {
    log,
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

async function boot(opts: Record<string, unknown> = {}) {
  driver = fakeDriver()
  logged = []
  router = createRouter({ secret: SECRET, size: 2, driver, now: () => clock, port: (id: number) => base + id, log: (event: string, f: object) => logged.push({ event, ...f }), ...opts })
  await router.init()
  front = http.createServer(router.handle)
  await new Promise<void>((r) => front.listen(0, '127.0.0.1', r))
  B = `http://127.0.0.1:${(front.address() as AddressInfo).port}`
}

const startAs = (ip: string, body = 'lang=en', extra: Record<string, string> = {}) =>
  fetch(`${B}/start`, { method: 'POST', redirect: 'manual', headers: { 'cf-connecting-ip': ip, 'content-type': 'application/x-www-form-urlencoded', ...extra }, body })
/** What the browser would keep: every cookie of the answer, as name=value. */
const jar = (res: Response) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')

beforeEach(() => { clock = 1_000_000 })
afterEach(async () => { front.closeAllConnections(); await new Promise((r) => front.close(r)); await driver.stopAll() })

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
    expect(stats).toEqual({ slots: 2, inUse: 1, free: 1, starting: 0, startsLastHour: 1 })
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
    for (let i = 0; i < 3; i++) expect((await startAs('192.0.2.9')).status).toBe(303)
    const fourth = await startAs('192.0.2.9')
    expect(fourth.status).toBe(429)
    expect(await fourth.text()).toContain('Too many demos')
    // Another address is not held back, and the hour lets the first one in again.
    expect(logged.some((l) => l.event === 'start-limited')).toBe(true)
    expect(JSON.stringify(logged)).not.toContain('192.0.2.9')
    clock += 3_600_001
    expect((await startAs('192.0.2.9')).status).toBe(503)
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
    await router.reset(slot, 'en')
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
