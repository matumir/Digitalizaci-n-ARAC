'use strict';
/* ARAC Partidos — inicio de sesión con Google (Supabase) y whitelist de cuentas.

   Cómo funciona:
   - En el APK, Google no deja iniciar sesión dentro de un WebView, así que se abre
     el navegador del sistema y Google vuelve a la app por com.arac.partidos://login.
   - Después de entrar se pregunta al servidor si el mail está en la whitelist
     (función es_autorizado de supabase/setup.sql). Además el servidor no deja ni
     crear la cuenta a un mail que no está en la lista.
   - La app funciona sin internet: si la cuenta ya fue autorizada en este teléfono,
     entra directo y vuelve a confirmar con el servidor cuando hay conexión. */

(() => {
  const CFG = window.ARAC_CONFIG || {};
  const REDIRECT_NATIVO = 'com.arac.partidos://login';
  const CLAVE_OK = 'arac-autorizado';        // mail ya autorizado en este teléfono
  const Cap = window.Capacitor;
  const nativo = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const P = (Cap && Cap.Plugins) || {};

  const $ = s => document.querySelector(s);
  const login = $('#login');
  const msg = $('#login-msg');
  const btn = $('#btn-google');

  const leer = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const guardar = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };

  let tSalida;
  function mostrarLogin(texto = '', esError = false) {
    clearTimeout(tSalida);                            // por si estaba terminando de ocultarse
    document.body.classList.add('sin-sesion');
    login.hidden = false;
    login.classList.remove('se-va');
    msg.textContent = texto;
    msg.classList.toggle('error', esError);
    btn.disabled = false;
    $('#aj-cuenta').hidden = true;
  }
  function entrar(email) {
    $('#aj-mail').textContent = email;
    $('#aj-cuenta').hidden = false;
    if (login.hidden) return;
    login.classList.add('se-va');
    tSalida = setTimeout(() => { login.hidden = true; login.classList.remove('se-va'); document.body.classList.remove('sin-sesion'); }, 260);
  }

  if (!CFG.supabaseUrl || !CFG.supabaseAnonKey || !window.supabase) {
    mostrarLogin('Falta configurar Supabase en www/config.js.', true);
    btn.disabled = true;
    return;
  }

  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: !nativo },
  });

  // true / false según la whitelist; null si no se pudo preguntar (sin internet).
  async function consultarWhitelist() {
    try {
      const { data, error } = await sb.rpc('es_autorizado');
      if (error) return null;
      return data === true;
    } catch (e) { return null; }
  }

  async function rechazar(email) {
    guardar(CLAVE_OK, null);
    try { await sb.auth.signOut({ scope: 'local' }); } catch (e) {}
    mostrarLogin(`La cuenta ${email || ''} no está autorizada. Pedile a la ARAC que la agregue.`, true);
  }

  // Decide qué hacer con la sesión guardada (o recién obtenida).
  async function revisar(session) {
    if (!session) { mostrarLogin(); return; }
    const email = (session.user && session.user.email || '').toLowerCase();
    if (leer(CLAVE_OK) === email) {
      entrar(email);                                  // ya autorizado acá: entra sin esperar a la red
      const ok = await consultarWhitelist();          // y confirma en segundo plano
      if (ok === false) rechazar(email);
      return;
    }
    mostrarLogin('Verificando la cuenta…');
    btn.disabled = true;
    const ok = await consultarWhitelist();
    if (ok === true) { guardar(CLAVE_OK, email); entrar(email); }
    else if (ok === false) rechazar(email);
    else mostrarLogin('Sin conexión. La primera vez hace falta internet para verificar la cuenta.', true);
  }

  // Mensaje legible para los errores que devuelve Supabase/Google en la vuelta.
  function textoError(desc) {
    if (/database error|no autorizada|not authorized/i.test(desc || '')) return 'Esta cuenta no está autorizada. Pedile a la ARAC que la agregue.';
    return 'No se pudo iniciar sesión. Probá de nuevo.';
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    msg.classList.remove('error');
    msg.textContent = 'Abriendo Google…';
    try {
      const { data, error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: nativo ? REDIRECT_NATIVO : location.origin + location.pathname,
          skipBrowserRedirect: nativo,
          queryParams: { prompt: 'select_account' },
        },
      });
      if (error) throw error;
      if (nativo) await P.Browser.open({ url: data.url, presentationStyle: 'popover' });
    } catch (e) {
      mostrarLogin('No se pudo abrir Google. Revisá la conexión.', true);
    }
  });

  // APK: Google vuelve por com.arac.partidos://login?code=…
  if (nativo && P.App) {
    P.App.addListener('appUrlOpen', async ({ url }) => {
      if (!url || !url.startsWith(REDIRECT_NATIVO)) return;
      try { await P.Browser.close(); } catch (e) {}
      const u = new URL(url.replace(REDIRECT_NATIVO, 'https://x/login'));
      const params = new URLSearchParams(u.search + '&' + u.hash.slice(1));
      const code = params.get('code');
      if (!code) { mostrarLogin(textoError(params.get('error_description')), true); return; }
      mostrarLogin('Ingresando…');
      btn.disabled = true;
      const { data, error } = await sb.auth.exchangeCodeForSession(code);
      if (error) { mostrarLogin(textoError(error.message), true); return; }
      revisar(data.session);
    });
    // Si la persona cierra el navegador sin elegir cuenta
    if (P.Browser) P.Browser.addListener('browserFinished', () => { if (!login.hidden && btn.disabled && /Abriendo/.test(msg.textContent)) mostrarLogin(); });
  }

  $('#btn-salir').addEventListener('click', async () => {
    guardar(CLAVE_OK, null);
    try { await sb.auth.signOut({ scope: 'local' }); } catch (e) {}
    history.back();                                   // cierra Ajustes
    mostrarLogin('Sesión cerrada.');
  });

  // Inicio
  (async () => {
    // Navegador: si Google volvió con un error en la URL, mostrarlo y limpiar la URL
    const q = new URLSearchParams(location.search + '&' + location.hash.slice(1));
    const errUrl = q.get('error_description');
    const { data } = await sb.auth.getSession();
    if (!nativo && (q.has('code') || errUrl)) history.replaceState(null, '', location.pathname);
    if (!data.session && errUrl) { mostrarLogin(textoError(errUrl), true); return; }
    revisar(data.session);
  })();

  // Volver a confirmar al recuperar conexión
  window.addEventListener('online', async () => {
    const { data } = await sb.auth.getSession();
    if (data.session && !login.hidden) return;
    if (data.session && (await consultarWhitelist()) === false) rechazar(data.session.user.email);
  });
})();
