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

// Avisos que manda el servidor (supabase/functions/recordatorio): el recordatorio de los
// fines de semana (abre Cargar partido) y los del administrador, como una versión nueva.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { /* sin datos: va el texto de siempre */ }
  const url = d.url || './#cargar';
  e.waitUntil(self.registration.showNotification(d.title || 'ARAC Partidos', {
    body: d.body || 'No te olvides de cargar los partidos de la jornada.',
    icon: 'icons/icon-192.png',
    tag: url.includes('#cargar') ? 'arac-recordatorio' : 'arac-aviso',
    data: { url },
  }));
});
// Al tocarlo: abre la app (o la trae al frente); el recordatorio, en Cargar partido
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const url = new URL(e.notification.data && e.notification.data.url || './', self.registration.scope).href;
    for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
      if (c.url.startsWith(self.registration.scope)) {
        if (url.includes('#cargar')) c.postMessage('abrir-cargar');
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
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
