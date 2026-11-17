'use strict';
/* ARAC Partidos — aviso de versión nueva (como en Mis Gastos).

   La versión publicada es www/version.json en GitHub (rama main): para anunciar una versión
   nueva se sube el número y se escribe la nota (ver LEEME.md). La app compara ese archivo con
   su propia copia de version.json (la que vino en el APK o la que guardó la versión web) y,
   si la publicada es más nueva:
   - al entrar a la app muestra un cartel con la nota y Descargar (APK) o Actualizar (web);
     si se cierra, vuelve a aparecer al día siguiente, hasta que se actualice;
   - manda una notificación, una vez por versión. En el APK la programa el teléfono al revisar
     (al abrir la app o volver a ella). En la versión web la manda el servidor apenas se publica
     el APK nuevo (.github/workflows/apk.yml → función "recordatorio"), aunque la app esté cerrada.
   En el APK el aviso espera a que el APK nuevo esté en Releases (tarda unos minutos más que
   version.json). Sin internet no hace nada: revisa la próxima vez. */

(() => {
  const REPO = 'matumir/Digitalizaci-n-ARAC';
  const URL_VERSION = `https://raw.githubusercontent.com/${REPO}/main/www/version.json`;
  const URL_RELEASE = `https://api.github.com/repos/${REPO}/releases/latest`;
  const URL_APK = `https://github.com/${REPO}/releases/latest/download/arac-partidos.apk`;
  const ID_NOTIF = 7100;                          // recordatorio.js no abre Cargar con este aviso
  const CLAVE_NOTIF = 'arac-version-notificada';  // última versión avisada con notificación
  const CLAVE_LUEGO = 'arac-version-luego';       // { version, hasta }: tocó "Más tarde"
  const ESPERA_LUEGO = 20 * 3600000;
  const ENTRE_REVISIONES = 30 * 60000;

  const Cap = window.Capacitor;
  const nativo = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const P = (Cap && Cap.Plugins) || {};
  const LN = nativo ? P.LocalNotifications : null;
  const $ = s => document.querySelector(s);

  const leer = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const guardar = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };

  // "1.10" es más nueva que "1.9": se comparan como números, no como texto
  function versionMayor(a, b) {
    const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    }
    return false;
  }
  async function leerJSON(url) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      return r.ok ? await r.json() : null;
    } catch (e) { return null; }
  }

  let mia = null;          // versión instalada
  let nueva = null;        // { version, nota } si hay una más nueva lista para instalar
  let sesion = false, revisando = false, ultimaRevision = 0;
  const instalada = leerJSON('version.json').then(v => { mia = v && v.version ? String(v.version) : null; pintarAjustes(); return mia; });

  // APK: true si el APK de Releases es más nuevo que el instalado; null si no se pudo saber
  async function apkPublicado() {
    const rel = await leerJSON(URL_RELEASE);
    const n = rel && /^build-(\d+)$/.exec(rel.tag_name || '');
    if (!n) return null;
    try { return Number(n[1]) > Number((await P.App.getInfo()).build); } catch (e) { return null; }
  }

  // mostrar: 'si' | 'auto' (respeta "Más tarde") | 'no'. aMano: lo pidió la persona desde Ajustes.
  async function revisar({ mostrar = 'auto', aMano = false } = {}) {
    if (revisando || (!aMano && navigator.onLine === false)) return;
    if (!aMano && mostrar === 'auto' && Date.now() - ultimaRevision < ENTRE_REVISIONES) { if (nueva) ofrecer(nueva, mostrar); return; }
    revisando = true; pintarAjustes();
    try {
      const [local, pub] = await Promise.all([instalada, leerJSON(URL_VERSION + '?t=' + Date.now())]);
      if (!local || !pub || !pub.version) { if (aMano) toast('No se pudo revisar. ¿Tenés internet?'); return; }
      ultimaRevision = Date.now();
      let lista = versionMayor(pub.version, local);
      if (lista && nativo) {
        const ok = await apkPublicado();
        if (ok == null) { if (aMano) toast('No se pudo revisar. Probá de nuevo en un rato.'); return; }
        lista = ok;
      }
      if (!lista) {
        nueva = null;
        if (aMano) toast(versionMayor(pub.version, local) ? 'La versión nueva se está publicando: probá en unos minutos' : `Ya tenés la versión más nueva (${local})`);
        return;
      }
      nueva = { version: String(pub.version), nota: pub.nota || '' };
      notificar(nueva);
      ofrecer(nueva, aMano ? 'si' : mostrar);
    } finally { revisando = false; pintarAjustes(); }
  }

  // Notificación del teléfono (APK), una vez por versión. Sin permiso no la pide: queda el cartel.
  async function notificar(v) {
    if (!LN || leer(CLAVE_NOTIF) === v.version) return;
    try {
      if ((await LN.checkPermissions()).display !== 'granted') return;
      await LN.schedule({ notifications: [{
        id: ID_NOTIF, title: `Versión ${v.version} de ARAC Partidos`, smallIcon: 'ic_stat_arac',
        body: (v.nota ? v.nota + ' ' : '') + 'Tocá para descargarla.',
        schedule: { at: new Date(Date.now() + 1500), allowWhileIdle: true },
      }] });
      guardar(CLAVE_NOTIF, v.version);
    } catch (e) { /* sin notificaciones: queda el cartel */ }
  }

  // ---------------- Cartel ----------------
  let abierto = false;
  function luegoVigente(v) {
    try { const l = JSON.parse(leer(CLAVE_LUEGO) || 'null'); return !!l && l.version === v.version && Date.now() < l.hasta; } catch (e) { return false; }
  }
  function ofrecer(v, mostrar) {
    if (mostrar === 'no' || abierto || !sesion) return;
    if (mostrar === 'auto' && luegoVigente(v)) return;
    if (pila.length) return;                    // hay otra pantalla abierta: se ofrece la próxima vez
    $('#ver-titulo').textContent = 'Hay una versión nueva';
    $('#ver-numeros').textContent = `Versión ${v.version}${mia ? ' · tenés la ' + mia : ''}`;
    $('#ver-nota').textContent = v.nota;
    $('#ver-ayuda').textContent = nativo
      ? 'Se baja el APK: abrilo e instalalo encima de esta. Tus partidos no se pierden.'
      : 'La app se recarga con la versión nueva. Tus partidos no se pierden.';
    $('#ver-ok').textContent = nativo ? 'Descargar' : 'Actualizar';
    $('#ver-ok').disabled = false;
    abierto = true;
    // Al cerrarlo (Más tarde, la cruz, el fondo o Atrás) no vuelve a aparecer solo hasta mañana
    abrirCapa('#h-version', () => { abierto = false; posponer(); });
  }
  function posponer() {
    if (nueva) guardar(CLAVE_LUEGO, JSON.stringify({ version: nueva.version, hasta: Date.now() + ESPERA_LUEGO }));
  }
  $('#ver-luego').addEventListener('click', cerrarCapa);
  $('#ver-ok').addEventListener('click', async () => {
    if (nativo) {
      cerrarCapa();
      try { await P.Browser.open({ url: URL_APK }); } catch (e) { window.open(URL_APK, '_blank'); }
      return;
    }
    $('#ver-ok').disabled = true;
    $('#ver-ok').textContent = 'Actualizando…';
    if (!(await actualizarWeb())) {
      $('#ver-ok').disabled = false;
      $('#ver-ok').textContent = 'Actualizar';
      toast('La versión nueva se está publicando: probá en unos minutos');
    }
  });

  // Versión web: pasa al service worker nuevo; pwa.js recarga la app cuando toma el control.
  async function actualizarWeb() {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (!reg) { location.reload(); return true; }
    try { await reg.update(); } catch (e) {}
    let w = reg.waiting;
    if (!w && reg.installing) {
      const sw = reg.installing;
      w = await new Promise(ok => {
        const t = setTimeout(() => ok(null), 30000);
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed') { clearTimeout(t); ok(sw); }
          else if (sw.state === 'redundant') { clearTimeout(t); ok(null); }
        });
      });
    }
    if (!w) return false;
    w.postMessage('saltar');
    return true;
  }

  // ---------------- Ajustes ----------------
  function pintarAjustes() {
    $('#aj-ver-texto').textContent = mia ? 'Versión ' + mia : 'Versión —';
    $('#aj-ver-detalle').textContent = nueva ? ` · está la ${nueva.version}` : '';
    const b = $('#btn-ver-buscar');
    b.textContent = revisando ? 'Buscando…' : nueva ? (nativo ? 'Descargar' : 'Actualizar') : 'Buscar';
    b.disabled = revisando;
  }
  $('#btn-ver-buscar').addEventListener('click', () => {
    if (!nueva) { revisar({ aMano: true }); return; }
    cerrarCapa();                                  // cierra Ajustes y abre el cartel
    setTimeout(() => ofrecer(nueva, 'si'), DUR_SALIDA + 30);
  });

  // ---------------- Cuándo se revisa ----------------
  if (LN) LN.addListener('localNotificationActionPerformed', e => {
    if (e && e.notification && e.notification.id === ID_NOTIF) setTimeout(() => revisar({ mostrar: 'si' }), 600);
  });
  window.addEventListener('arac:sesion', () => { sesion = true; setTimeout(() => revisar(), 1500); });
  window.addEventListener('arac:fin-sesion', () => { sesion = false; abierto = false; });   // app.js cierra las capas
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && sesion) revisar(); });
  window.addEventListener('online', () => { if (sesion) revisar(); });
  setInterval(() => { if (document.visibilityState === 'visible' && sesion) revisar(); }, ENTRE_REVISIONES);

  // recordatorio.js: aviso de versión del administrador → revisar ya y mostrar si hay una nueva
  window.Actualizaciones = { revisar: () => revisar({ mostrar: 'si' }) };
})();
