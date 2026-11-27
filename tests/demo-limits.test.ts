// What keeps one demo copy from using more than its share of the disk and the total: the people cap on undo, the size of
// the database, the router's door for usage and the switch that turns the assistant off for the day.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let hdrs = new Headers()
vi.mock('next/headers', () => ({ headers: async () => hdrs }))

const SECRET = 'router-secret-for-limits'
const HOST = 'localhost:3417'
const owner = { userId: 'u', name: 'O', role: 'owner' as const, personId: null }
let cookie = ''

beforeAll(async () => {
  process.env.FOLKBRANCH_DEMO = '1'
  process.env.DEMO_ROUTER_SECRET = SECRET
  process.env.DEMO_DB_MB = '3'
  const { seedDemo } = await import('../lib/demo-seed')
  await seedDemo()
  const { POST } = await import('../app/api/demo/session/route')
  cookie = (await POST(new Request(`http://${HOST}/api/demo/session`, { method: 'POST', headers: { 'x-demo-secret': SECRET } }))).headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
})
afterAll(() => { delete process.env.FOLKBRANCH_DEMO; delete process.env.DEMO_PEOPLE })

describe('disk and totals', () => {
  it('refuses a database copy on demand', async () => {
    hdrs = new Headers({ host: HOST, origin: `http://${HOST}`, cookie })
    const { POST } = await import('../app/api/v1/[...path]/route')
    const res = await POST(new Request(`http://${HOST}/api/v1/backups/now`, { method: 'POST', headers: hdrs }), { params: Promise.resolve({ path: ['backups', 'now'] }) })
    expect(res.status).toBe(403)
  })

  it('cannot pass the people cap by undoing a delete', async () => {
    const people = await import('../lib/ops/people')
    const { getDb, schema } = await import('../lib/db')
    const core = await import('../lib/ops/core')
    const made = people.createPerson(owner, { givenName: 'Short', surname: 'Lived' })
    people.deletePerson(owner, made.id)
    const entry = getDb().select().from(schema.history).all().filter((h) => !h.undoneAt && !h.undoOf).at(-1)!
    process.env.DEMO_PEOPLE = String(getDb().select().from(schema.persons).all().length)
    expect(() => core.undo(owner, entry.id, 'undo')).toThrow(/holds up to/)
    delete process.env.DEMO_PEOPLE
    expect(() => core.undo(owner, entry.id, 'undo')).not.toThrow()
  })

  it('stops the database at DEMO_DB_MB: text has no other limit, and the disk is shared', async () => {
    const { getDb } = await import('../lib/db')
    const sqlite = getDb().$client
    const pageSize = sqlite.pragma('page_size', { simple: true }) as number
    expect(sqlite.pragma('max_page_count', { simple: true })).toBe(Math.floor((3 * 1024 * 1024) / pageSize))
    const put = sqlite.prepare('insert into settings (key, value) values (?, ?)')
    const big = 'x'.repeat(400 * 1024)
    let wrote = 0
    expect(() => { for (let i = 0; i < 20; i++) { put.run(`filler${i}`, big); wrote++ } }).toThrow(/full/i)
    expect(wrote).toBeLessThan(20)
  })

  it('has the router read what a copy has spent, and switch the assistant off for the day, only with its secret', async () => {
    const usage = await import('../app/api/demo/usage/route')
    const ask = (method: 'GET' | 'POST', secret?: string, body?: unknown) => (usage[method] as (r: Request) => Response | Promise<Response>)(new Request(`http://${HOST}/api/demo/usage`, { method, headers: secret ? { 'x-demo-secret': secret } : {}, ...(body ? { body: JSON.stringify(body) } : {}) }))
    expect((await ask('GET')).status).toBe(404)
    expect((await ask('POST', 'wrong', { aiOffDay: '2026-01-01' })).status).toBe(404)
    expect(typeof (await (await ask('GET', SECRET)).json()).tokens).toBe('number')
    expect((await ask('POST', SECRET, { aiOffDay: 'tomorrow' })).status).toBe(400)
    const { assistantRefusal } = await import('../lib/agent/agent')
    expect(assistantRefusal(owner)).not.toContain('used up its share')
    expect((await ask('POST', SECRET, { aiOffDay: new Date().toISOString().slice(0, 10) })).status).toBe(200)
    expect(assistantRefusal(owner)).toContain('used up its share')
    // Yesterday's switch means nothing today.
    await ask('POST', SECRET, { aiOffDay: '2020-01-01' })
    expect(assistantRefusal(owner)).not.toContain('used up its share')
  })
})

describe('a full database', () => {
  it('still switches the assistant off for the day (a file, not a row), and says in plain words that the copy is full', async () => {
    // Fill the database to its limit, until a row of any size is refused.
    const { getDb } = await import('../lib/db')
    const put = getDb().$client.prepare('insert into settings (key, value) values (?, ?)')
    let n = 0
    for (const size of [20_000, 2_000, 100]) { for (;;) { try { put.run(`fill${n++}`, 'x'.repeat(size)) } catch { break } } }
    const usage = await import('../app/api/demo/usage/route')
    const day = new Date().toISOString().slice(0, 10)
    const set = await usage.POST(new Request(`http://${HOST}/api/demo/usage`, { method: 'POST', headers: { 'x-demo-secret': SECRET }, body: JSON.stringify({ aiOffDay: day }) }))
    expect(set.status).toBe(200)
    // Written outside the database, so it cannot have been refused for want of room.
    expect((await import('../lib/ops/app-config')).getSetting('demoAiOffDay')).toBeNull()
    const { assistantRefusal } = await import('../lib/agent/agent')
    expect(assistantRefusal(owner)).toContain('used up its share')
    await usage.POST(new Request(`http://${HOST}/api/demo/usage`, { method: 'POST', headers: { 'x-demo-secret': SECRET }, body: JSON.stringify({ aiOffDay: '2020-01-01' }) }))
    // A write that does not fit answers with a sentence, not a server error.
    hdrs = new Headers({ host: HOST, origin: `http://${HOST}`, cookie, 'content-type': 'application/json' })
    const { POST } = await import('../app/api/v1/[...path]/route')
    // Small writes still fit in the pages that are there; keep writing until one needs a page the copy may not have.
    const { schema } = await import('../lib/db')
    process.env.DEMO_PEOPLE = '100000'
    let res: Response | undefined
    for (let i = 0; i < 3000; i++) {
      res = await POST(new Request(`http://${HOST}/api/v1/persons`, { method: 'POST', headers: hdrs, body: JSON.stringify({ person: { givenName: `Over${i}`, surname: 'Flow', otherNames: 'x'.repeat(100) } }) }), { params: Promise.resolve({ path: ['persons'] }) })
      if (res.status !== 200) break
    }
    expect(getDb().select().from(schema.persons).all().length).toBeGreaterThan(27)
    res = res!
    expect(res.status).toBe(507)
    expect((await res.json()).error).toBe('The demo copy is full: install your own copy to keep going.')
  })
})
