/*
 * Frame Studio service worker.
 *
 * Registration happens only in production builds. Navigations stay
 * network-first (so a new deploy is picked up immediately when online) and
 * fall back to the cached shell offline. Cache-first covers the shell and
 * the bundled music library under /music/, plus the hashed build assets
 * under /assets/, minus runtime WASM binaries (ONNX Runtime ships ~tens of
 * MB; they are always fetched fresh). Opt-in AI model files and other
 * same-origin GETs are fetched fresh so they never accumulate in the
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

  // Only the Vite build outputs and the bundled music library are cached:
  // the shell ('/' and '/index.html'), everything under '/assets/', and the
  // '/music/' tracks — except runtime WASM binaries (ONNX Runtime ships
  // ~tens of MB; they are always fetched fresh). Everything else (the
  // manifest, opt-in AI model files, other same-origin GETs) is fetched on
  // demand, never cached.
  if (url.pathname.endsWith('.wasm')) {
    event.respondWith(fetch(request))
    return
  }
  const cacheable =
    url.pathname === '/' ||
    url.pathname === '/index.html' ||
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/music/')
  if (!cacheable) {
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
