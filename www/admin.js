'use strict';
/* ARAC Partidos — panel de administrador (tablas y permisos en supabase/admin.sql).

   Sólo aparece para las cuentas marcadas como admin en la whitelist. Muestra todos los
   árbitros, los partidos de cada uno y el detalle completo de cada partido, en sólo lectura.
   Se lee directo de la nube (necesita internet): no se guarda nada en este teléfono. */

const ADM = { sb: null, es: false, arbitros: null, actual: null, detalle: null, partidos: [], fotos: {}, liga: null, cat: 'todas', buscar: '' };
const ADM_LOTE = 1000;
const ADM_DIAS_NUBE = 15;

const nombreArbitro = a => a.nombre || a.email;
const inicialesDe = a => nombreArbitro(a).replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const sinTildes = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// "hace 3 h" hasta una semana; después, la fecha
function cuandoFue(ts) {
  if (!ts) return '';
  const ms = Date.parse(ts);
  if (Date.now() - ms < 7 * 86400000) return haceCuanto(ms);
  const d = new Date(ms);
  return 'el ' + fechaCorta(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
}

// Trae todas las filas de una consulta, de a lotes (la API devuelve hasta 1000 por vez)
async function admTodas(consulta) {
  const filas = [];
  for (let desde = 0; ; desde += ADM_LOTE) {
    const { data, error } = await consulta().range(desde, desde + ADM_LOTE - 1);
    if (error) throw error;
    filas.push(...data);
    if (data.length < ADM_LOTE) return filas;
  }
}

function admAviso(cont, texto, reintentar) {
  cont.innerHTML = '';
  cont.append(el('div', { class: 'vacio' },
    el('p', {}, texto),
    reintentar ? el('button', { type: 'button', class: 'btn btn-primary', onclick: reintentar }, 'Reintentar') : null));
}
const textoFallo = e => (navigator.onLine === false
  ? 'Sin conexión: el panel necesita internet.'
  : `No se pudo cargar. ${(e && e.message) || ''}`.trim());

// ---------------- ¿Es administrador? ----------------
async function revisarAdmin() {
  if (!ADM.sb) return;
  try {
    const { data, error } = await ADM.sb.rpc('es_admin');
    if (error) return;                               // sin internet o falta correr admin.sql: queda como estaba
    ADM.es = data === true;
  } catch (e) { return; }
  $('#nav-admin').hidden = !ADM.es;
  if (!ADM.es && vistaActual === 'admin') mostrarVista('partidos');
}
window.addEventListener('arac:sesion', e => {
  if (ADM.sb === e.detail.cliente && ADM.es) return;
  ADM.sb = e.detail.cliente;
  revisarAdmin();
});
window.addEventListener('arac:fin-sesion', () => {
  Object.assign(ADM, { sb: null, es: false, arbitros: null, actual: null, partidos: [], fotos: {} });
  $('#nav-admin').hidden = true;
  $('#adm-lista').innerHTML = ''; $('#adm-resumen').innerHTML = '';
});
window.addEventListener('online', () => { if (ADM.sb && !ADM.es) revisarAdmin(); });

// ---------------- Lista de árbitros ----------------
async function renderAdmin() {
  if (!ADM.es) return;
  const lista = $('#adm-lista');
  if (!ADM.arbitros) {
    $('#adm-resumen').innerHTML = '';
    lista.innerHTML = '';
    lista.append(el('p', { class: 'adm-cargando' }, 'Cargando árbitros…'));
    try {
      const { data, error } = await ADM.sb.rpc('admin_arbitros');
      if (error) throw error;
      ADM.arbitros = (data || []).sort((a, b) => sinTildes(nombreArbitro(a)).localeCompare(sinTildes(nombreArbitro(b))));
    } catch (e) {
      admAviso(lista, textoFallo(e), renderAdmin);
      return;
    }
  }
  pintarArbitros();
}

function pintarArbitros() {
  const todos = ADM.arbitros || [];
  const total = todos.reduce((s, a) => s + Number(a.partidos || 0), 0);
  const resumen = $('#adm-resumen'); resumen.innerHTML = '';
  const iBuscar = el('input', { type: 'search', class: 'buscar', placeholder: 'Buscar por nombre o mail' });
  iBuscar.value = ADM.buscar;
  iBuscar.addEventListener('input', () => { ADM.buscar = iBuscar.value; pintarFilas(); });
  resumen.append(
    el('div', { class: 'adm-resumen' },
      el('div', {}, el('b', {}, plural(todos.length, 'árbitro', 'árbitros')), el('span', {}, plural(total, 'partido cargado', 'partidos cargados'))),
      el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { ADM.arbitros = null; renderAdmin(); } }, 'Actualizar')),
    el('div', { class: 'adm-buscar' }, icono('<svg class="buscar-ico" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>'), iBuscar));
  pintarFilas();
}

function pintarFilas() {
  const lista = $('#adm-lista'); lista.innerHTML = '';
  const q = sinTildes(ADM.buscar.trim());
  const filtrados = (ADM.arbitros || []).filter(a => !q || sinTildes(nombreArbitro(a)).includes(q) || sinTildes(a.email).includes(q));
  if (!filtrados.length) {
    admAviso(lista, ADM.arbitros && ADM.arbitros.length ? 'Ningún árbitro coincide con la búsqueda.' : 'Todavía no hay árbitros en la whitelist.');
    return;
  }
  filtrados.forEach(a => {
    const n = Number(a.partidos || 0);
    const estado = !a.user_id ? 'Todavía no inició sesión'
      : n ? `Último cambio ${cuandoFue(a.ultimo)}` : 'Sin partidos cargados';
    lista.append(el('button', { type: 'button', class: 'arbitro' + (a.user_id ? '' : ' sin-ingreso'), onclick: () => {
      if (!a.user_id) { toast('Todavía no inició sesión en la app'); return; }
      abrirArbitro(a);
    } },
      el('span', { class: 'arbitro-avatar' }, inicialesDe(a) || '?'),
      el('span', { class: 'arbitro-txt' },
        el('b', {}, nombreArbitro(a)),
        a.nombre ? el('span', {}, a.email) : null,
        el('span', { class: 'arbitro-estado' }, estado,
          a.admin ? el('em', { class: 'etiqueta' }, 'Admin') : null,
          a.autorizado ? null : el('em', { class: 'etiqueta mal' }, 'Fuera de la whitelist'))),
      el('span', { class: 'arbitro-num' }, el('b', {}, String(n)), n === 1 ? 'partido' : 'partidos')));
  });
}

// ---------------- Partidos de un árbitro ----------------
function abrirArbitro(a) {
  ADM.actual = a;
  $('#h-arbitro-titulo').textContent = nombreArbitro(a);
  abrirCapa('#h-arbitro', () => { if (ADM.actual === a) ADM.actual = null; });
  $('#h-arbitro').scrollTop = 0;
  cargarArbitro(a);
}
async function cargarArbitro(a) {
  const cuerpo = $('#h-arbitro-cuerpo');
  admAviso(cuerpo, 'Cargando partidos…');
  try {
    const [filas, fotos] = await Promise.all([
      admTodas(() => ADM.sb.from('partidos').select('id,datos,actualizado').eq('user_id', a.user_id).eq('borrado', false).order('id')),
      admTodas(() => ADM.sb.from('fotos').select('id,partido,orden,ruta,subida').eq('user_id', a.user_id).eq('borrado', false).order('id')),
    ]);
    if (ADM.actual !== a) return;                    // ya volvió atrás
    ADM.partidos = filas.filter(r => r.datos).map(r => Object.assign({}, r.datos, { id: r.id, actualizado: r.actualizado }));
    ADM.fotos = {};
    fotos.forEach(f => { (ADM.fotos[f.partido] = ADM.fotos[f.partido] || []).push(f); });
    // Arranca en la liga con más partidos
    const cuenta = id => ADM.partidos.filter(p => p.liga === id).length;
    ADM.liga = LIGAS.reduce((m, l) => (cuenta(l.id) > cuenta(m.id) ? l : m), LIGAS[0]).id;
    ADM.cat = 'todas';
    pintarArbitro(true);
  } catch (e) {
    if (ADM.actual === a) admAviso(cuerpo, textoFallo(e), () => cargarArbitro(a));
  }
}

function pintarArbitro(animarLista = false) {
  const a = ADM.actual;
  if (!a) return;
  const cuerpo = $('#h-arbitro-cuerpo'); cuerpo.innerHTML = '';
  const todos = ADM.partidos;
  const cab = el('div', { class: 'adm-arbitro-cab' },
    el('span', { class: 'arbitro-avatar' }, inicialesDe(a) || '?'),
    el('div', {}, el('b', {}, nombreArbitro(a)), el('span', {}, a.email),
      el('span', {}, [plural(todos.length, 'partido', 'partidos'), a.ingreso ? `entró ${cuandoFue(a.ingreso)}` : ''].filter(Boolean).join(' · '))));
  cuerpo.append(cab);
  if (!todos.length) { const v = el('div', {}); admAviso(v, 'Este árbitro todavía no cargó partidos.'); cuerpo.append(v); return; }

  const cuentaLiga = id => todos.filter(p => p.liga === id).length;
  const tabs = el('div', { class: 'ligas-tabs' });
  LIGAS.forEach(l => tabs.append(el('button', { type: 'button', class: l.id === ADM.liga ? 'sel' : '', onclick: () => {
    if (ADM.liga === l.id) return; ADM.liga = l.id; ADM.cat = 'todas'; pintarArbitro(true);
  } }, logoLiga(l), l.corto, el('span', { class: 'cuenta' }, plural(cuentaLiga(l.id), 'partido', 'partidos')))));

  const deLiga = todos.filter(p => p.liga === ADM.liga);
  const cats = [{ id: 'todas', nombre: 'Todas' }, ...categorias(ADM.liga)];
  const cuentaCat = c => (c.id === 'todas' ? deLiga.length : deLiga.filter(p => p.cat === c.id).length);
  const chips = el('div', { class: 'chips' });
  cats.forEach(c => chips.append(el('button', { type: 'button', class: 'chip' + (c.id === ADM.cat ? ' sel' : ''), onclick: () => {
    if (ADM.cat === c.id) return; ADM.cat = c.id; pintarArbitro(true);
  } }, `${c.id === 'primera' ? 'Primera' : c.id === 'tercera' ? 'Tercera' : c.nombre} (${cuentaCat(c)})`)));

  const lista = (ADM.cat === 'todas' ? deLiga : deLiga.filter(p => p.cat === ADM.cat))
    .sort((x, y) => (y.fecha || '').localeCompare(x.fecha || '') || (y.creado || 0) - (x.creado || 0));
  const filas = el('div', { class: 'adm-partidos' + (animarLista ? ' entra' : '') });
  if (!lista.length) admAviso(filas, deLiga.length ? 'No hay partidos en esta categoría.' : 'No cargó partidos de esta liga.');
  let fechaAnt = '';
  lista.forEach(p => {
    if (p.fecha !== fechaAnt) { fechaAnt = p.fecha; filas.append(el('div', { class: 'grupo-fecha' }, p.fecha ? fechaLarga(p.fecha) : 'Sin fecha')); }
    const nf = (ADM.fotos[p.id] || []).length;
    filas.append(el('button', { type: 'button', class: 'partido', onclick: () => abrirPartidoAdmin(a, p) },
      escudo(p.local),
      el('span', { class: 'medio' },
        el('b', { class: tieneResultado(p) ? 'marcador' : '' }, textoMarcador(p)),
        el('span', { class: 'cat' }, textoCategoria(p)),
        el('span', { class: 'info' },
          [nf ? plural(nf, 'foto', 'fotos') : 'sin fotos', resumenInc(p.inc), p.notas ? 'con notas' : ''].filter(Boolean).join(' · '))),
      escudo(p.visit)));
  });
  cuerpo.append(el('div', { class: 'adm-arbitro-cuerpo' }, tabs, chips, filas));
}

// ---------------- Detalle de un partido (sólo lectura) ----------------
const fechaHora = ms => new Date(ms).toLocaleString('es-AR', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

async function abrirPartidoAdmin(a, p) {
  const abierto = ADM.detalle = {};                  // para saber si se cerró mientras bajaban las fotos
  visorSoloVer = true;
  fotosVisor.forEach(f => URL.revokeObjectURL(f.url)); fotosVisor = [];
  const c = $('#d-cuerpo'); c.innerHTML = '';
  c._guardarNota = null; c._partido = null;
  const club = id => el('div', {}, escudo(id), el('div', { class: 'nombre' }, CLUB[id] ? CLUB[id].nombre : '—'));
  const liga = ligaDe(p.liga);
  c.append(el('div', { class: 'd-cab' },
    el('div', { class: 'd-equipos' }, club(p.local), el('b', { class: tieneResultado(p) ? 'marcador' : '' }, textoMarcador(p)), club(p.visit)),
    el('div', { class: 'd-meta' },
      el('span', {}, el('b', {}, liga ? liga.nombre : '—')),
      el('span', { class: 'cat' }, textoCategoria(p)),
      el('span', {}, 'Árbitro: ', el('b', {}, nombreArbitro(a))),
      el('span', {}, p.fecha ? fechaLarga(p.fecha) : 'Sin fecha'))));

  // Fotos: se bajan de la nube las que todavía están (se guardan 15 días)
  const lista = (ADM.fotos[p.id] || []).slice().sort((x, y) => (x.orden || 0) - (y.orden || 0));
  const vigentes = lista.filter(f => Date.now() - Date.parse(f.subida) < ADM_DIAS_NUBE * 86400000);
  const grid = el('div', { class: 'd-fotos' });
  const pieFotos = el('div', {});
  const estadoFotos = el('p', { class: 'fotos-nota' }, vigentes.length ? 'Cargando fotos…' : '');
  c.append(el('div', { class: 'd-seccion' },
    el('h4', {}, 'Planillas y tarjetas', el('span', { class: 'cuenta' }, String(lista.length))),
    grid, estadoFotos, pieFotos));

  c.append(el('div', { class: 'd-seccion' }, el('h4', {}, 'Incidencias'), seccionIncidencias(p, () => {}, true)));
  c.append(el('div', { class: 'd-seccion' }, el('h4', {}, 'Notas'),
    p.notas ? el('p', { class: 'adm-notas' }, p.notas) : el('p', { class: 'inc-nada' }, 'Sin notas')));
  c.append(el('p', { class: 'fotos-nota adm-pie' },
    [p.creado ? `Cargado el ${fechaHora(p.creado)}` : '', p.actualizado ? `última modificación ${cuandoFue(p.actualizado)}` : ''].filter(Boolean).join(' · ')));

  abrirCapa('#h-detalle', () => { ADM.detalle = null; fotosVisor.forEach(f => URL.revokeObjectURL(f.url)); fotosVisor = []; visorSoloVer = false; });
  $('#h-detalle').scrollTop = 0;

  const bajadas = await Promise.all(vigentes.map(async f => {
    try {
      const r = await ADM.sb.storage.from('fotos').download(f.ruta);
      return r.error || !r.data ? null : { id: f.id, blob: r.data };
    } catch (e) { return null; }
  }));
  if (ADM.detalle !== abierto) return;               // ya se cerró
  const ok = bajadas.filter(Boolean);
  fotosVisor = ok.map(f => ({ id: f.id, url: URL.createObjectURL(f.blob) }));
  fotosVisor.forEach((f, i) => grid.append(el('div', { class: 'd-foto entra' },
    el('button', { type: 'button', class: 'ver', onclick: () => abrirVisor(i) }, el('img', { src: f.url, alt: 'Foto ' + (i + 1) })))));
  estadoFotos.textContent = '';
  const faltan = lista.length - ok.length;
  if (ok.length) {
    pieFotos.append(el('button', { type: 'button', class: 'btn btn-ghost btn-block btn-descargar', onclick: e => descargarFotos(p, ok, e.currentTarget) },
      icono(ICO_DESCARGAR), ok.length > 1 ? `Descargar las ${ok.length} fotos` : 'Descargar la foto'));
  }
  if (faltan) {
    pieFotos.append(el('p', { class: 'fotos-aviso' }, faltan === 1
      ? 'Hay 1 foto que ya no está en la nube (se guardan 15 días): queda sólo en el teléfono del árbitro.'
      : `Hay ${faltan} fotos que ya no están en la nube (se guardan 15 días): quedan sólo en el teléfono del árbitro.`));
  } else if (!lista.length) {
    estadoFotos.textContent = 'Sin fotos.';
  }
}
