/* SPHAiRDigital Service Worker — PWA caching */

// Bump this version whenever you deploy to force a cache refresh on all clients.
const CACHE_NAME = 'sphair-omv3';
const OFFLINE_URL = '/offline.html';

// Files we can name exactly at build time.
// React JS/CSS bundles have hashed filenames so they're cached dynamically
// on first visit via the fetch handler below — not listed here.
const PRECACHE = [
  '/',
  '/offline.html',
  '/logo192.png',
  '/logo512.png',
  '/favicon.ico',
  '/manifest.json',
];

// ─── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// ─── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ─── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin requests.
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Skip API requests — handled by IndexedDB offline layer (offlineApi / syncManager).
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // ── Navigation (HTML pages) ────────────────────────────────────────────────
  // Network-first: serve fresh page when online AND cache it so the full React
  // app shell is available offline after the very first visit.
  // On failure: serve cached version of the same URL, fall back to cached '/'
  // (the React SPA shell), then finally the offline.html branded page.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cached =
            (await caches.match(request)) ||
            (await caches.match('/'));
          if (cached) return cached;
          return caches.match(OFFLINE_URL);
        })
    );
    return;
  }

  // ── Static assets (JS, CSS, fonts, images) ────────────────────────────────
  // Cache-first: serve from cache instantly; on miss fetch from network and
  // store in cache. This automatically caches hashed JS/CSS bundles after the
  // first page load so they work offline on the next visit.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
    )
  );
});
