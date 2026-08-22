/**
 * TiqueteVivo Service Worker
 * Provides offline caching for the app shell and static assets.
 * Network-first for API calls, cache-first for static resources.
 */

const CACHE_NAME = 'tiquetevivo-v1';
const STATIC_ASSETS = [
  '/',
  '/app.html',
  '/app.js',
  '/index.html',
  '/tiquete.html',
  '/registro.html',
  '/js/qr-payload.js',
  '/js/qr-mode-selector.js',
  '/js/qr-renderer.js',
  '/js/status-poller.js',
  '/js/scanner.js',
  '/js/dark-mode.js',
  '/js/skeleton-loader.js',
  '/js/animated-counter.js',
  '/js/confetti.js',
  '/js/vertical-theming.js',
  '/js/onboarding.js',
  '/js/mini-chart.js',
  '/manifest.json'
];

// Install: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {
        // If some assets fail, continue with what we can cache
        return Promise.allSettled(
          STATIC_ASSETS.map(url => cache.add(url).catch(() => {}))
        );
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch strategy
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls: network-first, no caching
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ error: 'Offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // External resources (CDN): network-first with cache fallback
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(event.request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
