const CACHE = 'gyopo-pwa-20260930';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('gyopo-pwa-') && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

function canCache(url, request) {
  if (url.origin !== self.location.origin || url.search || url.pathname.startsWith('/api/')) return false;
  return request.mode === 'navigate' && url.pathname === '/'
    || url.pathname === '/manifest.json'
    || url.pathname === '/icon-192.png'
    || url.pathname === '/icon-512.png'
    || url.pathname.startsWith('/_next/static/');
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!canCache(url, request)) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      const cacheControl = response.headers.get('cache-control') || '';
      if (response.status === 200 && !/\b(?:private|no-store)\b/i.test(cacheControl)) {
        const cache = await caches.open(CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const home = await caches.match('/');
        if (home) return home;
      }
      return Response.error();
    }
  })());
});
