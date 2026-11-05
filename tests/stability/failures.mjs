// stab.mjs <image>: failure scenarios, one container each. Prints PASS/FAIL per check.
import { fileURLToPath } from 'node:url'
import net from 'node:net'
import fs from 'node:fs'
import { boot, IMAGE, sh, sleep, stats, listen, waitUp } from '../e2e/lib.mjs'
const img = IMAGE
const ok = (name, good, note = '') => console.log(`${good ? 'PASS' : 'FAIL'} ${name}${note ? ' · ' + note : ''}`)
const P = 3422
const only = process.argv[3]
const scenario = async (name, fn) => { if (only && only !== name) return; console.log('--', name); try { await fn() } catch (e) { ok(name + ' ran to the end', false, e.message.slice(0, 200)) } }

await scenario('crash', async () => {
  const { B, cookie } = await boot('fg-stab', P, img, { people: 300 })
  const h = { cookie, origin: B, 'content-type': 'application/json' }
  const acked = []; let stop = false
  const ws = [0, 1, 2, 3].map(async (w) => { for (let i = 0; !stop; i++) { try { const r = await fetch(B + '/api/v1/persons', { method: 'POST', headers: h, body: JSON.stringify({ person: { givenName: `W${w}-${i}`, surname: 'Crash' } }) }); if (r.ok) acked.push((await r.json()).id) } catch { await sleep(30) } } })
  for (let round = 0; round < 3; round++) {
    await sleep(1500); sh('docker kill -s KILL fg-stab'); await sleep(200); const confirmed = acked.length; const t = Date.now(); sh('docker start fg-stab'); await waitUp(B)
    const g = await (await fetch(B + '/api/v1/graph', { headers: { cookie } })).json(); const have = new Set(g.persons.map((p) => p.id))
    ok(`kill -9 round ${round + 1}: every confirmed write survives`, acked.slice(0, confirmed).every((i) => have.has(i)), `confirmed ${confirmed}, back in ${Date.now() - t} ms`)
  }
  stop = true; await Promise.allSettled(ws)
  const integrity = sh(`docker exec fg-stab node -e "const D=require('better-sqlite3');const d=new D('/data/family.db',{readonly:true});console.log(d.pragma('integrity_check',{simple:true}),d.pragma('foreign_key_check').length)"`)
  ok('database intact after three crashes', integrity.startsWith('ok 0'), integrity)
  const t = Date.now(); sh('docker stop -t 20 fg-stab'); const took = Date.now() - t
  ok('stops promptly on a deploy signal', took < 5000, `${took} ms`)
  const code = sh(`docker inspect fg-stab -f '{{.State.ExitCode}}'`)
  sh('docker start fg-stab'); await waitUp(B)
  ok('clean exit code', code === '0' || code === '143', code)
})

await scenario('sse', async () => {
  const { B, cookie } = await boot('fg-stab', P, img, { people: 200 })
  const h = { cookie, origin: B, 'content-type': 'application/json' }
  // Pages that stopped reading: a raw socket that never drains.
  const before = stats('fg-stab')
  const url = new URL(B)
  const stalled = Array.from({ length: 50 }, () => { const s = net.connect(Number(url.port), url.hostname); s.write(`GET /api/events HTTP/1.1\r\nHost: localhost\r\nCookie: ${cookie}\r\nAccept: text/event-stream\r\n\r\n`); s.pause(); s.on('error', () => {}); return s })
  await sleep(1000)
  const g = await (await fetch(B + '/api/v1/graph', { headers: { cookie } })).json()
  const pad = 'x'.repeat(60)
  const t0 = Date.now(); let writes = 0
  while (Date.now() - t0 < 25000) { const r = await fetch(`${B}/api/v1/persons/${g.persons[writes % g.persons.length].id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ birthPlace: pad + writes }) }); if (r.ok) writes++; await sleep(40) }
  const during = stats('fg-stab')
  ok('stalled pages do not grow memory', during.anonMB - before.anonMB < 60, `${before.anonMB} → ${during.anonMB} MB after ${writes} writes`)
  const r = await fetch(B + '/api/health'); ok('healthy with stalled pages', r.ok)
  stalled.forEach((s) => s.destroy()); await sleep(1500)
  const after = stats('fg-stab')
  ok('sockets released when they vanish', after.fds <= before.fds + 5, `fds ${before.fds} → ${during.fds} → ${after.fds}`)

  // More pages than allowed.
  const many = Array.from({ length: 320 }, () => listen(B, cookie)); await sleep(3000)
  const health = await fetch(B + '/api/health').then((x) => x.ok)
  ok('server answers with 320 pages at once', health)
  const peak = stats('fg-stab')
  many.forEach((l) => l.stop()); const res = await Promise.all(many.map((l) => l.done))
  const refused = res.filter((x) => x.status === 503).length
  ok('pages over the limit get 503', refused === 20, `${refused} refused`)
  // A burst of all of them coming back at once.
  const t = Date.now(); const storm = Array.from({ length: 300 }, () => listen(B, cookie)); await sleep(1500)
  const w = Date.now(); const ping = await fetch(`${B}/api/v1/persons/${g.persons[0].id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ birthPlace: 'после бури' }) }); const lag = Date.now() - w
  ok('a write gets through right after 300 reconnects', ping.ok && lag < 1000, `${lag} ms, memory ${peak.anonMB} MB, cpu ${stats('fg-stab').cpuS - before.cpuS}s so far`)
  storm.forEach((l) => l.stop()); await Promise.all(storm.map((l) => l.done)); await sleep(8000)
  const idle = stats('fg-stab'); ok('all released after the storm', idle.fds <= before.fds + 5, `fds ${idle.fds}`)
})

await scenario('disk', async () => {
  const { B, cookie } = await boot('fg-stab', P, img, { people: 50, volume: false, args: '--tmpfs /data:size=12m,uid=1000,gid=1000 -e ALLOW_NO_VOLUME=1' })
  const h = { cookie, origin: B, 'content-type': 'application/json' }
  const jpg = fs.readFileSync(new URL('../fixtures/photo.jpg', import.meta.url))
  // Fill the disk.
  const seen = {}; let lastGood = null
  for (let i = 0; i < 200; i++) {
    const f = new FormData(); f.set('file', new Blob([jpg]), `${i}.jpg`)
    const r = await fetch(B + '/api/v1/media', { method: 'POST', headers: { cookie, origin: B }, body: f }).catch(() => null)
    seen[r?.status ?? 'net'] = (seen[r?.status ?? 'net'] ?? 0) + 1
    if (r?.ok) lastGood = (await r.json()).id
    else if (r && r.status >= 500 && seen[r.status] > 3) break
  }
  console.log('   uploads', JSON.stringify(seen), sh(`docker exec fg-stab df -m /data | tail -1`).replace(/\s+/g, ' '))
  let big = 0; const pad = 'я'.repeat(40000); const st = {}
  for (let i = 0; i < 400; i++) { const r = await fetch(B + '/api/v1/persons', { method: 'POST', headers: h, body: JSON.stringify({ person: { givenName: 'Диск', surname: 'Полон', notes: pad, birthPlace: pad.slice(0, 180) } }) }).catch(() => null); st[r?.status ?? 'net'] = (st[r?.status ?? 'net'] ?? 0) + 1; if (r?.status >= 500) { big++; if (big > 3) break } }
  console.log('   writes', JSON.stringify(st))
  ok('with a full disk the server stays up', (await fetch(B + '/api/health').catch(() => null))?.status !== undefined)
  const g = await fetch(B + '/api/v1/graph', { headers: { cookie } }); ok('reading still works with a full disk', g.ok, 'graph ' + g.status)
  const fail = await fetch(B + '/api/v1/persons', { method: 'POST', headers: h, body: JSON.stringify({ person: { givenName: 'Ещё', surname: 'Один' } }) })
  const body = await fail.text()
  ok('a failed write says so, without internals', fail.ok || (fail.status >= 400 && !/SQLITE|\/data|at .*\.js/.test(body)), `${fail.status} ${body.slice(0, 100)}`)
  // Free space: does it recover by itself?
  sh(`docker exec fg-stab sh -c 'rm -rf /data/media/* /data/uploads/* 2>/dev/null; true'`)
  await sleep(500)
  const again = await fetch(B + '/api/v1/persons', { method: 'POST', headers: h, body: JSON.stringify({ person: { givenName: 'После', surname: 'Очистки' } }) })
  ok('writes work again once there is room, without a restart', again.ok, String(again.status))
  const integrity = sh(`docker exec fg-stab node -e "const D=require('better-sqlite3');const d=new D('/data/family.db',{readonly:true});console.log(d.pragma('integrity_check',{simple:true}))"`)
  ok('database intact after a full disk', integrity === 'ok', integrity)
})

await scenario('memory', async () => {
  const { B, cookie } = await boot('fg-stab', P, img, { people: 1000, args: '-m 256m --memory-swap 256m' })
  const h = { cookie, origin: B, 'content-type': 'application/json' }
  const jpg = fs.readFileSync(new URL('../fixtures/photo.jpg', import.meta.url))
  const res = await Promise.all(Array.from({ length: 8 }, async (_, i) => { const f = new FormData(); f.set('file', new Blob([jpg]), `${i}.jpg`); const r = await fetch(B + '/api/v1/media', { method: 'POST', headers: { cookie, origin: B }, body: f }).catch(() => null); return r?.status ?? 'net' }))
  const views = await Promise.all(Array.from({ length: 40 }, () => fetch(B + '/api/v1/graph', { headers: { cookie } }).then((r) => r.text().then(() => r.status)).catch(() => 'net')))
  const ged = sh(`python3 "${fileURLToPath(new URL('../e2e/gen-family.py', import.meta.url))}" 1000`)
  const imp = await fetch(B + '/api/v1/gedcom/import', { method: 'POST', headers: { cookie, origin: B, 'content-type': 'text/plain' }, body: ged }).then((r) => r.status).catch(() => 'net')
  const restarts = sh(`docker inspect fg-stab -f '{{.RestartCount}} {{.State.OOMKilled}} {{.State.Running}}'`)
  ok('within 256 MB: 8 uploads, 40 views, an import', restarts === '0 false true', `${restarts}; uploads ${[...new Set(res)]}, views ${[...new Set(views)]}, import ${imp}, ${JSON.stringify(stats('fg-stab'))}`)
})

await scenario('input', async () => {
  const { B, cookie } = await boot('fg-stab', P, img, { people: 20 })
  const h = { cookie, origin: B, 'content-type': 'application/json' }
  const g = await (await fetch(B + '/api/v1/graph', { headers: { cookie } })).json(); const id = g.persons[0].id
  const bad = [
    ['POST', '/api/v1/persons', '{not json'], ['POST', '/api/v1/persons', '[]'], ['POST', '/api/v1/persons', 'null'], ['POST', '/api/v1/persons', '{"person":null}'], ['POST', '/api/v1/persons', '{"person":{"givenName":{"$ne":1}}}'],
    ['PATCH', `/api/v1/persons/${id}`, '{"facts":"nope"}'], ['PATCH', `/api/v1/persons/${id}`, '{"tags":[{},{}]}'], ['PATCH', `/api/v1/persons/${id}`, '{"seen":{"tags":7},"tags":[]}'], ['PATCH', `/api/v1/persons/${id}`, '{"birthYear":"\\u0000"}'], ['PATCH', '/api/v1/persons/../../etc/passwd', '{}'], ['DELETE', "/api/v1/persons/' OR 1=1 --", ''],
    ['POST', '/api/v1/relations', '{"type":"son"}'], ['POST', '/api/v1/relations', `{"type":"son","to":"${id}","other":"${id}"}`], ['POST', '/api/v1/relations/remove', '{"ids":"x"}'], ['POST', '/api/v1/presence', '{"client":{},"focusId":[]}'], ['POST', '/api/v1/history/x/undo', '{}'], ['GET', '/api/v1/history?limit=-1', null], ['GET', '/api/v1/history?limit=abc', null], ['GET', '/api/v1/history?limit=99999999999', null],
    ['POST', '/api/v1/gedcom/import', '0 HEAD\n0 @I1@ INDI\n1 FAMS @F9@\n0 @F9@ FAM\n1 HUSB @I1@\n1 CHIL @I1@\n0 TRLR'], ['POST', '/api/v1/gedcom/import', '\u0000\u0001'.repeat(5000)], ['POST', '/api/agent', '{"messages":"x"}'], ['GET', '/api/v1/media/..%2f..%2fetc%2fpasswd/file', null], ['GET', '/api/v1/persons/x/avatar', null],
    ['POST', '/api/v1/persons', JSON.stringify({ person: { givenName: 'я'.repeat(2_000_000) } })],
  ]
  let server = 0
  for (const [m, p, b] of bad) {
    const r = await fetch(B + p, { method: m, headers: h, ...(b === null ? {} : { body: b }) }).catch(() => null)
    const text = r ? await r.text() : ''
    if (!r || r.status >= 500 || /SQLITE|\.js:\d|node_modules/.test(text)) { server++; console.log('   ✗', m, p.slice(0, 50), r?.status, text.slice(0, 120)) }
  }
  ok('malformed requests never produce a server error or internals', server === 0, `${bad.length - server}/${bad.length}`)
  // A loop in the links must not hang anyone's page or the server.
  const a = g.persons[1].id, b = g.persons[2].id
  await fetch(B + '/api/v1/relations', { method: 'POST', headers: h, body: JSON.stringify({ type: 'son', to: a, other: b }) })
  const loop = await fetch(B + '/api/v1/relations', { method: 'POST', headers: h, body: JSON.stringify({ type: 'son', to: b, other: a }) })
  ok('a parent loop is refused', loop.status >= 400 && loop.status < 500, String(loop.status))
  ok('healthy after all that', (await fetch(B + '/api/health')).ok)
})
sh('docker rm -fv fg-stab')
