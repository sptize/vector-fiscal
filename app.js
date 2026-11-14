'use strict';

let state;
let tab = 'pagos';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const save = () => KV.set('state', state);
const hayNotif = () => 'Notification' in window;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('on'), 2600);
}

/* ================= SELECTOR DE FECHA (botones) ================= */
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const parseYMD = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
const sumaDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
function textoFecha(s) {
  const d = parseYMD(s);
  return DIAS[d.getDay()] + ' ' + d.getDate() + ' de ' + MESES[d.getMonth()].toLowerCase() + ' ' + d.getFullYear();
}
function campoFecha(valor) {
  return `<div class="fecha" data-fecha>
    <span class="lbl">Fecha en que pagaste</span>
    <div class="opts">
      <button type="button" class="opt" data-fset="0">Hoy</button>
      <button type="button" class="opt" data-fset="-1">Ayer</button>
      <button type="button" class="opt" data-fset="-2">Anteayer</button>
    </div>
    <div class="stepper">
      <button type="button" class="ghost" data-fstep="-1" aria-label="Un día antes">‹</button>
      <div class="vista" data-fshow></div>
      <button type="button" class="ghost" data-fstep="1" aria-label="Un día después">›</button>
    </div>
    <label class="otra">Otra fecha (calendario)<input type="date" name="fecha" value="${esc(valor)}" max="${ymd(new Date())}" required></label>
  </div>`;
}
function fechaMarcar(box) {
  if (!box) return;
  const inp = box.querySelector('input[type=date]');
  const show = box.querySelector('[data-fshow]');
  if (!inp.value) { show.textContent = 'Elige una fecha'; return; }
  const diff = Math.round((parseYMD(inp.value) - startOfDay(new Date())) / 864e5);
  box.querySelectorAll('[data-fset]').forEach(b => b.classList.toggle('on', Number(b.dataset.fset) === diff));
  box.querySelector('[data-fstep="1"]').disabled = diff >= 0;
  show.textContent = textoFecha(inp.value);
}
function fechaPoner(box, d) {
  const hoy = startOfDay(new Date());
  box.querySelector('input[type=date]').value = ymd(d > hoy ? hoy : d);
  fechaMarcar(box);
}

/* ================= PAGOS ================= */
function codigos(ob) {
  const fila = (nombre, valor) => valor
    ? `<div class="code"><span>${nombre}</span><b>${esc(valor)}</b><button class="ghost small" data-copy="${esc(valor)}">Copiar</button></div>`
    : '';
  const rc = fila('Código Transfermóvil', ob.codigoRC);
  const tr = fila('Código del tributo', ob.codigoTributo);
  if (!rc && !tr) return `<div class="codes"><button class="link" data-go="ajustes">Falta el código · ponlo en Ajustes</button></div>`;
  return `<div class="codes">${rc}${tr}${rc ? '' : '<button class="link" data-go="ajustes">Falta el código Transfermóvil</button>'}</div>`;
}

function tarjeta(it) {
  const cls = it.daysLeft < 0 ? 'late' : it.daysLeft === 0 ? 'today' : it.daysLeft <= 2 ? 'soon' : '';
  let monto;
  if (it.amount === null) {
    monto = `<p class="warn">Falta anotar el 10% de ${it.falta.map(i => nombreMes(i, true)).join(', ')}. <button class="link" data-go="ingresos">Anotar</button></p>`;
  } else if (it.amount === 0 && it.ob.tipo === 'fijo') {
    monto = `<p class="warn">Falta poner el monto. <button class="link" data-go="ajustes">Ajustes</button></p>`;
  } else {
    monto = `<div class="monto">${money(it.amount)}</div>`;
  }
  return `<article class="card ${cls}">
    <div class="row"><div><h3>${esc(it.ob.nombre)}</h3><p class="sub">${it.label}</p></div><span class="chip ${cls}">${textoEstado(it)}</span></div>
    ${monto}
    <p class="sub">Límite: ${it.due.getDate()} de ${MESES[it.due.getMonth()].toLowerCase()} de ${it.due.getFullYear()}</p>
    ${codigos(it.ob)}
    <button class="primary" data-act="pagar" data-key="${esc(it.key)}">Ya pagué</button>
  </article>`;
}

function vistaPagos() {
  const now = new Date();
  const cur = ymIdx(now.getFullYear(), now.getMonth());
  const off = Number(state.settings.offset) || 0;
  const items = computeItems(state, now).filter(i => !i.pago && !esCero(i)).sort((a, b) => a.due - b.due);

  const regla = off === 0
    ? `En <b>${nombreMes(cur)}</b> se paga lo de <b>${nombreMes(cur)}</b> (el mismo mes).`
    : `En <b>${nombreMes(cur)}</b> se paga lo de <b>${nombreMes(cur - off)}</b>. Lo de ${nombreMes(cur)} se paga en <b>${nombreMes(cur + off)}</b>.`;
  const trims = state.obligaciones.filter(o => o.frecuencia === 'trimestral');
  const reglaTrim = trims.length ? `<p><b>${trims.map(o => esc(o.nombre)).join(', ')}</b> se paga por trimestres vencidos: ${
    [0, 3, 6, 9].map(q => ({ pay: (q + 2 + off) % 12, q }))
      .sort((a, b) => a.pay - b.pay)
      .map(x => `en ${MESES[x.pay].toLowerCase()} se paga ${MESES[x.q].toLowerCase()}–${MESES[x.q + 2].toLowerCase()}`).join(', ')}.</p>` : '';

  let aviso = '';
  if (hayNotif() && Notification.permission === 'default') {
    aviso = `<div class="banner"><span>Activa los avisos para no olvidar un pago.</span><button class="primary small" data-act="permiso">Activar</button></div>`;
  } else if (hayNotif() && Notification.permission === 'denied') {
    aviso = `<div class="banner"><span>Los avisos están bloqueados en el navegador.</span></div>`;
  } else if (!hayNotif()) {
    aviso = `<div class="banner"><span>Este navegador no permite avisos. Usa el calendario (Ajustes).</span></div>`;
  }

  const conMonto = items.filter(i => i.amount !== null);
  const total = conMonto.reduce((s, i) => s + i.amount, 0);
  const sinMonto = items.length - conMonto.length;

  const hero = items.length
    ? `<section class="hero"><div class="eyebrow">Por pagar</div><div class="big">${money(total)}</div>
        <div class="sub">${items.length} ${items.length === 1 ? 'pago' : 'pagos'}${sinMonto ? ` · ${sinMonto} sin monto aún` : ''}</div></section>`
    : `<section class="hero ok"><div class="big">Todo al día ✓</div><div class="sub">No tienes pagos pendientes.</div></section>`;

  return `${aviso}${hero}
    ${items.map(tarjeta).join('')}
    <details class="info"><summary>Cómo se calcula cada mes</summary><div>
      <p>${regla}</p>${reglaTrim}
      <p>Si ya pagaste alguno de los de arriba, toca «Ya pagué» para que deje de avisarte.</p>
    </div></details>`;
}

function abrirPago(key) {
  const it = computeItems(state).find(i => i.key === key);
  if (!it) return;
  const dlg = $('#dlg');
  dlg.innerHTML = `<form id="fpago">
    <h3>${esc(it.ob.nombre)} · ${it.label}</h3>
    ${campoFecha(ymd(new Date()))}
    <label>Monto pagado (CUP)<input type="number" name="monto" inputmode="decimal" step="any" min="0" value="${it.amount ?? ''}" required></label>
    <label>Recargo por mora o multa pagado (CUP)<input type="number" name="mora" inputmode="decimal" step="any" min="0" value="0"></label>
    ${it.daysLeft < 0 ? '<p class="warn">Este pago estaba vencido: si te cobraron recargo, anótalo arriba.</p>' : ''}
    <label>Mensaje de Transfermóvil (opcional)
      <textarea name="mensaje" rows="5" placeholder="Copia el mensaje que te llegó y pégalo aquí: guarda el código de la transferencia."></textarea></label>
    <button type="button" class="ghost small" id="pegar" style="margin-top:6px">Pegar del portapapeles</button>
    <div class="acciones">
      <button type="button" class="ghost" id="cancelar">Cancelar</button>
      <button type="submit" class="primary" style="margin:0">Guardar pago</button>
    </div>
  </form>`;
  dlg.showModal();
  fechaMarcar(dlg.querySelector('[data-fecha]'));
  $('#cancelar').onclick = () => dlg.close();
  $('#pegar').onclick = () => pegarEn($('#fpago [name=mensaje]'));
  $('#fpago').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    state.pagos[key] = {
      fecha: f.get('fecha'),
      monto: Number(f.get('monto')) || 0,
      mora: Number(f.get('mora')) || 0,
      mensaje: String(f.get('mensaje') || '').trim()
    };
    await save();
    dlg.close();
    toast('Pago guardado. Ya no te avisaré de este.');
    render();
  };
}

async function pegarEn(campo) {
  try {
    campo.value = (await navigator.clipboard.readText()) || campo.value;
    if (!campo.value) toast('No hay nada copiado');
  } catch (_) {
    campo.focus();
    toast('Mantén presionado el cuadro y elige «Pegar»');
  }
}

function abrirEditarPago(key) {
  const p = state.pagos[key];
  if (!p) return;
  const [obId, per] = key.split('|');
  const ob = state.obligaciones.find(o => o.id === obId);
  const len = ob && ob.frecuencia === 'trimestral' ? 3 : 1;
  const dlg = $('#dlg');
  dlg.innerHTML = `<form id="fedit">
    <h3>Editar pago</h3>
    <p class="muted">${esc(ob ? ob.nombre : '(eliminada)')} · ${etiquetaPeriodo(parseYM(per), len)}</p>
    ${campoFecha(p.fecha || ymd(new Date()))}
    <label>Monto pagado (CUP)<input type="number" name="monto" inputmode="decimal" step="any" min="0" value="${p.monto}" required></label>
    <label>Recargo por mora o multa pagado (CUP)<input type="number" name="mora" inputmode="decimal" step="any" min="0" value="${p.mora || 0}"></label>
    <div class="acciones">
      <button type="button" class="ghost" id="cancelar3">Cancelar</button>
      <button type="submit" class="primary" style="margin:0">Guardar cambios</button>
    </div>
  </form>`;
  dlg.showModal();
  fechaMarcar(dlg.querySelector('[data-fecha]'));
  $('#cancelar3').onclick = () => dlg.close();
  $('#fedit').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    p.fecha = f.get('fecha');
    p.monto = Number(f.get('monto')) || 0;
    p.mora = Number(f.get('mora')) || 0;
    await save();
    dlg.close();
    toast('Pago actualizado');
    render();
  };
}

function abrirComprobante(key) {
  const p = state.pagos[key];
  if (!p) return;
  const dlg = $('#dlg');
  dlg.innerHTML = `<form id="fcomp">
    <h3>Mensaje de Transfermóvil</h3>
    <p class="muted">Pago del ${esc(p.fecha)} · ${money(p.monto)}</p>
    <textarea name="mensaje" rows="8" placeholder="Pega aquí el mensaje de Transfermóvil.">${esc(p.mensaje || '')}</textarea>
    <div class="acciones">
      <button type="button" class="ghost" id="pegar2">Pegar</button>
      <button type="button" class="ghost" id="copiar2">Copiar</button>
    </div>
    <div class="acciones">
      <button type="button" class="ghost" id="cerrar2">Cerrar</button>
      <button type="submit" class="primary" style="margin:0">Guardar</button>
    </div>
  </form>`;
  dlg.showModal();
  const campo = $('#fcomp [name=mensaje]');
  $('#cerrar2').onclick = () => dlg.close();
  $('#pegar2').onclick = () => pegarEn(campo);
  $('#copiar2').onclick = async () => {
    try { await navigator.clipboard.writeText(campo.value); toast('Mensaje copiado'); }
    catch (_) { campo.select(); toast('Selecciónalo y cópialo'); }
  };
  $('#fcomp').onsubmit = async e => {
    e.preventDefault();
    p.mensaje = campo.value.trim();
    await save();
    dlg.close();
    toast('Guardado');
    render();
  };
}

/* ================= 10% Y 5% ================= */
const abiertos = new Set();
const abOb = new Set();

function vistaIngresos() {
  const now = new Date();
  const cur = ymIdx(now.getFullYear(), now.getMonth());
  const ini = parseYM(state.settings.inicio);
  const base = baseOb(state);
  const pcts = state.obligaciones.filter(o => o.tipo === 'porcentaje');
  const otros = pcts.filter(o => !base || o.id !== base.id);
  const nb = base ? base.porcentaje + '%' : 'pago';
  const tarjetas = [];
  for (let i = cur; i >= Math.min(ini, cur); i--) {
    const key = ymKey(i);
    const d = desgloseMes(state, key);
    const hay = ingresosDe(state, key) !== undefined;
    const filas = d.filas.map(f => `<tr>
      <td>${num(f.e.monto)}${f.e.nota ? `<div class="muted">${esc(f.e.nota)}</div>` : ''}</td>
      ${otros.map(o => `<td class="n">${num(f.imp[o.id].pagar)}</td>`).join('')}
      <td><button class="ghost small danger" data-act="del-ingreso" data-mes="${key}" data-id="${esc(f.e.id)}">Quitar</button></td></tr>`).join('');
    const resumen = !hay ? '' : (base ? `<p class="muted">Pagando ${num(d.total)} del ${base.porcentaje}%, tus ingresos del mes equivalen a <b>${num(d.ingreso)}</b>.</p>` : '') +
      otros.map(o => {
        const t = d.tot[o.id];
        if (t.exento > 0 && t.pagar === 0) {
          const faltaPago = base ? t.falta * Number(base.porcentaje) / 100 : t.falta;
          return `<p>El <b>${o.porcentaje}%</b> de ${nombreMes(i)}: <b>no lo pagas</b> (no pasas el mínimo exento de ${num(t.exento)}).${t.falta > 0 ? ` Te faltan ${num(faltaPago)} más de ${nb} para empezar a pagarlo.` : ''}</p>`;
        }
        return `<p>${esc(o.nombre)} de ${nombreMes(i)}: <b>${money(t.pagar)}</b></p>`;
      }).join('');
    tarjetas.push(`<details class="mes" data-mes-d="${key}" ${(i >= cur - 1 || abiertos.has(key)) ? 'open' : ''}>
      <summary>${nombreMes(i, true)} <span class="muted">· ${hay ? 'pagas ' + money(d.total) : 'sin anotar'}</span></summary>
      ${d.filas.length ? `<div class="tabla-wrap" style="margin-top:10px"><table>
        <thead><tr><th>Pago ${nb}</th>${otros.map(o => `<th class="n">${o.porcentaje}%</th>`).join('')}<th></th></tr></thead>
        <tbody>${filas}</tbody>
        <tfoot><tr><td>${num(d.total)}</td>${otros.map(o => `<td class="n">${num(d.tot[o.id].pagar)}</td>`).join('')}<td></td></tr></tfoot>
      </table></div>` : (hay ? '<p class="muted">Sin pagos este mes.</p>' : '')}
      <form class="addf" data-addmes="${key}">
        <input type="number" name="monto" inputmode="decimal" step="any" min="0" placeholder="Lo que pagas del ${nb} (ej. 300)" required>
        <input name="nota" placeholder="Nota (opcional)">
        <button type="submit" class="primary" style="margin:0">Agregar</button>
      </form>
      ${!hay ? `<button class="link" data-act="sin-ingresos" data-mes="${key}">No tuve pagos este mes</button>` : ''}
      ${resumen}
    </details>`);
  }
  const ex = otros.find(o => Number(o.exento) > 0);
  return `<h2>Lo que pagas del ${nb}</h2>
    <p class="sub" style="margin:0 4px 8px">Anota cada pago del ${nb} y la app calcula tus ingresos y el ${otros.map(o => o.porcentaje + '%').join(' y ') || 'otro impuesto'}.</p>
    <details class="info"><summary>¿Cómo funciona?</summary><div>
      <p>Anota cada pago del ${nb} tal como lo pagas (no tus ingresos). La app deduce tus ingresos${base ? ` (el ${base.porcentaje}% es una décima parte)` : ''} y te dice cuánto toca${otros.length ? ' del ' + otros.map(o => o.porcentaje + '%').join(' y ') : ''}.${ex ? ` Al ${ex.porcentaje}% se le descuentan ${num(ex.exento)} de ingresos al mes: por debajo de eso no pagas nada.` : ''}</p>
    </div></details>
    ${tarjetas.join('')}`;
}

/* ================= HISTORIAL ================= */
const fechaCorta = s => { if (!s) return '—'; const d = parseYMD(s); return d.getDate() + ' ' + MESES[d.getMonth()].slice(0, 3).toLowerCase() + ' ' + d.getFullYear(); };

function vistaHistorial() {
  const filas = [];
  let tot = 0, mora = 0;
  for (const [key, p] of Object.entries(state.pagos)) {
    const [obId, per] = key.split('|');
    const ob = state.obligaciones.find(o => o.id === obId);
    const len = ob && ob.frecuencia === 'trimestral' ? 3 : 1;
    filas.push({ key, p, nombre: ob ? ob.nombre : '(eliminada)', etiqueta: etiquetaPeriodo(parseYM(per), len) });
    tot += p.monto; mora += p.mora;
  }
  filas.sort((a, b) => (b.p.fecha || '').localeCompare(a.p.fecha || ''));
  const lista = filas.length ? filas.map(f => `<div class="pago">
      <div class="row"><div><h3>${esc(f.nombre)}</h3><span class="sub">${esc(f.etiqueta)}</span></div>
        <div class="importe">${money(f.p.monto)}</div></div>
      ${f.p.mora ? `<div class="mora">Recargo: ${money(f.p.mora)}</div>` : ''}
      <div class="fila2">
        <span class="fecha-txt">${fechaCorta(f.p.fecha)}</span>
        <button class="ghost small" data-act="editar-pago" data-key="${esc(f.key)}">Editar</button>
        <button class="ghost small" data-act="comprobante" data-key="${esc(f.key)}">${f.p.mensaje ? 'Mensaje' : '+ Mensaje'}</button>
        <button class="ghost small danger" data-act="deshacer" data-key="${esc(f.key)}">Deshacer</button>
      </div></div>`).join('')
    : `<div class="panel"><p class="muted" style="text-align:center">Todavía no has registrado pagos.</p></div>`;
  return `<h2>Pagos realizados</h2>
    <div class="totales"><div><span class="sub">Total pagado</span><b>${money(tot)}</b></div>
      <div><span class="sub">Recargos</span><b>${money(mora)}</b></div></div>
    ${lista}
    <p class="muted" style="margin:12px 4px">«Recargos» es lo que pagaste de más por mora o multas. La meta es que se quede en 0.</p>`;
}

/* ================= RESUMEN ANUAL (PDF / imprimible) ================= */
let anio = new Date().getFullYear();

function datosAnio(y) {
  const meses = Array.from({ length: 12 }, () => ({ porOb: {}, mora: 0, total: 0 }));
  const lista = [];
  for (const [key, p] of Object.entries(state.pagos)) {
    const [obId, per] = key.split('|');
    const idx = parseYM(per);
    if (idxY(idx) !== y) continue;
    const ob = state.obligaciones.find(o => o.id === obId);
    const colId = ob ? obId : 'otros';
    const mm = meses[idxM(idx)];
    mm.porOb[colId] = (mm.porOb[colId] || 0) + p.monto;
    mm.mora += p.mora;
    mm.total += p.monto + p.mora;
    const len = ob && ob.frecuencia === 'trimestral' ? 3 : 1;
    lista.push({ p, nombre: ob ? ob.nombre : '(eliminada)', etiqueta: etiquetaPeriodo(idx, len) });
  }
  lista.sort((a, b) => (a.p.fecha || '').localeCompare(b.p.fecha || ''));
  meses.forEach((mm, m) => { mm.ingreso = ingresoMes(state, ymKey(ymIdx(y, m))); });
  return { meses, lista };
}

function modeloResumen() {
  const { meses, lista } = datosAnio(anio);
  const cols = state.obligaciones.map(o => ({ id: o.id, nombre: o.nombre }));
  if (lista.some(l => l.nombre === '(eliminada)')) cols.push({ id: 'otros', nombre: 'Otros' });
  const tot = { ing: 0, mora: 0, total: 0, porOb: {} };
  meses.forEach(mm => {
    if (mm.ingreso !== undefined) tot.ing += mm.ingreso;
    tot.mora += mm.mora; tot.total += mm.total;
    cols.forEach(c => { tot.porOb[c.id] = (tot.porOb[c.id] || 0) + (mm.porOb[c.id] || 0); });
  });
  return { meses, lista, cols, tot };
}

function vistaResumen() {
  const now = new Date();
  const y0 = Math.min(idxY(parseYM(state.settings.inicio)), now.getFullYear());
  const anios = [];
  for (let y = now.getFullYear(); y >= y0; y--) anios.push(y);
  if (!anios.includes(anio)) anio = anios[0];
  const { meses, lista, cols, tot } = modeloResumen();
  const cel = v => v ? num(v) : '—';
  const filas = meses.map((mm, m) => `<tr><td>${MESES[m]}</td><td class="n">${mm.ingreso === undefined ? '—' : cel(mm.ingreso)}</td>
      ${cols.map(c => `<td class="n">${cel(mm.porOb[c.id])}</td>`).join('')}
      <td class="n">${cel(mm.mora)}</td><td class="n"><b>${cel(mm.total)}</b></td></tr>`).join('');
  const detalle = lista.length ? lista.map(l => `<tr>
      <td>${esc(l.p.fecha)}</td><td>${esc(l.nombre)}</td><td>${esc(l.etiqueta)}</td>
      <td class="n">${num(l.p.monto)}</td><td class="n">${l.p.mora ? num(l.p.mora) : '—'}</td>
      <td class="msg">${l.p.mensaje ? esc(l.p.mensaje) : '—'}</td></tr>`).join('')
    : '<tr><td colspan="6" class="muted">No hay pagos registrados en este año.</td></tr>';
  const nombre = (state.settings.nombre || '').trim();

  return `<div class="no-print">
      <h2>Resumen del año</h2>
      <div class="panel">
        <label style="margin-top:0">Año<select id="anio">${anios.map(y => `<option ${y === anio ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
        <button class="primary" data-act="pdf">Crear PDF</button>
        <div class="acciones" style="margin-bottom:0"><button class="ghost" data-act="imprimir">Imprimir</button></div>
      </div>
    </div>
    <section id="reporte">
      <h1 class="solo-print">Resumen de pagos a la ONAT · ${anio}</h1>
      <p class="solo-print muted">${nombre ? esc(nombre) + ' · ' : ''}Generado el ${now.getDate()} de ${MESES[now.getMonth()].toLowerCase()} de ${now.getFullYear()}</p>
      <h2>Por mes</h2>
      <div class="tabla-wrap"><table class="rep">
        <thead><tr><th>Mes</th><th class="n">Ingresos estimados</th>${cols.map(c => `<th class="n">${esc(c.nombre)}</th>`).join('')}<th class="n">Recargos</th><th class="n">Total pagado</th></tr></thead>
        <tbody>${filas}</tbody>
        <tfoot><tr><td>Total ${anio}</td><td class="n">${cel(tot.ing)}</td>${cols.map(c => `<td class="n">${cel(tot.porOb[c.id])}</td>`).join('')}<td class="n">${cel(tot.mora)}</td><td class="n">${num(tot.total)}</td></tr></tfoot>
      </table></div>
      <p class="muted" style="margin:8px 4px">Ingresos estimados = lo que anotaste del 10% × 10. Recargos = mora o multas. Montos en CUP.</p>
      <h2>Detalle de pagos</h2>
      <div class="tabla-wrap"><table class="rep">
        <thead><tr><th>Fecha</th><th>Pago</th><th>Corresponde a</th><th class="n">Monto</th><th class="n">Recargo</th><th>Mensaje de Transfermóvil</th></tr></thead>
        <tbody>${detalle}</tbody>
      </table></div>
    </section>`;
}

/* ---------- PDF propio (sin librerías, funciona sin internet) ---------- */
function crearPDF() {
  const { meses, lista, cols, tot } = modeloResumen();
  const W = 595.28, H = 841.89, MG = 40, AN = W - 2 * MG;
  const cv = document.createElement('canvas').getContext('2d');
  const medir = (t, sz, b) => { cv.font = (b ? 'bold ' : '') + sz + 'px Arial, Helvetica, sans-serif'; return cv.measureText(t).width; };
  const winansi = t => {
    let o = '';
    for (const ch of String(t)) {
      const c = ch.codePointAt(0);
      o += c < 128 || (c > 159 && c < 256) ? ch : c === 0x2013 ? '\x96' : c === 0x2014 ? '\x97' : c === 0x2026 ? '\x85'
        : (c === 0x2018 || c === 0x2019) ? "'" : (c === 0x201c || c === 0x201d) ? '"' : '?';
    }
    return o.replace(/[\\()]/g, '\\$&');
  };
  const f2 = n => n.toFixed(2);
  const paginas = [];
  let ops = [], y = MG;
  const nueva = () => { if (ops.length) paginas.push(ops); ops = []; y = MG; };
  const texto = (t, x, yy, sz, b, gris) =>
    ops.push(`BT ${gris ? '0.42 g' : '0.09 g'} /${b ? 'F2' : 'F1'} ${sz} Tf ${f2(x)} ${f2(H - yy)} Td (${winansi(t)}) Tj ET`);
  const rect = (x, yy, w, h, g) => ops.push(`${g} g ${f2(x)} ${f2(H - yy - h)} ${f2(w)} ${f2(h)} re f`);
  const linea = (yy, g) => ops.push(`${g} G 0.5 w ${f2(MG)} ${f2(H - yy)} m ${f2(MG + AN)} ${f2(H - yy)} l S`);

  function envolver(t, w, sz, b, max) {
    const out = [];
    for (const par of String(t).split('\n')) {
      let lin = '';
      for (const pal of par.split(/\s+/)) {
        const prueba = lin ? lin + ' ' + pal : pal;
        if (medir(prueba, sz, b) <= w) { lin = prueba; continue; }
        if (lin) out.push(lin);
        lin = pal;
        while (lin.length > 1 && medir(lin, sz, b) > w) {
          let k = lin.length - 1;
          while (k > 1 && medir(lin.slice(0, k), sz, b) > w) k--;
          out.push(lin.slice(0, k)); lin = lin.slice(k);
        }
      }
      out.push(lin);
    }
    if (max && out.length > max) { out.length = max; out[max - 1] += '…'; }
    return out;
  }

  function tabla(cs, filas, pie) {
    const sz = 8.5, lh = 11, pad = 5;
    const cabecera = () => {
      const ls = cs.map(c => envolver(c.t, c.w - 2 * pad, sz, true));
      const h = Math.max(...ls.map(l => l.length)) * lh + 2 * pad - 2;
      if (y + h > H - MG - 20) nueva();
      rect(MG, y, AN, h, 0.93);
      let x = MG;
      cs.forEach((c, i) => {
        ls[i].forEach((l, k) => texto(l, c.a === 'r' ? x + c.w - pad - medir(l, sz, true) : x + pad, y + pad + 8 + k * lh, sz, true, true));
        x += c.w;
      });
      y += h;
    };
    const fila = (cells, negrita) => {
      const ls = cells.map((t, i) => envolver(t, cs[i].w - 2 * pad, sz, negrita, 10));
      const h = Math.max(...ls.map(l => l.length)) * lh + 2 * pad - 2;
      if (y + h > H - MG - 20) { nueva(); cabecera(); }
      if (negrita) rect(MG, y, AN, h, 0.93);
      let x = MG;
      cells.forEach((_, i) => {
        ls[i].forEach((l, k) => texto(l, cs[i].a === 'r' ? x + cs[i].w - pad - medir(l, sz, negrita) : x + pad, y + pad + 8 + k * lh, sz, negrita, false));
        x += cs[i].w;
      });
      y += h;
      linea(y, 0.85);
    };
    cabecera();
    filas.forEach(r => fila(r, false));
    if (pie) fila(pie, true);
  }

  const cel = v => v ? num(v) : '—';
  const hoy = new Date();
  const nombre = (state.settings.nombre || '').trim();
  nueva();
  texto('Resumen de pagos a la ONAT · ' + anio, MG, y + 16, 17, true);
  y += 26;
  texto((nombre ? nombre + ' · ' : '') + 'Generado el ' + hoy.getDate() + ' de ' + MESES[hoy.getMonth()].toLowerCase() + ' de ' + hoy.getFullYear(), MG, y + 8, 9, false, true);
  y += 26;
  texto('Por mes', MG, y + 10, 11, true); y += 18;

  const wFijo = 62 + 70 + 55 + 70, wOb = (AN - wFijo) / cols.length;
  tabla(
    [{ t: 'Mes', w: 62 }, { t: 'Ingresos estimados', w: 70, a: 'r' }, ...cols.map(c => ({ t: c.nombre, w: wOb, a: 'r' })), { t: 'Recargos', w: 55, a: 'r' }, { t: 'Total pagado', w: 70, a: 'r' }],
    meses.map((mm, m) => [MESES[m], mm.ingreso === undefined ? '—' : cel(mm.ingreso), ...cols.map(c => cel(mm.porOb[c.id])), cel(mm.mora), cel(mm.total)]),
    ['Total ' + anio, cel(tot.ing), ...cols.map(c => cel(tot.porOb[c.id])), cel(tot.mora), num(tot.total)]
  );
  y += 6;
  texto('Ingresos estimados = lo que anotaste del 10% × 10. Recargos = mora o multas. Montos en CUP.', MG, y + 8, 8, false, true);
  y += 26;
  if (y > H - MG - 80) nueva();
  texto('Detalle de pagos', MG, y + 10, 11, true); y += 18;
  if (lista.length) {
    tabla(
      [{ t: 'Fecha', w: 54 }, { t: 'Pago', w: 82 }, { t: 'Corresponde a', w: 100 }, { t: 'Monto', w: 52, a: 'r' }, { t: 'Recargo', w: 48, a: 'r' }, { t: 'Mensaje de Transfermóvil', w: AN - 336 }],
      lista.map(l => [l.p.fecha || '—', l.nombre, l.etiqueta, num(l.p.monto), l.p.mora ? num(l.p.mora) : '—', l.p.mensaje || '—'])
    );
  } else {
    texto('No hay pagos registrados en este año.', MG, y + 8, 9.5, false, true);
  }
  if (ops.length) paginas.push(ops);

  paginas.forEach((p, i) => {
    const t = 'Página ' + (i + 1) + ' de ' + paginas.length;
    p.push(`BT 0.42 g /F1 8 Tf ${f2(MG + AN - medir(t, 8, false))} ${f2(MG - 18)} Td (${t}) Tj ET`);
  });

  let out = '%PDF-1.4\n';
  const offs = [];
  const add = (n, cuerpo) => { offs[n] = out.length; out += n + ' 0 obj\n' + cuerpo + '\nendobj\n'; };
  const n = paginas.length;
  add(1, '<< /Type /Catalog /Pages 2 0 R >>');
  add(2, `<< /Type /Pages /Kids [${paginas.map((_, i) => (6 + 2 * i) + ' 0 R').join(' ')}] /Count ${n} >>`);
  add(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  paginas.forEach((p, i) => {
    const c = p.join('\n');
    add(5 + 2 * i, `<< /Length ${c.length} >>\nstream\n${c}\nendstream`);
    add(6 + 2 * i, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${5 + 2 * i} 0 R >>`);
  });
  const total = 5 + 2 * n;
  const xref = out.length;
  out += `xref\n0 ${total}\n0000000000 65535 f \n` + offs.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') +
    `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const bytes = Uint8Array.from(out, ch => ch.charCodeAt(0) & 255);
  descargar('pagos-onat-' + anio + '.pdf', 'application/pdf', bytes);
  toast('PDF creado: ' + 'pagos-onat-' + anio + '.pdf');
}

/* ================= AJUSTES ================= */
const REFERENCIA = [
  ['0114022', 'Impuesto s/ ventas y servicios (PN)'],
  ['0510122', 'Impuesto s/ ingresos personales – aporte mensual'],
  ['0520522', 'Impuesto s/ ingresos personales – retención TCP'],
  ['0530222', 'Imp. s/ ingresos personales (liquidación adicional)'],
  ['0610322', 'Impuesto por utilización de fuerza de trabajo (PN)'],
  ['0810132', 'Contribución a la seguridad social'],
  ['0820132', 'Contribución especial a la seguridad social'],
  ['0820232', 'Contrib. esp. trabajador seg. social, retenciones']
];

function formOb(o) {
  const pct = o.tipo === 'porcentaje';
  return `<details data-ob="${o.id}" ${abOb.has(o.id) ? 'open' : ''}>
    <summary>${esc(o.nombre)} <span class="muted">· ${o.frecuencia === 'trimestral' ? 'cada 3 meses' : 'cada mes'}</span></summary>
    <label>Nombre<input data-f="nombre" value="${esc(o.nombre)}"></label>
    <div class="grid2">
      <label>Código Transfermóvil<input data-f="codigoRC" inputmode="numeric" value="${esc(o.codigoRC)}" placeholder="5 dígitos"></label>
      <label>Código del tributo<input data-f="codigoTributo" inputmode="numeric" value="${esc(o.codigoTributo)}" placeholder="opcional"></label>
    </div>
    <div class="grid2">
      <label>Se paga<select data-f="frecuencia">
        <option value="mensual" ${o.frecuencia === 'mensual' ? 'selected' : ''}>Cada mes</option>
        <option value="trimestral" ${o.frecuencia === 'trimestral' ? 'selected' : ''}>Cada 3 meses</option>
      </select></label>
      <label>Día límite<input type="number" min="1" max="31" data-f="diaLimite" value="${o.diaLimite}"></label>
    </div>
    <label>El monto es<select data-f="tipo">
      <option value="fijo" ${!pct ? 'selected' : ''}>Un monto fijo</option>
      <option value="porcentaje" ${pct ? 'selected' : ''}>Un % de mis ingresos</option>
    </select></label>
    ${pct
      ? `<div class="grid2">
          <label>Porcentaje (%)<input type="number" step="any" min="0" data-f="porcentaje" value="${o.porcentaje}"></label>
          <label>Mínimo exento al mes<input type="number" step="any" min="0" data-f="exento" value="${o.exento}"></label>
        </div>`
      : `<label>${o.frecuencia === 'trimestral' ? 'Monto de cada pago (los 3 meses juntos, CUP)' : 'Monto por cada pago (CUP)'}<input type="number" step="any" min="0" data-f="monto" value="${o.monto}"></label>`}
    <div class="acciones"><button class="ghost small danger" data-act="borrar-ob" data-id="${o.id}">Eliminar este pago</button></div>
  </details>`;
}

function vistaAjustes() {
  const s = state.settings;
  const perm = hayNotif() ? ({ granted: 'activados', denied: 'bloqueados', default: 'sin activar' }[Notification.permission]) : 'no disponibles';
  return `<h2>La app</h2>
    <div class="panel">
      <div class="row" style="align-items:center"><div><b>Versión ${APP_VERSION}</b><p class="sub" style="margin:0">Busca mejoras y las instala.</p></div>
        <button class="ghost" data-act="actualizar">Actualizar</button></div>
    </div>

    <h2>Mis pagos</h2>
    ${state.obligaciones.map(formOb).join('')}
    <div class="acciones"><button class="ghost" data-act="nueva-ob">+ Agregar otro pago</button></div>

    <h2>Cuándo se paga</h2>
    <div class="panel">
      <label style="margin-top:0">En «10% y 5%» anoto el pago de<select id="baseId">
        ${state.obligaciones.filter(o => o.tipo === 'porcentaje').map(o => `<option value="${o.id}" ${(baseOb(state) || {}).id === o.id ? 'selected' : ''}>${esc(o.nombre)}</option>`).join('')}
      </select></label>
      <label>Lo de un mes se paga<select id="offset">
        <option value="0" ${s.offset == 0 ? 'selected' : ''}>El mismo mes</option>
        <option value="1" ${s.offset == 1 ? 'selected' : ''}>Un mes después</option>
        <option value="2" ${s.offset == 2 ? 'selected' : ''}>Dos meses después</option>
      </select></label>
      <div class="fecha">
        <span class="lbl">Llevar el control desde</span>
        <div class="stepper">
          <button type="button" class="ghost" data-act="inicio-paso" data-paso="-1" aria-label="Un mes antes">‹</button>
          <div class="vista">${nombreMes(parseYM(s.inicio), true)}</div>
          <button type="button" class="ghost" data-act="inicio-paso" data-paso="1" aria-label="Un mes después" ${parseYM(s.inicio) >= ymIdx(new Date().getFullYear(), new Date().getMonth()) ? 'disabled' : ''}>›</button>
        </div>
      </div>
    </div>

    <h2>Avisos</h2>
    <div class="panel">
      <p class="sub" style="margin:0">Avisos <b>${perm}</b>. Salen 2 días antes, 1 día antes, el mismo día y cada día si ya venció.</p>
      <label>Avisarme a partir de las<select id="hora">
        ${[6, 7, 8, 9, 10, 12, 14].map(h => `<option value="${h}" ${Number(s.horaAviso) === h ? 'selected' : ''}>${h}:00</option>`).join('')}
      </select></label>
      <div class="acciones">
        <button class="ghost" data-act="permiso">Activar avisos</button>
        <button class="ghost" data-act="probar">Probar</button>
        <button class="ghost" data-act="ics">Agregar al calendario</button>
      </div>
    </div>

    <h2>Resumen y respaldo</h2>
    <div class="panel">
      <label style="margin-top:0">Tu nombre (sale en el PDF)<input id="nombre" value="${esc(s.nombre || '')}" placeholder="Opcional"></label>
      <div class="acciones">
        <button class="ghost" data-act="exportar">Guardar respaldo</button>
        <button class="ghost" data-act="importar">Restaurar respaldo</button>
        <input type="file" id="archivo" accept="application/json" hidden>
      </div>
    </div>

    <details class="info"><summary>Códigos de ejemplo</summary><div>
      <p>Salen de un vector fiscal de ejemplo. Para pagar por Transfermóvil se usa el código de 5 dígitos (RC-04A) de la segunda columna de <b>tu</b> vector, en la fila del tributo y mes.</p>
      <table>${REFERENCIA.map(r => `<tr><td><b>${r[0]}</b></td><td style="white-space:normal">${r[1]}</td></tr>`).join('')}</table>
    </div></details>`;
}

/* ================= ACCIONES ================= */
async function pedirPermiso() {
  if (!hayNotif()) return toast('Este navegador no permite avisos');
  const r = await Notification.requestPermission();
  if (r === 'granted') {
    await registrarSync();
    toast('Avisos activados');
    revisar();
  } else {
    toast('No se activaron los avisos');
  }
  render();
}

async function registrarSync() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if ('periodicSync' in reg) await reg.periodicSync.register('revisar-pagos', { minInterval: 6 * 3600 * 1000 });
  } catch (e) { /* no disponible: igual avisa al abrir la app */ }
}

async function revisar() {
  if (!hayNotif() || Notification.permission !== 'granted' || !('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    await revisarAvisos(state, reg);
  } catch (e) { /* ignorar */ }
}

async function actualizarApp() {
  if (!('serviceWorker' in navigator)) { location.reload(); return; }
  if (!navigator.onLine) return toast('Sin internet: conéctate para actualizar');
  toast('Buscando actualización…');
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) { location.reload(); return; }
    await reg.update();
    if (reg.waiting) reg.waiting.postMessage('saltar');
    const nuevo = reg.installing || reg.waiting;
    if (nuevo && nuevo.state !== 'activated') {
      toast('Instalando actualización…');
      await new Promise(res => {
        nuevo.addEventListener('statechange', () => { if (nuevo.state === 'activated') res(); });
        setTimeout(res, 15000);
      });
    }
    // ¿La página abierta es de otra versión que la del servidor?
    const r = await fetch('core.js?nc=' + Date.now(), { cache: 'no-store' });
    const v = ((await r.text()).match(/APP_VERSION = '([^']+)'/) || [])[1];
    if (v && v !== APP_VERSION) { toast('Actualizando a la versión ' + v + '…'); setTimeout(() => location.reload(), 700); }
    else toast('Ya tienes la última versión (' + APP_VERSION + ')');
  } catch (_) { toast('No se pudo buscar la actualización'); }
}

async function probarAviso() {
  if (!hayNotif() || Notification.permission !== 'granted') return toast('Primero activa los avisos');
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification('Aviso de prueba', { body: 'Así te voy a avisar de tus pagos.', icon: 'icon-192.png' });
}

function descargar(nombre, tipo, texto) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texto], { type: tipo }));
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function generarICS() {
  const now = new Date();
  const hora = String(Number(state.settings.horaAviso) || 8).padStart(2, '0');
  const stamp = ymd(now).replace(/-/g, '') + 'T000000';
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vector Fiscal//ES', 'CALSCALE:GREGORIAN'];
  const alarma = (trig, txt) => ['BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + txt, 'TRIGGER:' + trig, 'END:VALARM'];
  const hoy = startOfDay(now);
  for (const it of computeItems(state, now, 12)) {
    if (it.pago || esCero(it) || it.due < hoy) continue;
    const d = ymd(it.due).replace(/-/g, '');
    const txt = 'Pagar ' + it.ob.nombre + ' (' + it.label + ')';
    L.push('BEGIN:VEVENT', 'UID:' + it.key.replace('|', '-') + '@vector-fiscal', 'DTSTAMP:' + stamp,
      'DTSTART:' + d + 'T' + hora + '0000', 'DTEND:' + d + 'T' + hora + '3000',
      'SUMMARY:' + txt + (it.ob.codigoRC ? ' - código ' + it.ob.codigoRC : ''),
      ...alarma('-P2D', 'En 2 días vence: ' + txt),
      ...alarma('-P1D', 'Mañana vence: ' + txt),
      ...alarma('PT0S', 'HOY vence: ' + txt),
      'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  descargar('pagos-onat.ics', 'text/calendar', L.join('\r\n'));
  toast('Abre el archivo para agregarlo al calendario');
}

document.addEventListener('click', async e => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.tab) { tab = t.dataset.tab; render(); window.scrollTo(0, 0); return; }
  if (t.dataset.go) { tab = t.dataset.go; render(); window.scrollTo(0, 0); return; }
  if (t.dataset.fset !== undefined || t.dataset.fstep !== undefined) {
    const box = t.closest('[data-fecha]');
    const inp = box.querySelector('input[type=date]');
    const hoy = startOfDay(new Date());
    const base = inp.value ? parseYMD(inp.value) : hoy;
    fechaPoner(box, t.dataset.fset !== undefined ? sumaDias(hoy, Number(t.dataset.fset)) : sumaDias(base, Number(t.dataset.fstep)));
    return;
  }
  if (t.dataset.copy) {
    try { await navigator.clipboard.writeText(t.dataset.copy); toast('Código copiado'); }
    catch (_) { toast('Código: ' + t.dataset.copy); }
    return;
  }
  switch (t.dataset.act) {
    case 'pagar': abrirPago(t.dataset.key); break;
    case 'comprobante': abrirComprobante(t.dataset.key); break;
    case 'editar-pago': abrirEditarPago(t.dataset.key); break;
    case 'inicio-paso': {
      const now = new Date();
      const idx = Math.min(parseYM(state.settings.inicio) + Number(t.dataset.paso), ymIdx(now.getFullYear(), now.getMonth()));
      state.settings.inicio = ymKey(idx); await save(); render(); break;
    }
    case 'deshacer':
      if (confirm('¿Deshacer este pago? Volverá a aparecer como pendiente.')) {
        delete state.pagos[t.dataset.key]; await save(); render();
      }
      break;
    case 'del-ingreso': {
      const l = (ingresosDe(state, t.dataset.mes) || []).filter(x => x.id !== t.dataset.id);
      if (l.length) state.ingresos[t.dataset.mes] = l; else delete state.ingresos[t.dataset.mes];
      abiertos.add(t.dataset.mes); await save(); render(); break;
    }
    case 'sin-ingresos': state.ingresos[t.dataset.mes] = []; await save(); render(); break;
    case 'imprimir': window.print(); break;
    case 'pdf': crearPDF(); break;
    case 'actualizar': actualizarApp(); break;
    case 'permiso': pedirPermiso(); break;
    case 'probar': probarAviso(); break;
    case 'ics': generarICS(); break;
    case 'nueva-ob':
      { const nid = nuevoId(); abOb.add(nid);
      state.obligaciones.push({ id: nid, nombre: 'Nuevo pago', codigoRC: '', codigoTributo: '', tipo: 'fijo', monto: 0, porcentaje: 0, exento: 0, frecuencia: 'mensual', diaLimite: 10 }); }
      await save(); render(); break;
    case 'borrar-ob':
      if (confirm('¿Eliminar este pago de la lista? Los pagos ya registrados se conservan en el historial.')) {
        state.obligaciones = state.obligaciones.filter(o => o.id !== t.dataset.id); await save(); render();
      }
      break;
    case 'exportar':
      descargar('respaldo-vector-fiscal-' + ymd(new Date()) + '.json', 'application/json', JSON.stringify(state, null, 2));
      break;
    case 'importar': $('#archivo').click(); break;
  }
});

document.addEventListener('submit', async e => {
  const f = e.target;
  if (!f.dataset || !f.dataset.addmes) return;
  e.preventDefault();
  const key = f.dataset.addmes;
  if (f.monto.value === '' || !(Number(f.monto.value) >= 0)) return;
  const l = ingresosDe(state, key) || [];
  l.push({ id: nuevoId(), monto: Number(f.monto.value), nota: f.nota.value.trim() });
  state.ingresos[key] = l;
  abiertos.add(key);
  await save(); render();
  const nf = document.querySelector('[data-addmes="' + key + '"] [name=monto]');
  if (nf) nf.focus();
});

document.addEventListener('toggle', e => {
  const d = e.target;
  if (d.dataset && d.dataset.mesD) { if (d.open) abiertos.add(d.dataset.mesD); else abiertos.delete(d.dataset.mesD); }
  if (d.dataset && d.dataset.ob) { if (d.open) abOb.add(d.dataset.ob); else abOb.delete(d.dataset.ob); }
}, true);

document.addEventListener('change', async e => {
  const el = e.target;
  if (el.matches && el.matches('[data-fecha] input[type=date]')) { fechaMarcar(el.closest('[data-fecha]')); return; }
  if (el.id === 'archivo') {
    try {
      const data = JSON.parse(await el.files[0].text());
      if (!data.obligaciones || !data.settings) throw new Error('formato');
      state = migrarState(data);
      await save(); toast('Respaldo restaurado'); render();
    } catch (_) { toast('Ese archivo no es un respaldo válido'); }
    return;
  }
  if (el.dataset.f) {
    const ob = state.obligaciones.find(o => o.id === el.closest('[data-ob]').dataset.ob);
    const num = ['monto', 'porcentaje', 'exento', 'diaLimite'].includes(el.dataset.f);
    ob[el.dataset.f] = num ? (Number(el.value) || 0) : el.value.trim();
    await save();
    if (['tipo', 'nombre', 'frecuencia'].includes(el.dataset.f)) render();
    return;
  }
  if (el.id === 'anio') { anio = Number(el.value); render(); return; }
  if (el.id === 'nombre') { state.settings.nombre = el.value.trim(); await save(); toast('Guardado'); return; }
  if (el.id === 'baseId') { state.settings.baseId = el.value; await save(); toast('Guardado'); return; }
  if (el.id === 'offset') { state.settings.offset = Number(el.value); await save(); toast('Guardado'); return; }
  if (el.id === 'hora') { state.settings.horaAviso = Number(el.value); await save(); toast('Guardado'); return; }
});

/* ================= RENDER / ARRANQUE ================= */
function render() {
  const f = new Date();
  $('#hoy').textContent = f.getDate() + ' de ' + MESES[f.getMonth()].toLowerCase() + ' de ' + f.getFullYear();
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const vistas = { pagos: vistaPagos, ingresos: vistaIngresos, historial: vistaHistorial, resumen: vistaResumen, ajustes: vistaAjustes };
  // No repintar Ajustes mientras se escribe en un campo
  $('#app').innerHTML = vistas[tab]();
}

async function init() {
  let st = null;
  try { st = await KV.get('state'); } catch (_) { /* sin almacenamiento */ }
  state = migrarState(st || defaultState());
  if (!st) { try { await save(); } catch (_) { } }
  render();

  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('sw.js');
      if (hayNotif() && Notification.permission === 'granted') registrarSync();
    } catch (_) { /* sin SW (por ejemplo, abierto como archivo) */ }
  }
  revisar();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); revisar(); } });
  setInterval(revisar, 5 * 60 * 1000);
}
init();
