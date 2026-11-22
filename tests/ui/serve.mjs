// A built copy of the app on a throwaway data folder with an invented family, for browser checks that need no Docker:
// `pnpm build` once, then `startApp()`. Nothing real is read or written; the folder is removed on stop.
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadChronicleDemo } from '../../scripts/chronicle-demo.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const root = fileURLToPath(new URL('../..', import.meta.url))

/** Waits for /api/health to answer. */
async function waitUp(B, ms = 90000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fetch(B + '/api/health').then((r) => r.ok).catch(() => false)) return
    await sleep(200)
  }
  throw new Error('the app did not come up')
}

/**
 * Starts `next start` on a free-ish port with the demo family (or `people` invented people from gen-family.py on top).
 * With `chronicle`, the invented chronicle entries of tests/fixtures/chronicle-demo.json too, shown to everyone.
 * Returns the address, an owner's cookie, and `stop()`.
 */
export async function startApp({ port = 3590, language = 'en', people = 0, chronicle = false, env = {} } = {}) {
  const data = mkdtempSync(path.join(tmpdir(), 'folkbranch-ui-'))
  const B = `http://127.0.0.1:${port}`
  const child = spawn('pnpm', ['exec', 'next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: root, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, DATA_DIR: data, BETTER_AUTH_URL: B, SETUP_TOKEN: 'ui-check', BETTER_AUTH_SECRET: 'u'.repeat(64), NODE_ENV: 'production', ...env },
  })
  let err = ''
  child.stderr.on('data', (d) => { err = (err + d).slice(-2000) })
  const stop = () => { child.kill('SIGTERM'); rmSync(data, { recursive: true, force: true }) }
  try {
    await waitUp(B)
    const r = await fetch(B + '/api/auth/family/setup', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: B },
      body: JSON.stringify({ name: 'Ann', familyName: 'Woods', language, demo: true, code: 'ui-check' }),
    })
    if (!r.ok) throw new Error('setup answered ' + r.status)
    const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
    if (people) {
      // Towns with points first, so the people written with their names have somewhere to stand on the map.
      for (let k = 0; k < 300; k++) {
        const lat = 44 + ((k * 37) % 100) / 10, lon = 4 + ((k * 53) % 300) / 10
        const p = await fetch(B + '/api/v1/places', { method: 'POST', headers: { cookie, origin: B, 'content-type': 'application/json' }, body: JSON.stringify({ name: `Town${k}`, lat, lon }) })
        if (!p.ok) throw new Error(`place ${k} answered ${p.status}: ${await p.text()}`)
      }
      const ged = execFileSync('python3', [path.join(root, 'tests/ui/gen-placed-family.py'), String(people)], { encoding: 'utf8', maxBuffer: 1e9 })
      const i = await fetch(B + '/api/v1/gedcom/import', { method: 'POST', headers: { cookie, origin: B, 'content-type': 'text/plain' }, body: ged })
      if (!i.ok) throw new Error('import answered ' + i.status)
    }
    if (chronicle) await loadChronicleDemo(B, { cookie }, { show: 'all' })
    return { B, cookie, stop }
  } catch (e) {
    stop()
    throw new Error(`${e.message}\n${err}`)
  }
}

/** The cookie as Playwright wants it. */
export const cookiesFor = (B, cookie) => cookie.split('; ').map((c) => ({ name: c.split('=')[0], value: c.slice(c.indexOf('=') + 1), domain: new URL(B).hostname, path: '/', httpOnly: true }))
