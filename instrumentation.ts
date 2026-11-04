// Says on start how to claim an empty instance, since nobody can sign in to read it anywhere else.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { hasUsers } = await import('./lib/ops/settings')
  const { setupCode } = await import('./lib/setup-code')
  const { sweepOrphanFiles } = await import('./lib/ops/media')
  sweepOrphanFiles().then((n) => { if (n) console.log(`Removed ${n} files left by an interrupted upload.`) }).catch(console.error)
  const { sweepAttachments } = await import('./lib/agent/attachments')
  sweepAttachments().catch(console.error)
  if (hasUsers()) return
  const code = setupCode()
  const base = process.env.BETTER_AUTH_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${process.env.PORT || 3417}`)
  console.log(`\nFamily Graph is empty. Claim it here:\n  ${base}/setup${code ? `?code=${code}` : ''}\n`)
}
