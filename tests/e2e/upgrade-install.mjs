// Updating as people do: the last release, installed by its own install.sh and filled, then the install command run
// again with this version while a page is open. A version before 1.6.0 does not stop with a page open, so this
// install.sh has to end it, or the app is down afterwards. Nothing entered and no setting may change.
// FG_OLD_BUNDLE and FG_OLD_INSTALLER: the release to start from and its install.sh. Without them the latest release for
// this system and the install.sh of its tag are downloaded with `gh`. FG_BUNDLE: this version's archive.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { waitUp } from './lib.mjs'

const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x && !c ? '  ' + x : ''}`); if (!c) process.exitCode = 1 }
const repo = fileURLToPath(new URL('../..', import.meta.url))
const target = `${process.platform}-${process.arch}`
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fg-upgrade-')))
let oldBundle = process.env.FG_OLD_BUNDLE, oldInstaller = process.env.FG_OLD_INSTALLER
if (!oldBundle || !oldInstaller) {
  const gh = (...a) => spawnSync('gh', a, { encoding: 'utf8' })
  const tag = gh('release', 'view', '--repo', 'danarkhipov/folkbranch', '--json', 'tagName', '--jq', '.tagName').stdout.trim()
  const r = gh('release', 'download', tag, '--repo', 'danarkhipov/folkbranch', '--pattern', `folkbranch-${target}.tar.xz`, '--dir', work)
  const i = gh('api', `repos/danarkhipov/folkbranch/contents/install.sh?ref=${tag}`, '--jq', '.content')
  if (!tag || r.status || i.status) { console.error(`Could not download the latest release: ${r.stderr}${i.stderr}`); process.exit(1) }
  oldBundle = path.join(work, `folkbranch-${target}.tar.xz`)
  oldInstaller = path.join(work, 'install-old.sh')
  fs.writeFileSync(oldInstaller, Buffer.from(i.stdout.replace(/\s/g, ''), 'base64'))
}
const newBundle = process.env.FG_BUNDLE ?? path.join(repo, `dist/folkbranch-${target}.tar.xz`)
const dir = path.join(work, 'folkbranch'), PORT = 3517, B = `http://localhost:${PORT}`
const withSum = (f, sub) => { fs.mkdirSync(path.join(work, sub)); const c = path.join(work, sub, path.basename(f)); fs.copyFileSync(f, c); fs.writeFileSync(c + '.sha256', `${createHash('sha256').update(fs.readFileSync(c)).digest('hex')}  ${path.basename(c)}\n`); return c }
const env = { HOME: work, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, TMPDIR: work }
const run = (script, bundle) => spawnSync('sh', [script, '--local', '--dir', dir, '--port', String(PORT)], { cwd: work, env: { ...env, FOLKBRANCH_BUNDLE: pathToFileURL(bundle).href }, encoding: 'utf8', timeout: 300000 })
try {
  const a = run(oldInstaller, withSum(oldBundle, 'old'))
  ok('1.5.1 installs with its own installer', a.status === 0, (a.stdout + a.stderr).slice(-300))
  await waitUp(B, 90000)
  const code = fs.readFileSync(path.join(dir, '.env'), 'utf8').match(/^SETUP_TOKEN=(.*)$/m)[1]
  const setup = await fetch(B + '/api/auth/family/setup', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ name: 'Анна', familyName: 'Проверка', language: 'ru', demo: true, code }) })
  const cookie = setup.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  const api = async (m, p, body) => (await fetch(`${B}/api/v1/${p}`, { method: m, headers: { cookie, origin: B, 'content-type': 'application/json' }, body: body && JSON.stringify(body) })).json()
  const g0 = await api('GET', 'graph')
  await api('PATCH', `persons/${g0.persons[0].id}`, { birthPlace: 'Тверь' })
  await api('POST', 'persons', { person: { givenName: 'Ёжик', surname: 'Проверочный', sex: 'M', birthDate: '1900' } })
  const before = await api('GET', 'graph')
  const env0 = fs.readFileSync(path.join(dir, '.env'), 'utf8')
  // A page stays open while the update runs, as it would for a person.
  const live = new AbortController()
  fetch(`${B}/api/events`, { headers: { cookie }, signal: live.signal }).then(async (r) => { for await (const _ of r.body) {} }).catch(() => {})
  const t = Date.now()
  const b = run(path.join(repo, 'install.sh'), withSum(newBundle, 'new'))
  live.abort()
  ok('the same install command updates it', b.status === 0, (b.stdout + b.stderr).slice(-400))
  ok(`and does not hang on the open page (${Math.round((Date.now() - t) / 1000)} s)`, Date.now() - t < 120000)
  await waitUp(B, 90000)
  const v = await api('GET', 'update')
  ok('the new version answers', v.current === JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version, JSON.stringify(v))
  const after = await api('GET', 'graph')
  // Every field the old version had must be the same. A later version may add fields (a link to a place record): those are
  // left out of this comparison and checked on their own below, since an old archive can hold nothing in them.
  const strip = ({ updatedAt, ...p }) => p
  const byId = (g, like) => JSON.stringify([...g.persons].sort((x, y) => x.id.localeCompare(y.id)).map((p) => {
    const q = strip(p), base = like?.persons.find((x) => x.id === p.id)
    return base ? Object.fromEntries(Object.keys(strip(base)).map((k) => [k, q[k]])) : q
  }))
  ok('still signed in, everyone and every field the same', after.persons?.length === before.persons.length && byId(after, before) === byId(before))
  const added = after.persons.flatMap((p) => { const base = before.persons.find((x) => x.id === p.id) ?? {}; return Object.keys(p).filter((k) => !(k in base)).map((k) => [k, p[k]]) })
  ok('a field this version added is empty for what the old version wrote', added.every(([, v]) => v == null || v === '' || (Array.isArray(v) && !v.length)), JSON.stringify(added.filter(([, v]) => !(v == null || v === '')).slice(0, 3)))
  ok('every link the same', after.parentChild.length === before.parentChild.length && after.unions.length === before.unions.length)
  const env1 = fs.readFileSync(path.join(dir, '.env'), 'utf8')
  ok('settings in .env are kept', env0.split('\n').filter(Boolean).every((l) => env1.includes(l)))
  spawnSync('sh', ['-c', './folkbranch restart'], { cwd: dir, env, encoding: 'utf8' })
  await waitUp(B, 90000)
  ok('and after a restart', byId(await api('GET', 'graph'), before) === byId(before))
} catch (e) {
  console.log('ERROR', e.message)
  for (const f of fs.existsSync(path.join(dir, 'logs')) ? fs.readdirSync(path.join(dir, 'logs')) : []) console.log(`--- ${f}\n` + fs.readFileSync(path.join(dir, 'logs', f), 'utf8').slice(-2500))
  console.log(spawnSync('sh', ['-c', `ps -axo pid,etime,command | grep -i '${work}' | grep -v grep; lsof -iTCP:${PORT} -sTCP:LISTEN -P`], { encoding: 'utf8' }).stdout)
  console.log(spawnSync('sh', ['-c', './folkbranch status'], { cwd: dir, env, encoding: 'utf8' }).stdout)
  process.exitCode = 1
} finally {
  spawnSync('sh', ['-c', './folkbranch stop'], { cwd: dir, env, encoding: 'utf8' })
  fs.rmSync(work, { recursive: true, force: true })
}
