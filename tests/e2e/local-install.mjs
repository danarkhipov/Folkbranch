// Installing without Docker on a clean folder: with Node, without it, again, after an update, and moving a copy between kinds of install.
// Needs an archive: pnpm build && node scripts/make-bundle.mjs. Downloads the real Node twice, about 25 MB each.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { IMAGE, sh, sleep, waitUp } from './lib.mjs'

const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x && !c ? ' · ' + x : ''}`); if (!c) process.exitCode = 1 }
// A restart leaves an idle connection the old server has closed: not a failure of the app, so try once more.
const plainFetch = globalThis.fetch
globalThis.fetch = (url, init) => plainFetch(url, init).catch((e) => { if (['UND_ERR_SOCKET', 'ECONNRESET'].includes(e.cause?.code) && !init?.body) return plainFetch(url, init); throw e })
const repo = fileURLToPath(new URL('../..', import.meta.url))
const bundleFile = process.env.FG_BUNDLE ?? path.join(repo, `dist/folkbranch-${process.platform}-${process.arch}.tar.xz`)
if (!fs.existsSync(bundleFile)) { console.error(`No archive at ${bundleFile}. Run: pnpm build && node scripts/make-bundle.mjs`); process.exit(1) }
const bundle = pathToFileURL(bundleFile).href
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'folkbranch-local-')))
const SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'

// Stand-ins, so the real agent programs' settings stay untouched and any use of Docker shows up.
const bin = path.join(work, 'bin')
fs.mkdirSync(bin)
const seen = path.join(work, 'called.log')
for (const a of ['claude', 'codex', 'docker', 'open', 'xdg-open']) fs.writeFileSync(path.join(bin, a), `#!/bin/sh\necho "${a} $*" >> "${seen}"\n`, { mode: 0o755 })
const called = () => (fs.existsSync(seen) ? fs.readFileSync(seen, 'utf8') : '')

const nodeDir = path.dirname(process.execPath)
const env = (extra = {}, withNode = true) => ({ HOME: work, TMPDIR: work, DISPLAY: ':0', PATH: `${bin}:${withNode ? `${nodeDir}:` : ''}${SYSTEM_PATH}`, FOLKBRANCH_BUNDLE: bundle, ...extra })
const run = (cmd, cwd, e = env()) => spawnSync('sh', ['-c', cmd], { cwd, env: e, encoding: 'utf8', timeout: 240000 })
/** As in the README: the script arrives on stdin, so anything that reads stdin would swallow the rest of it. */
const install = (dir, args = '', e) => run(`cat "${repo}install.sh" | sh -s -- --dir "${dir}" ${args}`, work, e)
const cli = (dir, args, e) => run(`./folkbranch ${args}`, dir, e)
const envOf = (dir) => fs.readFileSync(path.join(dir, '.env'), 'utf8')
const valueOf = (dir, k) => envOf(dir).match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]
const linkOf = (out, port) => out.match(new RegExp(`http://localhost:${port}/setup\\?code=\\S+`))?.[0]
const free = (port) => new Promise((resolve) => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); resolve(false) }); s.on('error', () => resolve(true)) })
const sum = (b) => createHash('sha256').update(Buffer.from(b)).digest('hex')
const jpg = fs.readFileSync(new URL('../fixtures/photo.jpg', import.meta.url))

async function claim(B, code) {
  const r = await fetch(B + '/api/auth/family/setup', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ name: 'Анна', familyName: 'Лесные', language: 'ru', demo: false, code }) })
  if (!r.ok) throw new Error(`setup ${r.status}`)
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
}
const graph = async (B, cookie) => (await fetch(B + '/api/v1/graph', { headers: { cookie } })).json()
const download = async (B, cookie) => Buffer.from(await (await fetch(B + '/api/archive', { headers: { cookie } })).arrayBuffer())
async function restore(B, zip, code) {
  const r = await fetch(B + '/api/archive', { method: 'POST', headers: { origin: B, 'content-type': 'application/zip', 'x-setup-code': code }, body: zip, duplex: 'half' })
  const rep = await r.json()
  await sleep(1500); await waitUp(B)
  const ac = await fetch(B + '/api/auth/family/accept', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ token: rep.login?.split('/invite/')[1] }) })
  return { status: r.status, rep, cookie: ac.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') }
}
const dirs = []
const place = (name) => { const d = path.join(work, name); dirs.push(d); return d }

try {
  // The first install, with a space in the path, where a careless script breaks.
  const A = place('my archive'), AP = 3461, AB = `http://localhost:${AP}`
  const first = install(A, `--port ${AP}`)
  ok('one command starts it and prints the link', !!linkOf(first.stdout, AP), first.stdout.slice(-300) + first.stderr.slice(-300))
  ok('it chose the install without Docker', fs.existsSync(path.join(A, '.local')) && !called().includes('docker'), called())
  ok('it used the Node already here', !fs.existsSync(path.join(A, 'runtime')))
  ok('settings are generated and private', /BETTER_AUTH_SECRET=\S{40}/.test(envOf(A)) && (fs.statSync(path.join(A, '.env')).mode & 0o077) === 0)
  ok('the data is private too', (fs.statSync(path.join(A, 'data')).mode & 0o077) === 0)
  ok('it listens only on this computer', /127\.0\.0\.1:3461/.test(sh(`lsof -nP -iTCP:${AP} -sTCP:LISTEN`)))
  ok('the setup page opens', (await fetch(linkOf(first.stdout, AP))).status === 200)
  ok('the first install opens the browser on that page', called().includes(`open ${linkOf(first.stdout, AP)}`) || called().includes(`xdg-open ${linkOf(first.stdout, AP)}`), called())

  const cookie = await claim(AB, valueOf(A, 'SETUP_TOKEN'))
  const ged = sh(`python3 "${fileURLToPath(new URL('gen-family.py', import.meta.url))}" 40`)
  ok('a family goes in', (await fetch(AB + '/api/v1/gedcom/import', { method: 'POST', headers: { cookie, origin: AB, 'content-type': 'text/plain' }, body: ged })).ok)
  const people = (await graph(AB, cookie)).persons
  const form = new FormData(); form.set('file', new Blob([jpg]), 'p.jpg'); form.set('personId', people[0].id)
  const photo = await (await fetch(AB + '/api/v1/media', { method: 'POST', headers: { cookie, origin: AB }, body: form })).json()
  const photoSum = async (B, c) => sum(await (await fetch(`${B}/api/v1/media/${photo.id}/file?size=orig`, { headers: { cookie: c } })).arrayBuffer())
  const photoBefore = await photoSum(AB, cookie)

  ok('status says it runs', cli(A, 'status').stdout.includes(`Running at ${AB}`))
  ok('doctor reads the data', cli(A, 'doctor').stdout.includes('Users:   1'))
  ok('help names the local commands', cli(A, 'help').stdout.includes('start, stop, restart, status, logs'))
  ok('logs are there', cli(A, 'logs').status === 0)

  // Opening it later, signed in, with nothing to type.
  const opens = () => called().split('\n').filter((l) => /^(xdg-)?open /.test(l)).length
  const openedBefore = opens()
  const opened = cli(A, 'open')
  const signIn = called().split('\n').filter((l) => /^(xdg-)?open /.test(l)).pop()?.split(' ')[1]
  ok('open sends the browser to a sign-in link', opened.status === 0 && opened.stdout.includes('Opened') && !!signIn?.includes('/invite/') && signIn.includes('go=1'), opened.stdout)
  ok('and does not print the link when a browser took it', !opened.stdout.includes('/invite/'))
  ok('that link opens', (await fetch(signIn)).status === 200)
  const printed = cli(A, 'open', env({ FOLKBRANCH_NO_OPEN: '1' }))
  ok('with no browser it prints the link instead', printed.stdout.includes('/invite/') && opens() === openedBefore + 1, printed.stdout)

  // Agents.
  const conn = cli(A, 'connect')
  const token = called().match(/Bearer (fb_\S+)/)?.[1]
  ok('connect finds Claude Code and Codex', conn.status === 0 && conn.stdout.includes('Claude Code Codex') && !!token, conn.stdout.slice(-120))
  const mcp = await fetch(`${AB}/api/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })
  ok('and that key really opens MCP', mcp.ok && (await mcp.text()).includes('get_overview'))

  // Again: nothing to fetch into place, nothing restarted.
  const settings = envOf(A), pid = fs.readFileSync(path.join(A, 'folkbranch.pid'), 'utf8')
  const again = install(A, `--port ${AP}`)
  ok('running it again keeps the settings', again.status === 0 && envOf(A) === settings, again.stderr.slice(-200))
  ok('and does not restart the app', fs.readFileSync(path.join(A, 'folkbranch.pid'), 'utf8') === pid)
  ok('and says it runs, with no setup link', again.stdout.includes(`Running at ${AB}`) && !linkOf(again.stdout, AP))
  ok('and does not open the browser again', opens() === openedBefore + 1)

  // An update.
  const next = path.join(work, 'next'), unpack = path.join(next, 'x')
  fs.mkdirSync(unpack, { recursive: true })
  sh(`tar -xf "${bundleFile}" -C "${unpack}"`)
  fs.writeFileSync(path.join(unpack, fs.readdirSync(unpack)[0], 'next-version'), 'yes')
  const nextFile = path.join(next, 'next.tar.gz')
  sh(`COPYFILE_DISABLE=1 tar -czf "${nextFile}" -C "${unpack}" ${fs.readdirSync(unpack)[0]}`)
  fs.writeFileSync(`${nextFile}.sha256`, `${sum(fs.readFileSync(nextFile))}  next.tar.gz\n`)
  const updated = install(A, `--port ${AP}`, env({ FOLKBRANCH_BUNDLE: pathToFileURL(nextFile).href }))
  ok('an update replaces the app', updated.status === 0 && fs.existsSync(path.join(A, 'app/next-version')), updated.stdout.slice(-200))
  ok('and leaves nothing behind', !fs.existsSync(path.join(A, 'app.old')) && !fs.existsSync(path.join(A, 'app.new')))
  ok('the family and the sign-in survive it', (await graph(AB, cookie)).persons?.length === people.length && await photoSum(AB, cookie) === photoBefore)

  // A damaged download changes nothing.
  const bad = path.join(next, 'bad.tar.gz')
  fs.copyFileSync(nextFile, bad); fs.writeFileSync(`${bad}.sha256`, `${'0'.repeat(64)}  bad.tar.gz\n`)
  const damaged = install(A, `--port ${AP}`, env({ FOLKBRANCH_BUNDLE: pathToFileURL(bad).href }))
  ok('a damaged download is refused, and the app keeps running', damaged.status !== 0 && damaged.stdout.includes('damaged') && (await fetch(AB + '/api/health')).ok)

  // Stop and start.
  const quiet = place('no-browser')
  const silent = opens()
  ok('--no-open leaves the browser alone', install(quiet, '--no-open --port 3469').status === 0 && opens() === silent)
  cli(quiet, 'stop')
  ok('open starts it first if it was stopped', cli(quiet, 'open', env({ FOLKBRANCH_NO_OPEN: '1' })).stdout.includes('/setup?code=') && !(await free(3469)))
  cli(quiet, 'stop')
  ok('stop stops it', cli(A, 'stop').status === 0 && await free(AP) && cli(A, 'status').status !== 0)
  ok('start brings it back', cli(A, 'start').stdout.includes(`Running at ${AB}`))
  ok('with the family and the sign-in', (await graph(AB, cookie)).persons?.length === people.length)
  ok('starting twice is harmless', cli(A, 'start').status === 0)

  // A crash.
  const supervisor = fs.readFileSync(path.join(A, 'folkbranch.pid'), 'utf8').trim()
  sh(`pkill -KILL -P ${supervisor}`)
  await sleep(1500); await waitUp(AB)
  ok('after a crash it comes back by itself', fs.readFileSync(path.join(A, 'folkbranch.pid'), 'utf8').trim() === supervisor)

  // Kinds of install stay apart.
  const refused = install(A, '--docker')
  ok('a local install does not turn into Docker', refused.status !== 0 && refused.stdout.includes('other kind'), refused.stdout.slice(-200))
  ok('--domain does not either', install(A, '--domain family.example.org').status !== 0)
  const dockerDir = place('docker-install')
  fs.mkdirSync(dockerDir); fs.writeFileSync(path.join(dockerDir, 'docker-compose.yml'), 'services: {}\n')
  const refused2 = install(dockerDir, '--local')
  ok('a Docker install does not turn local', refused2.status !== 0 && refused2.stdout.includes('other kind') && !fs.existsSync(path.join(dockerDir, 'app')))
  ok('--domain and --local together are refused', run(`sh "${repo}install.sh" --local --domain x.example.org`, work).status !== 0)

  // Port taken: a plain sentence, then the way out.
  const B = place('second'), BP = 3462, BP2 = 3463
  const blocker = net.createServer().listen(BP, '127.0.0.1')
  await new Promise((r) => blocker.once('listening', r))
  const busy = install(B, `--port ${BP}`)
  ok('a taken port is said plainly', busy.status !== 0 && busy.stdout.includes(`Port ${BP} is in use`), busy.stdout.slice(-200))
  const moved = install(B, `--port ${BP2}`)
  await new Promise((r) => blocker.close(r))
  const BB = `http://localhost:${BP2}`
  ok('--port moves it, and the address with it', moved.status === 0 && !!linkOf(moved.stdout, BP2) && valueOf(B, 'BETTER_AUTH_URL') === BB, moved.stdout.slice(-200))

  // A copy moves to a clean local install, and the app restarts by itself to take it.
  const zip = await download(AB, cookie)
  const rest = await restore(BB, zip, valueOf(B, 'SETUP_TOKEN'))
  ok('a clean install takes the copy and comes back', rest.status === 200 && rest.rep.people === people.length, JSON.stringify({ people: rest.rep.people }))
  ok('everyone is the same', JSON.stringify(await graph(BB, rest.cookie)) === JSON.stringify(await graph(AB, cookie)))
  ok('the photo is identical', await photoSum(BB, rest.cookie) === photoBefore)
  ok('still under its own watch', cli(B, 'status').status === 0)

  // Between the kinds, if an image is here to try it with.
  const hasImage = (() => { try { sh(`docker image inspect ${IMAGE}`); return true } catch { return false } })()
  if (hasImage) {
    const DP = 3464, DB = `http://localhost:${DP}`
    try { sh('docker rm -fv fg-cross') } catch {}
    try { sh('docker volume rm fg-cross-data') } catch {}
    sh(`docker run -d --name fg-cross --restart=on-failure -p 127.0.0.1:${DP}:3000 -v fg-cross-data:/data -e BETTER_AUTH_URL=${DB} -e SETUP_TOKEN=cross ${IMAGE}`)
    await waitUp(DB)
    const toDocker = await restore(DB, zip, 'cross')
    ok('a copy from a local install restores in Docker', toDocker.status === 200 && JSON.stringify(await graph(DB, toDocker.cookie)) === JSON.stringify(await graph(AB, cookie)))
    const fromDocker = await download(DB, toDocker.cookie)
    const C = place('from-docker'), CP = 3465, CB = `http://localhost:${CP}`
    ok('a third install starts', install(C, `--port ${CP}`).status === 0)
    const toLocal = await restore(CB, fromDocker, valueOf(C, 'SETUP_TOKEN'))
    ok('a copy from Docker restores in a local install', toLocal.status === 200 && JSON.stringify(await graph(CB, toLocal.cookie)) === JSON.stringify(await graph(DB, toDocker.cookie)))
    ok('with the photo', await photoSum(CB, toLocal.cookie) === photoBefore)
    sh('docker rm -fv fg-cross'); sh('docker volume rm fg-cross-data')
  } else console.log(`SKIP between Docker and local: no image ${IMAGE}`)

  // No Node on the computer: the real download, checked against Node's own list.
  const noNode = env({}, false)
  ok('this check really has no Node', run('command -v node', work, noNode).status !== 0)
  const N = place('no-node'), NP = 3466, NB = `http://localhost:${NP}`
  const t0 = Date.now()
  const nn = install(N, `--port ${NP}`, noNode)
  ok('with no Node it brings its own', nn.status === 0 && fs.existsSync(path.join(N, 'runtime/node')) && !!linkOf(nn.stdout, NP), nn.stdout.slice(-300) + nn.stderr.slice(-300))
  const expected = fs.readFileSync(path.join(repo, 'install.sh'), 'utf8').match(/^NODE_VERSION=(.*)$/m)[1]
  ok('the pinned one', run('runtime/node -v', N, noNode).stdout.trim() === `v${expected}`)
  ok('nothing else of Node comes along', fs.readdirSync(path.join(N, 'runtime')).join() === 'node')
  console.log(`INFO no-Node install took ${Math.round((Date.now() - t0) / 1000)} s, disk ${sh(`du -sh "${N}" | cut -f1`)}, app alone ${sh(`du -sh "${path.join(N, 'app')}" | cut -f1`)}, Node ${sh(`du -sh "${path.join(N, 'runtime')}" | cut -f1`)}`)
  await claim(NB, valueOf(N, 'SETUP_TOKEN'))
  ok('and works', cli(N, 'doctor', noNode).stdout.includes('Users:   1'))
  ok('commands use that copy', cli(N, 'status', noNode).status === 0)
  const nnAgain = install(N, `--port ${NP}`, noNode)
  ok('again it keeps everything', nnAgain.status === 0 && nnAgain.stdout.includes(`Running at ${NB}`))
  cli(N, 'stop', noNode)

  // Node too old: the same.
  const oldBin = path.join(work, 'old-node')
  fs.mkdirSync(oldBin)
  fs.writeFileSync(path.join(oldBin, 'node'), '#!/bin/sh\necho v20.0.0\nexit 1\n', { mode: 0o755 })
  const O = place('old-node-install'), OP = 3467
  const old = install(O, `--port ${OP}`, env({ PATH: `${oldBin}:${bin}:${SYSTEM_PATH}` }))
  ok('a Node that cannot run it is passed over', old.status === 0 && fs.existsSync(path.join(O, 'runtime/node')), old.stdout.slice(-200))
  cli(O, 'stop', env({ PATH: `${oldBin}:${bin}:${SYSTEM_PATH}` }))

  // A damaged Node.
  const mirror = path.join(work, 'mirror', `v${expected}`)
  fs.mkdirSync(mirror, { recursive: true })
  const nodeName = `node-v${expected}-${process.platform}-${process.arch}.tar.xz`
  fs.writeFileSync(path.join(mirror, nodeName), 'not node')
  fs.writeFileSync(path.join(mirror, 'SHASUMS256.txt'), `${'0'.repeat(64)}  ${nodeName}\n`)
  const R = place('bad-node')
  const badNode = install(R, '--port 3468', env({ FOLKBRANCH_NODE_DIST: pathToFileURL(path.dirname(mirror)).href }, false))
  ok('a damaged Node is refused', badNode.status !== 0 && badNode.stdout.includes('damaged') && !fs.existsSync(path.join(R, 'runtime')))
} finally {
  for (const d of dirs) if (fs.existsSync(path.join(d, 'folkbranch.pid'))) spawnSync('./folkbranch', ['stop'], { cwd: d, env: { ...env(), PATH: `${bin}:${nodeDir}:${SYSTEM_PATH}` } })
  fs.rmSync(work, { recursive: true, force: true })
}
process.exit(process.exitCode ?? 0)
