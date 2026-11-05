import type { NextConfig } from 'next'

// Nothing on a page may load from or send to another site: not a picture written into a page, not a script.
const dev = process.env.NODE_ENV !== 'production'
const CSP = [
  "default-src 'self'", `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ''}`, "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self' data:",
  // The face model comes from Google's storage; only that one address is allowed.
  `connect-src 'self' https://storage.googleapis.com${dev ? ' ws:' : ''}`, "media-src 'self' blob:", "worker-src 'self' blob:", "frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'", "form-action 'self'",
].join('; ')

const config: NextConfig = {
  poweredByHeader: false,
  output: 'standalone',
  devIndicators: false,
  serverExternalPackages: ['better-sqlite3', 'sharp'],
  transpilePackages: ['@blocknote/core', '@blocknote/react', '@blocknote/mantine'],
  async headers() {
    // The archive is private: search engines stay out of every route.
    return [{ source: '/:path*', headers: [
      { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Content-Security-Policy', value: CSP },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
    ] }]
  },
}
export default config
