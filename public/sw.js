// Only what holds no family data: the app's own hashed files, the fonts, and a page for when there is no connection.
// Nothing from /api is ever stored here, so a shared computer keeps no one's archive.
const CACHE = 'folkbranch-v2'
const OFFLINE = '/offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE)).then(() => self.skipWaiting()))
})

// Only this file's own older copies go: the models a person downloaded live in caches of their own.
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('folkbranch-v') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (request.mode === 'navigate') {
    // A new version is being put in place: the address answers with a gateway error for a moment. The waiting page retries by itself.
    event.respondWith(fetch(request).then((r) => (r.status === 502 || r.status === 503 || r.status === 504 ? caches.match(OFFLINE).then((o) => o ?? r) : r)).catch(() => caches.match(OFFLINE)))
    return
  }
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/fonts/')) {
    event.respondWith(caches.open(CACHE).then(async (cache) => {
      const kept = await cache.match(request)
      if (kept) return kept
      const fresh = await fetch(request)
      if (fresh.ok) cache.put(request, fresh.clone())
      return fresh
    }))
  }
})
