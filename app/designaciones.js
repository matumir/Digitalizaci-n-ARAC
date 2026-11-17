'use strict';
/* ARAC Partidos — contador de designaciones.

   Una designación es un día con partidos: tres partidos cargados con la misma fecha cuentan
   como una sola (aunque sean de ligas distintas). Con una liga elegida, cuenta los días con
   partidos de esa liga.
   - Por año: cada año con el anterior.
   - Por mes: los meses del año elegido, con el mismo mes del año anterior de fondo. Al tocar
     un mes se ven los días y cuántos partidos hubo cada uno.
   Lo usa la vista Designaciones (partidos de este teléfono) y el panel de administrador
   (partidos de un árbitro, leídos de la nube). */

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const FECHA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;
const cantidad = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const dosCifras = n => String(n).padStart(2, '0');

// Días con partidos: Map fecha → partidos de ese día (los de liga, si se pide una)
function diasDesignados(partidos, liga = 'todas') {
  const dias = new Map();
  partidos.forEach(p => {
    if (!FECHA_VALIDA.test(p.fecha || '') || (liga !== 'todas' && p.liga !== liga)) return;
    if (!dias.has(p.fecha)) dias.set(p.fecha, []);
    dias.get(p.fecha).push(p);
  });
  return dias;
}
// Designaciones y partidos en un período: '' (todo), 'AAAA' o 'AAAA-MM'
function contarPeriodo(dias, periodo) {
  let d = 0, p = 0;
  dias.forEach((ps, f) => { if (f.startsWith(periodo)) { d++; p += ps.length; } });
  return { d, p };
}
const textoPeriodo = periodo => (!periodo ? 'en total'
  : periodo.length === 4 ? 'en ' + periodo : `en ${MESES[Number(periodo.slice(5)) - 1]} ${periodo.slice(0, 4)}`);

function difDe(actual, previo) {
  if (previo == null) return null;
  const d = actual - previo;
  return el('span', { class: 'desig-dif' + (d > 0 ? ' sube' : d < 0 ? ' baja' : '') }, d > 0 ? '+' + d : d < 0 ? '−' + -d : '=');
}

// est: { modo: 'anio' | 'mes', anio, liga, abierto } — queda guardado afuera para no perder la elección
function contadorDesignaciones(partidos, est) {
  const cont = el('div', { class: 'desig' });
  const hoy = hoyISO();
  const anioHoy = Number(hoy.slice(0, 4));
  if (!est.modo) Object.assign(est, { modo: 'mes', anio: anioHoy, liga: 'todas', abierto: null });

  function pintar() {
    const dias = diasDesignados(partidos, est.liga);
    const anios = [...new Set([anioHoy, ...[...dias.keys()].map(f => Number(f.slice(0, 4)))])].sort((a, b) => b - a);
    if (!anios.includes(est.anio)) est.anio = anioHoy;
    const cambiar = cambios => { Object.assign(est, cambios); pintar(); };
    const chip = (texto, sel, onclick) => el('button', { type: 'button', class: 'chip' + (sel ? ' sel' : ''), onclick }, texto);

    const ligas = el('div', { class: 'chips' },
      chip('Todas las ligas', est.liga === 'todas', () => cambiar({ liga: 'todas', abierto: null })),
      LIGAS.map(l => chip(l.corto, est.liga === l.id, () => cambiar({ liga: l.id, abierto: null }))));
    const modos = el('div', { class: 'chips desig-modos' },
      chip('Por año', est.modo === 'anio', () => cambiar({ modo: 'anio', abierto: null })),
      chip('Por mes', est.modo === 'mes', () => cambiar({ modo: 'mes', abierto: null })));

    const filas = el('div', { class: 'desig-filas' });
    let resumen, pie = null;
    const pct = (v, max) => (max ? Math.max(v ? 4 : 0, Math.round(v / max * 100)) : 0);
    const barra = (actual, previo, max) => el('span', { class: 'desig-barra' },
      previo ? el('i', { class: 'desig-prev', style: `width:${pct(previo, max)}%` }) : null,
      el('i', { class: 'desig-act', style: `width:${pct(actual, max)}%` }));

    if (est.modo === 'anio') {
      const datos = anios.map(a => ({ a, ...contarPeriodo(dias, String(a)), previo: anios.includes(a - 1) ? contarPeriodo(dias, String(a - 1)).d : null }));
      const max = Math.max(0, ...datos.map(x => x.d));
      const total = contarPeriodo(dias, '');
      resumen = [cantidad(total.d, 'designación', 'designaciones'), `${cantidad(total.p, 'partido', 'partidos')} · ${cantidad(anios.length, 'año', 'años')}`];
      datos.forEach(x => filas.append(el('button', { type: 'button', class: 'desig-fila', onclick: () => cambiar({ modo: 'mes', anio: x.a, abierto: null }) },
        el('span', { class: 'desig-et' }, String(x.a)),
        barra(x.d, null, max),
        el('span', { class: 'desig-num' }, el('b', {}, String(x.d)), el('small', {}, cantidad(x.p, 'partido', 'partidos'))),
        difDe(x.d, x.previo))));
      pie = 'Tocá un año para verlo mes por mes. El número de color compara con el año anterior.';
    } else {
      const a = est.anio;
      const hayPrevio = [...dias.keys()].some(f => f.startsWith(String(a - 1)));
      const meses = MESES_CORTO.map((m, i) => {
        const clave = `${a}-${dosCifras(i + 1)}`;
        return { i, clave, ...contarPeriodo(dias, clave), previo: hayPrevio ? contarPeriodo(dias, `${a - 1}-${dosCifras(i + 1)}`).d : null, futuro: clave > hoy.slice(0, 7) };
      });
      const max = Math.max(0, ...meses.map(x => Math.max(x.d, x.previo || 0)));
      const total = contarPeriodo(dias, String(a));
      const totalPrevio = hayPrevio ? contarPeriodo(dias, String(a - 1)).d : null;
      resumen = [cantidad(total.d, 'designación', 'designaciones') + ' en ' + a,
        cantidad(total.p, 'partido', 'partidos') + (totalPrevio != null ? ` · ${a - 1}: ${totalPrevio}` : '')];
      const selAnio = el('div', { class: 'chips' }, anios.map(x => chip(String(x), x === a, () => cambiar({ anio: x, abierto: null }))));
      filas.append(selAnio);
      if (hayPrevio) filas.append(el('p', { class: 'desig-leyenda' }, el('i', { class: 'desig-act' }), String(a), el('i', { class: 'desig-prev' }), String(a - 1)));
      meses.forEach(x => {
        const abierto = est.abierto === x.clave;
        filas.append(el('button', {
          type: 'button', class: 'desig-fila' + (x.futuro && !x.d ? ' futuro' : '') + (abierto ? ' abierta' : ''), 'aria-expanded': x.d ? String(abierto) : false,
          onclick: () => { if (x.d) cambiar({ abierto: abierto ? null : x.clave }); },
        },
          el('span', { class: 'desig-et' }, MESES_CORTO[x.i]),
          barra(x.d, x.previo, max),
          el('span', { class: 'desig-num' }, el('b', {}, String(x.d)), x.p ? el('small', {}, cantidad(x.p, 'partido', 'partidos')) : null),
          x.futuro ? null : difDe(x.d, x.previo)));
        if (abierto) filas.append(detalleMes(dias, x.clave));
      });
      pie = 'Tocá un mes para ver los días. Varios partidos el mismo día cuentan como una designación.';
    }

    cont.replaceChildren(
      ligas, modos,
      el('div', { class: 'desig-total' }, el('b', {}, resumen[0]), el('span', {}, resumen[1])),
      filas,
      pie ? el('p', { class: 'fotos-nota' }, pie) : null);
  }
  pintar();
  return cont;
}

// Días de un mes con sus partidos
function detalleMes(dias, clave) {
  const lista = el('div', { class: 'desig-dias' });
  [...dias.keys()].filter(f => f.startsWith(clave)).sort().forEach(f => {
    const ps = dias.get(f);
    const ligas = [...new Set(ps.map(p => (ligaDe(p.liga) || {}).corto).filter(Boolean))].join(' · ');
    lista.append(el('div', { class: 'desig-dia' },
      el('span', {}, fechaLarga(f).replace(/ de \d{4}$/, '')),
      el('small', {}, [cantidad(ps.length, 'partido', 'partidos'), ligas].filter(Boolean).join(' · '))));
  });
  return lista;
}

// ---------------- Vista Designaciones (partidos de este teléfono) ----------------
const DESIG = {};
async function renderDesignaciones() {
  if (!DB.activa()) return;
  const todos = await DB.partidos();
  const cont = $('#desig-cuerpo');
  if (!todos.length) {
    cont.replaceChildren(el('div', { class: 'vacio' },
      el('p', {}, 'Cuando cargues partidos, acá vas a ver cuántas designaciones tuviste por año y por mes.'),
      el('button', { type: 'button', class: 'btn btn-primary', onclick: () => mostrarVista('cargar') }, 'Cargar partido')));
    return;
  }
  cont.replaceChildren(el('div', { class: 'd-seccion' }, contadorDesignaciones(todos, DESIG)));
}
window.addEventListener('arac:fin-sesion', () => { Object.keys(DESIG).forEach(k => delete DESIG[k]); $('#desig-cuerpo').innerHTML = ''; });
