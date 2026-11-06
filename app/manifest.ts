import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Folkbranch',
    short_name: 'Folkbranch',
    description: 'A self-hosted family tree for your whole family.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f7f3ea',
    theme_color: '#f7f3ea',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
