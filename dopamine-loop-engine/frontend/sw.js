const CACHE_NAME = 'dlde-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/dashboard.js',
  '/js/monitor.js',
  '/js/interventions.js',
  '/js/charts.js',
  '/assets/calm-hero.svg',
  '/assets/calm-monitor.svg',
  '/assets/calm-history.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
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
  // Network first for API calls, cache first for static assets
  if (event.request.url.includes('/api/') || event.request.url.includes('/ws/')) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
  } else {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  }
});
