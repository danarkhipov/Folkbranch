import type { NextConfig } from 'next'

const config: NextConfig = {
  output: 'standalone',
  devIndicators: false,
  serverExternalPackages: ['better-sqlite3', 'sharp'],
  transpilePackages: ['@blocknote/core', '@blocknote/react', '@blocknote/mantine'],
  async headers() {
    // The archive is private: search engines stay out of every route.
    return [{ source: '/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }, { key: 'X-Content-Type-Options', value: 'nosniff' }] }]
  },
}
export default config
