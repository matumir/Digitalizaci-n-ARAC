/* ARAC Partidos — service worker de la versión web (PWA).
   Guarda la app completa en el teléfono para que abra sin internet.
   VERSION y PRECACHE los completa scripts/preparar-web.mjs al publicar; cada publicación
   cambia este archivo, así el teléfono detecta que hay una versión nueva. */
const VERSION = '__VERSION__';
const PRECACHE = [/*PRECACHE*/];
const CACHE = 'arac-' + VERSION;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./'].concat(PRECACHE))));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// La app pide pasar a la versión nueva cuando la persona toca "Actualizar"
self.addEventListener('message', e => { if (e.data === 'saltar') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  // Supabase y Google van siempre por la red
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    // ignoreSearch: la vuelta del login llega como ./?code=… y tiene que abrir la app guardada
    const guardada = await caches.match(req, { ignoreSearch: true });
    if (guardada) return guardada;
    try {
      const resp = await fetch(req);
      if (resp.ok) (await caches.open(CACHE)).put(req, resp.clone());
      return resp;
    } catch (err) {
      if (req.mode === 'navigate') return caches.match('./');
      throw err;
    }
  })());
});
