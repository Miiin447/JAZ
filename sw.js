/* Chordinary v37.
   Root index.html remains the only HTML entry point.
   Network-first for fresh uploads, offline fallback only for navigations. */
const CACHE = 'chordinary-offline-v37';
const CORE = ['./', './index.html', './manifest.webmanifest',
              './icon-192.png', './icon-512.png', './favicon.png'];
const BASE = new URL('./', self.location.href);

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.allSettled(CORE.map(url => cache.add(url))))
      .catch(() => {})
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith('chordinary-offline') && key !== CACHE)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const target = new URL(request.url);
  if (request.method !== 'GET' ||
      target.origin !== BASE.origin ||
      !target.pathname.startsWith(BASE.pathname)) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request, {cache: 'no-cache'});
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE)
          .then(cache => cache.put(request, copy))
          .catch(() => {}));
      }
      return response;
    } catch (_) {
      const cached = await caches.match(request);
      if (cached) return cached;

      // Never send HTML in place of missing JS, images, JSON or fonts.
      if (request.mode === 'navigate') {
        return (await caches.match(new URL('./index.html', BASE).href)) ||
          Response.error();
      }
      return Response.error();
    }
  })());
});
