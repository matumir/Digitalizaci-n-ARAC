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
let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2200);
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
function abrirCapa(id, alCerrar) {
  $(id).hidden = false;
  pila.push({ id, alCerrar });
  history.pushState({ capa: id }, '');
}
function cerrarCapa() { if (pila.length) history.back(); }
window.addEventListener('popstate', () => {
  const c = pila.pop();
  if (!c) return;
  $(c.id).hidden = true;
  if (c.alCerrar) c.alCerrar();
});
document.addEventListener('click', e => { if (e.target.closest('[data-cerrar]')) cerrarCapa(); });

document.querySelectorAll('.tabbar button').forEach(b => b.addEventListener('click', () => mostrarVista(b.dataset.vista)));
function mostrarVista(v) {
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('activa', b.dataset.vista === v));
  $('#v-partidos').hidden = v !== 'partidos';
  $('#v-cargar').hidden = v !== 'cargar';
  window.scrollTo(0, 0);
  if (v === 'partidos') renderPartidos();
  if (v === 'cargar') renderCargar();
}

// ---------------- CARGAR ----------------
const form = { liga: null, cat: null, sub: null, local: null, visit: null, fecha: hoyISO(), fotos: [], notas: '' };

function renderCargar() {
  const cont = $('#c-ligas'); cont.innerHTML = '';
  LIGAS.forEach(l => cont.append(el('button', {
    type: 'button', class: 'liga-card' + (form.liga === l.id ? ' sel' : ''),
    onclick: () => {
      if (form.liga !== l.id) { form.liga = l.id; form.cat = null; form.sub = null; form.local = null; form.visit = null; }
      renderCargar();
      setTimeout(() => $('#p-cat').scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    },
  }, el('img', { src: l.logo, alt: '' }), l.corto)));

  $('#p-cat').hidden = !form.liga;
  if (form.liga) {
    const cc = $('#c-cats'); cc.innerHTML = '';
    categorias(form.liga).forEach(c => cc.append(el('button', {
      type: 'button', class: 'chip' + (form.cat === c.id ? ' sel' : ''),
      onclick: () => { if (form.cat !== c.id) { form.cat = c.id; form.sub = null; } renderCargar(); },
    }, c.nombre)));
  }
  const cat = form.liga && form.cat ? catDe(form.liga, form.cat) : null;
  $('#p-sub').hidden = !(cat && cat.subs);
  if (cat && cat.subs) {
    $('#c-sub-titulo').textContent = cat.id === 'femenino' ? 'Categoría femenina' : 'División de inferiores';
    const cs = $('#c-subs'); cs.innerHTML = '';
    cat.subs.forEach(s => cs.append(el('button', {
      type: 'button', class: 'chip' + (form.sub === s ? ' sel' : ''),
      onclick: () => { form.sub = s; renderCargar(); },
    }, s)));
  }
  const catLista = cat && (!cat.subs || form.sub);
  ['#p-equipos', '#p-fecha', '#p-fotos', '#p-notas', '#barra-guardar'].forEach(s => { $(s).hidden = !catLista; });
  if (!catLista) return;

  pintarSlot('#slot-local', 'Local', form.local, 'local');
  pintarSlot('#slot-visit', 'Visitante', form.visit, 'visit');
  $('#c-fecha').value = form.fecha;
  $('#c-notas').value = form.notas;
  pintarFotosForm();
  $('#btn-guardar').disabled = !(form.local && form.visit);
}

function pintarSlot(sel, rol, id, campo) {
  const b = $(sel); b.innerHTML = '';
  b.classList.toggle('lleno', !!id);
  b.append(el('span', { class: 'rol' }, rol));
  if (id) {
    b.append(escudo(id), el('span', { class: 'nombre' }, CLUB[id].nombre));
  } else {
    b.append(el('span', { class: 'mas' }, '+'), 'Tocá para elegir');
  }
  b.onclick = () => elegirClub(rol, campo);
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
  blobs.forEach(b => form.fotos.push({ id: uid(), blob: b, url: URL.createObjectURL(b) }));
  pintarFotosForm();
}));
function pintarFotosForm() {
  const c = $('#c-fotos'); c.innerHTML = '';
  form.fotos.forEach((f, i) => c.append(el('div', { class: 'mini' },
    el('img', { src: f.url, alt: 'Foto ' + (i + 1) }),
    el('button', { type: 'button', class: 'quitar', 'aria-label': 'Quitar foto', onclick: () => {
      URL.revokeObjectURL(f.url); form.fotos.splice(i, 1); pintarFotosForm();
    } }, '✕'))));
}

$('#btn-guardar').addEventListener('click', async () => {
  if (!form.local || !form.visit) { toast('Elegí los dos equipos'); return; }
  const btn = $('#btn-guardar'); btn.disabled = true;
  const p = {
    id: uid(), liga: form.liga, cat: form.cat, sub: form.sub || null,
    local: form.local, visit: form.visit, fecha: form.fecha || hoyISO(), notas: form.notas.trim(), creado: Date.now(),
  };
  const fotos = form.fotos.map((f, i) => ({ id: uid() + i, partido: p.id, blob: f.blob, orden: i }));
  try {
    await DB.guardar(p, fotos);
  } catch (e) {
    btn.disabled = false; toast('No se pudo guardar. Probá de nuevo.'); return;
  }
  form.fotos.forEach(f => URL.revokeObjectURL(f.url));
  // Se mantienen liga, categoría y fecha para cargar el siguiente más rápido.
  form.local = null; form.visit = null; form.fotos = []; form.notas = '';
  ver.liga = p.liga; ver.cat = p.cat; ver.sub = null;
  toast('Partido guardado ✓');
  renderCargar();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ---------------- PARTIDOS ----------------
const ver = { liga: 'sf', cat: 'todas', sub: null };

async function renderPartidos() {
  const todos = await DB.partidos();
  const tabs = $('#ver-ligas'); tabs.innerHTML = '';
  LIGAS.forEach(l => {
    const n = todos.filter(p => p.liga === l.id).length;
    tabs.append(el('button', {
      type: 'button', class: ver.liga === l.id ? 'sel' : '',
      onclick: () => { ver.liga = l.id; ver.cat = 'todas'; ver.sub = null; renderPartidos(); },
    }, el('img', { src: l.logo, alt: '' }), l.corto, el('span', { class: 'cuenta' }, n === 1 ? '1 partido' : n + ' partidos')));
  });

  const deLiga = todos.filter(p => p.liga === ver.liga);
  const cats = $('#ver-cats'); cats.innerHTML = '';
  [{ id: 'todas', nombre: 'Todas' }, ...categorias(ver.liga)].forEach(c => {
    const n = c.id === 'todas' ? deLiga.length : deLiga.filter(p => p.cat === c.id).length;
    cats.append(el('button', {
      type: 'button', class: 'chip' + (ver.cat === c.id ? ' sel' : ''),
      onclick: () => { ver.cat = c.id; ver.sub = null; renderPartidos(); },
    }, `${c.id === 'primera' ? 'Primera' : c.id === 'tercera' ? 'Tercera' : c.nombre} (${n})`));
  });
  const cat = catDe(ver.liga, ver.cat);
  const subs = $('#ver-subs');
  subs.hidden = !(cat && cat.subs);
  if (cat && cat.subs) {
    subs.innerHTML = '';
    [null, ...cat.subs].forEach(s => subs.append(el('button', {
      type: 'button', class: 'chip' + (ver.sub === s ? ' sel' : ''),
      onclick: () => { ver.sub = s; renderPartidos(); },
    }, s || 'Todas')));
  }

  let lista = deLiga;
  if (ver.cat !== 'todas') lista = lista.filter(p => p.cat === ver.cat);
  if (ver.sub) lista = lista.filter(p => p.sub === ver.sub);
  lista.sort((a, b) => (b.fecha.localeCompare(a.fecha)) || (b.creado - a.creado));

  const cont = $('#lista'); cont.innerHTML = '';
  if (!lista.length) {
    cont.append(el('div', { class: 'vacio' },
      el('img', { src: ligaDe(ver.liga).logo, alt: '' }),
      el('p', {}, deLiga.length ? 'No hay partidos en esta categoría.' : 'Todavía no cargaste partidos de esta liga.'),
      el('button', { type: 'button', class: 'btn', onclick: () => {
        form.liga = ver.liga;
        if (ver.cat !== 'todas') { form.cat = ver.cat; form.sub = ver.sub; }
        mostrarVista('cargar');
      } }, 'Cargar partido')));
    return;
  }
  // Cantidad de fotos por partido
  const nf = {};
  await Promise.all(lista.map(async p => { nf[p.id] = (await DB.fotosDe(p.id)).length; }));
  let fechaAnt = '';
  lista.forEach(p => {
    if (p.fecha !== fechaAnt) { fechaAnt = p.fecha; cont.append(el('div', { class: 'grupo-fecha' }, fechaLarga(p.fecha))); }
    cont.append(el('button', { type: 'button', class: 'partido', onclick: () => abrirDetalle(p) },
      escudo(p.local),
      el('span', { class: 'medio' },
        el('b', {}, 'vs'),
        el('span', { class: 'cat' }, textoCategoria(p)),
        el('span', { class: 'nfotos' }, nf[p.id] ? `${nf[p.id]} foto${nf[p.id] > 1 ? 's' : ''}` : 'sin fotos'),
        p.notas ? el('span', { class: 'nota-ico' }, '📝 con notas') : null),
      escudo(p.visit)));
  });
}

// ---------------- Detalle ----------------
let fotosVisor = [], idxVisor = 0;
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
  c.append(el('div', { class: 'd-cab' },
    el('div', { class: 'd-equipos' }, eq(p.local), el('b', {}, 'vs'), eq(p.visit)),
    el('div', { class: 'd-meta' },
      el('span', {}, el('b', {}, ligaDe(p.liga).nombre)),
      el('span', {}, textoCategoria(p)),
      el('span', {}, fechaLarga(p.fecha)))));

  const grid = el('div', { class: 'd-fotos' });
  fotosVisor.forEach((f, i) => grid.append(el('button', { type: 'button', onclick: () => abrirVisor(i) }, el('img', { src: f.url, alt: 'Foto ' + (i + 1) }))));
  const inCam = el('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
  const inGal = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const alAgregar = async e => {
    const blobs = await sumarFotos(e.target.files);
    if (!blobs.length) return;
    const base = fotos.length;
    await DB.agregarFotos(blobs.map((b, i) => ({ id: uid() + i, partido: p.id, blob: b, orden: base + i })));
    toast(blobs.length > 1 ? 'Fotos agregadas ✓' : 'Foto agregada ✓');
    pintarDetalle(p);
  };
  inCam.addEventListener('change', alAgregar); inGal.addEventListener('change', alAgregar);
  c.append(el('div', { class: 'd-seccion' },
    el('h4', {}, `Planillas y tarjetas (${fotos.length})`),
    grid,
    el('div', { class: 'foto-botones' },
      el('label', { class: 'btn-sec' }, inCam, '📷 Sacar foto'),
      el('label', { class: 'btn-sec' }, inGal, '🖼️ Agregar de galería'))));

  // Anotaciones: se guardan solas mientras se escribe
  const ta = el('textarea', { class: 'notas', rows: 5, placeholder: 'Incidencias, expulsiones, demoras, observaciones…' });
  ta.value = p.notas || '';
  const estado = el('div', { class: 'notas-estado' });
  let tNota;
  const guardarNota = async () => {
    clearTimeout(tNota);
    if ((p.notas || '') === ta.value.trim()) return;
    p.notas = ta.value.trim();
    try { await DB.actualizar(p); estado.textContent = 'Guardado ✓'; } catch (e) { estado.textContent = 'No se pudo guardar'; }
  };
  ta.addEventListener('input', () => { estado.textContent = 'Escribiendo…'; clearTimeout(tNota); tNota = setTimeout(guardarNota, 700); });
  ta.addEventListener('blur', guardarNota);
  c.append(el('div', { class: 'd-seccion' }, el('h4', {}, 'Anotaciones'), ta, estado));
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

function abrirVisor(i) {
  idxVisor = i; pintarVisor();
  abrirCapa('#visor');
}
function pintarVisor() {
  const n = fotosVisor.length;
  $('#visor-img').src = fotosVisor[idxVisor].url;
  $('#visor-num').textContent = `${idxVisor + 1} / ${n}`;
  $('#visor-ant').hidden = n < 2; $('#visor-sig').hidden = n < 2;
}
$('#visor-ant').addEventListener('click', () => { idxVisor = (idxVisor - 1 + fotosVisor.length) % fotosVisor.length; pintarVisor(); });
$('#visor-sig').addEventListener('click', () => { idxVisor = (idxVisor + 1) % fotosVisor.length; pintarVisor(); });
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
renderPartidos();
setTimeout(() => {
  const s = $('#splash');
  s.classList.add('fuera');
  setTimeout(() => s.remove(), 450);
}, 1400);
