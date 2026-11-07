// Packs a finished `pnpm build` into one archive for this platform, to install without Docker.
// Only reads the build, so it is safe while a server runs from it.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const standalone = '.next/standalone'
if (!fs.existsSync(path.join(standalone, 'server.js'))) { console.error('No build: run pnpm build first.'); process.exit(1) }

const name = `folkbranch-${process.platform}-${process.arch}`
const dist = path.resolve(process.env.BUNDLE_DIR ?? 'dist')
const stage = path.join(dist, name)
fs.rmSync(stage, { recursive: true, force: true })
fs.mkdirSync(dist, { recursive: true })

// Links inside node_modules stay links, or the archive doubles and the driver stops resolving.
const copy = (from, to) => fs.cpSync(from, path.join(stage, to), { recursive: true, verbatimSymlinks: true, force: true })
copy(standalone, '.')
copy('.next/static', '.next/static')
copy('public', 'public')
copy('drizzle', 'drizzle')
for (const f of ['folkbranch', 'LICENSE']) copy(f, f)
copy('scripts/folkbranch.mjs', 'folkbranch.mjs')

// Left over from the build. The speech runtime's large file comes from its CDN when someone turns speech on (lib/smart/speech.ts),
// and the face detector loads the plain build, not the ES module one. A folder that had the module build keeps it in public.
const media = path.join(stage, '.next/static/media')
for (const f of fs.readdirSync(media)) if (/^ort-wasm.*\.wasm$/.test(f)) fs.rmSync(path.join(media, f))
const faces = path.join(stage, 'public/mediapipe')
if (fs.existsSync(faces)) for (const f of fs.readdirSync(faces)) if (f.includes('_module_')) fs.rmSync(path.join(faces, f))

// The standalone build keeps the driver out of sight; the server commands need to find it.
const pnpmDir = path.join(stage, 'node_modules/.pnpm')
const driver = fs.readdirSync(pnpmDir).find((d) => d.startsWith('better-sqlite3@'))
if (!driver) { console.error('The database driver is not in the build.'); process.exit(1) }
fs.rmSync(path.join(stage, 'node_modules/better-sqlite3'), { recursive: true, force: true })
fs.symlinkSync(`.pnpm/${driver}/node_modules/better-sqlite3`, path.join(stage, 'node_modules/better-sqlite3'))
execFileSync(process.execPath, ['-e', "require('better-sqlite3'); require('sharp')"], { cwd: stage, stdio: 'inherit' })

// This archive is public. A family's files must never reach it, whatever the build picked up.
const FORBIDDEN = /^(data|\.env.*|START_PROMPT\.md|.*\.ged|family\.db.*|auth-secret|setup-code)$/
const scan = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (FORBIDDEN.test(e.name) && !full.includes('/node_modules/')) { console.error(`Refusing to pack ${full}`); process.exit(1) }
    if (e.isDirectory()) scan(full)
  }
}
scan(stage)

const pack = (ext, flag) => {
  const file = path.join(dist, `${name}.tar.${ext}`)
  execFileSync('tar', [flag, file, '-C', dist, name], { env: { ...process.env, COPYFILE_DISABLE: '1', XZ_OPT: '-6' } })
  const sum = createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  fs.writeFileSync(`${file}.sha256`, `${sum}  ${path.basename(file)}\n`)
  console.log(`${file}  ${(fs.statSync(file).size / 1048576).toFixed(1)} MB`)
}
pack('xz', '-cJf')
pack('gz', '-czf')
fs.rmSync(stage, { recursive: true, force: true })
