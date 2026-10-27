/* ARAC Partidos — service worker de la versión web (PWA).
   Guarda la app completa en el teléfono para que abra sin internet.
   VERSION y PRECACHE los completa scripts/preparar-web.mjs al publicar; cada publicación
   cambia este archivo, así el teléfono detecta que hay una versión nueva. */
const VERSION = "c581e01d3b";
const PRECACHE = [
 "admin.js",
 "app.css",
 "app.js",
 "auth.js",
 "config.js",
 "datos-clubes.js",
 "icons/apple-touch-icon.png",
 "icons/icon-192.png",
 "icons/icon-512.png",
 "icons/icon-maskable-192.png",
 "icons/icon-maskable-512.png",
 "img/arac.png",
 "img/escudos/rf-01.png",
 "img/escudos/rf-02.png",
 "img/escudos/rf-03.png",
 "img/escudos/rf-04.png",
 "img/escudos/rf-05.png",
 "img/escudos/rf-06.png",
 "img/escudos/rf-07.png",
 "img/escudos/rf-08.png",
 "img/escudos/rf-09.png",
 "img/escudos/rf-10.png",
 "img/escudos/rf-11.png",
 "img/escudos/rf-12.png",
 "img/escudos/rf-13.png",
 "img/escudos/rf-14.png",
 "img/escudos/rf-15.png",
 "img/escudos/rf-16.png",
 "img/escudos/rf-17.png",
 "img/escudos/rf-18.png",
 "img/escudos/rf-19.png",
 "img/escudos/rf-20.png",
 "img/escudos/rf-21.png",
 "img/escudos/rf-22.png",
 "img/escudos/rf-23.png",
 "img/escudos/rf-24.png",
 "img/escudos/rf-25.png",
 "img/escudos/rf-26.png",
 "img/escudos/rf-27.png",
 "img/escudos/rf-28.png",
 "img/escudos/rf-29.png",
 "img/escudos/rf-30.png",
 "img/escudos/rf-31.png",
 "img/escudos/rf-32.png",
 "img/escudos/rf-33.png",
 "img/escudos/rf-34.png",
 "img/escudos/rf-35.png",
 "img/escudos/rf-36.png",
 "img/escudos/rf-37.png",
 "img/escudos/rf-38.png",
 "img/escudos/rf-39.png",
 "img/escudos/rf-40.png",
 "img/escudos/sf-01.png",
 "img/escudos/sf-02.png",
 "img/escudos/sf-03.png",
 "img/escudos/sf-04.png",
 "img/escudos/sf-05.png",
 "img/escudos/sf-06.png",
 "img/escudos/sf-07.png",
 "img/escudos/sf-08.png",
 "img/escudos/sf-09.png",
 "img/escudos/sf-10.png",
 "img/escudos/sf-11.png",
 "img/escudos/sf-12.png",
 "img/escudos/sf-13.png",
 "img/escudos/sf-14.png",
 "img/escudos/sf-15.png",
 "img/escudos/sf-16.png",
 "img/escudos/sf-17.png",
 "img/escudos/sf-18.png",
 "img/escudos/sf-19.png",
 "img/escudos/sf-20.png",
 "img/escudos/sf-21.png",
 "img/escudos/sf-22.png",
 "img/escudos/sf-23.png",
 "img/escudos/sf-24.png",
 "img/escudos/sf-25.png",
 "img/escudos/sf-26.png",
 "img/escudos/sf-27.png",
 "img/escudos/sf-28.png",
 "img/escudos/sf-29.png",
 "img/escudos/sf-30.png",
 "img/escudos/sf-31.png",
 "img/escudos/sf-32.png",
 "img/escudos/sf-33.png",
 "img/escudos/sf-34.png",
 "img/escudos/sf-35.png",
 "img/escudos/sf-36.png",
 "img/escudos/sf-37.png",
 "img/escudos/sf-38.png",
 "img/escudos/sf-39.png",
 "img/escudos/sf-40.png",
 "img/escudos/sf-41.png",
 "img/escudos/sf-42.png",
 "img/escudos/sf-43.png",
 "img/escudos/sf-44.png",
 "img/escudos/sf-45.png",
 "img/escudos/sf-46.png",
 "img/escudos/sm-01.png",
 "img/escudos/sm-02.png",
 "img/escudos/sm-03.png",
 "img/escudos/sm-04.png",
 "img/escudos/sm-05.png",
 "img/escudos/sm-06.png",
 "img/escudos/sm-07.png",
 "img/escudos/sm-08.png",
 "img/escudos/sm-09.png",
 "img/escudos/sm-10.png",
 "img/escudos/sm-11.png",
 "img/escudos/sm-12.png",
 "img/escudos/sm-13.png",
 "img/escudos/sm-14.png",
 "img/escudos/sm-15.png",
 "img/escudos/sm-16.png",
 "img/escudos/sm-17.png",
 "img/escudos/sm-18.png",
 "img/escudos/sm-19.png",
 "img/escudos/sm-20.png",
 "img/escudos/sm-21.png",
 "img/escudos/sm-22.png",
 "img/escudos/sm-23.png",
 "img/ligas/rf.png",
 "img/ligas/sf.png",
 "img/ligas/sm.png",
 "index.html",
 "manifest.webmanifest",
 "pwa.js",
 "recordatorio.js",
 "sync.js",
 "vendor/cap-app.js",
 "vendor/cap-browser.js",
 "vendor/cap-filesystem.js",
 "vendor/cap-local-notifications.js",
 "vendor/cap-share.js",
 "vendor/capacitor.js",
 "vendor/supabase.js"
];
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
