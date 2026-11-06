#!/usr/bin/env node
// Access from the server's own command line, for when there is no browser at hand:
// connect an agent, get back in as the owner, or take a backup. Writes straight to the database,
// so it works whoever is signed in. Keep it small: everything else belongs in the app.
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

// A platform's shell opens as root, and a file made by root would lock the running app out of it.
if (process.getuid?.() === 0) { process.setgid('node'); process.setuid('node') }
const DATA_DIR = path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || './data')
const dbFile = path.join(DATA_DIR, 'family.db')
const hash = (t) => createHash('sha256').update(t).digest('hex')
const newId = () => randomBytes(9).toString('base64url')
const DAY = 86_400_000

function fail(message) {
  console.error(message)
  process.exit(1)
}

function open(readonly = false) {
  if (!fs.existsSync(dbFile)) fail(`No archive at ${dbFile}. Start the app once first.`)
  const db = new Database(dbFile, { readonly })
  db.pragma('busy_timeout = 5000')
  return db
}

function parse(args) {
  const out = { _: [] }
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) out._.push(args[i])
    else if (args[i + 1] && !args[i + 1].startsWith('--')) out[args[i].slice(2)] = args[++i]
    else out[args[i].slice(2)] = true
  }
  return out
}

const baseUrl = () => process.env.BETTER_AUTH_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${process.env.PORT || 3000}`)

function tokenCreate(o) {
  const name = o.name || o._[0]
  if (!name) fail('Usage: token create --name my-agent [--role reader|editor] [--direct] [--days 90]')
  const role = o.role || 'reader'
  if (!['reader', 'editor'].includes(role)) fail('--role must be reader or editor')
  const days = o.days === undefined ? null : Number(o.days)
  if (days !== null && !(days > 0)) fail('--days must be a positive number')
  const token = `fb_${randomBytes(32).toString('base64url')}`
  const db = open()
  const now = Date.now()
  db.prepare('insert into api_tokens (id, name, token_hash, role, review, created_by, created_at, expires_at) values (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(newId(), name, hash(token), role, o.direct ? 0 : 1, 'cli', now, days ? now + days * DAY : null)
  const url = `${baseUrl()}/api/mcp`
  if (o.json) return console.log(JSON.stringify({ token, url, role, review: !o.direct }))
  console.log(`Token for "${name}" (${role}${role === 'editor' ? (o.direct ? ', writes apply at once' : ', writes wait for your review') : ''}). Shown once, keep it safe.\n`)
  console.log(`  ${token}\n`)
  console.log('Claude Code:\n')
  console.log(`  claude mcp add --transport http folkbranch ${url} --header "Authorization: Bearer ${token}"\n`)
  console.log('Cursor, Windsurf and any other MCP client:\n')
  console.log(JSON.stringify({ mcpServers: { folkbranch: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2).replace(/^/gm, '  '))
  console.log('\nCodex:\n')
  console.log(`  export FOLKBRANCH_TOKEN=${token}`)
  console.log(`  codex mcp add folkbranch --url ${url} --bearer-token-env-var FOLKBRANCH_TOKEN`)
}

function tokenList() {
  const rows = open(true).prepare('select id, name, role, review, last_used_at u, expires_at e from api_tokens where revoked_at is null order by created_at desc').all()
  if (!rows.length) return console.log('No tokens.')
  for (const r of rows) {
    const expired = r.e && r.e < Date.now()
    console.log(`${r.id}  ${r.name}  ${r.role}${r.role === 'editor' && !r.review ? ' direct' : ''}  last used: ${r.u ? new Date(r.u).toISOString().slice(0, 10) : 'never'}${r.e ? `  ${expired ? 'EXPIRED' : 'expires'}: ${new Date(r.e).toISOString().slice(0, 10)}` : ''}`)
  }
}

function tokenRevoke(o) {
  const id = o._[0]
  if (!id) fail('Usage: token revoke <id>  (ids come from token list)')
  const r = open().prepare('update api_tokens set revoked_at = ? where id = ? and revoked_at is null').run(Date.now(), id)
  if (!r.changes) fail(`No active token ${id}.`)
  console.log('Revoked.')
}

/** Gets the owner back in: a one-time link, the same kind an invitation uses. */
function loginLink() {
  const db = open()
  const owner = db.prepare("select id, name from user where role = 'owner' limit 1").get()
  if (!owner) fail('Nobody has claimed this archive yet: open /setup.')
  const token = randomBytes(24).toString('base64url')
  const now = Date.now()
  db.prepare('insert into invites (id, token_hash, name, role, user_id, created_by, created_at, expires_at) values (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(newId(), hash(token), owner.name, 'owner', owner.id, 'cli', now, now + DAY)
  console.log(`One-time sign-in link for ${owner.name}, valid for a day:\n\n  ${baseUrl()}/invite/${token}`)
}

async function backup(o) {
  const dir = path.resolve(o._[0] || path.join(DATA_DIR, 'backups'))
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const target = path.join(dir, `folkbranch-${stamp}`)
  fs.mkdirSync(target, { recursive: true })
  // A consistent copy, safe while the app is running.
  await open(true).backup(path.join(target, 'family.db'))
  const media = path.join(DATA_DIR, 'media')
  if (fs.existsSync(media)) fs.cpSync(media, path.join(target, 'media'), { recursive: true })
  console.log(`Backup written to ${target}`)
}

function doctor() {
  const db = open(true)
  const n = (t) => db.prepare(`select count(*) n from ${t}`).get().n
  console.log(`Data:    ${DATA_DIR}`)
  console.log(`Address: ${baseUrl()}${process.env.BETTER_AUTH_URL ? '' : '  (BETTER_AUTH_URL is not set)'}`)
  console.log(`People:  ${n('persons')}`)
  console.log(`Users:   ${n('user')}`)
  console.log(`Tokens:  ${db.prepare('select count(*) n from api_tokens where revoked_at is null').get().n} active`)
  console.log(`Drafts:  ${db.prepare("select count(*) n from proposals where status = 'pending'").get().n} waiting for review`)
}

const HELP = `Folkbranch, server commands

  token create --name NAME [--role reader|editor] [--direct] [--days N] [--json]
                     Connect an agent. Readers never see living relatives. Editors'
                     writes wait for your review unless you pass --direct.
  token list         Tokens that are still active
  token revoke ID    Cut a token off at once
  login-link         A one-time sign-in link for the owner
  backup [DIR]       A consistent copy of the database and photos
  doctor             Where the data is and what is in it
`

const [cmd, sub, ...rest] = process.argv.slice(2)
if (cmd === 'token' && sub === 'create') tokenCreate(parse(rest))
else if (cmd === 'token' && sub === 'list') tokenList()
else if (cmd === 'token' && sub === 'revoke') tokenRevoke(parse(rest))
else if (cmd === 'login-link') loginLink()
else if (cmd === 'backup') await backup(parse([sub, ...rest].filter(Boolean)))
else if (cmd === 'doctor') doctor()
else { console.log(HELP); if (cmd && cmd !== 'help' && cmd !== '--help') process.exit(1) }
