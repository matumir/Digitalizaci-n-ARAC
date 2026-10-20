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
const DB = (() => {
  let db;
  function abrir() {
    if (db) return Promise.resolve(db);
    return new Promise((ok, mal) => {
      const r = indexedDB.open('arac-partidos', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('partidos', { keyPath: 'id' });
        const f = d.createObjectStore('fotos', { keyPath: 'id' });
        f.createIndex('partido', 'partido');
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
  return {
    partidos: () => tx(['partidos'], 'readonly', t => req(t.objectStore('partidos').getAll())),
    guardar: (p, fotos) => tx(['partidos', 'fotos'], 'readwrite', t => {
      t.objectStore('partidos').put(p);
      fotos.forEach(f => t.objectStore('fotos').put(f));
    }),
    fotosDe: id => tx(['fotos'], 'readonly', t => req(t.objectStore('fotos').index('partido').getAll(id))),
    actualizar: p => tx(['partidos'], 'readwrite', t => { t.objectStore('partidos').put(p); }),
    agregarFotos: fotos => tx(['fotos'], 'readwrite', t => { fotos.forEach(f => t.objectStore('fotos').put(f)); }),
    borrarFoto: id => tx(['fotos'], 'readwrite', t => { t.objectStore('fotos').delete(id); }),
    borrarPartido: id => tx(['partidos', 'fotos'], 'readwrite', async t => {
      t.objectStore('partidos').delete(id);
      const fs = t.objectStore('fotos');
      const ids = await req(fs.index('partido').getAllKeys(id));
      ids.forEach(k => fs.delete(k));
    }),
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

const TITULOS = { partidos: 'Partidos', cargar: 'Cargar partido' };
let vistaActual = 'partidos';
document.querySelectorAll('.bottomnav .nav-btn').forEach(b => b.addEventListener('click', () => mostrarVista(b.dataset.vista)));
function mostrarVista(v) {
  const cambia = v !== vistaActual;
  vistaActual = v;
  document.querySelectorAll('.bottomnav .nav-btn').forEach(b => b.classList.toggle('activa', b.dataset.vista === v));
  $('#v-partidos').hidden = v !== 'partidos';
  $('#v-cargar').hidden = v !== 'cargar';
  const tit = $('#titulo-vista');
  tit.textContent = TITULOS[v];
  if (cambia) { animar(tit, 'cambia'); animar($('#v-' + v), 'entra'); }
  window.scrollTo(0, 0);
  if (v === 'partidos') renderPartidos(true);
  if (v === 'cargar') renderCargar();
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
  amarilla: { nombre: 'Amarilla', titulo: 'Tarjeta amarilla' },
  roja:     { nombre: 'Roja',     titulo: 'Tarjeta roja' },
  gol:      { nombre: 'Gol',      titulo: 'Gol' },
  cambio:   { nombre: 'Cambio',   titulo: 'Sustitución' },
};
const MOTIVOS = {
  amarilla: ['Juego brusco', 'Protestar', 'Conducta antideportiva', 'Demorar la reanudación', 'No respetar la distancia', 'Infracciones reiteradas', 'Entrar o salir sin permiso', 'Simular'],
  roja: ['Doble amarilla', 'Juego brusco grave', 'Conducta violenta', 'Escupir', 'Evitar un gol con la mano', 'Evitar ocasión manifiesta de gol', 'Lenguaje ofensivo o insultos'],
};
const SUB_GOL = [['normal', 'Jugada'], ['penal', 'De penal'], ['en-contra', 'En contra']];

const ICONOS_INC = {
  amarilla: '<span class="tarjeta amarilla"></span>',
  roja: '<span class="tarjeta roja"></span>',
  gol: '<svg viewBox="0 0 24 24" class="ico-inc"><circle cx="12" cy="12" r="8.5"/><path d="m12 7.8 3.1 2.3-1.2 3.6h-3.8l-1.2-3.6zM12 7.8V3.6M15.1 10.1l3.9-1.3M13.9 13.7l2.4 3.4M10.1 13.7l-2.4 3.4M8.9 10.1 5 8.8"/></svg>',
  cambio: '<svg viewBox="0 0 24 24" class="ico-inc"><path d="M7 4v13M3.5 13.5 7 17l3.5-3.5M17 20V7M13.5 10.5 17 7l3.5 3.5"/></svg>',
};

function valorMinuto(m) {
  const t = String(m || '').match(/^(\d+)(?:\s*\+\s*(\d+))?/);
  return t ? Number(t[1]) + (t[2] ? Number(t[2]) / 100 : 0) : 999;
}
const textoMinuto = m => (m ? `${String(m).replace(/\s+/g, '')}'` : '');
function golesDe(inc) {
  const g = { local: 0, visit: 0 };
  (inc || []).forEach(i => { if (i.tipo === 'gol') g[i.eq]++; });
  return g;
}
function textoInc(i) {
  if (i.tipo === 'cambio') return [i.num ? `Sale ${i.num}` : '', i.num2 ? `entra ${i.num2}` : ''].filter(Boolean).join(', ') || 'Cambio';
  const quien = i.num ? `N° ${i.num}` : (i.tipo === 'gol' ? 'Gol' : TIPOS_INC[i.tipo].titulo);
  if (i.tipo === 'gol' && i.sub === 'penal') return quien + ' (penal)';
  if (i.tipo === 'gol' && i.sub === 'en-contra') return quien + ' (en contra)';
  return quien;
}
function resumenInc(inc) {
  const n = t => (inc || []).filter(i => i.tipo === t).length;
  const partes = [];
  if (n('amarilla')) partes.push(`${n('amarilla')} amarilla${n('amarilla') > 1 ? 's' : ''}`);
  if (n('roja')) partes.push(`${n('roja')} roja${n('roja') > 1 ? 's' : ''}`);
  return partes.join(' · ');
}

/* Sección de incidencias dividida en local y visitante.
   obj: el partido (o el formulario) con local, visit, inc, gl y gv.
   alCambiar(): se llama después de cada alta, edición o baja. */
function seccionIncidencias(obj, alCambiar) {
  const cont = el('div', { class: 'inc-equipos' });
  const pintar = (resaltar) => {
    cont.innerHTML = '';
    ['local', 'visit'].forEach(eq => {
      const id = obj[eq];
      const lista = (obj.inc || []).filter(i => i.eq === eq).sort((a, b) => valorMinuto(a.min) - valorMinuto(b.min));
      const filas = el('div', { class: 'inc-lista' });
      lista.forEach(i => {
        const fila = el('button', { type: 'button', class: 'inc-fila' + (i.id === resaltar ? ' entra' : ''), onclick: () => editorInc(obj, eq, i.tipo, i, pintarYAvisar) },
          el('span', { class: 'inc-ico' }), el('span', { class: 'inc-txt' },
            el('b', {}, textoInc(i)),
            i.motivo ? el('span', {}, i.motivo) : null),
          el('span', { class: 'inc-min' }, textoMinuto(i.min)));
        fila.querySelector('.inc-ico').innerHTML = ICONOS_INC[i.tipo];
        filas.append(fila);
      });
      const botones = el('div', { class: 'inc-botones' });
      Object.keys(TIPOS_INC).forEach(t => {
        const b = el('button', { type: 'button', class: 'inc-btn', onclick: () => editorInc(obj, eq, t, null, pintarYAvisar) },
          el('span', { class: 'inc-ico' }), TIPOS_INC[t].nombre);
        b.querySelector('.inc-ico').innerHTML = ICONOS_INC[t];
        botones.append(b);
      });
      cont.append(el('div', { class: 'inc-equipo' },
        el('div', { class: 'inc-cab' },
          id ? escudo(id) : el('span', { class: 'escudo vacio-esc' }),
          el('div', {}, el('span', { class: 'inc-rol' }, eq === 'local' ? 'Local' : 'Visitante'),
            el('b', {}, id && CLUB[id] ? CLUB[id].nombre : 'Sin elegir'))),
        lista.length ? filas : el('p', { class: 'inc-nada' }, 'Sin incidencias'),
        botones));
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
    const i = el('input', { type: 'text', inputmode: 'numeric', maxlength: 3, class: 'campo campo-num', placeholder: ph });
    i.value = valor || '';
    i.addEventListener('input', () => { i.value = i.value.replace(/\D/g, ''); });
    return [el('label', { class: 'field' }, el('span', { class: 'field-label' }, etiqueta), i), i];
  };
  const fila = el('div', { class: 'inc-campos' });
  let iNum, iNum2;
  if (tipo === 'cambio') {
    const [a, x] = campoNum('Sale N°', v.num, 'Ej: 9'); iNum = x;
    const [b, y] = campoNum('Entra N°', v.num2, 'Ej: 18'); iNum2 = y;
    fila.append(a, b);
  } else {
    const [a, x] = campoNum(tipo === 'gol' && v.sub === 'en-contra' ? 'Jugador N° (rival)' : 'Jugador N°', v.num, 'Ej: 10'); iNum = x;
    fila.append(a);
  }
  // Minuto: teclado de teléfono para poder escribir la adición (45+2)
  const iMin = el('input', { type: 'text', inputmode: 'tel', maxlength: 6, class: 'campo campo-num', placeholder: tipo === 'cambio' ? 'Ej: 65' : 'Ej: 35 o 45+2' });
  iMin.value = v.min || '';
  iMin.addEventListener('input', () => { iMin.value = iMin.value.replace(/[^\d+]/g, '').replace(/\+{2,}/g, '+'); });
  fila.append(el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Minuto'), iMin));
  cuerpo.append(fila);

  // Tipo de gol
  let sub = v.sub || 'normal';
  if (tipo === 'gol') {
    const seg = el('div', { class: 'chips' });
    SUB_GOL.forEach(([k, txt]) => seg.append(el('button', { type: 'button', class: 'chip' + (k === sub ? ' sel' : ''), onclick: e => {
      sub = k;
      seg.querySelectorAll('.chip').forEach(c => c.classList.toggle('sel', c === e.currentTarget));
      const lbl = fila.querySelector('.field-label');
      lbl.textContent = k === 'en-contra' ? 'Jugador N° (rival)' : 'Jugador N°';
    } }, txt)));
    cuerpo.append(el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Tipo de gol'), seg));
  }

  // Motivo (sólo tarjetas)
  let iMotivo;
  if (MOTIVOS[tipo]) {
    iMotivo = el('input', { type: 'text', class: 'campo', placeholder: 'Escribí el motivo o elegí uno', maxlength: 120 });
    iMotivo.value = v.motivo || '';
    const sug = el('div', { class: 'chips chips-motivo' });
    const marcar = () => sug.querySelectorAll('.chip').forEach(c => c.classList.toggle('sel', c.textContent === iMotivo.value));
    MOTIVOS[tipo].forEach(m => sug.append(el('button', { type: 'button', class: 'chip', onclick: () => { iMotivo.value = iMotivo.value === m ? '' : m; marcar(); } }, m)));
    iMotivo.addEventListener('input', marcar);
    marcar();
    cuerpo.append(el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Motivo'), iMotivo, sug));
  }

  const guardarInc = () => {
    const nuevo = {
      id: existente ? existente.id : uid(), tipo, eq,
      num: iNum.value.trim(), num2: iNum2 ? iNum2.value.trim() : '',
      min: iMin.value.trim().replace(/\+$/, ''), motivo: iMotivo ? iMotivo.value.trim() : '',
      sub: tipo === 'gol' ? sub : '',
    };
    const antes = golesDe(obj.inc);
    obj.inc = (obj.inc || []).filter(i => i.id !== nuevo.id).concat(nuevo);
    sincronizarResultado(obj, antes);
    cerrarCapa();
    alGuardar(nuevo.id);
    toast(existente ? 'Incidencia actualizada' : `${T.titulo} cargada`);
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
  acciones.append(el('button', { type: 'button', class: 'btn btn-primary', onclick: guardarInc }, existente ? 'Guardar cambios' : 'Agregar'));
  cuerpo.append(acciones);

  abrirCapa('#h-inc');
  // En una carga nueva el cursor va directo al número
  if (!existente) setTimeout(() => iNum.focus(), 380);
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
const form = { liga: null, cat: null, sub: null, local: null, visit: null, fecha: hoyISO(), fotos: [], notas: '', gl: null, gv: null, inc: [] };

function renderCargar() {
  opciones($('#c-ligas'), 'ligas', LIGAS, l => el('button', {
    type: 'button', class: 'liga-card',
    onclick: () => {
      if (form.liga !== l.id) { form.liga = l.id; form.cat = null; form.sub = null; form.local = null; form.visit = null; form.inc = []; }
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
    local: form.local, visit: form.visit, gl: form.gl, gv: form.gv, inc: form.inc, fecha: form.fecha || hoyISO(), notas: form.notas.trim(), creado: Date.now(),
  };
  const fotos = form.fotos.map((f, i) => ({ id: uid() + i, partido: p.id, blob: f.blob, orden: i }));
  try {
    await DB.guardar(p, fotos);
  } catch (e) {
    btn.disabled = false; toast('No se pudo guardar. Probá de nuevo.'); return;
  }
  form.fotos.forEach(f => URL.revokeObjectURL(f.url));
  // Se mantienen liga, categoría y fecha para cargar el siguiente más rápido.
  form.local = null; form.visit = null; form.gl = null; form.gv = null; form.inc = []; form.fotos = []; form.notas = '';
  ver.liga = p.liga; ver.cat = p.cat; ver.sub = null;
  toast('Partido guardado ✓');
  renderCargar();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ---------------- PARTIDOS ----------------
const ver = { liga: 'sf', cat: 'todas', sub: null };

// animarLista: las filas entran escalonadas (al cambiar de vista o de filtro, no al volver del detalle).
async function renderPartidos(animarLista = false) {
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
  fotosVisor.forEach(f => URL.revokeObjectURL(f.url));
  const fotos = (await DB.fotosDe(p.id)).sort((a, b) => (a.orden || 0) - (b.orden || 0));
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
      icono(ICO_DESCARGAR), fotos.length > 1 ? `Descargar las ${fotos.length} fotos` : 'Descargar la foto') : null));

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
      // Navegador: una descarga por foto
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

// ---------------- Inicio ----------------
renderPartidos(true);
setTimeout(() => {
  const s = $('#splash');
  s.classList.add('fuera');
  animar($('#v-partidos'), 'entra');
  setTimeout(() => s.remove(), 450);
}, 1400);
