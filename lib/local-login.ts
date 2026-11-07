import { publicUrl } from './public-url'

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

/**
 * Opens the archive as its owner without a link, for working on this computer.
 * On by itself only in `pnpm dev`, which listens on this computer alone. Never on a public address.
 */
export function localLoginAllowed(host: string | null | undefined, env: Record<string, string | undefined> = process.env) {
  if (env.NODE_ENV !== 'development' && env.FOLKBRANCH_LOCAL_LOGIN !== '1') return false
  return LOOPBACK.test(host ?? '') && LOOPBACK.test(new URL(publicUrl()).host)
}
