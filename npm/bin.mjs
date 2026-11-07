#!/usr/bin/env node
// npx folkbranch: installs on the first run and opens the app after that. Everything real happens in install.sh and
// the folder's own ./folkbranch command, so this package is a few kilobytes and has nothing to fall out of step.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
if (process.platform === 'win32') {
  console.log('On Windows, run this in PowerShell: irm https://raw.githubusercontent.com/danarkhipov/folkbranch/main/install.ps1 | iex')
  process.exit(1)
}

const at = args.indexOf('--dir')
const dir = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.FOLKBRANCH_DIR || path.join(os.homedir(), 'folkbranch'))
const installer = fileURLToPath(new URL('install.sh', import.meta.url))
const command = path.join(dir, 'folkbranch')
const run = (file, list) => process.exit(spawnSync(file, list, { stdio: 'inherit' }).status ?? 1)

// Flags and the word "install" or "update" go to the installer. It keeps settings and data, so running it twice is safe.
const installing = args[0] === 'install' || args[0] === 'update' || args[0]?.startsWith('--') || (!args.length && !fs.existsSync(command))
if (installing) {
  const rest = args[0] === 'install' || args[0] === 'update' ? args.slice(1) : args
  run('sh', [installer, ...(rest.includes('--dir') ? rest : ['--dir', dir, ...rest])])
}
if (!fs.existsSync(command)) {
  console.log(`Folkbranch is not installed in ${dir}. Run: npx folkbranch`)
  process.exit(1)
}
run(command, args.length ? args : ['open'])
