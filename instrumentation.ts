// Says on start how to claim an empty instance, since nobody can sign in to read it anywhere else.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { hasUsers } = await import('./lib/ops/settings')
  const { setupCode } = await import('./lib/setup-code')
  const { sweepOrphanFiles } = await import('./lib/ops/media')
  sweepOrphanFiles().then((n) => { if (n) console.log(`Removed ${n} files left by an interrupted upload.`) }).catch(console.error)
  const { sweepAttachments } = await import('./lib/agent/attachments')
  sweepAttachments().catch(console.error)
  const { tidyDatabase } = await import('./lib/db')
  setInterval(tidyDatabase, 6 * 60 * 60 * 1000).unref()
  if (hasUsers()) return
  const code = setupCode()
  const { publicOrigins, publicUrl } = await import('./lib/public-url')
  const base = publicUrl()
  if (process.env.RAILWAY_PROJECT_ID && !publicOrigins().length) console.log('This service has no public address yet. In Railway: Settings → Networking → Generate Domain, then redeploy.')
  console.log(`\nFamily Graph is empty. Claim it here:\n  ${base}/setup${code ? `?code=${code}` : ''}\n`)
}
