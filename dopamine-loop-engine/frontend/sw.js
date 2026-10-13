const CACHE_NAME = 'dlde-v7';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/style.css',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/assets/calm-hero.svg',
  '/assets/calm-history.svg',
  '/assets/calm-monitor.svg',
  '/js/config.js',
  '/js/charts.js',
  '/js/moss.js',
  '/js/interventions.js',
  '/js/dashboard.js',
  '/js/monitor.js',
  '/js/app.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Cache each asset individually so a single missing asset does not abort installation
      await Promise.all(
        ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn(`[SW] Failed to cache ${url}:`, err);
          })
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  const url = event.request.url;

  // Never cache API responses as static assets
  if (url.includes('/api/') || url.includes('/ws/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Cache-first strategy for static assets
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Cache newly fetched static assets on successful 200 response
        if (response && response.status === 200 && response.type === 'basic') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      });
    }).catch(() => {
      // Offline fallback for HTML navigation
      if (event.request.headers.get('accept')?.includes('text/html')) {
        return caches.match('/index.html') || caches.match('/');
      }
    })
  );
});
