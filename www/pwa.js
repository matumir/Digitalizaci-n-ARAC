'use strict';
/* ARAC Partidos — versión web instalable (PWA), pensada para iPhone.
   - Registra el service worker (sw.js) para que la app abra sin internet.
   - Cuando hay una versión nueva, ofrece actualizar (no recarga sola: se perdería
     un partido a medio cargar).
   - Explica cómo instalarla: en iPhone, Compartir › Agregar a pantalla de inicio;
     en Android/computadora, con el botón Instalar del navegador.
   En el APK no hace nada. */

(() => {
  const Cap = window.Capacitor;
  const nativo = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  if (nativo) return;

  const $ = s => document.querySelector(s);
  const ua = navigator.userAgent;
  const esIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const instalada = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  document.documentElement.classList.toggle('pwa-instalada', instalada());
  document.documentElement.classList.toggle('ios', esIOS);

  // En iPhone, :active (el "hundirse" de los botones) sólo funciona con un listener de toque
  document.addEventListener('touchstart', () => {}, { passive: true });

  // ---------- Service worker y actualizaciones ----------
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    let registro = null, recargando = false;
    const avisar = reg => { registro = reg; $('#actualizar').hidden = false; };
    navigator.serviceWorker.register('sw.js').then(reg => {
      if (reg.waiting && navigator.serviceWorker.controller) avisar(reg);
      reg.addEventListener('updatefound', () => {
        const nuevo = reg.installing;
        if (!nuevo) return;
        nuevo.addEventListener('statechange', () => {
          if (nuevo.state === 'installed' && navigator.serviceWorker.controller) avisar(reg);
        });
      });
      // Buscar versiones nuevas al volver a la app y cada hora
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
      setInterval(() => reg.update().catch(() => {}), 60 * 60000);
    }).catch(() => { /* sin service worker la app igual funciona con internet */ });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (recargando) return;
      recargando = true;
      location.reload();
    });
    $('#btn-actualizar').addEventListener('click', () => {
      $('#btn-actualizar').disabled = true;
      if (registro && registro.waiting) registro.waiting.postMessage('saltar');
      else location.reload();
    });
  }

  // ---------- Cómo instalarla ----------
  let pedido = null;   // evento del botón "Instalar" de Android/Chrome
  const COMPARTIR = '<svg class="ico-compartir" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v11M8 7.5l4-4 4 4M6.5 11H5.5v9h13v-9h-1"/></svg>';
  function pintarInstalar() {
    const yaEsta = instalada();
    const cajas = document.querySelectorAll('[data-instalar]');
    let html = '', mostrarEnLogin = false;
    if (!yaEsta && esIOS) {
      html = `<p>Para usarla como una app: en Safari tocá ${COMPARTIR} <b>Compartir</b> y después <b>Agregar a pantalla de inicio</b>.</p>`;
      mostrarEnLogin = true;
    } else if (!yaEsta && pedido) {
      html = '<button type="button" class="btn btn-ghost btn-block" data-btn-instalar>Instalar la app en este dispositivo</button>';
      mostrarEnLogin = true;
    } else if (!yaEsta) {
      html = '<p>Desde el menú del navegador elegí <b>Instalar app</b> o <b>Agregar a pantalla de inicio</b>.</p>';
    }
    cajas.forEach(c => {
      c.innerHTML = html;
      c.hidden = !html || (c.closest('#login') && !mostrarEnLogin);
    });
    $('#aj-instalar').hidden = !html;
    document.querySelectorAll('[data-btn-instalar]').forEach(b => b.addEventListener('click', async () => {
      if (!pedido) return;
      pedido.prompt();
      try { await pedido.userChoice; } catch (e) {}
      pedido = null;
      pintarInstalar();
    }));
  }
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); pedido = e; pintarInstalar(); });
  window.addEventListener('appinstalled', () => { pedido = null; pintarInstalar(); });
  pintarInstalar();
})();
