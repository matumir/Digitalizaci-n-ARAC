'use strict';
/* ARAC Partidos — todo se guarda en el teléfono (IndexedDB). */

// ---------------- Datos fijos ----------------
const LIGAS = [
  { id: 'sf', nombre: 'Liga Regional San Francisco', corto: 'Regional San Francisco', logo: 'img/ligas/sf.png' },
  { id: 'sm', nombre: 'Liga Departamental San Martín', corto: 'Departamental San Martín', logo: 'img/ligas/sm.png' },
  { id: 'rf', nombre: 'Liga Rafaelina de Fútbol', corto: 'Rafaelina', logo: 'img/ligas/rf.png' },
];
const INF_SF = ['Promocional', 'Preinfantil', 'Infantil', 'Prejuvenil', 'Juvenil'];
const INF_OTRAS = ['Novena', 'Séptima', 'Quinta'];
const FEM_SF = ['Promocional', 'Infantil', 'Juvenil', 'Primera'];

function categorias(liga) {
  const c = [
    { id: 'primera', nombre: 'Primera División' },
    { id: 'tercera', nombre: 'Tercera División' },
    { id: 'inferiores', nombre: 'Inferiores', subs: liga === 'sf' ? INF_SF : INF_OTRAS },
  ];
  if (liga === 'sf') c.push({ id: 'femenino', nombre: 'Femenino', subs: FEM_SF });
  return c;
}
const catDe = (liga, id) => categorias(liga).find(c => c.id === id);
const ligaDe = id => LIGAS.find(l => l.id === id);
const CLUB = {}; (window.CLUBES || []).forEach(c => { CLUB[c.id] = c; });

function textoCategoria(p) {
  const c = catDe(p.liga, p.cat);
  if (!c) return '';
  if (p.cat === 'femenino') return 'Femenino ' + p.sub;
  if (p.cat === 'inferiores') return p.sub;
  return c.nombre;
}

// Resultado: gl = goles del local, gv = del visitante (null si no se cargó).
const tieneResultado = p => p.gl != null && p.gv != null;
const textoMarcador = p => (tieneResultado(p) ? `${p.gl} – ${p.gv}` : 'vs');

// ---------------- Base de datos ----------------
/* Una base por cuenta ('arac-partidos-u-<id>'), así dos árbitros pueden usar el mismo teléfono.
   Cada cambio hecho en el teléfono queda marcado (sucio + mod) hasta que se sube a la nube;
   un borrado deja una marca en 'borrados' para que llegue a los otros teléfonos.
   Fotos: blob = archivo en el teléfono; blob null = la foto existe pero ya no está en la nube
   (se guarda 15 días) y no llegó a bajarse a este teléfono. */
const DB = (() => {
  let db = null, nombre = null;
  const STORES = ['partidos', 'fotos', 'borrados', 'meta'];
  function abrir() {
    if (!nombre) return Promise.reject(new Error('Sin sesión'));
    if (db) return Promise.resolve(db);
    return new Promise((ok, mal) => {
      const r = indexedDB.open(nombre, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('partidos', { keyPath: 'id' });
        d.createObjectStore('fotos', { keyPath: 'id' }).createIndex('partido', 'partido');
        d.createObjectStore('borrados', { keyPath: 'clave' });
        d.createObjectStore('meta', { keyPath: 'k' });
      };
      r.onsuccess = () => { db = r.result; ok(db); };
      r.onerror = () => mal(r.error);
    });
  }
  async function tx(stores, modo, fn) {
    const d = await abrir();
    return new Promise((ok, mal) => {
      const t = d.transaction(stores, modo);
      let res;
      Promise.resolve(fn(t)).then(v => { res = v; });
      t.oncomplete = () => ok(res);
      t.onerror = () => mal(t.error);
      t.onabort = () => mal(t.error);
    });
  }
  const req = r => new Promise((ok, mal) => { r.onsuccess = () => ok(r.result); r.onerror = () => mal(r.error); });
  const avisar = () => window.dispatchEvent(new Event('arac:cambio-local'));
  const sucio = o => Object.assign(o, { mod: Date.now(), sucio: true });
  // Al escribir, se ignoran los campos que la app agrega en memoria
  const limpio = p => { const c = Object.assign({}, p); delete c._url; return c; };

  // Partidos de la versión anterior (base sin cuenta): pasan a la primera cuenta que entra.
  function abrirLegado() {
    return new Promise(ok => {
      let existia = true;
      const r = indexedDB.open('arac-partidos');
      r.onupgradeneeded = () => { existia = false; r.transaction.abort(); };
      r.onsuccess = () => ok(existia ? r.result : (r.result.close(), null));
      r.onerror = () => ok(null);
    });
  }
  async function migrarLegado() {
    const viejo = await abrirLegado();
    if (!viejo) return 0;
    let partidos = [], fotos = [];
    if (viejo.objectStoreNames.contains('partidos')) {
      const t = viejo.transaction(['partidos', 'fotos'], 'readonly');
      [partidos, fotos] = await Promise.all([req(t.objectStore('partidos').getAll()), req(t.objectStore('fotos').getAll())]);
    }
    viejo.close();
    if (partidos.length || fotos.length) {
      await tx(['partidos', 'fotos'], 'readwrite', t => {
        partidos.forEach(p => t.objectStore('partidos').put(Object.assign(p, { mod: p.creado || Date.now(), sucio: true })));
        fotos.forEach(f => t.objectStore('fotos').put(Object.assign(f, { mod: Date.now(), sucio: true })));
      });
    }
    await new Promise(ok => { const d = indexedDB.deleteDatabase('arac-partidos'); d.onsuccess = d.onerror = d.onblocked = () => ok(); });
    return partidos.length;
  }

  return {
    usar(uid) { if (db) db.close(); db = null; nombre = uid ? 'arac-partidos-u-' + uid : null; },
    activa: () => !!nombre,
    migrarLegado,

    // --- lo que usa la app ---
    partidos: () => tx(['partidos'], 'readonly', t => req(t.objectStore('partidos').getAll())),
    guardar: async (p, fotos) => {
      await tx(['partidos', 'fotos'], 'readwrite', t => {
        t.objectStore('partidos').put(sucio(limpio(p)));
        fotos.forEach(f => t.objectStore('fotos').put(sucio(f)));
      });
      avisar();
    },
    // Sólo las fotos que están en este teléfono
    fotosDe: async id => (await tx(['fotos'], 'readonly', t => req(t.objectStore('fotos').index('partido').getAll(id)))).filter(f => f.blob),
    fotosFaltantes: async id => (await tx(['fotos'], 'readonly', t => req(t.objectStore('fotos').index('partido').getAll(id)))).filter(f => !f.blob).length,
    actualizar: async p => {
      sucio(p);
      await tx(['partidos'], 'readwrite', t => { t.objectStore('partidos').put(limpio(p)); });
      avisar();
    },
    agregarFotos: async fotos => { await tx(['fotos'], 'readwrite', t => { fotos.forEach(f => t.objectStore('fotos').put(sucio(f))); }); avisar(); },
    borrarFoto: async id => {
      await tx(['fotos', 'borrados'], 'readwrite', async t => {
        const f = await req(t.objectStore('fotos').get(id));
        t.objectStore('fotos').delete(id);
        if (f) t.objectStore('borrados').put({ clave: 'f:' + id, tipo: 'foto', id, partido: f.partido, orden: f.orden || 0, mod: Date.now() });
      });
      avisar();
    },
    borrarPartido: async id => {
      await tx(['partidos', 'fotos', 'borrados'], 'readwrite', async t => {
        t.objectStore('partidos').delete(id);
        t.objectStore('borrados').put({ clave: 'p:' + id, tipo: 'partido', id, mod: Date.now() });
        const fs = t.objectStore('fotos');
        const lista = await req(fs.index('partido').getAll(id));
        lista.forEach(f => {
          fs.delete(f.id);
          t.objectStore('borrados').put({ clave: 'f:' + f.id, tipo: 'foto', id: f.id, partido: id, orden: f.orden || 0, mod: Date.now() });
        });
      });
      avisar();
    },

    // --- lo que usa la sincronización ---
    pendientes: () => tx(STORES, 'readonly', async t => ({
      partidos: (await req(t.objectStore('partidos').getAll())).filter(p => p.sucio),
      fotos: (await req(t.objectStore('fotos').getAll())).filter(f => f.sucio && f.blob),
      borrados: await req(t.objectStore('borrados').getAll()),
    })),
    // Quita la marca sólo si no hubo otro cambio mientras se subía
    marcarSubido: (tipo, id, mod) => tx(['partidos', 'fotos', 'borrados'], 'readwrite', async t => {
      if (tipo === 'borrado') {
        const b = await req(t.objectStore('borrados').get(id));
        if (b && b.mod === mod) t.objectStore('borrados').delete(id);
        return;
      }
      const s = t.objectStore(tipo === 'partido' ? 'partidos' : 'fotos');
      const o = await req(s.get(id));
      if (o && o.mod === mod) { o.sucio = false; s.put(o); }
    }),
    // Aplica un partido que llegó de la nube. Devuelve true si cambió algo en el teléfono.
    aplicarPartido: row => tx(['partidos', 'fotos', 'borrados'], 'readwrite', async t => {
      const ps = t.objectStore('partidos'), bs = t.objectStore('borrados');
      const [local, marca] = await Promise.all([req(ps.get(row.id)), req(bs.get('p:' + row.id))]);
      const mod = Number(row.mod);
      if (row.borrado) {
        if (local && local.sucio && local.mod > mod) return false;     // acá se editó después
        if (!local) return false;
        ps.delete(row.id);
        const fs = t.objectStore('fotos');
        (await req(fs.index('partido').getAllKeys(row.id))).forEach(k => fs.delete(k));
        return true;
      }
      if (marca && marca.mod >= mod) return false;                      // acá se borró después
      if (local && local.mod >= mod) return false;                      // ya está (o acá es más nuevo)
      ps.put(Object.assign({}, row.datos || {}, { id: row.id, mod, sucio: false }));
      if (marca) bs.delete('p:' + row.id);
      return true;
    }),
    foto: id => tx(['fotos'], 'readonly', t => req(t.objectStore('fotos').get(id))),
    aplicarFoto: (row, blob) => tx(['fotos', 'borrados'], 'readwrite', async t => {
      const fs = t.objectStore('fotos');
      const [local, marca] = await Promise.all([req(fs.get(row.id)), req(t.objectStore('borrados').get('f:' + row.id))]);
      const mod = Number(row.mod);
      if (row.borrado) {
        if (!local || (local.sucio && local.mod > mod)) return false;
        fs.delete(row.id);
        return true;
      }
      if (marca && marca.mod >= mod) return false;
      if (local && local.mod >= mod && (local.blob || !blob)) return false;
      // Nunca se pierde un archivo que ya está en el teléfono
      fs.put({ id: row.id, partido: row.partido, orden: row.orden, blob: blob || (local && local.blob) || null, mod: Math.max(mod, local ? local.mod : 0), sucio: false, subida: row.subida });
      return true;
    }),
    meta: k => tx(['meta'], 'readonly', async t => { const m = await req(t.objectStore('meta').get(k)); return m ? m.v : null; }),
    ponerMeta: (k, v) => tx(['meta'], 'readwrite', t => { t.objectStore('meta').put({ k, v }); }),
  };
})();
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}

// ---------------- Utilidades ----------------
const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, ...hijos) => {
  const e = document.createElement(tag);
  for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k]);
  }
  hijos.flat().forEach(h => h != null && e.append(h.nodeType ? h : document.createTextNode(h)));
  return e;
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
function hoyISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function fechaLarga(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(a, m - 1, d).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
function fechaCorta(iso) {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}
function escudo(id) {
  const c = CLUB[id];
  const box = el('span', { class: 'escudo' });
  if (c) {
    box.style.background = c.fondo;
    box.append(el('img', { src: `img/escudos/${c.id}.png`, alt: c.nombre, loading: 'lazy' }));
  }
  return box;
}
// Dos casilleros de goles (local – visitante). alCambiar recibe {gl, gv}, con null si está vacío.
function campoResultado(gl, gv, alCambiar) {
  const leer = i => {
    const v = i.value.trim();
    if (v === '') return null;
    const n = Math.max(0, Math.min(99, parseInt(v, 10) || 0));
    if (String(n) !== v) i.value = n;
    return n;
  };
  const casillero = (valor, rol) => {
    const i = el('input', { type: 'number', inputmode: 'numeric', min: 0, max: 99, class: 'gol', placeholder: '–', 'aria-label': 'Goles ' + rol });
    if (valor != null) i.value = valor;
    i.addEventListener('focus', () => i.select());
    i.addEventListener('input', () => alCambiar({ gl: leer(iL), gv: leer(iV) }));
    return i;
  };
  const iL = casillero(gl, 'local'), iV = casillero(gv, 'visitante');
  return el('div', { class: 'resultado' },
    el('label', {}, iL, el('span', {}, 'Local')),
    el('b', {}, '–'),
    el('label', {}, iV, el('span', {}, 'Visitante')));
}

// Botón de dos toques: el primero pide confirmación, el segundo ejecuta.
function dosToques(btn, accion, textoConfirmar = '¿Borrar?') {
  const original = btn.innerHTML;
  let t;
  btn._reset = () => { clearTimeout(t); btn.classList.remove('confirmando'); btn.innerHTML = original; };
  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (!btn.classList.contains('confirmando')) {
      btn.classList.add('confirmando'); btn.textContent = textoConfirmar;
      t = setTimeout(btn._reset, 3000);
      return;
    }
    btn._reset();
    accion();
  });
  return btn;
}

// Reinicia una animación CSS de una clase (para que se repita en cada cambio).
function animar(nodo, clase) {
  nodo.classList.remove(clase);
  void nodo.offsetWidth;
  nodo.classList.add(clase);
}
const DUR_SALIDA = 200;
const esperar = ms => new Promise(r => setTimeout(r, ms));

let toastT, toastSale;
function toast(msg) {
  const t = $('#toast');
  clearTimeout(toastT); clearTimeout(toastSale);
  t.textContent = msg;
  t.classList.remove('se-va');
  t.hidden = false;
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  toastT = setTimeout(() => {
    t.classList.add('se-va');
    toastSale = setTimeout(() => { t.hidden = true; t.classList.remove('se-va'); }, DUR_SALIDA);
  }, 2200);
}

// Achica la foto para que no ocupe tanto lugar (lado mayor 1800 px, JPEG).
function comprimir(file) {
  return new Promise((ok, mal) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 1800;
      let { width: w, height: h } = img;
      const k = Math.min(1, max / Math.max(w, h));
      w = Math.round(w * k); h = Math.round(h * k);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      cv.toBlob(b => (b ? ok(b) : mal(new Error('No se pudo procesar la foto'))), 'image/jpeg', 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('No se pudo abrir la foto')); };
    img.src = url;
  });
}

// ---------------- Navegación (el botón Atrás de Android cierra pantallas) ----------------
const pila = [];
const salidas = {};
function abrirCapa(id, alCerrar) {
  const n = $(id);
  clearTimeout(salidas[id]);
  n.classList.remove('se-va');
  n.hidden = false;
  pila.push({ id, alCerrar });
  history.pushState({ capa: id }, '');
}
function cerrarCapa() { if (pila.length) history.back(); }
// Al cerrar, la capa se va con su animación y recién después se oculta.
window.addEventListener('popstate', () => {
  const c = pila.pop();
  if (!c) return;
  const n = $(c.id);
  n.classList.add('se-va');
  salidas[c.id] = setTimeout(() => {
    n.hidden = true; n.classList.remove('se-va');
    if (c.alCerrar) c.alCerrar();
  }, DUR_SALIDA);
});
document.addEventListener('click', e => { if (e.target.closest('[data-cerrar]')) cerrarCapa(); });

const TITULOS = { partidos: 'Partidos', cargar: 'Cargar partido', admin: 'Árbitros' };
let vistaActual = 'partidos';
document.querySelectorAll('.bottomnav .nav-btn').forEach(b => b.addEventListener('click', () => mostrarVista(b.dataset.vista)));
function mostrarVista(v) {
  const cambia = v !== vistaActual;
  vistaActual = v;
  document.querySelectorAll('.bottomnav .nav-btn').forEach(b => b.classList.toggle('activa', b.dataset.vista === v));
  document.querySelectorAll('main > .vista').forEach(s => { s.hidden = s.id !== 'v-' + v; });
  const tit = $('#titulo-vista');
  tit.textContent = TITULOS[v];
  if (cambia) { animar(tit, 'cambia'); animar($('#v-' + v), 'entra'); }
  window.scrollTo(0, 0);
  if (v === 'partidos') renderPartidos(true);
  if (v === 'cargar') renderCargar();
  if (v === 'admin') renderAdmin();   // admin.js
}

// ---------------- Tema ----------------
const TEMAS = ['auto', 'light', 'dark'];
function temaGuardado() {
  try { const t = localStorage.getItem('arac-tema'); return TEMAS.includes(t) ? t : 'auto'; } catch (e) { return 'auto'; }
}
function aplicarTema(t) {
  const raiz = document.documentElement;
  if (t === 'auto') raiz.removeAttribute('data-theme'); else raiz.setAttribute('data-theme', t);
  document.querySelectorAll('[data-tema]').forEach(b => b.classList.toggle('sel', b.dataset.tema === t));
  $('.seg').dataset.pos = TEMAS.indexOf(t);
  // La barra del sistema toma el color del fondo
  requestAnimationFrame(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(document.body).getPropertyValue('--page').trim() || '#f1f1ed';
  });
}
document.querySelectorAll('[data-tema]').forEach(b => b.addEventListener('click', () => {
  try { localStorage.setItem('arac-tema', b.dataset.tema); } catch (e) {}
  aplicarTema(b.dataset.tema);
}));
if (window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const alCambiarSistema = () => { if (temaGuardado() === 'auto') aplicarTema('auto'); };
  if (mq.addEventListener) mq.addEventListener('change', alCambiarSistema);
}
$('#btn-ajustes').addEventListener('click', () => abrirCapa('#h-ajustes'));
aplicarTema(temaGuardado());

// Logo de liga sobre su baldosa (los logos traen fondo blanco)
const logoLiga = l => el('span', { class: 'logo-liga' }, el('img', { src: l.logo, alt: '' }));

// Repinta una fila de opciones sin recrearla si no cambió, así la selección se anima.
function opciones(cont, clave, items, crear, esSel) {
  if (cont._clave !== clave) {
    cont.innerHTML = '';
    items.forEach(it => { const b = crear(it); b._item = it; cont.append(b); });
    cont._clave = clave;
  }
  [...cont.children].forEach(b => b.classList.toggle('sel', !!esSel(b._item)));
}

// ---------------- Incidencias ----------------
/* Cada partido guarda p.inc = [{ id, tipo, eq, num, num2, min, motivo, sub }]
   tipo: amarilla | roja | gol | cambio · eq: local | visit (el equipo al que corresponde)
   gol: sub = normal | penal | en-contra (el gol cuenta para eq; en contra, num es del rival)
   cambio: num = sale, num2 = entra · min admite adición: "45+2" */
const TIPOS_INC = {
  amarilla: { nombre: 'Amarilla', titulo: 'Tarjeta amarilla', cargada: 'Tarjeta amarilla cargada' },
  roja:     { nombre: 'Roja',     titulo: 'Tarjeta roja', cargada: 'Tarjeta roja cargada' },
  gol:      { nombre: 'Gol',      titulo: 'Gol', cargada: 'Gol cargado' },
  cambio:   { nombre: 'Cambio',   titulo: 'Sustitución', cargada: 'Sustitución cargada' },
};
const MOTIVOS = {
  amarilla: ['Juego brusco', 'Protestar', 'Conducta antideportiva', 'Demorar la reanudación', 'No respetar la distancia', 'Infracciones reiteradas', 'Entrar o salir sin permiso', 'Simular'],
  // (la doble amarilla no va acá: se registra sola al cargar la segunda amarilla)
  roja: ['Juego brusco grave', 'Conducta violenta', 'Escupir', 'Evitar un gol con la mano', 'Evitar ocasión manifiesta de gol', 'Lenguaje ofensivo o insultos'],
};
// Los que se le pueden sancionar a un suplente o a un jugador que ya salió (fuera del juego)
const MOTIVOS_SUPLENTE = {
  amarilla: ['Protestar', 'Conducta antideportiva', 'Demorar la reanudación', 'Entrar o salir sin permiso'],
  roja: ['Conducta violenta', 'Escupir', 'Lenguaje ofensivo o insultos'],
};
const motivoDeSuplente = t => !MOTIVOS[t.tipo].includes(t.motivo) || MOTIVOS_SUPLENTE[t.tipo].includes(t.motivo);
/* Tarjetas al cuerpo técnico: en vez de número llevan rol (y, si se quiere, el nombre).
   También para ellos dos amarillas son expulsión. */
const ROLES_CT = [
  ['dt', 'Director Técnico'], ['ayudante', 'Ayudante de Campo'], ['pf', 'Preparador Físico'],
  ['arqueros', 'Entrenador de Arqueros'], ['medico', 'Médico'], ['kinesiologo', 'Kinesiólogo / Masajista'],
  ['utilero', 'Utilero'], ['delegado', 'Delegado'], ['auxiliar', 'Personal Auxiliar'],
];
const nombreRol = id => (ROLES_CT.find(r => r[0] === id) || [id, 'Cuerpo técnico'])[1];
const MOTIVOS_CT = {
  amarilla: ['Protestar', 'Conducta antideportiva', 'Salir del área técnica', 'Entrar al campo sin permiso', 'Demorar la reanudación', 'Gestos o actitud provocativa'],
  roja: ['Conducta violenta', 'Lenguaje ofensivo o insultos', 'Escupir', 'Entrar al campo a confrontar', 'Arrojar objetos'],
};
const SUB_GOL = [['normal', 'Jugada'], ['penal', 'De penal'], ['en-contra', 'En contra']];

const ICONOS_INC = {
  amarilla: '<span class="tarjeta amarilla"></span>',
  roja: '<span class="tarjeta roja"></span>',
  // Segunda amarilla: amarilla con la roja encima
  doble: '<span class="tarjetas-doble"><span class="tarjeta amarilla"></span><span class="tarjeta roja"></span></span>',
  gol: '<svg viewBox="0 0 24 24" class="ico-inc"><circle cx="12" cy="12" r="8.5"/><path d="m12 7.8 3.1 2.3-1.2 3.6h-3.8l-1.2-3.6zM12 7.8V3.6M15.1 10.1l3.9-1.3M13.9 13.7l2.4 3.4M10.1 13.7l-2.4 3.4M8.9 10.1 5 8.8"/></svg>',
  cambio: '<svg viewBox="0 0 24 24" class="ico-inc"><path d="M7 4v13M3.5 13.5 7 17l3.5-3.5M17 20V7M13.5 10.5 17 7l3.5 3.5"/></svg>',
};

/* Cambio en el entretiempo: se guarda con min = 'ET' y cuenta como después de toda la
   adición del primer tiempo (45+20 vale 45.20) y antes del 46. */
const MIN_ET = 'ET';
function valorMinuto(m) {
  if (m === MIN_ET) return 45.9;
  const t = String(m || '').match(/^(\d+)(?:\s*\+\s*(\d+))?/);
  return t ? Number(t[1]) + (t[2] ? Number(t[2]) / 100 : 0) : 999;
}
// Para los mensajes ("en el 35'", "en el entretiempo"); en la lista el entretiempo se abrevia ET
const textoMinuto = m => (m === MIN_ET ? 'entretiempo' : m ? `${String(m).replace(/\s+/g, '')}'` : '');
function golesDe(inc) {
  const g = { local: 0, visit: 0 };
  (inc || []).forEach(i => { if (i.tipo === 'gol') g[i.eq]++; });
  return g;
}
function textoInc(i) {
  if (i.tipo === 'cambio') return [i.num ? `Sale ${i.num}` : '', i.num2 ? `entra ${i.num2}` : ''].filter(Boolean).join(', ') || 'Cambio';
  if (i.rol) return nombreRol(i.rol) + (i.nombre ? ` · ${i.nombre}` : '');
  const quien = i.num ? `N° ${i.num}` : (i.tipo === 'gol' ? 'Gol' : TIPOS_INC[i.tipo].titulo);
  if (i.tipo === 'gol' && i.sub === 'penal') return quien + ' (penal)';
  if (i.tipo === 'gol' && i.sub === 'en-contra') return quien + ' (en contra)';
  return quien;
}
function resumenInc(inc) {
  const n = t => (inc || []).filter(i => i.tipo === t).length;
  // La doble amarilla cuenta también como roja (expulsión)
  const rojas = n('roja') + segundasAmarillas(inc).size;
  const partes = [];
  if (n('amarilla')) partes.push(`${n('amarilla')} amarilla${n('amarilla') > 1 ? 's' : ''}`);
  if (rojas) partes.push(`${rojas} roja${rojas > 1 ? 's' : ''}`);
  return partes.join(' · ');
}

// ---- Incidencias por jugador (mismo equipo y mismo número; en un cambio, el que sale) ----
const rival = eq => (eq === 'local' ? 'visit' : 'local');
// En un gol en contra el número es de un jugador del rival
const equipoDe = i => (i.tipo === 'gol' && i.sub === 'en-contra' ? rival(i.eq) : i.eq);
// Cuerpo técnico: misma persona = mismo rol y mismo nombre (sin nombre, el rol solo)
const mismoNombre = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
const mismoJugador = (a, b) => equipoDe(a) === equipoDe(b) && (a.rol || b.rol
  ? a.rol === b.rol && mismoNombre(a.nombre, b.nombre)
  : !!(a.num && b.num && Number(a.num) === Number(b.num)));
// Cómo se nombra en los mensajes: "El N° 9", "El Director Técnico (Juan Pérez)"
const quienEs = i => (i.rol ? `El ${nombreRol(i.rol)}${i.nombre ? ` (${i.nombre})` : ''}` : `El N° ${Number(i.num)}`);
const esTarjeta = i => i.tipo === 'amarilla' || i.tipo === 'roja';
// Ordena por minuto; las que no tienen minuto van al final, en el orden en que se cargaron
const porMinuto = lista => lista.map((x, k) => [x, k]).sort((a, b) => (valorMinuto(a[0].min) - valorMinuto(b[0].min)) || (a[1] - b[1])).map(x => x[0]);
const antesDe = (a, b) => a.min && b.min && valorMinuto(a.min) < valorMinuto(b.min);   // a fue antes que b
// Cambios en los que salió o entró el jugador, por minuto; salidaDe / entradaDe: el primero con minuto
const salidasDe = (lista, jug) => porMinuto((lista || []).filter(i => i.tipo === 'cambio' && mismoJugador(i, jug)));
const entradasDe = (lista, jug) => porMinuto((lista || []).filter(i => i.tipo === 'cambio' && i.num2 && jug.num &&
  i.eq === equipoDe(jug) && Number(i.num2) === Number(jug.num)));
const salidaDe = (lista, jug) => salidasDe(lista, jug).find(i => i.min);
const entradaDe = (lista, jug) => entradasDe(lista, jug).find(i => i.min);
// Jugadores que protagonizan una incidencia; en un cambio, el que sale (num) y el que entra (num2)
const jugadoresDe = i => [
  i.num && { eq: equipoDe(i), num: i.num, campo: 'num' },
  i.tipo === 'cambio' && i.num2 && { eq: i.eq, num: i.num2, campo: 'num2' },
].filter(Boolean);

// Titulares de cada equipo: obj.tit = { local: [números], visit: [números] }. Si no se cargaron, del 1 al 11.
const TITULARES_BASE = Array.from({ length: 11 }, (_, k) => k + 1);
const titularesDe = (tit, eq) => (tit && tit[eq] && tit[eq].length ? tit[eq] : TITULARES_BASE);
const esTitular = (tit, jug) => titularesDe(tit, equipoDe(jug)).includes(Number(jug.num));
// Nunca pisó la cancha: no es titular ni entró en un cambio
const enBanco = (lista, jug, tit) => !esTitular(tit, jug) && !entradasDe(lista, jug).length;

// Si en el minuto de esta incidencia el jugador estaba fuera de la cancha: 'sustituido', 'suplente' o ''
function fueraDeCancha(inc, jug, tit) {
  if (!jug.num) return '';
  const s = salidaDe(inc, jug), e = entradaDe(inc, jug);
  if (s && antesDe(s, jug)) return 'sustituido';
  return (e ? antesDe(jug, e) : enBanco(inc, jug, tit)) ? 'suplente' : '';
}

/* Ids de las amarillas que son la segunda de su jugador: se muestran con la roja
   y cuentan como expulsión. Se calculan siempre, así se acomodan solas si se
   edita el minuto o se borra una amarilla. */
function segundasAmarillas(inc) {
  const ids = new Set(), vistos = [];
  porMinuto((inc || []).filter(i => i.tipo === 'amarilla' && (i.num || i.rol))).forEach(a => {
    const previas = vistos.filter(v => mismoJugador(v, a)).length;
    if (previas === 1) ids.add(a.id);
    vistos.push(a);
  });
  return ids;
}

/* Reglas de tarjetas para una tarjeta nueva o editada (cand) frente a las demás del jugador:
   - una sola expulsión: roja directa o doble amarilla, nunca las dos ni dos rojas;
   - como mucho dos amarillas;
   - después del minuto de la expulsión no puede recibir ninguna tarjeta.
   Devuelve { error } o { aviso } (cuando la amarilla nueva es la segunda). */
function revisarTarjeta(inc, cand) {
  if (!esTarjeta(cand) || !(cand.num || cand.rol)) return {};
  const otras = (inc || []).filter(i => i.id !== cand.id && esTarjeta(i) && mismoJugador(i, cand));
  const quien = quienEs(cand);
  const amas = porMinuto(otras.filter(i => i.tipo === 'amarilla'));
  const roja = otras.find(i => i.tipo === 'roja');
  const enMin = i => (i.min ? ` en el ${textoMinuto(i.min)}` : '');
  const despues = (a, b) => a.min && b.min && valorMinuto(a.min) > valorMinuto(b.min);   // a fue después de b
  if (cand.tipo === 'roja') {
    if (roja) return { error: `${quien} ya tiene una roja${enMin(roja)}.` };
    if (amas.length >= 2) return { error: `${quien} ya fue expulsado por doble amarilla${enMin(amas[1])}.` };
    const tarde = amas.find(a => despues(a, cand));
    if (tarde) return { error: `${quien} tiene una amarilla${enMin(tarde)}, después de esta roja: un expulsado no puede recibir tarjetas.` };
    return {};
  }
  if (amas.length >= 2) return { error: `${quien} ya tiene dos amarillas: fue expulsado${enMin(amas[1])}.` };
  if (roja) {
    if (amas.length === 1) return { error: `${quien} ya fue expulsado con roja${enMin(roja)}.` };
    if (despues(cand, roja)) return { error: `${quien} fue expulsado${enMin(roja)}: no puede recibir tarjetas después.` };
    return {};
  }
  if (amas.length === 1) {
    return { aviso: `Con esta, ${quien.replace(/^El/, 'el')} suma dos amarillas: se registra la roja por doble amarilla.` };
  }
  return {};
}

/* Reglas entre titulares, expulsiones, cambios y goles de un jugador:
   - entra en un cambio sólo si no es titular, y una sola vez; sale una sola vez;
   - para salir tiene que haber estado en cancha (titular, o entró antes);
   - no puede salir reemplazado ni entrar después de ser expulsado (roja o doble amarilla);
   - convierte sólo si estuvo en cancha: no después de ser expulsado ni de salir, ni antes de entrar;
   - mientras está fuera (en el banco o ya sustituido), sólo se le pueden sacar tarjetas por motivos de suplente.
   Revisa cómo quedaría el partido con cand y sólo informa los problemas que trae cand,
   no los que ya estaban cargados. Devuelve { error, campo } o {}. */
function revisarJugador(inc, cand, tit) {
  const con = (inc || []).filter(i => i.id !== cand.id).concat(cand);
  for (const jug of jugadoresDe(cand)) {
    const previos = new Set(problemasJugador(inc || [], jug, tit).map(p => p.error));
    const nuevo = problemasJugador(con, jug, tit).find(p => !previos.has(p.error));
    if (nuevo) return { error: nuevo.error, campo: nuevo.id === cand.id ? 'motivo' : jug.campo };
  }
  return {};
}
// Todos los problemas del partido (para revisar un cambio de titulares)
function problemasPartido(inc, tit) {
  const vistos = new Set(), problemas = [];
  (inc || []).forEach(i => jugadoresDe(i).forEach(jug => {
    const clave = jug.eq + Number(jug.num);
    if (vistos.has(clave)) return;
    vistos.add(clave);
    problemas.push(...problemasJugador(inc, jug, tit));
  }));
  return problemas;
}
function problemasJugador(lista, jug, tit) {
  const suyas = lista.filter(i => mismoJugador(i, jug));
  const quien = `El N° ${Number(jug.num)}`;
  const enMin = i => (i.min ? ` en el ${textoMinuto(i.min)}` : '');
  const dobles = segundasAmarillas(lista);
  const expulsion = porMinuto(suyas.filter(i => i.min && (i.tipo === 'roja' || dobles.has(i.id))))[0];
  const salidas = salidasDe(suyas, jug), entradas = entradasDe(lista, jug);
  const salida = salidaDe(suyas, jug), entrada = entradaDe(lista, jug);
  const titular = esTitular(tit, jug), banco = !titular && !entradas.length;
  const problemas = [];
  if (titular && entradas.length) problemas.push({ error: `${quien} es titular: no puede entrar en un cambio (revisá los titulares).` });
  if (entradas.length > 1) problemas.push({ error: `${quien} ya entró${enMin(entradas[0])}: no puede volver a entrar.` });
  if (salidas.length > 1) problemas.push({ error: `${quien} ya salió${enMin(salidas[0])}: no puede volver a salir.` });
  if (banco && salidas.length) problemas.push({ error: `${quien} no es titular ni entró en un cambio: no puede salir (revisá los titulares).` });
  if (!titular && entrada && salida && antesDe(salida, entrada)) {
    problemas.push({ error: `${quien} entró en el ${textoMinuto(entrada.min)}: no puede salir antes (cambio en el ${textoMinuto(salida.min)}).` });
  }
  if (expulsion && salida && antesDe(expulsion, salida)) {
    problemas.push({ error: `${quien} fue expulsado en el ${textoMinuto(expulsion.min)}: no puede salir reemplazado después (cambio en el ${textoMinuto(salida.min)}).` });
  }
  if (expulsion && entrada && antesDe(expulsion, entrada)) {
    problemas.push({ error: `${quien} fue expulsado en el ${textoMinuto(expulsion.min)}: no puede entrar después (cambio en el ${textoMinuto(entrada.min)}).` });
  }
  suyas.filter(i => i.tipo === 'gol').forEach(g => {
    if (banco) problemas.push({ error: `${quien} no es titular ni entró en un cambio: no puede convertir (revisá los titulares).` });
    else if (expulsion && antesDe(expulsion, g)) problemas.push({ error: `${quien} fue expulsado en el ${textoMinuto(expulsion.min)}: no puede convertir después (gol en el ${textoMinuto(g.min)}).` });
    else if (salida && antesDe(salida, g)) problemas.push({ error: `${quien} salió reemplazado en el ${textoMinuto(salida.min)}: no puede convertir después (gol en el ${textoMinuto(g.min)}).` });
    else if (entrada && antesDe(g, entrada)) problemas.push({ error: `${quien} entró en el ${textoMinuto(entrada.min)}: no puede convertir antes (gol en el ${textoMinuto(g.min)}).` });
  });
  suyas.filter(t => esTarjeta(t) && !motivoDeSuplente(t)).forEach(t => {
    const fuera = salida && antesDe(salida, t) ? `salió reemplazado en el ${textoMinuto(salida.min)}: después`
      : entrada && antesDe(t, entrada) ? `entró en el ${textoMinuto(entrada.min)}: antes`
      : banco ? 'no es titular ni entró en un cambio:' : '';
    if (fuera) problemas.push({ error: `${quien} ${fuera} sólo se le pueden sacar tarjetas de suplente, no por «${t.motivo}» (${textoMinuto(t.min)}).`, id: t.id });
  });
  return problemas;
}

/* Sección de incidencias dividida en local y visitante.
   obj: el partido (o el formulario) con local, visit, inc, gl y gv.
   alCambiar(): se llama después de cada alta, edición o baja.
   soloLectura: sin botones para cargar ni editar (panel de administrador). */
function seccionIncidencias(obj, alCambiar, soloLectura = false) {
  // En sólo lectura las filas son div (no se tocan); si no, botones que abren su editor
  const tocable = (clase, accion, ...hijos) => (soloLectura
    ? el('div', { class: clase }, ...hijos)
    : el('button', { type: 'button', class: clase, onclick: accion }, ...hijos));
  const cont = el('div', { class: 'inc-equipos' });
  const pintar = (resaltar) => {
    cont.innerHTML = '';
    const dobles = segundasAmarillas(obj.inc);
    ['local', 'visit'].forEach(eq => {
      const id = obj[eq];
      const lista = (obj.inc || []).filter(i => i.eq === eq).sort((a, b) => valorMinuto(a.min) - valorMinuto(b.min));
      const filas = el('div', { class: 'inc-lista' });
      lista.forEach(i => {
        const doble = dobles.has(i.id);
        const detalle = [doble ? 'Roja por doble amarilla' : '', i.min === MIN_ET ? 'En el entretiempo' : '', i.motivo].filter(Boolean).join(' · ');
        const fila = tocable('inc-fila' + (doble ? ' doble' : '') + (i.id === resaltar ? ' entra' : ''), () => editorInc(obj, eq, i.tipo, i, pintarYAvisar),
          el('span', { class: 'inc-ico' }), el('span', { class: 'inc-txt' },
            el('b', {}, textoInc(i)),
            detalle ? el('span', {}, detalle) : null),
          el('span', { class: 'inc-min' }, i.min === MIN_ET ? 'ET' : textoMinuto(i.min)));
        fila.querySelector('.inc-ico').innerHTML = doble ? ICONOS_INC.doble : ICONOS_INC[i.tipo];
        filas.append(fila);
      });
      const botones = el('div', { class: 'inc-botones' });
      Object.keys(TIPOS_INC).forEach(t => {
        const b = el('button', { type: 'button', class: 'inc-btn', onclick: () => editorInc(obj, eq, t, null, pintarYAvisar) },
          el('span', { class: 'inc-ico' }), TIPOS_INC[t].nombre);
        b.querySelector('.inc-ico').innerHTML = ICONOS_INC[t];
        botones.append(b);
      });
      const propios = obj.tit && obj.tit[eq] && obj.tit[eq].length;
      cont.append(el('div', { class: 'inc-equipo' },
        el('div', { class: 'inc-cab' },
          id ? escudo(id) : el('span', { class: 'escudo vacio-esc' }),
          el('div', {}, el('span', { class: 'inc-rol' }, eq === 'local' ? 'Local' : 'Visitante'),
            el('b', {}, id && CLUB[id] ? CLUB[id].nombre : 'Sin elegir'))),
        tocable('inc-tit', () => editorTitulares(obj, eq, pintarYAvisar),
          el('span', { class: 'inc-rol' }, 'Titulares'),
          el('span', { class: 'inc-tit-nums' + (propios ? '' : ' base') }, propios ? titularesDe(obj.tit, eq).join(', ') : '1 al 11 (sin cargar)'),
          soloLectura ? null : el('span', { class: 'inc-tit-editar' }, propios ? 'Editar' : 'Cargar')),
        lista.length ? filas : el('p', { class: 'inc-nada' }, 'Sin incidencias'),
        soloLectura ? null : botones));
    });
  };
  const pintarYAvisar = (idCambiado) => { pintar(idCambiado); alCambiar(); };
  pintar();
  cont._repintar = () => pintar();
  return cont;
}

// Hoja para cargar o editar una incidencia.
function editorInc(obj, eq, tipo, existente, alGuardar) {
  const T = TIPOS_INC[tipo];
  const v = Object.assign({ num: '', num2: '', min: '', motivo: '', sub: 'normal' }, existente || {});
  $('#inc-titulo').textContent = (existente ? 'Editar · ' : '') + T.titulo;
  $('#inc-equipo').textContent = `${eq === 'local' ? 'Local' : 'Visitante'} · ${obj[eq] && CLUB[obj[eq]] ? CLUB[obj[eq]].nombre : 'equipo sin elegir'}`;
  const cuerpo = $('#inc-cuerpo'); cuerpo.innerHTML = '';

  const campoNum = (etiqueta, valor, ph) => {
    const i = el('input', { type: 'text', inputmode: 'numeric', maxlength: 2, class: 'campo campo-num', placeholder: ph });
    i.value = valor || '';
    i.addEventListener('input', () => { i.value = i.value.replace(/\D/g, '').slice(0, 2); validar(); });
    return [el('label', { class: 'field' }, el('span', { class: 'field-label' }, etiqueta), i), i];
  };
  const fila = el('div', { class: 'inc-campos' });
  let iNum, iNum2, campoJugador;
  if (tipo === 'cambio') {
    const [a, x] = campoNum('Sale N°', v.num, 'Ej: 9'); iNum = x;
    const [b, y] = campoNum('Entra N°', v.num2, 'Ej: 18'); iNum2 = y;
    fila.append(a, b);
  } else {
    const [a, x] = campoNum(tipo === 'gol' && v.sub === 'en-contra' ? 'Jugador N° (rival)' : 'Jugador N°', v.num, 'Ej: 10'); iNum = x;
    campoJugador = a;
    fila.append(a);
  }

  // Tarjeta: a un jugador o a alguien del cuerpo técnico (cargo y, si se quiere, nombre)
  let paraCT = !!v.rol, rol = v.rol || 'dt', iNombre = null;
  const bloqueCT = el('div', { class: 'field' });
  if (MOTIVOS[tipo]) {
    const seg = el('div', { class: 'chips' });
    [[false, 'Jugador'], [true, 'Cuerpo técnico']].forEach(([ct, txt]) => seg.append(el('button', { type: 'button', class: 'chip' + (ct === paraCT ? ' sel' : ''), onclick: e => {
      paraCT = ct;
      seg.querySelectorAll('.chip').forEach(c => c.classList.toggle('sel', c === e.currentTarget));
      campoJugador.hidden = paraCT; bloqueCT.hidden = !paraCT;
      validar();
    } }, txt)));
    cuerpo.append(el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'A quién'), seg));
    const roles = el('div', { class: 'chips chips-motivo' });
    ROLES_CT.forEach(([k, txt]) => roles.append(el('button', { type: 'button', class: 'chip' + (k === rol ? ' sel' : ''), onclick: e => {
      rol = k;
      roles.querySelectorAll('.chip').forEach(c => c.classList.toggle('sel', c === e.currentTarget));
      validar();
    } }, txt)));
    iNombre = el('input', { type: 'text', class: 'campo', placeholder: 'Nombre (opcional)', maxlength: 60, autocapitalize: 'words' });
    iNombre.value = v.nombre || '';
    iNombre.addEventListener('input', validar);
    bloqueCT.append(el('span', { class: 'field-label' }, 'Cargo'), roles, iNombre);
    campoJugador.hidden = paraCT; bloqueCT.hidden = !paraCT;
  }
  // Minuto: teclado de teléfono para poder escribir la adición (45+2)
  const iMin = el('input', { type: 'text', inputmode: 'tel', maxlength: 5, class: 'campo campo-num', placeholder: tipo === 'cambio' ? 'Ej: 65' : 'Ej: 35 o 45+2' });
  iMin.value = v.min === MIN_ET ? '' : (v.min || '');
  iMin.addEventListener('input', () => {
    // Sólo dígitos y un "+": hasta 2 cifras de minuto y 2 de adición
    const [base, ...resto] = iMin.value.replace(/[^\d+]/g, '').split('+');
    iMin.value = base.slice(0, 2) + (resto.length ? '+' + resto.join('').slice(0, 2) : '');
    validar();
  });
  const campoMin = el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Minuto'), iMin);
  fila.append(campoMin);
  cuerpo.append(fila);
  if (MOTIVOS[tipo]) cuerpo.append(bloqueCT);

  // Cambio: durante el partido (con minuto) o en el entretiempo (sin minuto)
  let enET = tipo === 'cambio' && v.min === MIN_ET;
  const minuto = () => (enET ? MIN_ET : iMin.value.trim().replace(/\+$/, ''));
  if (tipo === 'cambio') {
    const seg = el('div', { class: 'chips' });
    [[false, 'Durante el partido'], [true, 'En el entretiempo']].forEach(([et, txt]) => seg.append(el('button', { type: 'button', class: 'chip' + (et === enET ? ' sel' : ''), onclick: e => {
      enET = et;
      seg.querySelectorAll('.chip').forEach(c => c.classList.toggle('sel', c === e.currentTarget));
      campoMin.hidden = enET;
      validar();
    } }, txt)));
    campoMin.hidden = enET;
    cuerpo.append(el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Cuándo'), seg));
  }

  // Tipo de gol
  let sub = v.sub || 'normal';
  if (tipo === 'gol') {
    const seg = el('div', { class: 'chips' });
    SUB_GOL.forEach(([k, txt]) => seg.append(el('button', { type: 'button', class: 'chip' + (k === sub ? ' sel' : ''), onclick: e => {
      sub = k;
      seg.querySelectorAll('.chip').forEach(c => c.classList.toggle('sel', c === e.currentTarget));
      const lbl = fila.querySelector('.field-label');
      lbl.textContent = k === 'en-contra' ? 'Jugador N° (rival)' : 'Jugador N°';
      validar();
    } }, txt)));
    cuerpo.append(el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Tipo de gol'), seg));
  }

  // Motivo (sólo tarjetas)
  let iMotivo, pintarMotivos;
  if (MOTIVOS[tipo]) {
    iMotivo = el('input', { type: 'text', class: 'campo', placeholder: 'Escribí el motivo o elegí uno', maxlength: 120 });
    iMotivo.value = v.motivo || '';
    const sug = el('div', { class: 'chips chips-motivo' });
    const lbl = el('span', { class: 'field-label' }, 'Motivo');
    const marcar = () => sug.querySelectorAll('.chip').forEach(c => c.classList.toggle('sel', c.textContent === iMotivo.value));
    // Motivos según a quién: cuerpo técnico ('ct'), jugador fuera de la cancha ('sustituido' o
    // 'suplente': sólo los que se le pueden sancionar a un suplente) o jugador en cancha ('')
    let deSuplente = null;
    pintarMotivos = fuera => {
      if (fuera === deSuplente) return;
      deSuplente = fuera;
      lbl.textContent = { sustituido: 'Motivo · jugador sustituido', suplente: 'Motivo · suplente (todavía no entró)' }[fuera] || 'Motivo';
      sug.innerHTML = '';
      (fuera === 'ct' ? MOTIVOS_CT : fuera ? MOTIVOS_SUPLENTE : MOTIVOS)[tipo].forEach(m => sug.append(el('button', { type: 'button', class: 'chip', onclick: () => { iMotivo.value = iMotivo.value === m ? '' : m; marcar(); validar(); } }, m)));
      marcar();
    };
    iMotivo.addEventListener('input', () => { marcar(); validar(); });
    cuerpo.append(el('div', { class: 'field' }, lbl, iMotivo, sug));
  }

  // Validación en vivo: marca el campo con error y no deja guardar
  const error = el('p', { class: 'inc-error', role: 'alert' });
  const aviso = el('p', { class: 'inc-aviso' });
  cuerpo.append(error, aviso);
  let btnGuardar;
  const candidata = () => ({
    id: existente ? existente.id : '(nueva)', tipo, eq, num: paraCT ? '' : iNum.value.trim(), min: minuto(),
    num2: iNum2 ? iNum2.value.trim() : '', motivo: iMotivo ? iMotivo.value.trim() : '', sub: tipo === 'gol' ? sub : '',
    rol: paraCT ? rol : '', nombre: paraCT ? iNombre.value.trim() : '',
  });
  function validar() {
    const problemas = [];
    const marcar = (input, msg) => { input.classList.toggle('campo-error', !!msg); if (msg) problemas.push(msg); };
    if (pintarMotivos) {
      pintarMotivos(paraCT ? 'ct' : fueraDeCancha(obj.inc, candidata(), obj.tit));
      marcar(iMotivo, '');
    }
    marcar(iNum, paraCT ? '' : errorNumero(iNum.value));
    if (iNum2) {
      const mismo = iNum.value && iNum2.value && Number(iNum.value) === Number(iNum2.value);
      marcar(iNum2, errorNumero(iNum2.value) || (mismo ? 'El jugador que entra no puede ser el mismo que sale.' : ''));
    }
    marcar(iMin, enET ? '' : errorMinuto(iMin.value));
    // Reglas de tarjetas (doble amarilla, expulsados) y de expulsiones, cambios y goles del jugador
    let r = {};
    if (!problemas.length) {
      const c = candidata();
      r = revisarTarjeta(obj.inc, c);
      if (!r.error) {
        const rj = revisarJugador(obj.inc, c, obj.tit);
        if (rj.error) r = rj;
      }
      if (r.error) marcar({ motivo: iMotivo, num2: iNum2 }[r.campo] || (paraCT ? iNombre : iNum), r.error);
    }
    error.textContent = problemas[0] || '';
    aviso.textContent = problemas.length ? '' : (r.aviso || '');
    if (btnGuardar) btnGuardar.disabled = problemas.length > 0;
    return problemas.length === 0;
  }

  const guardarInc = () => {
    if (!validar()) return;
    const nuevo = {
      id: existente ? existente.id : uid(), tipo, eq,
      num: paraCT ? '' : iNum.value.trim(), num2: iNum2 ? iNum2.value.trim() : '',
      min: minuto(), motivo: iMotivo ? iMotivo.value.trim() : '',
      sub: tipo === 'gol' ? sub : '',
    };
    if (paraCT) Object.assign(nuevo, { rol, nombre: iNombre.value.trim() });
    const antes = golesDe(obj.inc);
    obj.inc = (obj.inc || []).filter(i => i.id !== nuevo.id).concat(nuevo);
    sincronizarResultado(obj, antes);
    cerrarCapa();
    alGuardar(nuevo.id);
    const doble = tipo === 'amarilla' && segundasAmarillas(obj.inc).has(nuevo.id);
    toast(doble ? `Doble amarilla: roja para ${quienEs(nuevo).replace(/^El /, 'el ')}` : (existente ? 'Incidencia actualizada' : T.cargada));
  };
  const acciones = el('div', { class: 'inc-acciones' });
  if (existente) {
    acciones.append(dosToques(el('button', { type: 'button', class: 'btn btn-peligro-ghost' }, 'Borrar'), () => {
      const antes = golesDe(obj.inc);
      obj.inc = obj.inc.filter(i => i.id !== existente.id);
      sincronizarResultado(obj, antes);
      cerrarCapa(); alGuardar(); toast('Incidencia borrada');
    }, '¿Borrar?'));
  }
  btnGuardar = el('button', { type: 'button', class: 'btn btn-primary', onclick: guardarInc }, existente ? 'Guardar cambios' : 'Agregar');
  acciones.append(btnGuardar);
  cuerpo.append(acciones);
  validar();

  abrirCapa('#h-inc');
  // En una carga nueva el cursor va directo al número
  if (!existente) setTimeout(() => iNum.focus(), 380);
}

/* Hoja para elegir los titulares de un equipo (opcional: sin cargar son del 1 al 11).
   No deja guardar si con los titulares nuevos alguna incidencia ya cargada deja de cerrar. */
const TITULARES_MAX = 11;
function editorTitulares(obj, eq, alGuardar) {
  const propios = obj.tit && obj.tit[eq] && obj.tit[eq].length;
  const elegidos = new Set(titularesDe(obj.tit, eq));
  $('#inc-titulo').textContent = 'Titulares';
  $('#inc-equipo').textContent = `${eq === 'local' ? 'Local' : 'Visitante'} · ${obj[eq] && CLUB[obj[eq]] ? CLUB[obj[eq]].nombre : 'equipo sin elegir'}`;
  const cuerpo = $('#inc-cuerpo'); cuerpo.innerHTML = '';

  const cuenta = el('span', { class: 'tit-cuenta' });
  const grilla = el('div', { class: 'tit-grilla' });
  // Del 1 al 30 siempre; los números más altos aparecen cuando se agregan
  const pintarGrilla = () => {
    grilla.innerHTML = '';
    const nums = [...new Set([...Array.from({ length: 30 }, (_, k) => k + 1), ...elegidos])].sort((a, b) => a - b);
    nums.forEach(n => grilla.append(el('button', { type: 'button', class: 'chip tit-num' + (elegidos.has(n) ? ' sel' : ''), onclick: e => {
      elegidos.has(n) ? elegidos.delete(n) : elegidos.add(n);
      e.currentTarget.classList.toggle('sel', elegidos.has(n));
      validar();
    } }, String(n))));
  };
  const iOtro = el('input', { type: 'text', inputmode: 'numeric', maxlength: 2, class: 'campo campo-num', placeholder: 'Ej: 33' });
  const agregar = () => {
    const n = Number(iOtro.value);
    if (errorNumero(iOtro.value) || !n) { iOtro.classList.add('campo-error'); return; }
    elegidos.add(n); iOtro.value = ''; iOtro.classList.remove('campo-error');
    pintarGrilla(); validar();
  };
  iOtro.addEventListener('input', () => { iOtro.value = iOtro.value.replace(/\D/g, '').slice(0, 2); iOtro.classList.remove('campo-error'); });
  iOtro.addEventListener('keydown', e => { if (e.key === 'Enter') agregar(); });
  cuerpo.append(
    el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Números de los titulares ', cuenta), grilla),
    el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Otro número'),
      el('div', { class: 'tit-otro' }, iOtro, el('button', { type: 'button', class: 'btn btn-ghost', onclick: agregar }, 'Agregar'))));

  const error = el('p', { class: 'inc-error', role: 'alert' });
  const aviso = el('p', { class: 'inc-aviso' });
  cuerpo.append(error, aviso);
  let btnGuardar;
  // Si quedan del 1 al 11 no se guarda lista propia
  const nuevosTit = () => {
    const tit = Object.assign({}, obj.tit, { [eq]: [...elegidos].sort((a, b) => a - b) });
    if (tit[eq].join() === TITULARES_BASE.join()) delete tit[eq];
    return tit;
  };
  function validar() {
    const n = elegidos.size;
    cuenta.textContent = `· ${n} de ${TITULARES_MAX}`;
    let msg = !n ? 'Elegí al menos un titular.' : (n > TITULARES_MAX ? `Pueden ser ${TITULARES_MAX} como máximo: sacá ${n - TITULARES_MAX}.` : '');
    if (!msg) {
      const previos = new Set(problemasPartido(obj.inc, obj.tit).map(p => p.error));
      const nuevo = problemasPartido(obj.inc, nuevosTit()).find(p => !previos.has(p.error));
      if (nuevo) msg = nuevo.error;
    }
    error.textContent = msg;
    aviso.textContent = !msg && n < TITULARES_MAX ? `Son ${n}: está bien si el equipo empezó con menos de ${TITULARES_MAX}.` : '';
    if (btnGuardar) btnGuardar.disabled = !!msg;
    return !msg;
  }
  const guardar = tit => { obj.tit = tit; cerrarCapa(); alGuardar(); toast('Titulares guardados'); };

  const acciones = el('div', { class: 'inc-acciones' });
  if (propios) {
    // Volver al 1 al 11 (si las incidencias lo permiten)
    acciones.append(el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => {
      elegidos.clear(); TITULARES_BASE.forEach(n => elegidos.add(n)); pintarGrilla();
      if (validar()) guardar(nuevosTit());
    } }, '1 al 11'));
  }
  btnGuardar = el('button', { type: 'button', class: 'btn btn-primary', onclick: () => { if (validar()) guardar(nuevosTit()); } }, 'Guardar');
  acciones.append(btnGuardar);
  cuerpo.append(acciones);
  pintarGrilla();
  validar();
  abrirCapa('#h-inc');
}

// Minuto: de 1 a 90, con adición opcional de 1 a 20 (ej: 45+2, 90+5). Vacío vale (es opcional).
const MINUTO_MAX = 90, ADICION_MAX = 20;
function errorMinuto(texto) {
  const t = String(texto || '').trim();
  if (!t) return '';
  const m = t.match(/^(\d{1,2})(?:\+(\d{0,2}))?$/);
  if (!m) return 'Escribí el minuto así: 35 o 45+2.';
  const base = Number(m[1]);
  if (base < 1 || base > MINUTO_MAX) return `El minuto va de 1 a ${MINUTO_MAX}. Si hubo adición, escribila así: ${MINUTO_MAX}+3.`;
  if (m[2] !== undefined) {
    if (m[2] === '') return 'Falta la adición después del +.';
    const ad = Number(m[2]);
    if (ad < 1 || ad > ADICION_MAX) return `La adición va de 1 a ${ADICION_MAX} minutos.`;
  }
  return '';
}
// Número de camiseta: de 1 a 99. Vacío vale (es opcional).
function errorNumero(texto) {
  const t = String(texto || '').trim();
  if (!t) return '';
  const n = Number(t);
  return Number.isInteger(n) && n >= 1 && n <= 99 ? '' : 'El número de jugador va de 1 a 99.';
}

/* Si el resultado estaba vacío o coincidía con los goles cargados, se actualiza solo.
   Un resultado escrito a mano que no coincide con los goles no se toca. */
function sincronizarResultado(obj, antes) {
  const ahora = golesDe(obj.inc);
  const vacio = obj.gl == null && obj.gv == null;
  const coincidia = obj.gl === antes.local && obj.gv === antes.visit;
  if (antes.local === ahora.local && antes.visit === ahora.visit) return;
  if (vacio || coincidia) {
    const sinGoles = ahora.local === 0 && ahora.visit === 0;
    obj.gl = sinGoles && vacio ? null : ahora.local;
    obj.gv = sinGoles && vacio ? null : ahora.visit;
  }
}

// ---------------- CARGAR ----------------
const form = { liga: null, cat: null, sub: null, local: null, visit: null, fecha: hoyISO(), fotos: [], notas: '', gl: null, gv: null, inc: [], tit: {} };

function renderCargar() {
  opciones($('#c-ligas'), 'ligas', LIGAS, l => el('button', {
    type: 'button', class: 'liga-card',
    onclick: () => {
      if (form.liga !== l.id) { form.liga = l.id; form.cat = null; form.sub = null; form.local = null; form.visit = null; form.inc = []; form.tit = {}; }
      renderCargar();
      setTimeout(() => $('#p-cat').scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    },
  }, logoLiga(l), l.corto), l => l.id === form.liga);

  $('#p-cat').hidden = !form.liga;
  if (form.liga) {
    opciones($('#c-cats'), form.liga, categorias(form.liga), c => el('button', {
      type: 'button', class: 'chip',
      onclick: () => { if (form.cat !== c.id) { form.cat = c.id; form.sub = null; } renderCargar(); },
    }, c.nombre), c => c.id === form.cat);
  }
  const cat = form.liga && form.cat ? catDe(form.liga, form.cat) : null;
  $('#p-sub').hidden = !(cat && cat.subs);
  if (cat && cat.subs) {
    $('#c-sub-titulo').textContent = cat.id === 'femenino' ? 'Categoría femenina' : 'División de inferiores';
    opciones($('#c-subs'), form.liga + cat.id, cat.subs, s => el('button', {
      type: 'button', class: 'chip',
      onclick: () => { form.sub = s; renderCargar(); },
    }, s), s => s === form.sub);
  }
  const catLista = cat && (!cat.subs || form.sub);
  ['#p-equipos', '#p-resultado', '#p-fecha', '#p-fotos', '#p-inc', '#p-notas', '#barra-guardar'].forEach(s => { $(s).hidden = !catLista; });
  if (!catLista) return;

  pintarSlot('#slot-local', 'Local', form.local, 'local');
  pintarSlot('#slot-visit', 'Visitante', form.visit, 'visit');
  const res = $('#c-resultado');
  if (!res.firstChild || res._gl !== form.gl || res._gv !== form.gv) {
    res.innerHTML = '';
    res.append(campoResultado(form.gl, form.gv, r => { form.gl = res._gl = r.gl; form.gv = res._gv = r.gv; }));
    res._gl = form.gl; res._gv = form.gv;
  }
  // Incidencias: se recrean sólo si cambian los equipos (si no, se repintan solas)
  const ci = $('#c-inc');
  const claveInc = form.local + '|' + form.visit + '|' + form.inc.length;
  if (ci._clave !== claveInc) {
    ci.innerHTML = '';
    ci.append(seccionIncidencias(form, () => { ci._clave = form.local + '|' + form.visit + '|' + form.inc.length; renderCargar(); }));
    ci._clave = claveInc;
  }
  $('#c-fecha').value = form.fecha;
  $('#c-notas').value = form.notas;
  pintarFotosForm();
  $('#btn-guardar').disabled = !(form.local && form.visit);
}

function pintarSlot(sel, rol, id, campo) {
  const b = $(sel);
  b.onclick = () => elegirClub(rol, campo);
  if (b.firstChild && b._id === id) return;   // sin cambios: no repetir la animación del escudo
  b._id = id;
  b.innerHTML = '';
  b.classList.toggle('lleno', !!id);
  b.append(el('span', { class: 'rol' }, rol));
  if (id) {
    b.append(escudo(id), el('span', { class: 'nombre' }, CLUB[id].nombre));
  } else {
    b.append(el('span', { class: 'mas' }, '+'), 'Tocá para elegir');
  }
}

function elegirClub(rol, campo) {
  $('#h-club-titulo').textContent = 'Equipo ' + rol.toLowerCase();
  const buscar = $('#h-club-buscar');
  buscar.value = '';
  const otro = campo === 'local' ? form.visit : form.local;
  const clubes = window.CLUBES.filter(c => c.liga === form.liga);
  const pintar = () => {
    const q = buscar.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\./g, '');
    const g = $('#h-club-grilla'); g.innerHTML = '';
    clubes.filter(c => !q || c.nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\./g, '').includes(q))
      .forEach(c => g.append(el('button', {
        type: 'button', class: 'club' + (c.id === otro ? ' usado' : ''),
        onclick: () => {
          if (c.id === otro) { toast('Ese equipo ya está elegido'); return; }
          form[campo] = c.id; cerrarCapa(); renderCargar();
        },
      }, escudo(c.id), el('span', {}, c.nombre))));
  };
  buscar.oninput = pintar;
  pintar();
  animar($('#h-club-grilla'), 'entra');
  abrirCapa('#h-club');
  $('#h-club').scrollTop = 0;
}

$('#c-notas').addEventListener('input', e => { form.notas = e.target.value; });
$('#c-fecha').addEventListener('change', e => { form.fecha = e.target.value || hoyISO(); });

async function sumarFotos(files, destino) {
  const lista = [...files];
  if (!lista.length) return [];
  toast(lista.length > 1 ? `Procesando ${lista.length} fotos…` : 'Procesando foto…');
  const out = [];
  for (const f of lista) {
    try { out.push(await comprimir(f)); } catch (e) { toast(e.message); }
  }
  return out;
}
['#c-camara', '#c-galeria'].forEach(s => $(s).addEventListener('change', async e => {
  const blobs = await sumarFotos(e.target.files);
  e.target.value = '';
  blobs.forEach(b => form.fotos.push({ id: uid(), blob: b, url: URL.createObjectURL(b), nueva: true }));
  pintarFotosForm();
}));
function pintarFotosForm() {
  const c = $('#c-fotos'); c.innerHTML = '';
  form.fotos.forEach((f, i) => {
    const m = el('div', { class: 'mini' + (f.nueva ? ' entra' : '') },
      el('img', { src: f.url, alt: 'Foto ' + (i + 1) }),
      el('button', { type: 'button', class: 'quitar', 'aria-label': 'Quitar foto', onclick: async () => {
        m.classList.add('se-va');
        await esperar(DUR_SALIDA);
        URL.revokeObjectURL(f.url); form.fotos.splice(form.fotos.indexOf(f), 1); pintarFotosForm();
      } }, '✕'));
    f.nueva = false;
    c.append(m);
  });
}

$('#btn-guardar').addEventListener('click', async () => {
  if (!form.local || !form.visit) { toast('Elegí los dos equipos'); return; }
  if ((form.gl == null) !== (form.gv == null)) { toast('Completá los goles de los dos equipos'); return; }
  const btn = $('#btn-guardar'); btn.disabled = true;
  const p = {
    id: uid(), liga: form.liga, cat: form.cat, sub: form.sub || null,
    local: form.local, visit: form.visit, gl: form.gl, gv: form.gv, inc: form.inc, tit: form.tit, fecha: form.fecha || hoyISO(), notas: form.notas.trim(), creado: Date.now(),
  };
  const fotos = form.fotos.map((f, i) => ({ id: uid() + i, partido: p.id, blob: f.blob, orden: i }));
  try {
    await DB.guardar(p, fotos);
  } catch (e) {
    btn.disabled = false; toast('No se pudo guardar. Probá de nuevo.'); return;
  }
  form.fotos.forEach(f => URL.revokeObjectURL(f.url));
  // Se mantienen liga, categoría y fecha para cargar el siguiente más rápido.
  form.local = null; form.visit = null; form.gl = null; form.gv = null; form.inc = []; form.tit = {}; form.fotos = []; form.notas = '';
  ver.liga = p.liga; ver.cat = p.cat; ver.sub = null;
  toast('Partido guardado ✓');
  renderCargar();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ---------------- PARTIDOS ----------------
const ver = { liga: 'sf', cat: 'todas', sub: null };

// animarLista: las filas entran escalonadas (al cambiar de vista o de filtro, no al volver del detalle).
async function renderPartidos(animarLista = false) {
  if (!DB.activa()) return;                     // todavía no hay sesión
  const todos = await DB.partidos();
  const cuentaLiga = id => todos.filter(p => p.liga === id).length;
  opciones($('#ver-ligas'), LIGAS.map(l => cuentaLiga(l.id)).join(), LIGAS, l => {
    const n = cuentaLiga(l.id);
    return el('button', {
      type: 'button',
      onclick: () => { if (ver.liga === l.id) return; ver.liga = l.id; ver.cat = 'todas'; ver.sub = null; renderPartidos(true); },
    }, logoLiga(l), l.corto, el('span', { class: 'cuenta' }, n === 1 ? '1 partido' : n + ' partidos'));
  }, l => l.id === ver.liga);

  const deLiga = todos.filter(p => p.liga === ver.liga);
  const listaCats = [{ id: 'todas', nombre: 'Todas' }, ...categorias(ver.liga)];
  const cuentaCat = c => (c.id === 'todas' ? deLiga.length : deLiga.filter(p => p.cat === c.id).length);
  opciones($('#ver-cats'), ver.liga + listaCats.map(cuentaCat).join(), listaCats, c => el('button', {
    type: 'button', class: 'chip',
    onclick: () => { if (ver.cat === c.id) return; ver.cat = c.id; ver.sub = null; renderPartidos(true); },
  }, `${c.id === 'primera' ? 'Primera' : c.id === 'tercera' ? 'Tercera' : c.nombre} (${cuentaCat(c)})`), c => c.id === ver.cat);
  const cat = catDe(ver.liga, ver.cat);
  const subs = $('#ver-subs');
  subs.hidden = !(cat && cat.subs);
  if (cat && cat.subs) {
    opciones(subs, ver.liga + cat.id, [null, ...cat.subs], s => el('button', {
      type: 'button', class: 'chip',
      onclick: () => { if (ver.sub === s) return; ver.sub = s; renderPartidos(true); },
    }, s || 'Todas'), s => s === ver.sub);
  }

  let lista = deLiga;
  if (ver.cat !== 'todas') lista = lista.filter(p => p.cat === ver.cat);
  if (ver.sub) lista = lista.filter(p => p.sub === ver.sub);
  lista.sort((a, b) => (b.fecha.localeCompare(a.fecha)) || (b.creado - a.creado));

  // Cantidad de fotos por partido
  const nf = {};
  await Promise.all(lista.map(async p => { nf[p.id] = (await DB.fotosDe(p.id)).length; }));

  const cont = $('#lista'); cont.innerHTML = '';
  if (animarLista) animar(cont, 'entra'); else cont.classList.remove('entra');
  if (!lista.length) {
    cont.append(el('div', { class: 'vacio' },
      logoLiga(ligaDe(ver.liga)),
      el('p', {}, deLiga.length ? 'No hay partidos en esta categoría.' : 'Todavía no cargaste partidos de esta liga.'),
      el('button', { type: 'button', class: 'btn btn-primary', onclick: () => {
        if (form.liga !== ver.liga) { form.local = null; form.visit = null; }
        form.liga = ver.liga;
        if (ver.cat !== 'todas') { form.cat = ver.cat; form.sub = ver.sub; }
        mostrarVista('cargar');
      } }, 'Cargar partido')));
    return;
  }
  let fechaAnt = '';
  lista.forEach(p => {
    if (p.fecha !== fechaAnt) { fechaAnt = p.fecha; cont.append(el('div', { class: 'grupo-fecha' }, fechaLarga(p.fecha))); }
    cont.append(el('button', { type: 'button', class: 'partido', onclick: () => abrirDetalle(p) },
      escudo(p.local),
      el('span', { class: 'medio' },
        el('b', { class: tieneResultado(p) ? 'marcador' : '' }, textoMarcador(p)),
        el('span', { class: 'cat' }, textoCategoria(p)),
        el('span', { class: 'info' },
          [nf[p.id] ? `${nf[p.id]} foto${nf[p.id] > 1 ? 's' : ''}` : 'sin fotos', resumenInc(p.inc), p.notas ? 'con notas' : '']
            .filter(Boolean).join(' · '))),
      escudo(p.visit)));
  });
}

// ---------------- Detalle ----------------
let fotosVisor = [], idxVisor = 0;
let visorSoloVer = false;        // fotos de otro árbitro (panel de administrador): no se borran
const fotosNuevas = new Set();   // recién agregadas: entran con animación
const ICO_CAMARA = '<svg class="ico" viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
const ICO_DESCARGAR = '<svg class="ico" viewBox="0 0 24 24"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/></svg>';
const ICO_GALERIA = '<svg class="ico" viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m4 17 5-5 4 4 2.5-2.5L20 18"/></svg>';
function icono(html) { const t = document.createElement('template'); t.innerHTML = html; return t.content.firstChild; }
async function abrirDetalle(p) {
  await pintarDetalle(p);
  abrirCapa('#h-detalle', () => { const c = $('#d-cuerpo'); if (c._guardarNota) c._guardarNota(); fotosVisor.forEach(f => URL.revokeObjectURL(f.url)); fotosVisor = []; renderPartidos(); });
  $('#h-detalle').scrollTop = 0;
}
async function pintarDetalle(p) {
  visorSoloVer = false;
  fotosVisor.forEach(f => URL.revokeObjectURL(f.url));
  const fotos = (await DB.fotosDe(p.id)).sort((a, b) => (a.orden || 0) - (b.orden || 0));
  const faltantes = await DB.fotosFaltantes(p.id);
  fotosVisor = fotos.map(f => ({ id: f.id, url: URL.createObjectURL(f.blob) }));
  const c = $('#d-cuerpo'); c.innerHTML = '';
  const eq = id => el('div', {}, escudo(id), el('div', { class: 'nombre' }, CLUB[id] ? CLUB[id].nombre : '—'));
  const marcador = el('b', {});
  const pintarMarcador = () => {
    marcador.textContent = textoMarcador(p);
    marcador.className = tieneResultado(p) ? 'marcador' : '';
  };
  pintarMarcador();
  c.append(el('div', { class: 'd-cab' },
    el('div', { class: 'd-equipos' }, eq(p.local), marcador, eq(p.visit)),
    el('div', { class: 'd-meta' },
      el('span', {}, el('b', {}, ligaDe(p.liga).nombre)),
      el('span', { class: 'cat' }, textoCategoria(p)),
      el('span', {}, fechaLarga(p.fecha)))));

  // Resultado: se guarda solo al completar (o vaciar) los dos casilleros
  const estadoRes = el('div', { class: 'notas-estado' });
  const resWrap = el('div', {});
  const pintarRes = () => { resWrap.innerHTML = ''; resWrap.append(campoResultado(p.gl, p.gv, async r => {
      if ((r.gl == null) !== (r.gv == null)) { estadoRes.textContent = 'Completá los goles de los dos equipos'; return; }
      if (r.gl === (p.gl ?? null) && r.gv === (p.gv ?? null)) { estadoRes.textContent = ''; return; }
      p.gl = r.gl; p.gv = r.gv;
      pintarMarcador(); animar(marcador, 'cambia');
      try { await DB.actualizar(p); estadoRes.textContent = r.gl == null ? 'Resultado quitado' : 'Guardado ✓'; } catch (e) { estadoRes.textContent = 'No se pudo guardar'; }
      animar(estadoRes, 'cambia');
    })); };
  pintarRes();
  c.append(el('div', { class: 'd-seccion' }, el('h4', {}, 'Resultado'), resWrap, estadoRes));

  const grid = el('div', { class: 'd-fotos' });
  fotosVisor.forEach((f, i) => {
    const nodo = el('div', { class: 'd-foto' + (fotosNuevas.has(f.id) ? ' entra' : '') },
      el('button', { type: 'button', class: 'ver', onclick: () => abrirVisor(i) }, el('img', { src: f.url, alt: 'Foto ' + (i + 1) })),
      dosToques(el('button', { type: 'button', class: 'quitar', 'aria-label': 'Borrar foto' }, '✕'), () => borrarFoto(p, f.id, nodo)));
    grid.append(nodo);
  });
  fotosNuevas.clear();
  const inCam = el('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
  const inGal = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const alAgregar = async e => {
    const blobs = await sumarFotos(e.target.files);
    if (!blobs.length) return;
    const base = fotos.length;
    const nuevas = blobs.map((b, i) => ({ id: uid() + i, partido: p.id, blob: b, orden: base + i }));
    await DB.agregarFotos(nuevas);
    nuevas.forEach(f => fotosNuevas.add(f.id));
    toast(blobs.length > 1 ? 'Fotos agregadas ✓' : 'Foto agregada ✓');
    refrescarDetalle(p);
  };
  inCam.addEventListener('change', alAgregar); inGal.addEventListener('change', alAgregar);
  c.append(el('div', { class: 'd-seccion' },
    el('h4', {}, 'Planillas y tarjetas', el('span', { class: 'cuenta' }, String(fotos.length))),
    grid,
    el('div', { class: 'foto-botones' },
      el('label', { class: 'btn btn-ghost' }, inCam, icono(ICO_CAMARA), 'Sacar foto'),
      el('label', { class: 'btn btn-ghost' }, inGal, icono(ICO_GALERIA), 'Agregar de galería')),
    fotos.length ? el('button', { type: 'button', class: 'btn btn-ghost btn-block btn-descargar', onclick: e => descargarFotos(p, fotos, e.currentTarget) },
      icono(ICO_DESCARGAR), fotos.length > 1 ? `Descargar las ${fotos.length} fotos` : 'Descargar la foto') : null,
    faltantes ? el('p', { class: 'fotos-aviso' }, faltantes === 1
      ? 'Hay 1 foto más que ya no está en la nube: queda sólo en el teléfono donde se cargó.'
      : `Hay ${faltantes} fotos más que ya no están en la nube: quedan sólo en el teléfono donde se cargaron.`) : null,
    el('p', { class: 'fotos-nota' }, 'Las fotos se guardan en la nube 15 días para pasarlas a tus otros teléfonos; en este teléfono quedan siempre.')));

  // Incidencias por equipo: se guardan al instante
  const estadoInc = el('div', { class: 'notas-estado' });
  c.append(el('div', { class: 'd-seccion' },
    el('h4', {}, 'Incidencias'),
    seccionIncidencias(p, async () => {
      pintarMarcador(); animar(marcador, 'cambia'); pintarRes();
      try { await DB.actualizar(p); estadoInc.textContent = 'Guardado ✓'; } catch (e) { estadoInc.textContent = 'No se pudo guardar'; }
      animar(estadoInc, 'cambia');
    }),
    estadoInc));

  // Notas: se guardan solas mientras se escribe
  const ta = el('textarea', { class: 'campo notas', rows: 4, placeholder: 'Algo más para anotar: demoras, estado de la cancha, observaciones…' });
  ta.value = p.notas || '';
  const estado = el('div', { class: 'notas-estado' });
  let tNota;
  const guardarNota = async () => {
    clearTimeout(tNota);
    if ((p.notas || '') === ta.value.trim()) return;
    p.notas = ta.value.trim();
    try { await DB.actualizar(p); estado.textContent = 'Guardado ✓'; } catch (e) { estado.textContent = 'No se pudo guardar'; }
    animar(estado, 'cambia');
  };
  ta.addEventListener('input', () => { estado.textContent = 'Escribiendo…'; clearTimeout(tNota); tNota = setTimeout(guardarNota, 700); });
  ta.addEventListener('blur', guardarNota);
  c.append(el('div', { class: 'd-seccion' }, el('h4', {}, 'Notas'), ta, estado));
  c._guardarNota = guardarNota;

  const zona = el('div', {});
  const btnBorrar = el('button', { type: 'button', class: 'btn-peligro', onclick: () => {
    zona.innerHTML = '';
    zona.append(el('div', { class: 'confirmar' },
      el('p', {}, '¿Borrar este partido y sus fotos? No se puede deshacer.'),
      el('div', { class: 'fila' },
        el('button', { type: 'button', class: 'no', onclick: () => { zona.innerHTML = ''; zona.append(btnBorrar); } }, 'Cancelar'),
        el('button', { type: 'button', class: 'si', onclick: async () => {
          await DB.borrarPartido(p.id); toast('Partido borrado'); cerrarCapa();
        } }, 'Borrar'))));
  } }, 'Borrar partido');
  zona.append(btnBorrar);
  c.append(el('div', { class: 'd-seccion' }, zona));
  c._partido = p;
}

// ---------------- Descargar fotos ----------------
const blobABase64 = b => new Promise((ok, mal) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1]);
  r.onerror = () => mal(r.error);
  r.readAsDataURL(b);
});
const limpiarNombre = t => t.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);

/* En el APK no hay gestor de descargas para blob:, así que las fotos se escriben
   con el plugin Filesystem en Pictures/ARAC Partidos/<partido>/ y aparecen en la
   galería. Si eso falla, se ofrece el menú de compartir del sistema. */
async function descargarFotos(p, fotos, boton) {
  // Sin la localidad entre paréntesis, para que el nombre de la carpeta no quede cortado
  const nombreClub = id => (CLUB[id] ? CLUB[id].nombre.replace(/\s*\([^)]*\)/g, '') : 'Equipo');
  const carpeta = limpiarNombre(`${p.fecha} ${nombreClub(p.local)} vs ${nombreClub(p.visit)}`);
  const archivo = i => `foto-${String(i + 1).padStart(2, '0')}.jpg`;
  const Cap = window.Capacitor;
  const P = (Cap && Cap.Plugins) || {};
  const nativo = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  if (boton) boton.disabled = true;
  try {
    if (!nativo) {
      // Celular (versión web): el menú de compartir tiene "Guardar imagen", que las manda a Fotos.
      // Se llama sin esperar nada antes, porque el navegador sólo lo permite justo después del toque.
      const archivos = fotos.map((f, i) => new File([f.blob], `${carpeta} ${archivo(i)}`, { type: 'image/jpeg' }));
      const movil = /iPhone|iPad|iPod|Android/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
      if (movil && navigator.canShare && navigator.canShare({ files: archivos })) {
        try {
          await navigator.share({ files: archivos, title: carpeta });
        } catch (err) {
          if (err && err.name === 'AbortError') { toast('No se guardaron las fotos'); return; }
          throw err;
        }
        return;
      }
      // Computadora: una descarga por foto
      for (let i = 0; i < fotos.length; i++) {
        const url = URL.createObjectURL(fotos[i].blob);
        const a = el('a', { href: url, download: `${carpeta} ${archivo(i)}` });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        await esperar(150);
      }
      toast(fotos.length > 1 ? 'Fotos descargadas ✓' : 'Foto descargada ✓');
      return;
    }
    toast('Guardando fotos…');
    const datos = await Promise.all(fotos.map(f => blobABase64(f.blob)));
    try {
      for (let i = 0; i < datos.length; i++) {
        await P.Filesystem.writeFile({
          path: `Pictures/ARAC Partidos/${carpeta}/${archivo(i)}`,
          data: datos[i], directory: 'EXTERNAL_STORAGE', recursive: true,
        });
      }
      toast('Guardadas en la galería › ARAC Partidos ✓');
    } catch (e) {
      // Plan B: pasar las fotos al menú de compartir (Drive, WhatsApp, Archivos…)
      const uris = [];
      for (let i = 0; i < datos.length; i++) {
        const { uri } = await P.Filesystem.writeFile({ path: `fotos/${archivo(i)}`, data: datos[i], directory: 'CACHE', recursive: true });
        uris.push(uri);
      }
      try {
        await P.Share.share({ title: carpeta, dialogTitle: 'Guardá las fotos del partido', files: uris });
      } catch (err) {
        const m = (err && (err.message || err.errorMessage)) || '';
        if (/cancel|abort|dismiss/i.test(m)) { toast('No se guardaron las fotos'); return; }
        throw err;
      }
    }
  } catch (e) {
    toast('No se pudieron guardar las fotos');
  } finally {
    if (boton) boton.disabled = false;
  }
}

// Vuelve a pintar el detalle sin perder una anotación a medio escribir.
async function refrescarDetalle(p) {
  const c = $('#d-cuerpo');
  if (c._guardarNota) await c._guardarNota();
  await pintarDetalle(p);
}
async function borrarFoto(p, id, nodo) {
  if (nodo) { nodo.classList.add('se-va'); await esperar(DUR_SALIDA); }
  try { await DB.borrarFoto(id); } catch (e) { toast('No se pudo borrar la foto'); return; }
  toast('Foto borrada');
  await refrescarDetalle(p);
}

function abrirVisor(i) {
  idxVisor = i; pintarVisor();
  abrirCapa('#visor');
}
function pintarVisor() {
  const n = fotosVisor.length;
  const img = $('#visor-img');
  if (img.src !== fotosVisor[idxVisor].url) { img.src = fotosVisor[idxVisor].url; animar(img, 'cambia'); }
  $('#visor-num').textContent = `${idxVisor + 1} / ${n}`;
  $('#visor-ant').hidden = n < 2; $('#visor-sig').hidden = n < 2;
  const b = $('#visor-borrar'); if (b._reset) b._reset();
  b.hidden = visorSoloVer;
}
$('#visor-ant').addEventListener('click', () => { idxVisor = (idxVisor - 1 + fotosVisor.length) % fotosVisor.length; pintarVisor(); });
$('#visor-sig').addEventListener('click', () => { idxVisor = (idxVisor + 1) % fotosVisor.length; pintarVisor(); });
dosToques($('#visor-borrar'), async () => {
  const f = fotosVisor[idxVisor];
  if (!f) return;
  await borrarFoto($('#d-cuerpo')._partido, f.id);
  if (!fotosVisor.length) { cerrarCapa(); return; }
  idxVisor = Math.min(idxVisor, fotosVisor.length - 1);
  pintarVisor();
});
// Deslizar para pasar de foto
(() => {
  let x0 = null;
  const v = $('#visor');
  v.addEventListener('touchstart', e => { x0 = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
  v.addEventListener('touchend', e => {
    if (x0 == null || fotosVisor.length < 2) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) $(dx < 0 ? '#visor-sig' : '#visor-ant').click();
    x0 = null;
  });
})();

// ---------------- Sesión ----------------
// auth.js avisa qué cuenta entró; cada cuenta usa su propia base en el teléfono.
let cuentaActual = null;
window.addEventListener('arac:sesion', async e => {
  const { uid, cliente } = e.detail;
  if (cuentaActual === uid) return;
  cuentaActual = uid;
  DB.usar(uid);
  try {
    const n = await DB.migrarLegado();
    if (n) toast(n === 1 ? '1 partido pasó a tu cuenta' : `${n} partidos pasaron a tu cuenta`);
  } catch (err) { /* si falla, los partidos viejos quedan donde estaban */ }
  // Si se abrió tocando el recordatorio (recordatorio.js), va directo a Cargar partido
  const desdeAviso = location.hash === '#cargar';
  if (desdeAviso) history.replaceState(history.state, '', location.pathname + location.search);
  mostrarVista(desdeAviso ? 'cargar' : 'partidos');
  if (typeof Sync !== 'undefined') Sync.iniciar(cliente, uid);
});
window.addEventListener('arac:fin-sesion', () => {
  cuentaActual = null;
  if (typeof Sync !== 'undefined') Sync.detener();
  DB.usar(null);
  // Cierra lo que haya abierto y limpia lo de la cuenta anterior
  pila.length = 0;
  document.querySelectorAll('.hoja, .sheet-wrap, .visor').forEach(n => { n.hidden = true; n.classList.remove('se-va'); });
  form.fotos.forEach(f => URL.revokeObjectURL(f.url));
  Object.assign(form, { liga: null, cat: null, sub: null, local: null, visit: null, gl: null, gv: null, inc: [], tit: {}, fotos: [], notas: '' });
  $('#lista').innerHTML = '';
  syncEstado = null; pintarSync();
});
// Indicador de sincronización (nube de la barra superior y Ajustes)
function haceCuanto(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return 'recién';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`;
}
let syncEstado = null;
function pintarSync() {
  const e = syncEstado, b = $('#btn-sync');
  const activo = !!cuentaActual && !!e;
  b.hidden = !activo; $('#aj-sync').hidden = !activo;
  if (!activo) return;
  const fase = e.fase === 'ok' && e.pendientes ? 'pendiente' : e.fase;
  b.dataset.fase = fase;
  const textos = {
    sincronizando: ['Sincronizando…', ''],
    ok: ['Al día', e.ultimo ? ' · ' + haceCuanto(e.ultimo) : ''],
    pendiente: ['Con cambios sin subir', ` · ${e.pendientes}`],
    'sin-conexion': ['Sin conexión', e.pendientes ? ` · ${e.pendientes} cambio${e.pendientes > 1 ? 's' : ''} para subir` : ''],
    error: ['No se pudo sincronizar', e.pendientes ? ` · ${e.pendientes} pendiente${e.pendientes > 1 ? 's' : ''}` : ''],
    inactivo: ['—', ''],
  }[fase] || ['—', ''];
  $('#aj-sync-estado').textContent = textos[0];
  $('#aj-sync-detalle').textContent = textos[1];
  b.setAttribute('aria-label', 'Sincronización: ' + textos[0]);
  $('#btn-sync-ahora').disabled = fase === 'sincronizando';
}
window.addEventListener('arac:sync-estado', e => { syncEstado = e.detail; pintarSync(); });
setInterval(() => { if (syncEstado && syncEstado.fase === 'ok') pintarSync(); }, 30000);   // "hace X min"
const sincronizarYa = () => {
  if (typeof Sync === 'undefined') return;
  if (navigator.onLine === false) { toast('Sin conexión: se sincroniza solo al volver internet'); return; }
  Sync.ahora();
};
$('#btn-sync').addEventListener('click', () => {
  const f = $('#btn-sync').dataset.fase;
  if (f === 'ok') toast('Todo sincronizado ✓'); else sincronizarYa();
});
$('#btn-sync-ahora').addEventListener('click', sincronizarYa);

// La nube trajo cambios: repintar si no hay nada abierto encima
window.addEventListener('arac:sync-cambios', () => {
  if (!pila.length && vistaActual === 'partidos') renderPartidos();
});

// ---------------- Inicio ----------------
setTimeout(() => {
  const s = $('#splash');
  s.classList.add('fuera');
  animar($('#v-partidos'), 'entra');
  setTimeout(() => s.remove(), 450);
}, 1400);
