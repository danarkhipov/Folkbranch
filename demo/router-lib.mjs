// The demo router's logic, with the processes left out so tests can drive it with fake slots. docs/DEMO.md explains the whole.
// A slot is one app process with its own data folder and port. A visitor holds one slot until it expires, and what
// ties them together is a cookie the router signs: a slot number and a token the slot remembers.
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const COOKIE = 'fb_demo'

// ---- the signed cookie ----------------------------------------------------------------------------------------

export function sign(value, secret) {
  const body = Buffer.from(value).toString('base64url')
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`
}

/** The signed value, or null when the cookie was not signed with this secret. */
export function verify(cookie, secret) {
  const [body, mac, extra] = String(cookie ?? '').split('.')
  if (!body || !mac || extra !== undefined) return null
  const good = createHmac('sha256', secret).update(body).digest()
  const given = Buffer.from(mac, 'base64url')
  if (given.length !== good.length || !timingSafeEqual(given, good)) return null
  return Buffer.from(body, 'base64url').toString()
}

export const cookieOf = (header, name) => String(header ?? '').split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === name)?.slice(1).join('=') ?? null

/** Compared in constant time; an empty secret matches nothing. */
export function sameSecret(given, expected) {
  if (!given || !expected) return false
  const d = (s) => createHash('sha256').update(String(s)).digest()
  return timingSafeEqual(d(given), d(expected))
}

// ---- the slots ------------------------------------------------------------------------------------------------

export function createPool({ size, ttlMs, idleMs, now = Date.now }) {
  const slots = Array.from({ length: size }, (_, id) => ({ id, ready: false, visitor: null, owner: null, lang: 'en', startedAt: 0, lastSeen: 0, reported: 0, wipePending: false }))
  const starts = []
  const endsAt = (s) => Math.min(s.startedAt + ttlMs, s.lastSeen + idleMs)
  return {
    slots,
    /** A free, ready slot for this language (one already in it, or else any), taken for a new visitor; null when none. */
    assign(lang, owner = null) {
      const free = slots.filter((s) => s.ready && !s.visitor)
      const slot = free.find((s) => s.lang === lang) ?? free[0]
      if (!slot) return null
      slot.visitor = randomBytes(12).toString('hex')
      slot.owner = owner
      slot.startedAt = slot.lastSeen = now()
      starts.push(now())
      return { slot, token: slot.visitor, needsReset: slot.lang !== lang }
    },
    /** 'ok' while this visitor still holds the slot, 'ended' once they do not. */
    check(id, token) {
      const s = slots[id]
      if (!s || !s.visitor || s.visitor !== token) return 'ended'
      return now() >= endsAt(s) ? 'ended' : 'ok'
    },
    /** Whether this address already holds a copy that has not ended. */
    liveFor(owner) { return !!owner && slots.some((s) => s.owner === owner && s.visitor && now() < endsAt(s)) },
    touch(id) { if (slots[id]) slots[id].lastSeen = now() },
    /** Slots whose visitor has used up the time or been idle too long. */
    expired() { return slots.filter((s) => s.visitor && now() >= endsAt(s)) },
    /** Minutes until the next visitor leaves, at least one. */
    minutesToFree() {
      const ends = slots.filter((s) => s.visitor).map(endsAt)
      return ends.length ? Math.max(1, Math.ceil((Math.min(...ends) - now()) / 60_000)) : 1
    },
    stats() {
      const hour = now() - 3_600_000
      while (starts.length && starts[0] < hour) starts.shift()
      return {
        slots: slots.length,
        inUse: slots.filter((s) => s.visitor).length,
        free: slots.filter((s) => s.ready && !s.visitor).length,
        starting: slots.filter((s) => !s.ready).length,
        startsLastHour: starts.length,
      }
    },
  }
}

/** At most `max` starts per key in `windowMs`. */
export function createLimiter({ max, windowMs, now = Date.now }) {
  const seen = new Map()
  const kept = (key) => (seen.get(key) ?? []).filter((x) => now() - x < windowMs)
  return {
    /** Whether a start would be let through, counting nothing. */
    peek(key) { return kept(key).length < max },
    /** Counts one start. */
    hit(key) { seen.set(key, [...kept(key), now()]) },
    allow(key) {
      const t = now()
      const kept = (seen.get(key) ?? []).filter((x) => t - x < windowMs)
      if (kept.length >= max) { seen.set(key, kept); return false }
      seen.set(key, [...kept, t])
      if (seen.size > 5000) for (const [k, v] of seen) if (!v.some((x) => t - x < windowMs)) seen.delete(k)
      return true
    },
  }
}

// ---- the pages ------------------------------------------------------------------------------------------------

const WORDS = {
  en: {
    title: 'Folkbranch demo', lead: 'Try Folkbranch with an invented family. You get your own copy, signed in as its owner. Nothing to sign up for.',
    start: 'Start the demo', note: 'Your copy is deleted after an hour, or after 20 minutes of silence. Do not upload real family data.',
    busyTitle: 'All demo copies are in use.', busy: (n) => `All demo copies are in use. Try again in about ${n} ${n === 1 ? 'minute' : 'minutes'}.`,
    endedTitle: 'Your demo has ended', ended: 'Your demo has ended. Start again for a fresh copy.', again: 'Start again',
    limit: 'Too many demos from your connection. Try again later.', already: 'A demo copy from your connection is already running. Use it, or wait until it ends.', slow: 'The request took too long. Go back and try again.', big: 'The request was too large.', check: 'The check did not pass. Go back and try again.',
    starting: 'The demo copy is starting. This page reloads by itself.', broken: 'The demo is not answering. Try again in a moment.', other: 'Русский',
  },
  ru: {
    title: 'Демо Folkbranch', lead: 'Попробуйте Folkbranch на выдуманной семье. Вы получите свою копию и войдёте в неё владельцем. Регистрация не нужна.',
    start: 'Начать демо', note: 'Копия удаляется через час или через 20 минут без действий. Не загружайте настоящие семейные данные.',
    busyTitle: 'Все копии демо заняты.', busy: (n) => `Все копии демо заняты. Попробуйте снова примерно через ${n} мин.`,
    endedTitle: 'Ваше демо закончилось', ended: 'Ваше демо закончилось. Начните заново, чтобы получить новую копию.', again: 'Начать заново',
    limit: 'С вашего подключения слишком много запусков демо. Попробуйте позже.', already: 'С вашего подключения уже запущена копия демо. Пользуйтесь ей или дождитесь её конца.', slow: 'Запрос шёл слишком долго. Вернитесь назад и попробуйте ещё раз.', big: 'Запрос слишком большой.', check: 'Проверка не пройдена. Вернитесь назад и попробуйте ещё раз.',
    starting: 'Копия демо запускается. Страница обновится сама.', broken: 'Демо не отвечает. Попробуйте ещё раз через минуту.', other: 'English',
  },
}

/** Russian for a browser that asks for it first, English for the rest. */
export const langOfHeader = (accept) => (/^\s*ru\b/i.test(String(accept ?? '')) ? 'ru' : 'en')

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

const shell = (lang, title, body, head = '') => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>${head}<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f3ea;color:#2a241c;font:17px/1.5 Georgia,serif}
main{max-width:30rem;padding:2rem 1.25rem;text-align:center}h1{font-size:1.6rem;margin:0 0 .75rem}p{margin:.5rem 0}
button{margin-top:1.25rem;padding:.9rem 2rem;font:600 1.15rem system-ui,sans-serif;color:#f7f3ea;background:#2a241c;border:0;border-radius:.6rem;cursor:pointer}
small,.note{color:#6a5f50;font-size:.9rem}a{color:inherit}.cf-turnstile{margin-top:1rem;display:inline-block}</style></head><body><main>${body}</main></body></html>`

export function startPage(lang, { siteKey } = {}) {
  const w = WORDS[lang]
  const widget = siteKey ? `<div class="cf-turnstile" data-sitekey="${esc(siteKey)}"></div>` : ''
  const head = siteKey ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ''
  return shell(lang, w.title, `<h1>${esc(w.title)}</h1><p>${esc(w.lead)}</p><form method="post" action="/start"><input type="hidden" name="lang" value="${lang}">${widget}<br><button type="submit">${esc(w.start)}</button></form><p class="note">${esc(w.note)}</p><p><small><a href="/?lang=${lang === 'ru' ? 'en' : 'ru'}">${esc(w.other)}</a></small></p>`, head)
}
export const busyPage = (lang, minutes) => shell(lang, WORDS[lang].busyTitle, `<h1>${esc(WORDS[lang].busyTitle)}</h1><p>${esc(WORDS[lang].busy(minutes))}</p>`, '<meta http-equiv="refresh" content="60">')
export const endedPage = (lang) => shell(lang, WORDS[lang].endedTitle, `<h1>${esc(WORDS[lang].endedTitle)}</h1><p>${esc(WORDS[lang].ended)}</p><form method="post" action="/start"><input type="hidden" name="lang" value="${lang}"><button type="submit">${esc(WORDS[lang].again)}</button></form>`)
export const noticePage = (lang, key, refresh) => shell(lang, WORDS[lang].title, `<p>${esc(WORDS[lang][key])}</p><p><a href="/">${esc(WORDS[lang].title)}</a></p>`, refresh ? `<meta http-equiv="refresh" content="${refresh}">` : '')

// ---- the router -----------------------------------------------------------------------------------------------

/** Requests that say nothing about someone being there: an open page's live line and its presence beat. */
const PASSIVE = [/^\/api\/events(\/|$)/, /^\/api\/v1\/presence$/, /^\/api\/health$/]

/** What must be put right before the router may start, or null. */
export function startupProblem({ publicUrl, turnstile, allowNoTurnstile }) {
  if (publicUrl.startsWith('https:') && !turnstile && !allowNoTurnstile) return 'The public demo needs Cloudflare Turnstile: set TURNSTILE_SECRET and TURNSTILE_SITE_KEY (or DEMO_ALLOW_NO_TURNSTILE=1 to run without, and accept that bots can take every copy).'
  return null
}

/** The body of a small form, read within a time and a size: a connection that trickles is cut off. */
const readBody = (req, max = 2048, timeoutMs = 10_000) => new Promise((resolve, reject) => {
  let size = 0
  const parts = []
  const timer = setTimeout(() => reject(Object.assign(new Error('too slow'), { code: 408 })), timeoutMs)
  const done = (fn) => (v) => { clearTimeout(timer); fn(v) }
  resolve = done(resolve)
  reject = done(reject)
  req.on('data', (c) => { size += c.length; if (size > max) reject(Object.assign(new Error('too large'), { code: 413 })); else parts.push(c) })
  req.on('end', () => resolve(Buffer.concat(parts).toString()))
  req.on('error', reject)
})

/** The request, answered by the slot's app: the same method, path and body, streamed both ways. */
function pipeTo(slotPort, req, res, headers, onError) {
  const up = http.request({ host: '127.0.0.1', port: slotPort, method: req.method, path: req.url, headers, agent: false }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers)
    r.pipe(res)
  })
  up.on('error', onError)
  // A page that goes away must free the live line it held.
  res.on('close', () => up.destroy())
  req.pipe(up)
}

export function createRouter({
  secret, size = 8, ttlMs = 60 * 60_000, idleMs = 20 * 60_000, startsPerHour = 3, driver, publicUrl = '', defaultLang = 'en', turnstile = null,
  now = Date.now, log = () => {}, fetchImpl = fetch, port = (id) => 4100 + id,
  /** Tokens all copies together may spend in a UTC day; then every copy's assistant is switched off until the next day. 0 means no total. */
  totalTokensDay = 0, budgetFile = null,
  /** A header Cloudflare is made to add: only with it is CF-Connecting-IP believed. Without the option the header is trusted as it comes. */
  cfSecret = '', bodyTimeoutMs = 10_000, retryMs = 3000, keepFailures = 3,
}) {
  const pool = createPool({ size, ttlMs, idleMs, now })
  const limiter = createLimiter({ max: startsPerHour, windowMs: 3_600_000, now })
  for (const s of pool.slots) { s.port = port(s.id); s.lang = defaultLang }
  const secure = publicUrl.startsWith('https:')
  const hashIp = (ip) => createHash('sha256').update(`${secret}:${ip}`).digest('hex').slice(0, 10)
  const resetting = new Map()
  let everReady = false
  let stopped = false

  // ---- the total budget ----
  const today = () => new Date(now()).toISOString().slice(0, 10)
  let budget = { day: today(), tokens: 0 }
  try { const b = JSON.parse(fs.readFileSync(budgetFile, 'utf8')); if (b.day === today() && Number.isFinite(b.tokens)) budget = b } catch { /* none yet */ }
  const spentToday = () => (budget.day === today() ? budget.tokens : 0)
  const budgetOut = () => totalTokensDay > 0 && spentToday() >= totalTokensDay
  function addTokens(n) {
    if (budget.day !== today()) budget = { day: today(), tokens: 0 }
    budget.tokens += n
    if (budgetFile) { try { fs.mkdirSync(path.dirname(budgetFile), { recursive: true }); fs.writeFileSync(budgetFile, JSON.stringify(budget)) } catch (e) { log('budget-save-failed', { error: String(e?.message ?? e) }) } }
  }
  const switchOff = (slot) => driver.setAiOff?.(slot, today()).catch((e) => log('ai-off-failed', { slot: slot.id, error: String(e?.message ?? e) }))
  /** What a copy has spent since it was last asked, added to the total; the assistant goes off everywhere when the total is used up. */
  async function collect(slot, force = false) {
    if (!(slot.ready || force) || !driver.usage) return
    let t
    try { t = await driver.usage(slot) } catch { return }
    addTokens(t >= slot.reported ? t - slot.reported : t)
    slot.reported = t
    if (budgetOut()) await Promise.all(pool.slots.filter((s) => s.ready).map(switchOff))
  }
  const pollUsage = () => Promise.all(pool.slots.filter((s) => s.ready && s.visitor).map(collect))

  /**
   * Wipes the slot and starts it fresh in a language. Never throws: a failed start is tried again. A wipe asked for while
   * a reset that keeps the data is running is done again after it, and a copy that will not start with its data is wiped.
   */
  function reset(slot, lang, { keep = false } = {}) {
    if (resetting.has(slot.id)) {
      if (!keep) { slot.wipePending = true; slot.pendingLang = lang }
      return resetting.get(slot.id)
    }
    const wasReady = slot.ready
    slot.ready = false
    const run = (async () => {
      let failures = 0
      // What the copy spent counts toward the total before it is wiped.
      if (wasReady) await collect(slot, true).catch(() => {})
      let keepData = keep
      for (;;) {
        if (stopped) return
        try {
          await driver.stop(slot)
          if (stopped) return
          const wanted = slot.wipePending ? slot.pendingLang ?? lang : lang
          await driver.start(slot, wanted, { keep: keepData && !slot.wipePending && failures < keepFailures })
          slot.lang = wanted
          slot.reported = 0
          if (slot.wipePending) { slot.wipePending = false; keepData = false; lang = wanted; continue }
          if (budgetOut()) await switchOff(slot)
          slot.ready = true
          everReady = true
          return
        } catch (e) {
          failures++
          log('slot-start-failed', { slot: slot.id, error: String(e?.message ?? e) })
          await new Promise((r) => setTimeout(r, retryMs))
        }
      }
    })().finally(() => resetting.delete(slot.id))
    resetting.set(slot.id, run)
    return run
  }

  /** Hands every slot whose time is up back, as a fresh copy. */
  function sweep() {
    const out = pool.expired()
    for (const s of out) {
      log('slot-expired', { slot: s.id })
      s.visitor = null
      s.owner = null
      reset(s, s.lang)
    }
    return out.map((s) => s.id)
  }

  /** A slot's process died by itself: start it again, keeping what the visitor made. */
  function crashed(slot) {
    if (resetting.has(slot.id) || stopped) return
    log('slot-crashed', { slot: slot.id })
    reset(slot, slot.lang, { keep: !!slot.visitor })
  }

  async function verifyTurnstile(token, ip) {
    if (!turnstile) return true
    if (!token) return false
    try {
      const r = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: new URLSearchParams({ secret: turnstile.secret, response: token, ...(ip ? { remoteip: ip } : {}) }) })
      return (await r.json()).success === true
    } catch { return false }
  }

  /** The app's own Set-Cookie lines for the demo owner, from the slot. */
  async function sessionCookies(slot) {
    const res = await fetch(`http://127.0.0.1:${slot.port}/api/demo/session`, { method: 'POST', headers: { 'x-demo-secret': secret } })
    if (!res.ok) throw new Error(`session answered ${res.status}`)
    return res.headers.getSetCookie()
  }

  const html = (res, status, body, extra = {}) => { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...extra }); res.end(body) }
  /** The visitor's address: Cloudflare's header when it can be believed, else the connection's own. */
  const ipOf = (req) => {
    const direct = String(req.socket.remoteAddress ?? '')
    const cf = req.headers['cf-connecting-ip']
    if (cf && (!cfSecret || sameSecret(req.headers['x-demo-cf'], cfSecret))) return String(cf)
    return cfSecret ? `direct:${direct}` : direct
  }
  // Kept a day past the copy's life, so a visitor who comes back is told that their demo ended, not shown a stranger's start page.
  const routerCookie = (value) => `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.ceil(ttlMs / 1000) + 86_400}${secure ? '; Secure' : ''}`

  async function start(req, res) {
    const ip = ipOf(req)
    const owner = hashIp(ip)
    let form
    try { form = new URLSearchParams(await readBody(req, 2048, bodyTimeoutMs)) } catch (e) {
      const lang = langOfHeader(req.headers['accept-language'])
      res.on('finish', () => req.destroy())
      return html(res, e.code === 413 ? 413 : 408, noticePage(lang, e.code === 413 ? 'big' : 'slow'), { connection: 'close' })
    }
    const lang = form.get('lang') === 'ru' ? 'ru' : form.get('lang') === 'en' ? 'en' : langOfHeader(req.headers['accept-language'])
    if (!limiter.peek(ip)) { log('start-limited', { ip: owner }); return html(res, 429, noticePage(lang, 'limit')) }
    if (pool.liveFor(owner)) { log('start-already', { ip: owner }); return html(res, 429, noticePage(lang, 'already')) }
    if (!(await verifyTurnstile(form.get('cf-turnstile-response'), ip))) { log('start-check-failed', { ip: owner }); return html(res, 403, noticePage(lang, 'check')) }
    const got = pool.assign(lang, owner)
    if (!got) { log('start-busy', { ip: owner }); return html(res, 503, busyPage(lang, pool.minutesToFree()), { 'retry-after': '60' }) }
    // Only a start that got a copy counts against the address.
    limiter.hit(ip)
    const { slot, token, needsReset } = got
    try {
      // A copy in the other language is made fresh in this one; the visitor's time starts when it is ready.
      if (needsReset) await reset(slot, lang)
      slot.startedAt = slot.lastSeen = now()
      const cookies = await sessionCookies(slot)
      log('start', { slot: slot.id, ip: owner, lang })
      res.writeHead(303, { location: '/', 'cache-control': 'no-store', 'set-cookie': [...cookies, routerCookie(sign(`${slot.id}:${token}`, secret))] })
      res.end()
    } catch (e) {
      log('start-failed', { slot: slot.id, error: String(e?.message ?? e) })
      slot.visitor = null
      slot.owner = null
      reset(slot, slot.lang)
      html(res, 503, noticePage(lang, 'broken', 5))
    }
  }

  function proxy(req, res, slot, lang) {
    if (!slot.ready) return html(res, 503, noticePage(lang, 'starting', 3), { 'retry-after': '3' })
    const path = new URL(req.url, 'http://x').pathname
    if (!PASSIVE.some((p) => p.test(path))) pool.touch(slot.id)
    const headers = { ...req.headers }
    delete headers['x-demo-secret']
    delete headers['x-demo-cf']
    // The visitor's own cookies reach the app; the router's cookie does not.
    const rest = String(headers.cookie ?? '').split(/;\s*/).filter((c) => c && !c.startsWith(`${COOKIE}=`)).join('; ')
    if (rest) headers.cookie = rest
    else delete headers.cookie
    headers['x-forwarded-for'] = ipOf(req)
    headers['x-forwarded-host'] = req.headers.host ?? ''
    headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] ?? (secure ? 'https' : 'http')
    pipeTo(slot.port, req, res, headers, () => { if (!res.headersSent) html(res, 502, noticePage(lang, 'broken', 5)); else res.destroy() })
  }

  async function handle(req, res) {
    try {
      const url = new URL(req.url, 'http://x')
      const lang = url.searchParams.get('lang') === 'ru' ? 'ru' : url.searchParams.get('lang') === 'en' ? 'en' : langOfHeader(req.headers['accept-language'])
      // Up only once a copy has been ready: a release that cannot start is seen as broken, and a busy demo is not.
      if (url.pathname === '/health') { res.writeHead(everReady ? 200 : 503, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: everReady })) }
      if (url.pathname === '/stats') {
        if (!sameSecret(req.headers['x-demo-secret'], secret)) { res.writeHead(404); return res.end() }
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ ...pool.stats(), tokensToday: spentToday(), assistantOff: budgetOut() }))
      }
      const payload = verify(cookieOf(req.headers.cookie, COOKIE), secret)
      const [slotId, token] = payload ? payload.split(':') : []
      const live = payload ? pool.check(Number(slotId), token) === 'ok' : false
      if (req.method === 'POST' && url.pathname === '/start') {
        if (live) { req.resume(); res.writeHead(303, { location: '/' }); return res.end() }
        return start(req, res)
      }
      if (live) return proxy(req, res, pool.slots[Number(slotId)], lang)
      if (payload) {
        if (url.pathname.startsWith('/api/')) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"error":"Your demo has ended"}') }
        return html(res, 200, endedPage(lang))
      }
      if (req.method === 'GET' && url.pathname === '/') return html(res, 200, startPage(lang, { siteKey: turnstile?.siteKey }))
      res.writeHead(302, { location: '/' })
      res.end()
    } catch (e) {
      log('router-error', { error: String(e?.message ?? e) })
      if (!res.headersSent) res.writeHead(500)
      res.end()
    }
  }

  return {
    pool, handle, sweep, crashed, reset, hashIp, pollUsage, collect,
    /** After this no copy is started again: a reset in progress ends, and the caller stops the rest. */
    stop() { stopped = true },
    /** Resolves when no reset is running. */
    idle: () => Promise.all([...resetting.values()]),
    /** Starts every slot at once; resolves when all are ready. */
    init: () => Promise.all(pool.slots.map((s) => reset(s, defaultLang))),
  }
}
