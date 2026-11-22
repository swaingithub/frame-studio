/*
 * Frame Studio service worker.
 *
 * Registration happens only in production builds. Navigations stay
 * network-first (so a new deploy is picked up immediately when online) and
 * fall back to the cached shell offline. Cache-first is limited to the
 * hashed build assets under /assets/ and the shell; music and opt-in AI
 * model files are always fetched fresh so they never accumulate in the
 * never-expiring cache. User media lives in IndexedDB/OPFS, never here.
 */
// Bump when the shell/UI changes so installed builds invalidate stale assets.
const CACHE = 'frame-studio-v3'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        })
        .catch(() => caches.match(request).then((cached) => cached ?? caches.match('/index.html'))),
    )
    return
  }

  // Only the Vite build outputs are cached: the shell ('/' and '/index.html')
  // and everything under '/assets/'. Everything else (music, AI models, the
  // manifest, the app itself) is fetched on demand, never cached.
  if (url.pathname !== '/' && url.pathname !== '/index.html' && !url.pathname.startsWith('/assets/')) {
    event.respondWith(fetch(request))
    return
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        }),
    ),
  )
})
