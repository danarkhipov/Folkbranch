// npx folkbranch, from the packed package as npm would give it: install, open, then a command. Needs an archive: pnpm build && node scripts/make-bundle.mjs.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x && !c ? ' · ' + x : ''}`); if (!c) process.exitCode = 1 }
const repo = fileURLToPath(new URL('../..', import.meta.url))
const bundleFile = process.env.FG_BUNDLE ?? path.join(repo, `dist/folkbranch-${process.platform}-${process.arch}.tar.xz`)
if (!fs.existsSync(bundleFile)) { console.error(`No archive at ${bundleFile}. Run: pnpm build && node scripts/make-bundle.mjs`); process.exit(1) }
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'folkbranch-npx-')))
const packed = execFileSync('npm', ['pack', '--silent', '--pack-destination', work], { cwd: path.join(repo, 'npm'), encoding: 'utf8' }).trim().split('\n').pop()
const tgz = path.join(work, packed)
const size = fs.statSync(tgz).size
ok('the package is tiny', size < 20_000, `${size} bytes`)
const inside = execFileSync('tar', ['-tzf', tgz], { encoding: 'utf8' })
ok('and holds only what it needs', inside.split('\n').filter(Boolean).sort().join() === ['package/bin.mjs', 'package/install.sh', 'package/package.json'].join(), inside)

const env = { ...process.env, FOLKBRANCH_NO_OPEN: '1', HOME: work, npm_config_cache: path.join(work, 'npm-cache'), FOLKBRANCH_BUNDLE: pathToFileURL(bundleFile).href, FOLKBRANCH_DIR: path.join(work, 'archive') }
const npx = (...a) => spawnSync('npx', ['--yes', `--package=${tgz}`, 'folkbranch', ...a], { cwd: work, env, encoding: 'utf8', timeout: 180000 })
const dir = env.FOLKBRANCH_DIR
try {
  const none = npx('status')
  ok('a command before any install says what to do', none.status !== 0 && none.stdout.includes('npx folkbranch'), none.stdout)
  const first = npx('--port', '3476')
  ok('the first run installs and prints the link', first.status === 0 && /localhost:3476\/setup\?code=/.test(first.stdout), first.stdout.slice(-200) + first.stderr.slice(-200))
  ok('into its own folder', fs.existsSync(path.join(dir, '.local')))
  const code = fs.readFileSync(path.join(dir, '.env'), 'utf8').match(/^SETUP_TOKEN=(.*)$/m)[1]
  const again = npx()
  ok('the next run opens it instead of installing', again.status === 0 && again.stdout.includes(`/setup?code=${code}`), again.stdout)
  ok('commands pass through', npx('status').stdout.includes('Running at http://localhost:3476'))
  ok('update keeps the settings', npx('update').status === 0 && fs.readFileSync(path.join(dir, '.env'), 'utf8').includes(code))
  ok('stop stops it', npx('stop').status === 0 && npx('status').status !== 0)
} finally {
  spawnSync(path.join(dir, 'folkbranch'), ['stop'], { env })
  fs.rmSync(work, { recursive: true, force: true })
}
process.exit(process.exitCode ?? 0)
