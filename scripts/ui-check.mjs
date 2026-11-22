#!/usr/bin/env node
// Looks at the app the way a person does: starts a built copy on an invented family and runs the browser checks in
// tests/ui (and the map scenario in tests/e2e). Phone and desktop sizes, the map's layers, the chronicle, speed after a reload.
//   node scripts/ui-check.mjs                 the checks that gate a pull request
//   node scripts/ui-check.mjs --perf          also the speed budgets (a family of 2,000; slower, for a nightly run)
//   node scripts/ui-check.mjs --no-build      use the build already in .next
//   node scripts/ui-check.mjs layout          only the checks whose file name contains "layout"
// Screenshots of every state it looked at go to ./ui-shots (UI_SHOTS=dir to move them), for the pull request.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startApp } from '../tests/ui/serve.mjs'
import { startModelStub } from '../tests/ui/model-stub.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const perf = args.includes('--perf')
const only = args.filter((a) => !a.startsWith('--'))
const shots = path.resolve(process.env.UI_SHOTS ?? path.join(root, 'ui-shots'))
rmSync(shots, { recursive: true, force: true }); mkdirSync(shots, { recursive: true })

if (!args.includes('--no-build') && !existsSync(path.join(root, '.next/BUILD_ID'))) {
  console.log('== pnpm build')
  if (spawnSync('pnpm', ['build'], { cwd: root, stdio: 'inherit' }).status !== 0) process.exit(1)
}

// Each check: its file, the family it needs, and whether it only runs with --perf.
const checks = [
  { file: 'tests/ui/layout.mjs', port: 3590 },
  { file: 'tests/ui/map-layers.mjs', port: 3591 },
  { file: 'tests/ui/languages.mjs', port: 3696 },
  { file: 'tests/ui/chart-drag.mjs', port: 3694 },
  { file: 'tests/ui/chart-marks.mjs', port: 3695 },
  { file: 'tests/ui/settings-ai.mjs', port: 3594, stubOnly: true, stubPort: 3794 },
  { file: 'tests/ui/assistant-panel.mjs', port: 3595, stub: true },
  { file: 'tests/e2e/map.mjs', port: 3592 },
  { file: 'tests/ui/map-chronicle.mjs', port: 3599, chronicle: true },
  { file: 'tests/ui/story-ask.mjs', port: 3597 },
  { file: 'tests/ui/map-reload.mjs', port: 3593, people: 2000, perf: true, chronicle: true },
].filter((c) => (perf || !c.perf) && (!only.length || only.some((o) => c.file.includes(o))))

let failed = 0
for (const c of checks) {
  console.log(`== ${c.file}`)
  // A check that talks to the assistant gets a model that costs nothing: the "local model" provider pointed at a stub.
  // stubOnly: the stub runs, but the app is not told about it (FG_STUB): the check adds it as a provider of its own.
  const stub = c.stub || c.stubOnly ? await startModelStub(c.stubPort ?? c.port + 100) : null
  const app = await startApp({ port: c.port, people: c.people ?? 0, chronicle: !!c.chronicle, env: stub && c.stub ? { AGENT_PROVIDER: 'local', AGENT_BASE_URL: stub.url, AGENT_MODEL: 'stub' } : {} }).catch((e) => { stub?.stop(); throw e })
  try {
    // Asynchronous: the model stub of a check runs in this process and must keep answering.
    const r = await new Promise((done) => spawn('node', [c.file], { cwd: root, stdio: 'inherit', env: { ...process.env, FG_URL: app.B, FG_COOKIE: app.cookie, UI_SHOTS: shots, ...(c.stubOnly && stub ? { FG_STUB: stub.url } : {}), NODE_OPTIONS: `--import "${path.join(root, 'tests/e2e/no-tour.mjs')}"` } }).on('exit', (code) => done({ status: code })))
    if (r.status !== 0) failed++
  } finally { app.stop(); stub?.stop() }
}
console.log(`\n${checks.length - failed} of ${checks.length} checks passed; screenshots in ${shots} (${existsSync(shots) ? readdirSync(shots).length : 0} files)`)
process.exit(failed ? 1 : 0)
