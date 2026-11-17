// The "Update now" button, for real: an install without Docker made by install.sh, filled with data, updated from the
// app. The installer stops the server, swaps the program and starts it again; nothing entered may change, and a
// checked copy of the database must exist from before the update.
// FG_BUNDLE: this version's archive (pnpm build && node scripts/make-bundle.mjs). FG_NEXT_BUNDLE: the archive the
// update installs; any other build will do, it only has to differ. No network: the release check and the installer
// come from this machine.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import Database from 'better-sqlite3'
import { sleep, waitUp } from './lib.mjs'

const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x && !c ? '  ' + x : ''}`); if (!c) process.exitCode = 1 }
const repo = fileURLToPath(new URL('../..', import.meta.url))
const target = `${process.platform}-${process.arch}`
const first = process.env.FG_BUNDLE ?? path.join(repo, `dist/folkbranch-${target}.tar.xz`)
const next = process.env.FG_NEXT_BUNDLE
if (!next || !fs.existsSync(first) || !fs.existsSync(next)) { console.error('Needs FG_BUNDLE and FG_NEXT_BUNDLE archives'); process.exit(1) }
const sum = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex')
// A release carries a checksum beside each archive, and the installer insists on it.
const withSum = (f, into) => {
  const copy = path.join(into, path.basename(f))
  fs.copyFileSync(f, copy)
  fs.writeFileSync(`${copy}.sha256`, `${sum(copy)}  ${path.basename(copy)}\n`)
  return copy
}

const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fg-selfupdate-')))
const dir = path.join(work, 'folkbranch')
const nextCopy = (fs.mkdirSync(path.join(work, 'next')), withSum(next, path.join(work, 'next')))
const PORT = 3496, B = `http://localhost:${PORT}`

// The release source answers "9.9.9", so the running version sees an update.
const releases = http.createServer((_, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ tag_name: 'v9.9.9', html_url: 'https://example.org/v9.9.9' })) }).listen(0)
const RELEASES = `http://127.0.0.1:${releases.address().port}/latest`
const env = { HOME: work, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, TMPDIR: work }
const run = (cmd, extra = {}) => spawnSync('sh', ['-c', cmd], { cwd: work, env: { ...env, ...extra }, encoding: 'utf8', timeout: 300000 })

try {
  const inst = run(`sh "${repo}install.sh" --local --dir "${dir}" --port ${PORT}`, { FOLKBRANCH_BUNDLE: pathToFileURL(first).href })
  ok('install.sh installs this version', inst.status === 0, (inst.stdout + inst.stderr).slice(-400))
  // What the update will use: the local release source, the installer of this checkout and the other archive.
  fs.appendFileSync(path.join(dir, '.env'), `\nFOLKBRANCH_RELEASES_API=${RELEASES}\nFOLKBRANCH_INSTALLER=${process.env.FG_INSTALLER ?? pathToFileURL(path.join(repo, "install.sh")).href}\nFOLKBRANCH_BUNDLE=${pathToFileURL(nextCopy).href}\n`)
  spawnSync('sh', ['-c', './folkbranch restart'], { cwd: dir, env, encoding: 'utf8' })
  await waitUp(B, 90000)
  const code = fs.readFileSync(path.join(dir, '.env'), 'utf8').match(/^SETUP_TOKEN=(.*)$/m)[1]
  const setup = await fetch(B + '/api/auth/family/setup', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ name: 'Анна', familyName: 'Обновление', language: 'ru', demo: true, code }) })
  ok('an owner sets up the archive', setup.ok, String(setup.status))
  const cookie = setup.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  const api = async (m, p, body) => (await fetch(`${B}/api/v1/${p}`, { method: m, headers: { cookie, origin: B, 'content-type': 'application/json' }, body: body && JSON.stringify(body) })).json()
  const g0 = await api('GET', 'graph')
  await api('PATCH', `persons/${g0.persons[0].id}`, { birthPlace: 'Тверь' })
  await api('POST', 'persons', { person: { givenName: 'Ёжик', surname: 'Проверочный', sex: 'M', birthDate: '1900' } })
  const before = await api('GET', 'graph')

  // The owner presses the button from an open page, which holds a live line to the server.
  const live = new AbortController()
  fetch(`${B}/api/events`, { headers: { cookie }, signal: live.signal }).then(async (r) => { for await (const _ of r.body) {} }).catch(() => {})
  await sleep(500)
  const status = await api('GET', 'update')
  ok('the app offers the button for this install', status.newer === true && status.how?.button === true, JSON.stringify(status))
  const start = await fetch(`${B}/api/v1/update`, { method: 'POST', headers: { cookie, origin: B } })
  const started = await start.json()
  ok('pressing it starts the update and names the copy', start.ok && /before-update/.test(started.backup ?? ''), JSON.stringify(started))
  const copyFile = path.join(dir, 'data', started.backup ?? 'missing')
  ok('the copy exists before the program is swapped', fs.existsSync(copyFile))

  // Wait for the swapped program to answer: the installer stops the server first.
  const end = Date.now() + 240000
  while (Date.now() < end && (fs.readFileSync(path.join(dir, 'app', '.sha256'), 'utf8').trim() !== sum(next) || fs.existsSync(path.join(dir, 'update.lock')))) await sleep(1000)
  try { await waitUp(B, 120000) } catch (e) {
    for (const f of fs.readdirSync(path.join(dir, 'logs'))) console.log(`--- ${f}\n` + fs.readFileSync(path.join(dir, 'logs', f), 'utf8').slice(-1200))
    throw e
  }
  live.abort()
  ok('the program was swapped for the new archive', fs.readFileSync(path.join(dir, 'app', '.sha256'), 'utf8').trim() === sum(next))
  ok('the update log was written', fs.existsSync(path.join(dir, 'logs', 'update.log')))
  if (process.exitCode) console.log(fs.readFileSync(path.join(dir, 'logs', 'update.log'), 'utf8').slice(-1500))
  ok('the lock is gone, so the next update can run', !fs.existsSync(path.join(dir, 'update.lock')))
  ok('the previous version was cleared away after a good start', !fs.existsSync(path.join(dir, 'app.old')))

  const after = await api('GET', 'graph')
  // Every field the previous release had must be the same; a newer release may add fields, which must be empty for old data.
  const strip = ({ updatedAt, ...p }) => p
  const byId = (g, like) => JSON.stringify([...g.persons].sort((a, b) => a.id.localeCompare(b.id)).map((p) => {
    const q = strip(p), base = like?.persons.find((x) => x.id === p.id)
    return base ? Object.fromEntries(Object.keys(strip(base)).map((k) => [k, q[k]])) : q
  }))
  ok('still signed in, and every person is the same', after.persons?.length === before.persons.length && byId(after, before) === byId(before), `${after.persons?.length} vs ${before.persons.length} ` + JSON.stringify(before.persons.flatMap((b) => { const a = after.persons.find((x) => x.id === b.id); return a ? Object.keys(strip(b)).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => [k, b[k], a[k]]) : [[b.id, 'missing']] }).slice(0, 3)))
  const added = after.persons.flatMap((p) => { const base = before.persons.find((x) => x.id === p.id) ?? {}; return Object.keys(p).filter((k) => !(k in base)).map((k) => [k, p[k]]) })
  ok('a field this version added is empty for what the old version wrote', added.every(([, v]) => v == null || v === '' || (Array.isArray(v) && !v.length)), JSON.stringify(added.filter(([, v]) => !(v == null || v === '')).slice(0, 3)))
  ok('every link is the same', JSON.stringify(after.parentChild.length + after.unions.length) === JSON.stringify(before.parentChild.length + before.unions.length))
  const copy = new Database(copyFile, { readonly: true })
  const integrity = copy.pragma('integrity_check', { simple: true })
  const people = copy.prepare('select count(*) as n from persons').get().n
  copy.close()
  ok('the copy from before the update is whole and holds everyone', integrity === 'ok' && people === before.persons.length, `${integrity} ${people}`)
} finally {
  spawnSync('sh', ['-c', './folkbranch stop'], { cwd: dir, env, encoding: 'utf8' })
  releases.close()
  if (!process.env.FG_KEEP) fs.rmSync(work, { recursive: true, force: true }); else console.log('kept', work)
}
