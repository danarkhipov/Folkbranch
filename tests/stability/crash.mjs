// Confirmed writes across crashes. Only what was confirmed BEFORE the check began is expected in that check; a final check after writers stop covers everything.
import { boot, IMAGE, sh, sleep, waitUp } from '../e2e/lib.mjs'
const { B, cookie } = await boot('fg-dur', 3428, IMAGE, { people: 300 })
const h = { cookie, origin: B, 'content-type': 'application/json' }
const acked = []; let stop = false, netFails = 0
const ws = [0, 1, 2, 3].map(async (w) => { for (let i = 0; !stop; i++) { try { const r = await fetch(B + '/api/v1/persons', { method: 'POST', headers: h, body: JSON.stringify({ person: { givenName: `W${w}-${i}`, surname: 'Crash' } }) }); if (r.ok) acked.push((await r.json()).id) } catch { netFails++; await sleep(30) } } })
const graphIds = async () => new Set((await (await fetch(B + '/api/v1/graph', { headers: { cookie } })).json()).persons.map((p) => p.id))
let lost = 0
for (let round = 1; round <= 10; round++) {
  await sleep(800 + Math.random() * 1200); sh('docker kill -s KILL fg-dur'); await sleep(100)
  const confirmedAtKill = acked.length // nothing can be confirmed while the server is dead
  sh('docker start fg-dur'); await waitUp(B)
  const have = await graphIds()
  const missing = acked.slice(0, confirmedAtKill).filter((i) => !have.has(i))
  lost += missing.length
  console.log(`round ${round}: confirmed before kill ${confirmedAtKill}, missing ${missing.length}`, missing.slice(0, 3).join(' '))
}
stop = true; await Promise.allSettled(ws); await sleep(300)
const have = await graphIds(); const finalMissing = acked.filter((i) => !have.has(i))
console.log(`final: confirmed ${acked.length}, missing ${finalMissing.length}, network failures while down ${netFails}`)
console.log(lost + finalMissing.length === 0 ? 'PASS no confirmed write was lost' : 'FAIL confirmed writes lost')
sh('docker rm -f fg-dur'); process.exit(0)
