'use strict';
/* Lógica compartida entre la página y el service worker (sin DOM). */

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/* ---------- Almacenamiento (IndexedDB, clave/valor) ---------- */
const KV = {
  _db: null,
  open() {
    if (!this._db) {
      this._db = new Promise((res, rej) => {
        const r = indexedDB.open('vector-fiscal', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
    return this._db;
  },
  async get(k) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const q = db.transaction('kv').objectStore('kv').get(k);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
  },
  async set(k, v) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('kv', 'readwrite');
      t.objectStore('kv').put(v, k);
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  }
};

/* ---------- Meses como índice: año*12 + mes(0-11) ---------- */
const ymIdx = (y, m) => y * 12 + m;
const idxY = i => Math.floor(i / 12);
const idxM = i => ((i % 12) + 12) % 12;
const ymKey = i => idxY(i) + '-' + String(idxM(i) + 1).padStart(2, '0');
function parseYM(s) { const [y, m] = String(s).split('-').map(Number); return y * 12 + (m - 1); }
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const nuevoId = () => Math.random().toString(36).slice(2, 9);
const num = n => new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(n);
const money = n => num(n) + ' CUP';

function nombreMes(idx, conAnio) {
  return MESES[idxM(idx)] + (conAnio ? ' ' + idxY(idx) : '');
}
function etiquetaPeriodo(p, len) {
  if (len === 1) return nombreMes(p, true);
  return MESES[idxM(p)] + '–' + MESES[idxM(p + len - 1)] + ' ' + idxY(p);
}

/* ---------- Estado inicial ---------- */
function defaultState(now = new Date()) {
  const cur = ymIdx(now.getFullYear(), now.getMonth());
  return {
    version: 1,
    settings: {
      offset: 1,              // se paga 1 mes después del mes al que corresponde
      inicio: ymKey(cur - 1), // desde qué mes se lleva el control
      horaAviso: 8,           // los avisos salen a partir de esta hora
      baseId: 'i10'           // el pago que ella anota en la pestaña «10% y 5%»
    },
    obligaciones: [
      { id: 'ss', nombre: 'Seguridad social', codigoRC: '', codigoTributo: '', tipo: 'fijo', monto: 0, porcentaje: 0, exento: 0, frecuencia: 'mensual', diaLimite: 10 },
      { id: 'i10', nombre: 'Impuesto 10%', codigoRC: '', codigoTributo: '', tipo: 'porcentaje', monto: 0, porcentaje: 10, exento: 0, frecuencia: 'mensual', diaLimite: 10 },
      { id: 'i5', nombre: 'Impuesto 5%', codigoRC: '', codigoTributo: '', tipo: 'porcentaje', monto: 0, porcentaje: 5, exento: 3260, frecuencia: 'mensual', diaLimite: 10 }
    ],
    ingresos: {},  // 'YYYY-MM' -> ingresos del mes
    pagos: {}      // 'idObligacion|YYYY-MM' -> { fecha, monto, mora }
  };
}

/* ---------- Ingresos: cada mes es una lista de entradas {id, monto, nota} ---------- */
function ingresosDe(st, key) {
  const v = st.ingresos[key];
  if (v === undefined || v === null || v === '') return undefined;
  return Array.isArray(v) ? v : [{ id: nuevoId(), monto: Number(v) || 0, nota: '' }];
}
function totalMes(st, key) {
  const l = ingresosDe(st, key);
  return l === undefined ? undefined : l.reduce((s, e) => s + (Number(e.monto) || 0), 0);
}
/* La usuaria anota lo que paga del 10% (obligación «base»); de ahí se deduce el ingreso:
   ingreso = pago10 × 100 / 10. Si no hay obligación base, lo anotado se toma como ingreso. */
function baseOb(st) {
  const pcts = st.obligaciones.filter(o => o.tipo === 'porcentaje' && Number(o.porcentaje) > 0);
  return pcts.find(o => o.id === st.settings.baseId) || pcts[0] || null;
}
function toIngreso(st, monto) {
  const b = baseOb(st);
  return b ? monto * 100 / Number(b.porcentaje) : monto;
}
function ingresoMes(st, key) {
  const t = totalMes(st, key);
  return t === undefined ? undefined : toIngreso(st, t);
}
function migrarState(st) {
  st.ingresos = st.ingresos || {};
  st.pagos = st.pagos || {};
  for (const k of Object.keys(st.ingresos)) {
    const l = ingresosDe(st, k);
    if (l === undefined) delete st.ingresos[k]; else st.ingresos[k] = l;
  }
  return st;
}
/* Impuesto de cada ingreso. El mínimo exento se descuenta una vez al mes:
   el % se empieza a pagar con el ingreso que lo hace pasar del exento. */
function desgloseMes(st, key) {
  const lista = ingresosDe(st, key) || [];
  const pcts = st.obligaciones.filter(o => o.tipo === 'porcentaje');
  const filas = lista.map(e => ({ e, imp: {} }));
  const tot = {};
  for (const o of pcts) {
    const ex = Number(o.exento) || 0, pc = Number(o.porcentaje) || 0;
    let cum = 0;
    for (const f of filas) {
      const m = toIngreso(st, Number(f.e.monto) || 0);
      f.ingreso = m;
      const antes = Math.max(0, cum - ex);
      cum += m;
      f.imp[o.id] = { pagar: (Math.max(0, cum - ex) - antes) * pc / 100 };
    }
    tot[o.id] = { cum, exento: ex, falta: Math.max(0, ex - cum), pagar: Math.max(0, cum - ex) * pc / 100 };
  }
  const total = filas.reduce((s, f) => s + (Number(f.e.monto) || 0), 0);
  return { filas, total, ingreso: toIngreso(st, total), base: baseOb(st), tot };
}

/* ---------- Cálculo de pagos pendientes/realizados ---------- */
/* horizonte = cuántos meses hacia adelante se muestran pagos (1 = este mes y el próximo). */
function computeItems(st, now = new Date(), horizonte = 1) {
  const hoy = startOfDay(now);
  const cur = ymIdx(hoy.getFullYear(), hoy.getMonth());
  const off = Number(st.settings.offset) || 0;
  const ini = parseYM(st.settings.inicio);
  const items = [];
  for (const ob of st.obligaciones) {
    const len = ob.frecuencia === 'trimestral' ? 3 : 1;
    let p = len === 3 ? ini - (idxM(ini) % 3) : ini;
    for (; ; p += len) {
      const payIdx = p + len - 1 + off;
      if (payIdx > cur + horizonte) break;
      const y = idxY(payIdx), m = idxM(payIdx);
      const dim = new Date(y, m + 1, 0).getDate();
      const due = new Date(y, m, Math.min(Number(ob.diaLimite) || 10, dim));
      const key = ob.id + '|' + ymKey(p);
      const pago = st.pagos[key] || null;

      let amount = null;
      const falta = [];
      if (ob.tipo === 'fijo') {
        amount = Number(ob.monto) || 0;
      } else {
        let tot = 0;
        for (let k = 0; k < len; k++) {
          const v = ingresoMes(st, ymKey(p + k));
          if (v === undefined) { falta.push(p + k); continue; }
          tot += Math.max(0, v - (Number(ob.exento) || 0)) * (Number(ob.porcentaje) || 0) / 100;
        }
        amount = falta.length ? null : Math.round(tot * 100) / 100;
      }
      items.push({
        key, ob, p, len, payIdx, due, pago, amount, falta,
        label: etiquetaPeriodo(p, len),
        daysLeft: Math.round((due - hoy) / 864e5)
      });
    }
  }
  return items;
}

function textoEstado(it) {
  const d = it.daysLeft;
  if (d < 0) return 'Vencido hace ' + (-d) + (d === -1 ? ' día' : ' días');
  if (d === 0) return 'Vence HOY';
  if (d === 1) return 'Vence mañana';
  if (d === 2) return 'Vence en 2 días';
  return 'Faltan ' + d + ' días';
}

/* ---------- Recordatorios: 2 días antes, 1 día antes, el día y vencidos (a diario) ---------- */
function recordatorios(items, now = new Date()) {
  const out = [];
  const hoyStr = ymd(now);
  for (const it of items) {
    if (it.pago) continue;           // ya pagado: no avisa
    const d = it.daysLeft;
    if (d > 2) continue;
    const base = it.key + '|' + ymd(it.due);
    let id, title, urgent = true;
    if (d < 0) { id = base + '|vencido|' + hoyStr; title = 'VENCIDO: ' + it.ob.nombre; }
    else if (d === 0) { id = base + '|0'; title = 'HOY vence: ' + it.ob.nombre; }
    else if (d === 1) { id = base + '|1'; title = 'Mañana vence: ' + it.ob.nombre; urgent = false; }
    else { id = base + '|2'; title = 'En 2 días vence: ' + it.ob.nombre; urgent = false; }
    const partes = ['Corresponde a ' + it.label + '.'];
    if (it.ob.codigoRC) partes.push('Código Transfermóvil: ' + it.ob.codigoRC + '.');
    if (it.amount !== null && it.amount > 0) partes.push('Monto: ' + money(it.amount) + '.');
    if (d < 0) partes.push('Cada día de atraso aumenta el recargo. Paga hoy.');
    out.push({ id, title, body: partes.join(' '), urgent });
  }
  return out;
}

/* Muestra los avisos que toquen y aún no se hayan mostrado. Devuelve cuántos. */
async function revisarAvisos(st, reg, now = new Date()) {
  if (now.getHours() < (Number(st.settings.horaAviso) || 8)) return 0;
  const av = (await KV.get('avisos')) || {};
  let n = 0;
  for (const r of recordatorios(computeItems(st, now), now)) {
    if (av[r.id]) continue;
    await reg.showNotification(r.title, {
      body: r.body, tag: r.id, icon: 'icon-192.png', badge: 'icon-192.png',
      requireInteraction: r.urgent, data: { url: './' }
    });
    av[r.id] = Date.now();
    n++;
  }
  if (n) await KV.set('avisos', av);
  return n;
}
