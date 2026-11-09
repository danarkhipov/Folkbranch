import type { NextConfig } from 'next'

// Nothing on a page may load from or send to another site: not a picture written into a page, not a script.
// The exceptions: the map's pictures from OpenStreetMap, fetched only after a device allowed them,
// and Telegram's sign-in button, which Telegram draws itself in a frame of its own.
const dev = process.env.NODE_ENV !== 'production'
const CSP = [
  "default-src 'self'", `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://telegram.org${dev ? " 'unsafe-eval'" : ''}`, "frame-src https://oauth.telegram.org", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.basemaps.cartocdn.com", "font-src 'self' data:",
  // Model files, fetched only when someone asks for them: these addresses can send data in, and no code from them runs as a script.
  `connect-src 'self' https://unpkg.com https://cdn.jsdelivr.net https://huggingface.co https://*.hf.co https://hf-mirror.com${dev ? ' ws:' : ''}`, "media-src 'self' blob:", "worker-src 'self' blob:", "frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'", "form-action 'self'",
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
      // Lets a speech model use several cores. A browser without this simply runs it on one.
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
      { key: 'Content-Security-Policy', value: CSP },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
    ] }]
  },
}
export default config
