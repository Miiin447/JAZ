/* Chordinary service worker: network-first, so new uploads show up right away.
   The cache is only a fallback for when there is no internet. */
const CACHE = 'chordinary-offline';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './favicon.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).catch(() => {}));
});
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then(res => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then(m => m || caches.match('./index.html')))
  );
});
