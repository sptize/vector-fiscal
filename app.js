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

/* ================= PAGOS ================= */
function codigos(ob) {
  const fila = (nombre, valor) => valor
    ? `<div class="code"><span>${nombre}</span><b>${esc(valor)}</b><button class="ghost small" data-copy="${esc(valor)}">Copiar</button></div>`
    : '';
  const rc = fila('Código Transfermóvil (RC-04A)', ob.codigoRC);
  const tr = fila('Código del tributo', ob.codigoTributo);
  if (!rc && !tr) {
    return `<div class="codes"><button class="link" data-go="ajustes">Falta el código: ponlo en Ajustes</button></div>`;
  }
  return `<div class="codes">${rc}${tr}${rc ? '' : '<button class="link" data-go="ajustes">Falta el código RC-04A (Ajustes)</button>'}</div>`;
}

function tarjeta(it) {
  const cls = it.daysLeft < 0 ? 'late' : it.daysLeft === 0 ? 'today' : it.daysLeft <= 2 ? 'soon' : '';
  let monto;
  if (it.amount === null) {
    monto = `<p class="warn">Anota lo que pagas del 10% de ${it.falta.map(i => nombreMes(i, true)).join(', ')} para calcular el monto. <button class="link" data-go="ingresos">Ir a «10% y 5%»</button></p>`;
  } else if (it.amount === 0 && it.ob.tipo === 'fijo') {
    monto = `<p class="warn">Falta poner el monto. <button class="link" data-go="ajustes">Ir a Ajustes</button></p>`;
  } else {
    monto = `<div class="monto">${money(it.amount)}</div>`;
  }
  return `<article class="card ${cls}">
    <div class="row"><h3>${esc(it.ob.nombre)}</h3><span class="chip ${cls}">${textoEstado(it)}</span></div>
    <p class="corresp">Corresponde a <b>${it.label}</b></p>
    <p class="muted">Se paga en ${nombreMes(it.payIdx, true)} · límite: ${it.due.getDate()} de ${MESES[it.due.getMonth()].toLowerCase()}</p>
    ${monto}
    ${codigos(it.ob)}
    <button class="primary" data-act="pagar" data-key="${esc(it.key)}">Ya pagué</button>
  </article>`;
}

function vistaPagos() {
  const now = new Date();
  const cur = ymIdx(now.getFullYear(), now.getMonth());
  const off = Number(state.settings.offset) || 0;
  const items = computeItems(state, now).filter(i => !i.pago).sort((a, b) => a.due - b.due);

  const regla = off === 0
    ? `En <b>${nombreMes(cur)}</b> se paga lo de <b>${nombreMes(cur)}</b> (el mismo mes).`
    : `En <b>${nombreMes(cur)}</b> se paga lo de <b>${nombreMes(cur - off)}</b>. Lo de ${nombreMes(cur)} se paga en <b>${nombreMes(cur + off)}</b>.`;

  let aviso = '';
  if (hayNotif() && Notification.permission === 'default') {
    aviso = `<div class="banner">Activa los avisos para que te recuerde 2 días antes, 1 día antes y el mismo día del pago.<br><button class="primary" data-act="permiso">Activar avisos</button></div>`;
  } else if (hayNotif() && Notification.permission === 'denied') {
    aviso = `<div class="banner">Los avisos están bloqueados. Actívalos en los ajustes del navegador para este sitio.</div>`;
  } else if (!hayNotif()) {
    aviso = `<div class="banner">Este navegador no permite avisos. Instala la app en la pantalla de inicio o usa los recordatorios de calendario (Ajustes).</div>`;
  }

  const conMonto = items.filter(i => i.amount !== null);
  const total = conMonto.reduce((s, i) => s + i.amount, 0);
  const sinMonto = items.length - conMonto.length;

  const lista = items.length
    ? items.map(tarjeta).join('')
    : `<div class="vacio"><b>Todo al día ✓</b><p class="muted">No tienes pagos pendientes por ahora.</p></div>`;

  return `${aviso}
    <div class="regla">${regla}</div>
    ${items.length && !Object.keys(state.pagos).length ? '<p class="muted">Si ya pagaste alguno de estos, toca «Ya pagué» para que deje de avisarte.</p>' : ''}
    ${items.length ? `<div class="resumen"><span>${items.length} por pagar</span><b>${money(total)}</b></div>${sinMonto ? `<p class="muted">Más ${sinMonto} sin monto aún (falta anotar el 10% o poner montos).</p>` : ''}` : ''}
    ${lista}`;
}

function abrirPago(key) {
  const it = computeItems(state).find(i => i.key === key);
  if (!it) return;
  const dlg = $('#dlg');
  dlg.innerHTML = `<form id="fpago">
    <h3>${esc(it.ob.nombre)} · ${it.label}</h3>
    <label>Fecha en que pagaste<input type="date" name="fecha" value="${ymd(new Date())}" required></label>
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
          return `<p>El <b>${o.porcentaje}%</b> de ${nombreMes(i)}: <b>no lo pagas</b> (no pasas el mínimo exento de ${num(t.exento)} en ingresos).${t.falta > 0 ? ` Te faltan ${num(faltaPago)} más de ${nb} para empezar a pagarlo.` : ''}</p>`;
        }
        return `<p>${esc(o.nombre)} de ${nombreMes(i)}: <b>${money(t.pagar)}</b></p>`;
      }).join('');
    tarjetas.push(`<details class="mes" data-mes-d="${key}" ${(i >= cur - 1 || abiertos.has(key)) ? 'open' : ''}>
      <summary>${nombreMes(i, true)} <span class="muted">· ${hay ? 'pagas ' + money(d.total) : 'sin anotar'}</span></summary>
      ${d.filas.length ? `<div class="tabla-wrap"><table>
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
    <p class="muted">Anota cada pago del ${nb} tal como lo pagas (no tus ingresos). La app deduce tus ingresos${base ? ` (el ${base.porcentaje}% es una décima parte)` : ''} y te dice cuánto toca del ${otros.map(o => o.porcentaje + '%').join(' y ') || 'otro impuesto'}.${ex ? ` Al ${ex.porcentaje}% se le descuentan ${num(ex.exento)} de ingresos al mes: por debajo de eso no pagas nada.` : ''}</p>
    ${tarjetas.join('')}`;
}

/* ================= HISTORIAL ================= */
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
  const cuerpo = filas.length ? filas.map(f => `<tr>
      <td>${esc(f.p.fecha)}</td><td>${esc(f.nombre)}</td><td>${esc(f.etiqueta)}</td>
      <td class="n">${money(f.p.monto)}</td><td class="n">${f.p.mora ? money(f.p.mora) : '—'}</td>
      <td><button class="ghost small" data-act="comprobante" data-key="${esc(f.key)}">${f.p.mensaje ? 'Ver mensaje' : 'Agregar'}</button></td>
      <td><button class="ghost small danger" data-act="deshacer" data-key="${esc(f.key)}">Deshacer</button></td></tr>`).join('')
    : `<tr><td colspan="7" class="muted">Todavía no has registrado pagos.</td></tr>`;
  return `<h2>Pagos realizados</h2>
    <div class="tabla-wrap"><table>
      <thead><tr><th>Fecha</th><th>Pago</th><th>Corresponde a</th><th class="n">Monto</th><th class="n">Recargo</th><th>Transfermóvil</th><th></th></tr></thead>
      <tbody>${cuerpo}</tbody>
      <tfoot><tr><td colspan="3">Total</td><td class="n">${money(tot)}</td><td class="n">${money(mora)}</td><td></td><td></td></tr></tfoot>
    </table></div>
    <p class="muted">La columna «Recargo» es lo que has pagado de más por mora o multas. La meta es que se quede en 0.</p>`;
}

/* ================= RESUMEN ANUAL (imprimible) ================= */
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

function vistaResumen() {
  const now = new Date();
  const y0 = Math.min(idxY(parseYM(state.settings.inicio)), now.getFullYear());
  const anios = [];
  for (let y = now.getFullYear(); y >= y0; y--) anios.push(y);
  if (!anios.includes(anio)) anio = anios[0];
  const { meses, lista } = datosAnio(anio);
  const cols = state.obligaciones.map(o => ({ id: o.id, nombre: o.nombre }));
  if (lista.some(l => l.nombre === '(eliminada)')) cols.push({ id: 'otros', nombre: 'Otros' });
  const cel = v => v ? num(v) : '—';
  const tot = { ing: 0, mora: 0, total: 0, porOb: {} };
  const filas = meses.map((mm, m) => {
    if (mm.ingreso !== undefined) tot.ing += mm.ingreso;
    tot.mora += mm.mora; tot.total += mm.total;
    cols.forEach(c => { tot.porOb[c.id] = (tot.porOb[c.id] || 0) + (mm.porOb[c.id] || 0); });
    return `<tr><td>${MESES[m]}</td><td class="n">${mm.ingreso === undefined ? '—' : cel(mm.ingreso)}</td>
      ${cols.map(c => `<td class="n">${cel(mm.porOb[c.id])}</td>`).join('')}
      <td class="n">${cel(mm.mora)}</td><td class="n"><b>${cel(mm.total)}</b></td></tr>`;
  }).join('');
  const detalle = lista.length ? lista.map(l => `<tr>
      <td>${esc(l.p.fecha)}</td><td>${esc(l.nombre)}</td><td>${esc(l.etiqueta)}</td>
      <td class="n">${num(l.p.monto)}</td><td class="n">${l.p.mora ? num(l.p.mora) : '—'}</td>
      <td class="msg">${l.p.mensaje ? esc(l.p.mensaje) : '—'}</td></tr>`).join('')
    : '<tr><td colspan="6" class="muted">No hay pagos registrados en este año.</td></tr>';
  const nombre = (state.settings.nombre || '').trim();

  return `<div class="no-print">
      <h2>Resumen del año</h2>
      <label>Año<select id="anio">${anios.map(y => `<option ${y === anio ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
      <button class="primary" data-act="imprimir">Imprimir o guardar como PDF</button>
      <p class="muted">En la ventana que se abre, elige «Guardar como PDF» o tu impresora. Los pagos se agrupan por el mes al que corresponden.</p>
    </div>
    <section id="reporte">
      <h1 class="solo-print">Resumen de pagos a la ONAT · ${anio}</h1>
      <p class="solo-print muted">${nombre ? esc(nombre) + ' · ' : ''}Generado el ${now.getDate()} de ${MESES[now.getMonth()].toLowerCase()} de ${now.getFullYear()}</p>
      <h3>Por mes (según el mes al que corresponde cada pago)</h3>
      <div class="tabla-wrap"><table class="rep">
        <thead><tr><th>Mes</th><th class="n">Ingresos estimados</th>${cols.map(c => `<th class="n">${esc(c.nombre)}</th>`).join('')}<th class="n">Recargos</th><th class="n">Total pagado</th></tr></thead>
        <tbody>${filas}</tbody>
        <tfoot><tr><td>Total ${anio}</td><td class="n">${cel(tot.ing)}</td>${cols.map(c => `<td class="n">${cel(tot.porOb[c.id])}</td>`).join('')}<td class="n">${cel(tot.mora)}</td><td class="n">${num(tot.total)}</td></tr></tfoot>
      </table></div>
      <p class="muted">Ingresos estimados: lo que anotaste del 10% multiplicado por 10. Recargos: mora o multas pagadas. Montos en CUP.</p>
      <h3>Detalle de pagos</h3>
      <div class="tabla-wrap"><table class="rep">
        <thead><tr><th>Fecha</th><th>Pago</th><th>Corresponde a</th><th class="n">Monto</th><th class="n">Recargo</th><th>Mensaje de Transfermóvil</th></tr></thead>
        <tbody>${detalle}</tbody>
      </table></div>
    </section>`;
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
  return `<details data-ob="${o.id}" open>
    <summary>${esc(o.nombre)}</summary>
    <label>Nombre<input data-f="nombre" value="${esc(o.nombre)}"></label>
    <div class="grid2">
      <label>Código Transfermóvil (RC-04A, 5 dígitos)<input data-f="codigoRC" inputmode="numeric" value="${esc(o.codigoRC)}" placeholder="de la 2.ª columna"></label>
      <label>Código del tributo (opcional)<input data-f="codigoTributo" inputmode="numeric" value="${esc(o.codigoTributo)}" placeholder="ej. 0510122"></label>
    </div>
    <div class="grid2">
      <label>Se paga<select data-f="frecuencia">
        <option value="mensual" ${o.frecuencia === 'mensual' ? 'selected' : ''}>Cada mes</option>
        <option value="trimestral" ${o.frecuencia === 'trimestral' ? 'selected' : ''}>Cada 3 meses</option>
      </select></label>
      <label>Día límite del mes<input type="number" min="1" max="31" data-f="diaLimite" value="${o.diaLimite}"></label>
    </div>
    <label>El monto es<select data-f="tipo">
      <option value="fijo" ${!pct ? 'selected' : ''}>Un monto fijo</option>
      <option value="porcentaje" ${pct ? 'selected' : ''}>Un % de mis ingresos</option>
    </select></label>
    ${pct
      ? `<div class="grid2">
          <label>Porcentaje (%)<input type="number" step="any" min="0" data-f="porcentaje" value="${o.porcentaje}"></label>
          <label>Mínimo exento al mes (CUP)<input type="number" step="any" min="0" data-f="exento" value="${o.exento}"></label>
        </div>`
      : `<label>Monto por cada pago (CUP)<input type="number" step="any" min="0" data-f="monto" value="${o.monto}"></label>`}
    <div class="acciones"><button class="ghost small danger" data-act="borrar-ob" data-id="${o.id}">Eliminar este pago</button></div>
  </details>`;
}

function vistaAjustes() {
  const s = state.settings;
  const perm = hayNotif() ? Notification.permission : 'no disponible';
  return `<h2>Mis pagos</h2>
    <p class="muted">Llena los códigos con tu hoja del vector fiscal. Los cambios se guardan solos.</p>
    ${state.obligaciones.map(formOb).join('')}
    <div class="acciones"><button class="ghost" data-act="nueva-ob">+ Agregar otro pago</button></div>

    <h2>Regla del mes</h2>
    <label>En la pestaña «10% y 5%» anoto el pago de<select id="baseId">
      ${state.obligaciones.filter(o => o.tipo === 'porcentaje').map(o => `<option value="${o.id}" ${(baseOb(state) || {}).id === o.id ? 'selected' : ''}>${esc(o.nombre)}</option>`).join('')}
    </select></label>
    <label>Lo que corresponde a un mes se paga<select id="offset">
      <option value="0" ${s.offset == 0 ? 'selected' : ''}>El mismo mes</option>
      <option value="1" ${s.offset == 1 ? 'selected' : ''}>Un mes después (enero se paga en febrero)</option>
      <option value="2" ${s.offset == 2 ? 'selected' : ''}>Dos meses después</option>
    </select></label>
    <label>Llevar el control desde<input type="month" id="inicio" value="${esc(s.inicio)}"></label>
    <p class="muted">Si ya pagaste meses anteriores, pon aquí el primer mes que quieras controlar.</p>

    <h2>Resumen impreso</h2>
    <label>Tu nombre (aparece en el resumen)<input id="nombre" value="${esc(s.nombre || '')}" placeholder="Opcional"></label>

    <h2>Avisos</h2>
    <p class="muted">Permiso de avisos: <b>${perm}</b>. Te aviso 2 días antes, 1 día antes, el mismo día, y cada día si ya venció y no has pagado.</p>
    <label>Avisarme a partir de las<select id="hora">
      ${[6, 7, 8, 9, 10, 12, 14].map(h => `<option value="${h}" ${Number(s.horaAviso) === h ? 'selected' : ''}>${h}:00</option>`).join('')}
    </select></label>
    <div class="acciones">
      <button class="ghost" data-act="permiso">Activar avisos</button>
      <button class="ghost" data-act="probar">Probar un aviso</button>
    </div>
    <div class="acciones"><button class="ghost" data-act="ics">Descargar recordatorios para el calendario (12 meses)</button></div>
    <p class="muted">El calendario del teléfono suena aunque la app esté cerrada. Úsalo como respaldo; si pagas antes, borra ese evento.</p>

    <details>
      <summary>Códigos de ejemplo (confírmalos con tu hoja)</summary>
      <p class="muted">Salen de un vector fiscal de cuentapropista de ejemplo. Para pagar por Transfermóvil se usa el código de 5 dígitos (RC-04A) de la segunda columna de <b>tu</b> vector, en la fila del tributo y mes.</p>
      <table>${REFERENCIA.map(r => `<tr><td><b>${r[0]}</b></td><td style="white-space:normal">${r[1]}</td></tr>`).join('')}</table>
    </details>

    <h2>Respaldo</h2>
    <div class="acciones">
      <button class="ghost" data-act="exportar">Guardar respaldo</button>
      <button class="ghost" data-act="importar">Restaurar respaldo</button>
      <input type="file" id="archivo" accept="application/json" hidden>
    </div>`;
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
    if (it.pago || it.due < hoy) continue;
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
  if (t.dataset.copy) {
    try { await navigator.clipboard.writeText(t.dataset.copy); toast('Código copiado'); }
    catch (_) { toast('Código: ' + t.dataset.copy); }
    return;
  }
  switch (t.dataset.act) {
    case 'pagar': abrirPago(t.dataset.key); break;
    case 'comprobante': abrirComprobante(t.dataset.key); break;
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
    case 'permiso': pedirPermiso(); break;
    case 'probar': probarAviso(); break;
    case 'ics': generarICS(); break;
    case 'nueva-ob':
      state.obligaciones.push({ id: nuevoId(), nombre: 'Nuevo pago', codigoRC: '', codigoTributo: '', tipo: 'fijo', monto: 0, porcentaje: 0, exento: 0, frecuencia: 'mensual', diaLimite: 10 });
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
}, true);

document.addEventListener('change', async e => {
  const el = e.target;
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
    if (['tipo', 'nombre'].includes(el.dataset.f)) render();
    return;
  }
  if (el.id === 'anio') { anio = Number(el.value); render(); return; }
  if (el.id === 'nombre') { state.settings.nombre = el.value.trim(); await save(); toast('Guardado'); return; }
  if (el.id === 'baseId') { state.settings.baseId = el.value; await save(); toast('Guardado'); return; }
  if (el.id === 'offset') { state.settings.offset = Number(el.value); await save(); toast('Guardado'); return; }
  if (el.id === 'inicio' && el.value) { state.settings.inicio = el.value; await save(); toast('Guardado'); return; }
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
