'use strict';
/* ARAC Partidos — recordatorio de los sábados y domingos a las 22:00 para cargar los partidos.

   - APK: el teléfono programa dos avisos semanales (plugin LocalNotifications), a la hora del
     teléfono y sin internet. Se activa solo al entrar (Android pide el permiso la primera vez)
     y se puede apagar en Ajustes.
   - Versión web: un navegador no puede programar avisos, así que los manda el servidor con
     Web Push (supabase/recordatorio.sql y supabase/functions/recordatorio). Se activa con un
     toque, desde Ajustes o desde el aviso de la lista. En iPhone sólo funciona con la app
     instalada en la pantalla de inicio.
   La elección se guarda en este teléfono. Al tocar el aviso se abre Cargar partido. */

(() => {
  const CLAVE = 'arac-recordatorio';             // 'si' | 'no'; sin valor: todavía no se eligió
  const IDS = [{ id: 7001 }, { id: 7002 }];      // sábado y domingo
  const TEXTO = '¿Dirigiste hoy? No te olvides de cargar los partidos de la jornada.';
  const Cap = window.Capacitor;
  const nativo = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const LN = nativo && Cap.Plugins ? Cap.Plugins.LocalNotifications : null;
  const VAPID = (window.ARAC_CONFIG || {}).vapidPublicKey;
  const ua = navigator.userAgent;
  const esIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const instalada = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

  const leer = () => { try { return localStorage.getItem(CLAVE); } catch (e) { return null; } };
  const guardar = v => { try { v == null ? localStorage.removeItem(CLAVE) : localStorage.setItem(CLAVE, v); } catch (e) {} };

  let sb = null, sesion = false, ocupado = false;
  // Service worker de la versión web: lo registra pwa.js (sólo con https o localhost)
  let registro = null;
  const conSW = !nativo && 'serviceWorker' in navigator &&
    (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  const listo = conSW ? navigator.serviceWorker.ready.then(r => { registro = r; pintar(); return r; }) : Promise.resolve(null);

  // ---------------- APK ----------------
  async function programarNativo(pedirPermiso) {
    let p = await LN.checkPermissions();
    if (pedirPermiso && p.display !== 'granted' && p.display !== 'denied') p = await LN.requestPermissions();
    if (p.display !== 'granted') throw new Error('permiso');
    try { await LN.cancel({ notifications: IDS }); } catch (e) {}
    const aviso = (id, weekday) => ({
      id, title: 'ARAC Partidos', body: TEXTO, smallIcon: 'ic_stat_arac',
      schedule: { on: { weekday, hour: 22, minute: 0 }, allowWhileIdle: true },
    });
    await LN.schedule({ notifications: [aviso(IDS[0].id, 7), aviso(IDS[1].id, 1)] });   // 7 = sábado, 1 = domingo
  }

  // ---------------- Versión web ----------------
  const pushPosible = () => !nativo && !!VAPID && 'PushManager' in window && 'Notification' in window && !!registro;
  const pideInstalar = () => !nativo && esIOS && !instalada();   // iPhone en Safari: hay que instalarla primero
  function bytesDe(b64) {
    const s = atob((b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(s, c => c.charCodeAt(0));
  }
  async function subir(sub) {
    const j = sub.toJSON();
    const { error } = await sb.rpc('guardar_suscripcion', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
    if (error) throw error;
  }
  async function activarWeb(permiso) {
    if (await permiso !== 'granted') throw new Error('permiso');
    const sub = (await registro.pushManager.getSubscription())
      || await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytesDe(VAPID) });
    await subir(sub);
  }
  async function desactivarWeb() {
    const sub = await registro.pushManager.getSubscription();
    if (!sub) return;
    try { await sb.rpc('borrar_suscripcion', { p_endpoint: sub.endpoint }); } catch (e) {}
    await sub.unsubscribe();
  }

  // ---------------- Activar / desactivar ----------------
  async function activar() {
    if (ocupado) return;
    // En iPhone el permiso hay que pedirlo apenas se toca el botón, antes de cualquier espera
    const permiso = nativo ? null : Notification.requestPermission();
    ocupado = true; pintar();
    try {
      if (nativo) await programarNativo(true); else await activarWeb(permiso);
      guardar('si');
      toast('Recordatorio activado: sábados y domingos a las 22:00');
    } catch (e) {
      if (e && e.message === 'permiso') {
        guardar('no');
        toast('Sin permiso para notificaciones: activalo en los ajustes del teléfono');
      } else {
        toast(navigator.onLine === false ? 'Sin conexión: probá de nuevo con internet' : 'No se pudo activar el recordatorio');
      }
    }
    ocupado = false; pintar();
  }
  async function desactivar() {
    if (ocupado) return;
    ocupado = true; pintar();
    try {
      if (nativo) await LN.cancel({ notifications: IDS }); else await desactivarWeb();
      guardar('no');
      toast('Recordatorio desactivado');
    } catch (e) { toast('No se pudo desactivar. Probá de nuevo.'); }
    ocupado = false; pintar();
  }

  // ---------------- Prueba (panel de administrador) ----------------
  // Manda ahora el aviso a este teléfono. Devuelve el texto para mostrar.
  async function probar() {
    if (nativo) {
      if (!LN) return 'Esta versión de la app no tiene notificaciones.';
      let p = await LN.checkPermissions();
      if (p.display !== 'granted') p = await LN.requestPermissions();
      if (p.display !== 'granted') return 'Sin permiso para notificaciones: activalo en los ajustes del teléfono.';
      await LN.schedule({ notifications: [{
        id: 7099, title: 'ARAC Partidos', body: 'Notificación de prueba · ' + TEXTO, smallIcon: 'ic_stat_arac',
        schedule: { at: new Date(Date.now() + 5000), allowWhileIdle: true },
      }] });
      return 'Llega en 5 segundos (podés salir de la app para verla).';
    }
    if (pideInstalar()) return 'En iPhone, primero instalá la app: Compartir › Agregar a pantalla de inicio.';
    if (!pushPosible()) return 'Este navegador no puede recibir notificaciones.';
    const sub = Notification.permission === 'granted' ? await registro.pushManager.getSubscription() : null;
    if (!sub) return 'Primero activá el recordatorio en este teléfono (Ajustes › Recordatorio).';
    await subir(sub);
    const { data, error } = await sb.functions.invoke('recordatorio', { body: { prueba: true } });
    if (error) throw new Error('¿Está desplegada la función "recordatorio" con sus secretos?');
    return data && data.enviados
      ? 'Enviada: llega en unos segundos.'
      : 'El servidor no encontró este teléfono. Desactivá y volvé a activar el recordatorio.';
  }
  // Aviso del administrador a todos ('version' o 'recordatorio'): la versión web lo recibe al
  // instante; todos (también el APK) lo ven en un cartel al abrir la app (ver revisarAvisos).
  async function enviarATodos(tipo) {
    const { data, error } = await sb.functions.invoke('recordatorio', { body: { tipo } });
    if (error) throw new Error('¿Está desplegada la versión nueva de la función "recordatorio"?');
    const n = (data && data.enviados) || 0;
    return `Enviado. ${n ? `Llegó al instante a ${n === 1 ? '1 teléfono' : n + ' teléfonos'} con la versión web; ` : ''}` +
      'todos lo ven al abrir la app.';
  }
  window.Recordatorio = { probar, enviarATodos };

  // ---------------- Avisos del administrador (cartel al abrir la app) ----------------
  const CLAVE_VISTO = 'arac-aviso-visto';        // id del último aviso visto en este teléfono
  const AVISO_VIGENTE = 7 * 86400000;            // uno más viejo ya no se muestra
  const URL_APK = 'https://github.com/matumir/Digitalizaci-n-ARAC/releases/latest';
  const leerVisto = () => { try { return localStorage.getItem(CLAVE_VISTO); } catch (e) { return null; } };
  const guardarVisto = id => { try { localStorage.setItem(CLAVE_VISTO, String(id)); } catch (e) {} };
  let revisando = false;

  async function revisarAvisos() {
    if (!sb || !sesion || revisando || navigator.onLine === false) return;
    revisando = true;
    try {
      const visto = leerVisto();
      if (visto == null) {
        // Primera vez en este teléfono: los avisos viejos no se muestran
        const { data } = await sb.from('avisos').select('id').order('id', { ascending: false }).limit(1);
        if (data) guardarVisto(data.length ? data[0].id : 0);
        return;
      }
      const { data, error } = await sb.from('avisos').select('id, tipo, titulo, cuerpo, creado')
        .gt('id', Number(visto)).order('id', { ascending: false }).limit(10);
      if (error || !data || !data.length) return;
      const ultimo = data[0];
      if (Date.now() - Date.parse(ultimo.creado) > AVISO_VIGENTE) { guardarVisto(ultimo.id); return; }
      mostrarAviso(ultimo);
    } catch (e) { /* sin internet o falta correr admin.sql: se revisa la próxima vez */ }
    finally { revisando = false; }
  }

  async function actualizarApp() {
    if (nativo) { try { await Cap.Plugins.Browser.open({ url: URL_APK }); } catch (e) { window.open(URL_APK, '_blank'); } return; }
    // Versión web: el aviso de pwa.js ("Hay una versión nueva · Actualizar") hace el cambio
    const boton = $('#btn-actualizar');
    if (!$('#actualizar').hidden) { boton.click(); return; }
    toast('Buscando la versión nueva…');
    try { if (registro) await registro.update(); } catch (e) {}
    setTimeout(() => { if (!$('#actualizar').hidden) boton.click(); else toast('Ya tenés la versión más nueva'); }, 2000);
  }

  function mostrarAviso(a) {
    const caja = $('#aviso-admin');
    const cerrar = () => { guardarVisto(a.id); caja.hidden = true; };
    const version = a.tipo === 'version';
    $('#aviso-admin-texto').replaceChildren(el('b', {}, a.titulo), a.cuerpo);
    const botones = $('#aviso-admin-botones');
    botones.replaceChildren(
      el('button', { type: 'button', class: 'btn btn-ghost', onclick: cerrar }, version ? 'Ahora no' : 'Cerrar'),
      el('button', { type: 'button', class: 'btn btn-primary', onclick: () => { cerrar(); version ? actualizarApp() : mostrarVista('cargar'); } },
        version ? (nativo ? 'Descargar' : 'Actualizar') : 'Cargar partido'));
    caja.hidden = false;
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') revisarAvisos(); });
  setInterval(() => { if (document.visibilityState === 'visible') revisarAvisos(); }, 5 * 60000);

  // ---------------- Pantalla ----------------
  const $ = s => document.querySelector(s);
  function pintar() {
    const posible = nativo ? !!LN : (pushPosible() || pideInstalar());
    $('#aj-recordatorio').hidden = !(sesion && posible);
    const bloqueado = !nativo && 'Notification' in window && Notification.permission === 'denied';
    const activo = leer() === 'si' && !bloqueado;
    $('#aj-rec-estado').textContent = bloqueado ? 'Bloqueado en el navegador' : activo ? 'Activado' : 'Desactivado';
    const btn = $('#btn-recordatorio');
    btn.textContent = activo ? 'Desactivar' : 'Activar';
    btn.disabled = ocupado || bloqueado || pideInstalar();
    $('#aj-rec-ayuda').textContent = pideInstalar()
      ? 'Para recibirlo en iPhone, primero instalá la app: Compartir › Agregar a pantalla de inicio.'
      : bloqueado ? 'Las notificaciones están bloqueadas: habilitalas para esta app en los ajustes del teléfono.'
      : 'Los sábados y domingos a las 22:00 te avisa para que cargues los partidos de la jornada.';
    // Invitación en la lista (sólo versión web, una vez: hasta que elija sí o no)
    $('#aviso-recordatorio').hidden = !(sesion && !nativo && pushPosible() && leer() == null && !bloqueado);
  }
  $('#btn-recordatorio').addEventListener('click', () => (leer() === 'si' ? desactivar() : activar()));
  $('#aviso-rec-si').addEventListener('click', activar);
  $('#aviso-rec-no').addEventListener('click', () => { guardar('no'); pintar(); toast('Lo podés activar cuando quieras en Ajustes'); });

  // Al tocar el aviso: abrir Cargar partido
  function abrirCargar() {
    if (cuentaActual) mostrarVista('cargar');
    else history.replaceState(history.state, '', '#cargar');   // lo abre app.js al entrar
  }
  if (LN) LN.addListener('localNotificationActionPerformed', abrirCargar);
  if (conSW) navigator.serviceWorker.addEventListener('message', e => { if (e.data === 'abrir-cargar') abrirCargar(); });

  // ---------------- Sesión ----------------
  window.addEventListener('arac:sesion', async e => {
    sb = e.detail.cliente; sesion = true;
    pintar();
    try {
      if (nativo && LN) {
        // Se activa solo: la primera vez pide el permiso; después sólo lo vuelve a programar
        if (leer() !== 'no') {
          try { await programarNativo(leer() == null); guardar('si'); } catch (err) { if (leer() == null) guardar('no'); }
        }
      } else if (leer() === 'si' && await listo && pushPosible()) {
        const sub = Notification.permission === 'granted' ? await registro.pushManager.getSubscription() : null;
        if (sub) await subir(sub);                // la deja a nombre de esta cuenta
        else guardar(null);                       // se perdió (permiso quitado): vuelve a ofrecerlo
      }
    } catch (err) { /* sin internet: queda como estaba */ }
    pintar();
    revisarAvisos();
  });
  window.addEventListener('arac:fin-sesion', () => { sesion = false; sb = null; pintar(); $('#aviso-admin').hidden = true; });
  window.addEventListener('online', revisarAvisos);
})();
