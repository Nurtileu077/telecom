/* OPTIQ: cache map tiles for field use (Carto + Esri imagery). */
const CACHE = 'optiq-tiles-v1';
const HOSTS = ['basemaps.cartocdn.com', 'server.arcgisonline.com'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  try {
    const url = new URL(event.request.url);
    if (!HOSTS.some((h) => url.hostname.includes(h))) return;
    if (!/\.(png|jpg|jpeg|webp)/i.test(url.pathname) && !url.pathname.includes('/tile/')) return;
  } catch {
    return;
  }

  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((res) => {
          if (res.ok) cache.put(event.request, res.clone());
          return res;
        }).catch(() => cached);
      }),
    ),
  );
});
