// Throwaway containers with an invented family, shared by the browser and stability scenarios.
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
export const sh = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
/** The image under test: `docker build -t folkbranch:check .` */
export const IMAGE = process.env.FG_IMAGE ?? 'folkbranch:check'
export const cookiesOf = (cookie) => cookie.split('; ').map((c) => ({ name: c.split('=')[0], value: c.slice(c.indexOf('=') + 1), domain: 'localhost', path: '/', httpOnly: true }))
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** A throwaway container with the fictional family. Returns its address and a signed-in owner's cookie. */
export async function boot(name, port, img, { args = '', people = 1000, volume = true, pub } = {}) {
  try { sh(`docker rm -fv ${name}`) } catch {}
  try { sh(`docker volume rm ${name}-data`) } catch {}
  const B = pub ?? `http://localhost:${port}`
  sh(`docker run -d --name ${name} -p 127.0.0.1:${port}:3000 ${volume ? `-v ${name}-data:/data` : ''} -e BETTER_AUTH_URL=${B} -e SETUP_TOKEN=audit ${args} ${img}`)
  await waitUp(B)
  const r = await fetch(B + '/api/auth/family/setup', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ name: 'Анна', familyName: 'Аудит', language: 'ru', demo: false, code: 'audit' }) })
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  if (people) {
    const ged = sh(`python3 "${fileURLToPath(new URL('gen-family.py', import.meta.url))}" ${people}`)
    const i = await fetch(B + '/api/v1/gedcom/import', { method: 'POST', headers: { cookie, origin: B, 'content-type': 'text/plain' }, body: ged })
    if (!i.ok) throw new Error('import ' + i.status)
  }
  return { B, cookie, name }
}
export async function waitUp(B, ms = 60000) {
  const end = Date.now() + ms
  while (Date.now() < end) { if (await fetch(B + '/api/health').then((r) => r.ok).catch(() => false)) return; await sleep(100) }
  throw new Error('server did not come up')
}
export const stats = (name) => {
  const s = sh(`docker exec ${name} sh -c 'echo $(cat /sys/fs/cgroup/memory.current) $(grep -E "^anon " /sys/fs/cgroup/memory.stat | cut -d" " -f2) $(ls /proc/1/fd | wc -l) $(grep usage_usec /sys/fs/cgroup/cpu.stat | cut -d" " -f2)'`).split(' ').map(Number)
  return { memMB: Math.round(s[0] / 1048576), anonMB: Math.round(s[1] / 1048576), fds: s[2], cpuS: Math.round(s[3] / 1e6) }
}
/** Opens the live line and reads until stopped. */
export function listen(B, cookie, ms) {
  const ac = new AbortController()
  const done = (async () => {
    try {
      const r = await fetch(B + '/api/events', { headers: { cookie }, signal: ac.signal })
      if (!r.ok) return { status: r.status, bytes: 0 }
      let bytes = 0; for await (const c of r.body) bytes += c.length
      return { status: 200, bytes }
    } catch { return { status: 0 } }
  })()
  if (ms) setTimeout(() => ac.abort(), ms)
  return { stop: () => ac.abort(), done }
}
