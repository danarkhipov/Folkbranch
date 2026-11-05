import fs from 'node:fs'; import { boot, IMAGE, sleep, stats, listen } from '../e2e/lib.mjs'
const img = IMAGE;
const jpg = fs.readFileSync(new URL('../fixtures/photo.jpg', import.meta.url))
const variants = { now: '' }
for (const [name, args] of Object.entries(variants)) {
  const { B, cookie } = await boot('fg-mem', 3427, img, { args }); const h = { cookie, origin: B, 'content-type': 'application/json' }
  await sleep(2000); const afterImport = stats('fg-mem').anonMB
  const g = await (await fetch(B + '/api/v1/graph', { headers: { cookie } })).json(); const ids = g.persons.map((p) => p.id)
  const lines = Array.from({ length: 30 }, () => listen(B, cookie)); const end = Date.now() + 40000; const lat = []; const c0 = stats('fg-mem').cpuS; const t0 = Date.now()
  const vs = Array.from({ length: 20 }, async () => { while (Date.now() < end) { const t = Date.now(); await fetch(B + '/api/v1/graph', { headers: { cookie } }).then((r) => r.text()); lat.push(Date.now() - t); await sleep(1500) } })
  const es = Array.from({ length: 3 }, async () => { while (Date.now() < end) { await fetch(`${B}/api/v1/persons/${ids[Math.floor(Math.random() * ids.length)]}`, { method: 'PATCH', headers: h, body: JSON.stringify({ birthPlace: 'Г' + Math.random() }) }); await sleep(600) } })
  const up = (async () => { for (let i = 0; i < 3; i++) { const f = new FormData(); f.set('file', new Blob([jpg]), 'k.jpg'); await fetch(B + '/api/v1/media', { method: 'POST', headers: { cookie, origin: B }, body: f }); await sleep(10000) } })()
  let peak = 0; const iv = setInterval(() => { peak = Math.max(peak, stats('fg-mem').memMB) }, 3000)
  await Promise.all([...vs, ...es, up]); clearInterval(iv); const cpu = +(100 * (stats('fg-mem').cpuS - c0) / ((Date.now() - t0) / 1000)).toFixed(1)
  lines.forEach((l) => l.stop()); const load = stats('fg-mem').anonMB; await sleep(25000)
  lat.sort((a, b) => a - b)
  console.log(name.padEnd(6), JSON.stringify({ afterImport, load, idle: stats('fg-mem').anonMB, peak, cpu, p50: lat[lat.length >> 1], p95: lat[Math.floor(lat.length * .95)] }))
}
