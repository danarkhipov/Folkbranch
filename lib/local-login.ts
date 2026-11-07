import { publicUrl } from './public-url'

const LOCAL_ADDRESS = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/
const PROXY_HEADERS = ['forwarded', 'x-real-ip', 'via', 'cf-connecting-ip', 'cf-ray', 'ngrok-trace-id', 'x-railway-request-id', 'fly-client-ip', 'x-vercel-id']
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

/**
 * Opens the archive as its owner without a link, for working on this computer.
 * On by itself only in `pnpm dev`, which listens on this computer alone. Never on a public address.
 */
export function localLoginAllowed(headers: { get: (name: string) => string | null }, env: Record<string, string | undefined> = process.env) {
  if (env.NODE_ENV !== 'development' && env.FOLKBRANCH_LOCAL_LOGIN !== '1') return false
  // A tunnel or proxy can say "localhost" while the visitor is anywhere. Those that say so themselves are refused.
  if (PROXY_HEADERS.some((h) => headers.get(h))) return false
  const from = headers.get('x-forwarded-for')?.split(',')[0].trim()
  if (from && !LOCAL_ADDRESS.test(from)) return false
  return LOOPBACK.test(headers.get('host') ?? '') && LOOPBACK.test(new URL(publicUrl()).host)
}
