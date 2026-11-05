// soak.mjs <image> <minutes>: steady mixed use with constant comings and goings. A leak shows as a rising floor.
import fs from 'node:fs'
import { boot, IMAGE, sleep, stats, listen } from '../e2e/lib.mjs'
const img = IMAGE, min = process.argv[2] ?? '10'
const { B, cookie } = await boot('fg-soak', 3421, img, { args: '-m 512m' })
const h = { cookie, origin: B, 'content-type': 'application/json' }
const end = Date.now() + Number(min) * 60000
const graph = await (await fetch(B + '/api/v1/graph', { headers: { cookie } })).json()
const ids = graph.persons.map((p) => p.id)
const n = { reads: 0, writes: 0, conflicts: 0, uploads: 0, sse: 0, errors: {} }
const fail = (k) => { n.errors[k] = (n.errors[k] ?? 0) + 1 }
const pick = (a) => a[Math.floor(Math.random() * a.length)]
const jpg = fs.readFileSync(new URL('../fixtures/photo.jpg', import.meta.url))

// 40 pages that come and go, each staying a few seconds to a minute.
const pages = Array.from({ length: 40 }, async () => {
  while (Date.now() < end) {
    const l = listen(B, cookie, 2000 + Math.random() * 60000); n.sse++
    const r = await l.done; if (r.status && r.status !== 200) fail('sse' + r.status)
    await sleep(100)
  }
})
// Viewers: unchanged graph mostly as 304.
const viewers = Array.from({ length: 10 }, async () => {
  let etag = ''
  while (Date.now() < end) {
    try {
      const r = await fetch(B + '/api/v1/graph', { headers: { cookie, ...(etag ? { 'if-none-match': etag } : {}) } })
      if (r.status === 200) { etag = r.headers.get('etag') ?? ''; await r.text() } else if (r.status !== 304) fail('read' + r.status)
      n.reads++
      await fetch(B + '/api/v1/history?limit=30', { headers: { cookie } }).then((x) => x.text())
    } catch { fail('readNet') }
    await sleep(1000 + Math.random() * 1000)
  }
})
const editors = Array.from({ length: 3 }, async () => {
  let made = []
  while (Date.now() < end) {
    try {
      const roll = Math.random()
      if (roll < 0.7) {
        const r = await fetch(`${B}/api/v1/persons/${pick(ids)}`, { method: 'PATCH', headers: h, body: JSON.stringify({ birthPlace: 'Город ' + Math.floor(Math.random() * 1e6) }) })
        if (r.ok) n.writes++; else if (r.status === 409) n.conflicts++; else fail('patch' + r.status)
      } else if (roll < 0.85) {
        const r = await fetch(B + '/api/v1/persons', { method: 'POST', headers: h, body: JSON.stringify({ person: { givenName: 'Гость', surname: 'Прогонов' } }) })
        if (r.ok) { made.push((await r.json()).id); n.writes++ } else fail('post' + r.status)
      } else if (made.length) {
        const r = await fetch(`${B}/api/v1/persons/${made.pop()}`, { method: 'DELETE', headers: h })
        if (r.ok) n.writes++; else fail('del' + r.status)
      }
    } catch { fail('writeNet') }
    await sleep(300 + Math.random() * 700)
  }
})
const uploader = (async () => {
  while (Date.now() < end) {
    const f = new FormData(); f.set('file', new Blob([jpg]), 'k.jpg')
    const r = await fetch(B + '/api/v1/media', { method: 'POST', headers: { cookie, origin: B }, body: f }).catch(() => null)
    if (r?.ok) { n.uploads++; const m = await r.json(); await fetch(`${B}/api/v1/media/${m.id}`, { method: 'DELETE', headers: h }).catch(() => {}) } else fail('upload' + (r?.status ?? 'Net'))
    await sleep(20000)
  }
})()
const samples = []
const t0 = Date.now(), c0 = stats('fg-soak').cpuS
const sampler = (async () => {
  while (Date.now() < end) {
    const s = { min: +((Date.now() - t0) / 60000).toFixed(1), ...stats('fg-soak') }
    samples.push(s); fs.writeFileSync('/tmp/family-soak.json', JSON.stringify({ samples, n }, null, 0))
    await sleep(20000)
  }
})()
await Promise.all([...pages, ...viewers, ...editors, uploader, sampler])
await sleep(12000) // everyone has gone: what remains?
const last = stats('fg-soak')
const third = Math.floor(samples.length / 3)
const avg = (a) => Math.round(a.reduce((x, s) => x + s.anonMB, 0) / a.length)
console.log(JSON.stringify({ n, start: samples[0], end: samples.at(-1), idleAfter: last, anonFirstThird: avg(samples.slice(0, third)), anonLastThird: avg(samples.slice(-third)), peakMem: Math.max(...samples.map((s) => s.memMB)), cpuPct: +(100 * (last.cpuS - c0) / ((Date.now() - t0) / 1000)).toFixed(1) }))
