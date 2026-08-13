/* PoTracker service worker.
   The shell is cached so the app opens instantly and still works on a plane;
   Airtable calls always go to the network (the outbox handles being offline). */

const VERSION = 'potracker-2026-08-13.2';
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

  /* Network-first, cache as the fallback. Online you always get the current
     build; offline you still get the app.

     `cache: 'reload'` is what makes that true. A plain fetch() goes through
     the browser's HTTP cache, and GitHub Pages serves these files with
     max-age=600 — so for ten minutes "network-first" would quietly hand back
     the same stale JavaScript a deploy was meant to replace. This asks the
     server every time and refreshes the HTTP cache on the way. */
  event.respondWith(
    fetch(request, { cache: 'reload' })
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
