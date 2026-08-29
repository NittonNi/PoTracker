/* PoTracker service worker.
   The shell is cached so the app opens instantly and still works on a plane;
   Airtable calls always go to the network (the outbox handles being offline). */

const VERSION = 'potracker-2026-08-29.1';
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

/* `cache: 'reload'` belongs here, once per deploy, rather than on every request.
   GitHub Pages serves every file with max-age=600, so a plain install can cache
   the very copies a deploy was meant to replace; asking the server directly is
   what makes bumping VERSION enough to ship new code. Keeping it out of the
   fetch handler is what lets a cold start on a phone read from the cache
   instead of needing all seventeen round-trips to succeed first. */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => Promise.all(SHELL.map((path) =>
        fetch(new Request(path, { cache: 'reload' })).then((response) => {
          if (!response.ok) throw new Error(`${path} → ${response.status}`);
          return cache.put(path, response);
        })
      )))
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

/* A last resort that is still a page. Resolving respondWith to undefined is a
   network error, and in a home-screen app a network error is a white rectangle. */
function offlinePage() {
  return new Response(
    '<!doctype html><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>PoTracker</title>' +
    '<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f2f2f7;' +
    'color:#1c1c1e;font:16px/1.5 -apple-system,BlinkMacSystemFont,system-ui,sans-serif">' +
    '<div style="text-align:center;padding:24px">' +
    '<h1 style="font-size:19px;margin:0 0 8px">PoTracker is offline</h1>' +
    '<p style="margin:0 0 20px;color:#8e8e93">No connection, and no copy saved on this device yet.</p>' +
    '<button onclick="location.reload()" style="font:inherit;font-weight:600;background:#0a84ff;' +
    'color:#fff;border:0;border-radius:13px;padding:13px 24px">Try again</button></div>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

/* Two rules, and the half that matters is what each one does when it runs out
   of options.

   A navigation may fall back to the cached shell: that is the same document.
   Nothing else may. Handing index.html back for `js/store.js` looks like a
   successful load and then dies as `SyntaxError: Unexpected token '<'`, with
   both #app and #onboarding still hidden — a white screen that explains
   nothing. An asset that cannot be served has to fail as an asset. */
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return; // Airtable and friends

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'reload' })
        .catch(() => caches
          // ignoreSearch so the ?action=… home-screen shortcuts match as well.
          .match(request, { ignoreSearch: true })
          .then((cached) => cached || caches.match('index.html'))
          .then((cached) => cached || offlinePage()))
    );
    return;
  }

  /* Cache first: instant, and it survives a phone that woke up before its
     signal did. The copy is refreshed in the background, and a deploy does not
     depend on that happening — bumping VERSION rebuilds the cache on install. */
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      });

      if (cached) {
        event.waitUntil(network.catch(() => { /* the cached copy already answered */ }));
        return cached;
      }
      return network.catch(() => new Response('', { status: 504, statusText: 'Offline' }));
    })
  );
});
