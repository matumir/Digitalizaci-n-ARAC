'use strict';
/* ARAC Partidos — sincronización con Supabase (tablas de supabase/sync.sql).

   El teléfono es la fuente principal: todo se guarda primero acá y la app funciona sin
   internet. Cuando hay conexión:
     1. sube lo pendiente (partidos, fotos y borrados hechos en este teléfono);
     2. baja lo que cambió en la nube desde la última vez (cambios de otros teléfonos).
   Si el mismo partido se editó en dos teléfonos, gana el cambio más nuevo.
   Las fotos se borran de la nube a los 15 días: en los teléfonos que ya las tienen quedan. */

const Sync = (() => {
  const BUCKET = 'fotos';
  const DIAS_NUBE = 15;
  const LOTE = 500;
  let sb = null, uid = null;
  let corriendo = false, otraVez = false, tPronto = null, tPeriodico = null;
  const estado = { fase: 'inactivo', ultimo: null, pendientes: 0, error: '' };

  function emitir(cambios) {
    window.dispatchEvent(new CustomEvent('arac:sync-estado', { detail: Object.assign({}, estado) }));
    if (cambios) window.dispatchEvent(new Event('arac:sync-cambios'));
  }
  const datosDe = p => { const d = Object.assign({}, p); delete d.id; delete d.mod; delete d.sucio; return d; };
  const rutaDe = f => `${uid}/${f.partido}/${f.id}.jpg`;
  const comprobar = r => { if (r && r.error) throw r.error; return r; };

  async function contarPendientes() {
    try {
      const p = await DB.pendientes();
      estado.pendientes = p.partidos.length + p.fotos.length + p.borrados.length;
    } catch (e) { /* sin sesión */ }
  }

  // 1. Subir lo hecho en este teléfono
  async function subir() {
    const { partidos, fotos, borrados } = await DB.pendientes();
    if (partidos.length) {
      comprobar(await sb.from('partidos').upsert(
        partidos.map(p => ({ user_id: uid, id: p.id, datos: datosDe(p), mod: p.mod, borrado: false })),
        { onConflict: 'user_id,id' }));
      for (const p of partidos) await DB.marcarSubido('partido', p.id, p.mod);
    }
    for (const f of fotos) {
      comprobar(await sb.storage.from(BUCKET).upload(rutaDe(f), f.blob, { upsert: true, contentType: 'image/jpeg' }));
      comprobar(await sb.from('fotos').upsert(
        { user_id: uid, id: f.id, partido: f.partido, orden: f.orden || 0, ruta: rutaDe(f), mod: f.mod, borrado: false },
        { onConflict: 'user_id,id' }));
      await DB.marcarSubido('foto', f.id, f.mod);
    }
    const bPartidos = borrados.filter(b => b.tipo === 'partido');
    if (bPartidos.length) {
      comprobar(await sb.from('partidos').upsert(
        bPartidos.map(b => ({ user_id: uid, id: b.id, datos: null, mod: b.mod, borrado: true })),
        { onConflict: 'user_id,id' }));
    }
    const bFotos = borrados.filter(b => b.tipo === 'foto');
    if (bFotos.length) {
      // El archivo se borra de la nube enseguida (si ya no estaba, no importa)
      await sb.storage.from(BUCKET).remove(bFotos.map(rutaDe));
      comprobar(await sb.from('fotos').upsert(
        bFotos.map(b => ({ user_id: uid, id: b.id, partido: b.partido, orden: b.orden || 0, ruta: rutaDe(b), mod: b.mod, borrado: true })),
        { onConflict: 'user_id,id' }));
    }
    for (const b of borrados) await DB.marcarSubido('borrado', b.clave, b.mod);
  }

  // Trae las filas cambiadas después de 'desde', de a lotes
  async function cambiosDe(tabla, columnas, desde) {
    const filas = [];
    let cursor = desde;
    for (;;) {
      const { data, error } = await sb.from(tabla).select(columnas).gt('actualizado', cursor).order('actualizado').limit(LOTE);
      if (error) throw error;
      filas.push(...data);
      if (data.length < LOTE) return filas;
      cursor = data[data.length - 1].actualizado;
    }
  }

  // 2. Bajar lo que cambió en la nube
  async function bajar() {
    const ultimo = (await DB.meta('ultimaBajada')) || '1970-01-01T00:00:00Z';
    // Un minuto de solapamiento por si una fila se guardó con una hora apenas anterior
    const desde = new Date(Date.parse(ultimo) - 60000).toISOString();
    let cambios = false, max = ultimo;
    const nota = r => { if (Date.parse(r.actualizado) > Date.parse(max)) max = r.actualizado; };

    for (const r of await cambiosDe('partidos', 'id,datos,mod,borrado,actualizado', desde)) {
      if (await DB.aplicarPartido(r)) cambios = true;
      nota(r);
    }
    for (const r of await cambiosDe('fotos', 'id,partido,orden,ruta,mod,borrado,subida,actualizado', desde)) {
      let blob = null;
      if (!r.borrado) {
        const local = await DB.foto(r.id);
        const vencida = Date.now() - Date.parse(r.subida) > DIAS_NUBE * 86400000;
        if (!(local && local.blob) && !vencida) {
          const res = await sb.storage.from(BUCKET).download(r.ruta);
          if (!res.error && res.data) blob = res.data;     // si ya no está, queda como "sólo en otro teléfono"
        }
      }
      if (await DB.aplicarFoto(r, blob)) cambios = true;
      nota(r);
    }
    await DB.ponerMeta('ultimaBajada', max);
    return cambios;
  }

  async function ahora() {
    if (!sb || !uid) return;
    if (corriendo) { otraVez = true; return; }
    corriendo = true;
    const mio = uid;
    estado.fase = 'sincronizando'; estado.error = '';
    emitir();
    let cambios = false;
    try {
      await subir();
      cambios = await bajar();
      if (mio !== uid) return;                         // cerró sesión en el medio
      estado.fase = 'ok';
      estado.ultimo = Date.now();
    } catch (e) {
      if (mio !== uid) return;
      estado.fase = navigator.onLine === false ? 'sin-conexion' : 'error';
      estado.error = (e && (e.message || e.error_description)) || String(e);
    } finally {
      corriendo = false;
      await contarPendientes();
      if (mio === uid) emitir(cambios);
      if (otraVez) { otraVez = false; ahora(); }
    }
  }

  // Después de un cambio en el teléfono, espera un momento por si vienen más
  function pronto() {
    clearTimeout(tPronto);
    contarPendientes().then(() => emitir());
    tPronto = setTimeout(ahora, 1500);
  }

  function iniciar(cliente, id) {
    sb = cliente; uid = id;
    estado.fase = 'inactivo'; estado.ultimo = null; estado.error = '';
    clearInterval(tPeriodico);
    tPeriodico = setInterval(() => { if (document.visibilityState === 'visible') ahora(); }, 5 * 60000);
    ahora();
  }
  function detener() {
    sb = null; uid = null;
    clearTimeout(tPronto); clearInterval(tPeriodico);
    estado.fase = 'inactivo'; estado.pendientes = 0;
    emitir();
  }

  window.addEventListener('arac:cambio-local', () => { if (sb) pronto(); });
  window.addEventListener('online', () => ahora());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') ahora(); });

  return { iniciar, detener, ahora, estado: () => Object.assign({}, estado) };
})();
