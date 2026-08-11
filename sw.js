/* PoTracker service worker.
   The shell is cached so the app opens instantly and still works on a plane;
   Airtable calls always go to the network (the outbox handles being offline). */

const VERSION = 'potracker-v1';
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/util.js',
  'js/store.js',
  'js/airtable.js',
  'js/stats.js',
  'js/charts.js',
  'js/share.js',
  'js/qr.js',
  'js/views.js',
  'js/app.js',
  'manifest.webmanifest',
  'assets/icon.svg',
  'assets/icon-180.png',
  'assets/icon-192.png',
  'assets/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Airtable and friends: straight to the network

  // Network-first, cache as the fallback. Online you always get the current
  // build (no stale JavaScript after a deploy); offline you still get the app.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('index.html')))
  );
});
