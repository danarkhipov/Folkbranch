// Installing on a server, on the Linux people rent: a clean system with systemd, in a throwaway container with its own
// init, so that a restart of the container is a real reboot. HTTPS uses Caddy's own certificates, since nothing here is on
// the internet. Needs Docker and a Linux archive: FG_BUNDLE, or dist/folkbranch-linux-*.tar.xz. FG_DISTROS narrows the list.
import { execFile, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const repo = fileURLToPath(new URL('../..', import.meta.url))
const arch = process.env.FG_ARCH ?? (spawnSync('docker', ['info', '--format', '{{.Architecture}}'], { encoding: 'utf8' }).stdout.trim() === 'aarch64' ? 'arm64' : 'x64')
const distFile = path.join(repo, `dist/folkbranch-linux-${arch}.tar.xz`)
const bundleFile = path.resolve(process.env.FG_BUNDLE ?? distFile)
if (!fs.existsSync(bundleFile)) { console.error(`No Linux archive at ${bundleFile}. Build one on Linux: pnpm build && node scripts/make-bundle.mjs`); process.exit(1) }

const APT = 'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends systemd systemd-sysv dbus curl ca-certificates xz-utils procps sudo'
const DNF = 'dnf install -y -q --allowerasing systemd curl tar xz procps-ng util-linux shadow-utils sudo findutils'
const DISTROS = {
  'ubuntu:22.04': APT, 'ubuntu:24.04': APT,
  'debian:12': APT, 'debian:13': APT,
  'almalinux:8': DNF, 'almalinux:9': DNF, 'rockylinux:9': DNF, 'fedora:43': DNF, 'amazonlinux:2023': DNF,
}
const TOO_OLD = new Set(['almalinux:8'])
const wanted = process.env.FG_DISTROS?.split(',') ?? Object.keys(DISTROS)
const NODE_VERSION = fs.readFileSync(path.join(repo, 'install.sh'), 'utf8').match(/^NODE_VERSION=(.*)$/m)[1]
const CADDY_VERSION = fs.readFileSync(path.join(repo, 'install.sh'), 'utf8').match(/^CADDY_VERSION=(.*)$/m)[1]

// Node and Caddy are downloaded once, for real, checksums included; the systems then take them from a folder.
const work = fs.realpathSync(fs.mkdtempSync(path.join(process.env.FG_WORK ?? os.tmpdir(), 'folkbranch-server-')))
const dist = path.join(work, 'dist')
const get = (url, file) => { fs.mkdirSync(path.dirname(file), { recursive: true }); const r = spawnSync('curl', ['-fsSL', url, '-o', file]); if (r.status) throw new Error(`could not download ${url}`) }
const nodeBase = `https://nodejs.org/dist/v${NODE_VERSION}`
const caddyBase = `https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}`
const caddyArch = arch === 'x64' ? 'amd64' : arch
for (const f of ['SHASUMS256.txt', `node-v${NODE_VERSION}-linux-${arch}.tar.xz`, `node-v${NODE_VERSION}-linux-${arch}.tar.gz`]) get(`${nodeBase}/${f}`, path.join(dist, 'node', `v${NODE_VERSION}`, f))
for (const f of [`caddy_${CADDY_VERSION}_checksums.txt`, `caddy_${CADDY_VERSION}_linux_${caddyArch}.tar.gz`]) get(`${caddyBase}/${f}`, path.join(dist, 'caddy', `v${CADDY_VERSION}`, f))
fs.copyFileSync(bundleFile, path.join(dist, 'bundle.tar.xz'))
fs.copyFileSync(`${bundleFile}.sha256`, path.join(dist, 'bundle.tar.xz.sha256'))
fs.copyFileSync(path.join(repo, 'install.sh'), path.join(dist, 'install.sh'))

const results = []
// Not with spawnSync: that would hold up every other system while this one builds.
const buildImage = (tag, distro) => new Promise((resolve, reject) => {
  const child = spawn('docker', ['build', '-q', '-t', tag, '-'], { stdio: ['pipe', 'ignore', 'pipe'], timeout: 1500000 })
  let err = ''
  child.stderr.on('data', (d) => { err += d })
  child.on('close', (code) => (code ? reject(new Error(`image: ${err.slice(-400)}`)) : resolve()))
  child.stdin.end(`FROM ${distro}\nRUN ${DISTROS[distro]}\nSTOPSIGNAL SIGRTMIN+3\nCMD ["/sbin/init"]\n`)
})
async function check(distro) {
  const slug = distro.replace(/[^a-z0-9]+/g, '-')
  const box = `fb-server-${slug}`
  const log = []
  const ok = (name, pass, detail = '') => log.push({ name, pass: !!pass, detail: pass ? '' : String(detail).slice(-900) })
  const inBox = async (cmd, { allow = false, timeout = 240000 } = {}) => {
    try { const { stdout, stderr } = await run('docker', ['exec', box, 'sh', '-c', cmd], { timeout, maxBuffer: 1 << 24 }); return { code: 0, out: stdout + stderr } }
    catch (e) { if (allow) return { code: e.code ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }; throw new Error(`${cmd.slice(0, 80)}: ${`${e.stdout ?? ''}${e.stderr ?? ''}`.slice(-600)}`) }
  }
  const waitBoot = async () => { for (let i = 0; i < 60; i++) { const r = await inBox('systemctl is-system-running', { allow: true }); if (/running|degraded/.test(r.out)) return; await new Promise((s) => setTimeout(s, 1000)) } }
  // As a first-boot script runs it: no HOME and almost no environment.
  const env = `env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin FOLKBRANCH_BUNDLE=file:///m/bundle.tar.xz FOLKBRANCH_NODE_DIST=file:///m/node FOLKBRANCH_CADDY_DIST=file:///m/caddy FOLKBRANCH_TLS=internal`
  const https = (host, p) => `curl -sk -m 10 --resolve ${host}:443:127.0.0.1 https://${host}${p}`
  const healthy = async (host) => { for (let i = 0; i < 45; i++) { if (/"?ok"?|status/.test((await inBox(`${https(host, '/api/health')}`, { allow: true })).out)) return true; await new Promise((s) => setTimeout(s, 1000)) } return false }
  try {
    const tag = `folkbranch-server-test:${slug}`
    await buildImage(tag, distro)
    spawnSync('docker', ['rm', '-fv', box], { encoding: 'utf8' })
    await run('docker', ['run', '-d', '--name', box, '--memory', '512m', '--privileged', '--cgroupns=host', '--tmpfs', '/run', '--tmpfs', '/run/lock', '-v', '/sys/fs/cgroup:/sys/fs/cgroup:rw', '-v', `${dist}:/m:ro`, tag])
    await waitBoot()

    const first = await inBox(`cat /m/install.sh | ${env} sh -s -- --server --domain family.test 2>&1`, { allow: true })
    if (TOO_OLD.has(distro)) {
      const left = (await inBox('ls /etc/systemd/system/folkbranch* /opt/folkbranch 2>&1', { allow: true })).code
      ok('too old a system is told so, and nothing is set up', first.code !== 0 && first.out.includes('glibc') && first.out.includes('--docker') && left !== 0, first.out)
      return log
    }
    const code = first.out.match(/https:\/\/family\.test\/setup\?code=(\S+)/)?.[1]
    ok('installs on a clean system, with no HOME', first.code === 0 && code, first.out)
    if (first.code || !code) return log
    ok('answers over HTTPS', await healthy('family.test'), first.out)
    const plain = (await inBox('curl -s -m 5 -o /dev/null -w "%{http_code}" -H "Host: family.test" http://127.0.0.1/', { allow: true })).out
    ok('sends plain HTTP on to HTTPS', /^30[178]$/.test(plain.trim()), plain)
    const ip = (await inBox('hostname -I | cut -d" " -f1')).out.trim()
    ok('the app itself is closed from outside', (await inBox(`curl -s -m 3 -o /dev/null http://${ip}:3000/`, { allow: true })).code !== 0)
    const who = (await inBox(`ps -eo user:20,args | grep -E 'next-server|caddy run' | grep -v grep`, { allow: true })).out
    ok('nothing from the internet runs as root', who.includes('next-server') && who.includes('caddy run') && !/^root/m.test(who), who)
    const setup = await inBox(`${https('family.test', '/api/auth/family/setup')} -X POST -c /root/c -H 'content-type: application/json' -H 'origin: https://family.test' -d '{"name":"Анна","familyName":"Проба","language":"ru","demo":false,"code":"${code}"}' -o /dev/null -w '%{http_code}'`, { allow: true })
    ok('the printed link creates the family', setup.out.trim() === '200', setup.out)
    const add = await inBox(`${https('family.test', '/api/v1/persons')} -b /root/c -H 'origin: https://family.test' -H 'content-type: application/json' -d '{"person":{"givenName":"Зоя","surname":"Проба","living":false}}' -o /dev/null -w '%{http_code}'`, { allow: true })
    ok('the family takes a person', /^20/.test(add.out.trim()), add.out)

    const asRoot = await inBox('cd /opt/folkbranch && ./folkbranch status && ./folkbranch doctor && ./folkbranch login-link', { allow: true })
    ok('commands work from root', asRoot.code === 0 && /family\.test/.test(asRoot.out), asRoot.out)
    const strays = (await inBox(`find /opt/folkbranch/data /opt/folkbranch/logs -user root | head -5`, { allow: true })).out.trim()
    ok('and leave no root files in the data', !strays, strays)

    await run('docker', ['restart', box], { timeout: 120000 })
    await waitBoot()
    ok('comes back after a reboot', await healthy('family.test'))
    const people = (await inBox(`${https('family.test', '/api/v1/graph')} -b /root/c`, { allow: true })).out
    ok('with the family in place', people.includes('Зоя'), people.slice(0, 200))

    const again = await inBox(`cat /m/install.sh | ${env} sh -s -- 2>&1`, { allow: true })
    ok('running the command again finds the install and keeps it', again.code === 0 && /Running at https:\/\/family\.test/.test(again.out) && !again.out.includes('setup?code'), again.out)
    ok('and the family is still there', (await inBox(`${https('family.test', '/api/v1/graph')} -b /root/c`, { allow: true })).out.includes('Зоя'))

    const stop = await inBox('cd /opt/folkbranch && ./folkbranch stop && ./folkbranch status; ./folkbranch start', { allow: true })
    ok('stops and starts', /Stopped/.test(stop.out) && (await healthy('family.test')), stop.out)
    return log
  } catch (e) {
    ok('did not finish', false, e.message)
    return log
  } finally {
    if (process.env.FG_KEEP) console.log(`kept ${box}`)
    else spawnSync('docker', ['rm', '-fv', box], { encoding: 'utf8' })
  }
}

/** What only one system needs to show. */
async function extras(distro) {
  const slug = distro.replace(/[^a-z0-9]+/g, '-')
  const box = `fb-server-extra-${slug}`
  const log = []
  const ok = (name, pass, detail = '') => log.push({ name, pass: !!pass, detail: pass ? '' : String(detail).slice(-600) })
  const sh = (cmd) => { const r = spawnSync('docker', ['exec', box, 'sh', '-c', cmd], { encoding: 'utf8', timeout: 240000 }); return { code: r.status, out: `${r.stdout}${r.stderr}` } }
  const env = 'FOLKBRANCH_BUNDLE=file:///m/bundle.tar.xz FOLKBRANCH_NODE_DIST=file:///m/node FOLKBRANCH_CADDY_DIST=file:///m/caddy FOLKBRANCH_TLS=internal'
  try {
    spawnSync('docker', ['rm', '-fv', box])
    const r = spawnSync('docker', ['run', '-d', '--name', box, '--privileged', '--cgroupns=host', '--tmpfs', '/run', '--tmpfs', '/run/lock', '-v', '/sys/fs/cgroup:/sys/fs/cgroup:rw', '-v', `${dist}:/m:ro`, `folkbranch-server-test:${slug}`], { encoding: 'utf8' })
    if (r.status) throw new Error(r.stderr)
    for (let i = 0; i < 60 && !/running|degraded/.test(sh('systemctl is-system-running').out); i++) await new Promise((s) => setTimeout(s, 1000))

    // No domain: the name comes from the public address. A private one is refused rather than promised.
    const refused = sh(`cat /m/install.sh | ${env} FOLKBRANCH_PUBLIC_IP=192.168.1.5 sh -s -- --server --dir /tmp/refused 2>&1`)
    ok('a private address is refused with what to do', refused.code !== 0 && refused.out.includes('--domain'), refused.out)
    const named = sh(`cat /m/install.sh | ${env} FOLKBRANCH_PUBLIC_IP=203.0.113.5 sh -s -- --server 2>&1`)
    ok('with no domain, it uses the address, with HTTPS', named.code === 0 && named.out.includes('https://203.0.113.5/setup?code=') && /ok|status/.test(sh('curl -sk -m 10 --connect-to ::127.0.0.1:443 https://203.0.113.5/api/health').out), named.out)
    const moved = sh(`cat /m/install.sh | ${env} sh -s -- --server --domain family.test 2>&1; curl -sk -m 10 --resolve family.test:443:127.0.0.1 https://family.test/api/health; grep -c family.test /opt/folkbranch/Caddyfile; grep BETTER_AUTH_URL /opt/folkbranch/.env`)
    ok('a domain given later takes over', moved.code === 0 && moved.out.includes('BETTER_AUTH_URL=https://family.test') && !moved.out.includes('BETTER_AUTH_URL=https://203'), moved.out)

    // Another web server keeps its ports, and nothing is taken from it.
    sh('cp /opt/folkbranch/runtime/node /root/node; cd /opt/folkbranch && ./folkbranch stop; systemctl disable --now folkbranch-caddy folkbranch; rm -rf /opt/folkbranch /etc/systemd/system/folkbranch*; systemctl daemon-reload')
    const busy = spawnSync('docker', ['exec', '-d', box, '/root/node', '-e', "require('http').createServer((q,s)=>s.end('x')).listen(80)"])
    if (busy.status === 0 && sh('sleep 1; curl -s -m 2 -o /dev/null http://127.0.0.1:80/').code === 0) {
      const taken = sh(`cat /m/install.sh | ${env} sh -s -- --server --domain family.test 2>&1`)
      ok('a port another server holds is left alone', taken.code !== 0 && taken.out.includes('--no-caddy'), taken.out)
      const proxied = sh(`cat /m/install.sh | ${env} sh -s -- --server --domain family.test --no-caddy 2>&1; curl -s -m 5 http://127.0.0.1:3000/api/health; systemctl is-enabled folkbranch-caddy`)
      ok('--no-caddy runs behind that server', proxied.out.includes('https://family.test/setup?code=') && /ok|status/.test(proxied.out) && !/^enabled$/m.test(proxied.out), proxied.out)
      sh('cd /opt/folkbranch && ./folkbranch stop; systemctl disable --now folkbranch; rm -rf /opt/folkbranch /etc/systemd/system/folkbranch*; systemctl daemon-reload; pkill -f createServer')
    }

    // The one thing the checks above stand in for: asking for a real certificate for an address. A made-up address gets
    // refused, and the installer still finishes and says what to look at. Takes a minute.
    const real = sh(`cat /m/install.sh | FOLKBRANCH_BUNDLE=file:///m/bundle.tar.xz FOLKBRANCH_NODE_DIST=file:///m/node FOLKBRANCH_CADDY_DIST=file:///m/caddy FOLKBRANCH_PUBLIC_IP=203.0.113.5 sh -s -- --server 2>&1; cd /opt/folkbranch; runtime/caddy validate --config Caddyfile --adapter caddyfile 2>&1 | tail -1; grep -c shortlived Caddyfile`)
    ok('a real certificate for an address is asked for correctly', /Valid configuration/.test(real.out) && /^1$/m.test(real.out) && real.out.includes('HTTPS is not ready') && real.out.includes('/setup?code='), real.out)
    sh('cd /opt/folkbranch && ./folkbranch stop; systemctl disable --now folkbranch-caddy folkbranch; rm -rf /opt/folkbranch /etc/systemd/system/folkbranch*; systemctl daemon-reload')

    // A person with sudo, not root: the folder is theirs, and so is the app.
    sh('useradd -m ann && echo "ann ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/ann')
    const ann = sh(`su ann -c 'cat /m/install.sh | ${env} sh -s -- --server --domain family.test 2>&1'`)
    ok('a user with sudo gets it in their own folder', ann.code === 0 && ann.out.includes('/home/ann/folkbranch') && ann.out.includes('https://family.test/setup?code='), ann.out)
    const owner = sh(`ps -eo user:20,args | grep next-server | grep -v grep; cd /home/ann/folkbranch && su ann -c './folkbranch status'; ./folkbranch doctor | head -2; find /home/ann/folkbranch/data -user root | wc -l`)
    ok('and it runs as them', /^ann\s/m.test(owner.out) && /Running at/.test(owner.out) && /^0$/m.test(owner.out), owner.out)
    return log
  } catch (e) {
    ok('did not finish', false, e.message)
    return log
  } finally {
    spawnSync('docker', ['rm', '-fv', box])
  }
}

const parallel = Number(process.env.FG_PARALLEL ?? 3)
const queue = [...wanted]
await Promise.all(Array.from({ length: parallel }, async () => {
  while (queue.length) {
    const distro = queue.shift()
    const started = Date.now()
    const log = await check(distro)
    results.push({ distro, log, seconds: Math.round((Date.now() - started) / 1000) })
    const failed = log.filter((l) => !l.pass)
    console.log(`${failed.length ? 'FAIL' : 'PASS'} ${distro}: ${log.length - failed.length}/${log.length} in ${results.at(-1).seconds}s`)
    for (const f of failed) console.log(`     ✗ ${f.name}\n       ${f.detail.replace(/\n/g, '\n       ')}`)
    if (failed.length) process.exitCode = 1
  }
}))

const extra = process.env.FG_EXTRA ?? (wanted.includes('ubuntu:24.04') ? 'ubuntu:24.04' : wanted[0])
const more = await extras(extra)
for (const l of more) {
  console.log(`${l.pass ? 'PASS' : 'FAIL'} ${extra}: ${l.name}${l.pass ? '' : `\n       ${l.detail.replace(/\n/g, '\n       ')}`}`)
  if (!l.pass) process.exitCode = 1
}
fs.rmSync(work, { recursive: true, force: true })
process.exit(process.exitCode ?? 0)
