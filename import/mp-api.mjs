// Sincronización con Mercado Pago por API (OAuth client_credentials).
// Mintea un token de app (bypassa el gate de live credentials), genera el reporte
// "Account money / settlement" (ledger firmado: negativo=egreso), lo descarga y
// lo normaliza a movimientos de cashflow (caja MP), deduplicando contra lo cargado.
//
// LÍMITE conocido: la API NO trae nombres de contraparte (privacidad del token de
// app). Por eso los movimientos entran best-effort y marcados needs_review salvo
// peajes (detectados por monto). Los nombres ricos siguen en el .xlsx manual.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '..', 'dashboard-app', 'package.json'));
const XLSX = require('xlsx');

const API = 'https://api.mercadopago.com';
const TC = 1400;
const MP = 'CAJ-002', MP_NAME = 'Mercado Pago';
const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

function creds() {
  const f = path.join(__dirname, '..', 'data', 'sources', '.mp-oauth.json');
  if (!fs.existsSync(f)) throw new Error('Faltan credenciales MP en data/sources/.mp-oauth.json');
  const { client_id, client_secret } = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!client_id || !client_secret) throw new Error('client_id/client_secret incompletos');
  return { client_id, client_secret };
}

export async function mintToken() {
  const { client_id, client_secret } = creds();
  const r = await fetch(`${API}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id, client_secret, grant_type: 'client_credentials' }) });
  const j = await r.json();
  if (!j.access_token) throw new Error('No se pudo mintear token MP: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}

const iso = (d) => d.toISOString().slice(0, 19) + 'Z';
async function jget(url, at) { const r = await fetch(url, { headers: { Authorization: `Bearer ${at}` } }); const t = await r.text(); try { return { s: r.status, v: JSON.parse(t), t } } catch { return { s: r.status, v: t, t } } }

// Genera + descarga el settlement report (xlsx) para [from,to]. Devuelve filas crudas.
async function fetchSettlement(at, from, to) {
  const cr = await fetch(`${API}/v1/account/settlement_report`, { method: 'POST', headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ begin_date: iso(from), end_date: iso(to) }) });
  if (cr.status !== 202 && cr.status !== 200 && cr.status !== 201) throw new Error('No se pudo crear el reporte MP: ' + cr.status + ' ' + (await cr.text()).slice(0, 160));
  // poll hasta que aparezca un archivo nuevo (creado en este request)
  let fileName = null;
  for (let i = 0; i < 30 && !fileName; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const ls = await jget(`${API}/v1/account/settlement_report/list`, at);
    const arr = Array.isArray(ls.v) ? ls.v : (ls.v.results || []);
    const done = arr.filter((x) => x.file_name).sort((a, b) => String(b.date_created || '').localeCompare(String(a.date_created || '')))[0];
    if (done) fileName = done.file_name;
  }
  if (!fileName) throw new Error('El reporte MP no estuvo listo a tiempo (reintentá en un minuto).');
  const dl = await fetch(`${API}/v1/account/settlement_report/${fileName}`, { headers: { Authorization: `Bearer ${at}` } });
  const buf = Buffer.from(await dl.arrayBuffer());
  const wb = XLSX.read(buf, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
  const hi = rows.findIndex((r) => r && r.some((c) => /ID DE OPERAC/i.test(String(c))));
  if (hi < 0) return [];
  const H = rows[hi].map((c) => String(c || ''));
  const col = (re) => H.findIndex((c) => re.test(c));
  const cId = col(/ID DE OPERAC/i), cMedio = col(/MEDIO DE PAGO/i), cTipo = col(/TIPO DE OPERAC/i),
        cNeto = col(/MONTO NETO/i), cValor = col(/VALOR DE LA COMPRA/i), cFecha = col(/FECHA DE ORIGEN/i);
  return rows.slice(hi + 1).filter((r) => r && r[cId]).map((r) => ({
    source_id: String(r[cId]),
    medio: String(r[cMedio] || ''),
    tipo: String(r[cTipo] || ''),
    amount: parseFloat(r[cNeto] != null ? r[cNeto] : r[cValor]),
    date: String(r[cFecha] || '').slice(0, 10),
  })).filter((m) => !isNaN(m.amount) && /^\d{4}-\d{2}-\d{2}$/.test(m.date));
}

const isPeajeAmount = (a) => a < 6000;   // peajes AUSOL/AUSA suelen ser < $6k

// Construye movimientos de cashflow deduplicados. existing = db.cashflow.
export async function syncMp({ from, to, existing = [] }) {
  const at = await mintToken();
  const raw = await fetchSettlement(at, from, to);

  // índice de lo ya cargado en MP: fecha±3 + |monto ARS|
  const sameCaja = existing.filter((m) => m.caja_id === MP);
  const k = (d, a) => d + '|' + Math.round(Math.abs(a || 0));
  const seen = new Set();
  for (const m of sameCaja) { const dd = (m.date || '').slice(0, 10); if (!dd || m.amount_ars == null) continue; const b = new Date(dd); for (let o = -3; o <= 3; o++) { const x = new Date(b); x.setDate(x.getDate() + o); seen.add(k(x.toISOString().slice(0, 10), m.amount_ars)); } }

  const peajeByDay = {};
  const movements = [];
  for (const m of raw) {
    if (/rendimiento|interes/i.test(m.tipo)) continue;          // ruido
    const flow = m.amount < 0 ? 'Egreso' : 'Ingreso';
    const abs = Math.abs(m.amount);
    if (flow === 'Egreso' && isPeajeAmount(abs)) { peajeByDay[m.date] = (peajeByDay[m.date] || 0) + abs; continue; }
    movements.push({
      date: m.date + 'T00:00:00.000Z', flow, caja_id: MP, caja_name: MP_NAME,
      category: flow === 'Ingreso' ? 'Venta - No Pisos' : 'Otros',
      subcategory: null,
      counterparty: flow === 'Ingreso' ? 'Cobro MP (sin nombre)' : 'Pago MP (sin nombre)',
      counterparty_type: flow === 'Ingreso' ? 'client' : 'supplier',
      client_id: null, supplier_id: null,
      description: `MP API · ${m.tipo} · ${m.medio} · op ${m.source_id}`, sale_ref: null,
      currency: 'ARS', amount_ars: r2(abs), amount_usd: r2(abs / TC), exchange_rate: TC,
      fixed_variable: 'Variable', expense_type: flow === 'Egreso' ? null : null,
      transfer: false, needs_review: true,
      review_reason: 'sync MP API — sin nombre, asociar/clasificar',
      source: 'mp-api', mp_op_id: m.source_id,
    });
  }
  for (const [date, sum] of Object.entries(peajeByDay).sort()) {
    movements.push({
      date: date + 'T00:00:00.000Z', flow: 'Egreso', caja_id: MP, caja_name: MP_NAME,
      category: 'Flota', subcategory: 'Peajes', counterparty: 'Peajes (AUSOL/AUSA/AUBASA)', counterparty_type: 'supplier',
      client_id: null, supplier_id: null, description: 'Peajes MP (agrupados del día, API)', sale_ref: null,
      currency: 'ARS', amount_ars: r2(sum), amount_usd: r2(sum / TC), exchange_rate: TC,
      fixed_variable: 'Variable', expense_type: 'Gastos de Flota/Vehículos', transfer: false,
      needs_review: false, review_reason: null, source: 'mp-api',
    });
  }

  // dedup + flags
  const out = movements.map((m, i) => ({ ...m, _idx: i, _dupe: seen.has(k(m.date.slice(0, 10), m.amount_ars)) }));
  const report = {
    source: 'mp-api', caja: MP_NAME, total: out.length,
    nuevos: out.filter((m) => !m._dupe).length,
    duplicados: out.filter((m) => m._dupe).length,
    revisar: out.filter((m) => !m._dupe && m.needs_review).length,
    ingresos: out.filter((m) => !m._dupe && m.flow === 'Ingreso').length,
    egresos: out.filter((m) => !m._dupe && m.flow === 'Egreso').length,
  };
  return { movements: out, report };
}
