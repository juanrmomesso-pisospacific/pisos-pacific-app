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
import { reportStats } from './report-stats.mjs';
import { dedupKey, windowKeys } from './dedup.mjs';
import { lastBlue } from './fx.mjs';
import { withTimeout } from '../integrations/http.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '..', 'dashboard-app', 'package.json'));
const XLSX = require('xlsx');

const API = 'https://api.mercadopago.com';
const MP = 'CAJ-002', MP_NAME = 'Mercado Pago';
const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

function creds() {
  // Producción: env vars MP_CLIENT_ID / MP_CLIENT_SECRET. Local: data/sources/.mp-oauth.json (gitignored).
  if (process.env.MP_CLIENT_ID && process.env.MP_CLIENT_SECRET) {
    return { client_id: process.env.MP_CLIENT_ID, client_secret: process.env.MP_CLIENT_SECRET };
  }
  const f = path.join(__dirname, '..', 'data', 'sources', '.mp-oauth.json');
  if (!fs.existsSync(f)) throw new Error('Faltan credenciales MP (env MP_CLIENT_ID/MP_CLIENT_SECRET o data/sources/.mp-oauth.json)');
  const { client_id, client_secret } = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!client_id || !client_secret) throw new Error('client_id/client_secret incompletos');
  return { client_id, client_secret };
}

export async function mintToken() {
  const { client_id, client_secret } = creds();
  const r = await fetch(`${API}/oauth/token`, withTimeout({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id, client_secret, grant_type: 'client_credentials' }) }));
  const j = await r.json();
  if (!j.access_token) throw new Error('No se pudo mintear token MP: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}

const iso = (d) => d.toISOString().slice(0, 19) + 'Z';
async function jget(url, at) { const r = await fetch(url, withTimeout({ headers: { Authorization: `Bearer ${at}` } })); const t = await r.text(); try { return { s: r.status, v: JSON.parse(t), t } } catch { return { s: r.status, v: t, t } } }

// Crea un settlement report para [from,to] y devuelve su id (el "jobId").
async function createReport(at, from, to) {
  const cr = await fetch(`${API}/v1/account/settlement_report`, withTimeout({ method: 'POST', headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ begin_date: iso(from), end_date: iso(to) }) }));
  const crj = await cr.json().catch(() => ({}));
  if (cr.status >= 300 || !crj.id) throw new Error('No se pudo crear el reporte MP: ' + cr.status + ' ' + JSON.stringify(crj).slice(0, 160));
  return crj.id;
}

// Genera + descarga el settlement report para [from,to]. Devuelve filas crudas.
// Matchea el reporte por el id que devuelve el POST (no agarra uno viejo). Maneja
// xlsx/csv y headers en español o inglés. Si no está listo a tiempo, tira un error
// claro para reintentar (los reportes pueden tardar unos minutos).
async function fetchSettlement(at, from, to) {
  const myId = await createReport(at, from, to);
  // poll por MI reporte (por id) hasta que tenga file_name
  let fileName = null;
  for (let i = 0; i < 45 && !fileName; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const ls = await jget(`${API}/v1/account/settlement_report/list`, at);
    const arr = Array.isArray(ls.v) ? ls.v : (ls.v.results || []);
    const mine = arr.find((x) => x.id === myId && x.file_name);
    if (mine) fileName = mine.file_name;
  }
  if (!fileName) throw new Error('El reporte de MP se está generando (puede tardar unos minutos). Probá "Sincronizar" de nuevo en un ratito.');
  const dl = await fetch(`${API}/v1/account/settlement_report/${fileName}`, withTimeout({ headers: { Authorization: `Bearer ${at}` } }));
  const buf = Buffer.from(await dl.arrayBuffer());
  return parseReportBuffer(buf);
}

// Parsea xlsx o csv, headers ES o EN. Normaliza a {source_id, medio, tipo, amount(signed), date}.
function parseReportBuffer(buf) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
  const isHeader = (r) => r && r.some((c) => /ID DE OPERAC|SOURCE_ID/i.test(String(c))) && r.some((c) => /MONTO NETO|NET_|TRANSACTION_AMOUNT|VALOR DE LA COMPRA|REAL_AMOUNT/i.test(String(c)));
  const hi = rows.findIndex(isHeader);
  if (hi < 0) return [];
  const H = rows[hi].map((c) => String(c || ''));
  const col = (re) => H.findIndex((c) => re.test(c));
  const cId = col(/ID DE OPERAC|SOURCE_ID/i);
  const cMedio = col(/MEDIO DE PAGO|PAYMENT_METHOD/i);
  const cTipo = col(/TIPO DE OPERAC|TRANSACTION_TYPE|RECORD_TYPE|^DESCRIPTION$/i);
  const cFecha = col(/FECHA DE ORIGEN|TRANSACTION_DATE|^DATE$/i);
  const cNeto = col(/MONTO NETO|^NET_AMOUNT|REAL_AMOUNT|TRANSACTION_AMOUNT|VALOR DE LA COMPRA/i);
  const cCred = col(/NET_CREDIT_AMOUNT/i), cDeb = col(/NET_DEBIT_AMOUNT/i);
  const numf = (v) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; };
  return rows.slice(hi + 1).filter((r) => r && r[cId] != null).map((r) => {
    let amount;
    if (cNeto >= 0 && r[cNeto] != null) amount = numf(r[cNeto]);
    else if (cCred >= 0 || cDeb >= 0) amount = (numf(r[cCred]) || 0) - Math.abs(numf(r[cDeb]) || 0);
    return { source_id: String(r[cId]), medio: String(r[cMedio] || ''), tipo: String(r[cTipo] || ''), amount, date: String(r[cFecha] || '').slice(0, 10) };
  }).filter((m) => m.amount != null && !isNaN(m.amount) && /^\d{4}-\d{2}-\d{2}$/.test(m.date));
}

const isPeajeAmount = (a) => a < 6000;   // peajes AUSOL/AUSA suelen ser < $6k

// ===================== Contrapartes por user id de MP =====================
// La API no da el NOMBRE de la contraparte, pero /v1/payments/{op} sí da su user id
// ESTABLE (collector en egresos, payer en ingresos). Con eso: (a) un mapa aprendido
// user_id → contraparte/clasificación hace que los recurrentes entren clasificados;
// (b) el nickname público del perfil sirve de nombre provisional; (c) los fondeos
// propios (account_fund con payer = la cuenta) se marcan transferencia solos.
let ME = null;
async function myUserId(at) {
  if (ME) return ME;
  const r = await jget(`${API}/users/me`, at);
  ME = r.v?.id != null ? String(r.v.id) : null;
  return ME;
}
const payCache = new Map();   // op_id → info | null (cache del proceso)
async function paymentInfo(at, opId) {
  if (payCache.has(opId)) return payCache.get(opId);
  const r = await jget(`${API}/v1/payments/${opId}`, at);
  const v = r.s === 200 && r.v && typeof r.v === 'object' ? r.v : null;
  const info = v ? {
    operation_type: v.operation_type || null,
    collector_id: v.collector?.id != null ? String(v.collector.id) : null,
    payer_id: v.payer?.id != null ? String(v.payer.id) : null,
  } : null;
  payCache.set(opId, info);
  return info;
}
const nickCache = new Map();
async function nickname(at, userId) {
  if (nickCache.has(userId)) return nickCache.get(userId);
  const r = await jget(`${API}/users/${userId}`, at);
  const nick = r.s === 200 ? (r.v?.nickname || null) : null;
  nickCache.set(userId, nick);
  return nick;
}
// "ADRIANCRISTIAN20220127174724" → "ADRIANCRISTIAN". Handles no-nombre (CBCFHGEDA51580) → null.
function prettyNick(nick) {
  if (!nick) return null;
  const s = String(nick).replace(/\d{6,}$/, '').replace(/[-_.]+/g, ' ').trim();
  return s.length >= 6 && /^[A-Za-z ]+$/.test(s) && /[aeiou]/i.test(s) ? s.toUpperCase() : null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Enriquece movimientos nuevos del sync (con mp_op_id, en revisión) resolviendo la contraparte
// por user id. Muta los movimientos. userMap = db.settings.mp_user_map (aprendido).
export async function enrichWithMpUsers(movements, { userMap = {}, at = null } = {}) {
  const targets = movements.filter((m) => !m._dupe && m.mp_op_id && m.needs_review);
  const out = { resolved: 0, mapped: 0, funding: 0, named: 0 };
  if (!targets.length) return out;
  if (!at) at = await mintToken();
  const me = await myUserId(at);
  for (const m of targets) {
    let info = null;
    try { info = await paymentInfo(at, m.mp_op_id); } catch { /* transferencia bancaria: el op no es un payment */ }
    if (!info) continue;
    out.resolved++;
    // Fondeo propio: ingreso account_fund donde el pagador es la propia cuenta → transferencia.
    if (m.flow === 'Ingreso' && info.operation_type === 'account_fund' && me && info.payer_id === me) {
      Object.assign(m, {
        transfer: true, counterparty: 'MOV ENTRE CUENTAS', counterparty_type: null,
        category: 'Otros Gastos y Ajustes', subcategory: 'Ajuste', expense_type: null,
        description: 'Fondeo Mercado Pago (cuenta propia)',
        needs_review: false, review_reason: null, classified_by: 'fondeo propio (payer = la cuenta)',
      });
      out.funding++; continue;
    }
    const other = m.flow === 'Egreso' ? info.collector_id : info.payer_id;
    if (!other || other === me) continue;
    m.mp_user_id = other;
    const known = userMap[other];
    if (known?.counterparty) {
      Object.assign(m, {
        counterparty: known.counterparty,
        counterparty_type: known.counterparty_type || m.counterparty_type,
        supplier_id: known.supplier_id || null, client_id: known.client_id || null,
        ...(known.category ? { category: known.category } : {}),
        ...(known.subcategory ? { subcategory: known.subcategory } : {}),
        ...(m.flow === 'Egreso' && known.expense_type ? { expense_type: known.expense_type } : {}),
        needs_review: false, review_reason: null,
        classified_by: `contraparte MP aprendida (user ${other})`,
      });
      out.mapped++;
    } else {
      // Nombre provisional desde el nickname público (suele ser el nombre real autogenerado).
      const nice = prettyNick(await nickname(at, other).catch(() => null));
      if (nice) {
        m.counterparty = nice;
        m.raw_name = nice;
        m.review_reason = 'nombre estimado del perfil de MP — confirmar y clasificar';
        m.classified_by = `nickname del perfil MP (user ${other})`;
        out.named++;
      }
      await sleep(120);   // throttle suave solo cuando pegamos a la API
    }
  }
  return out;
}

// Siembra el mapa desde el histórico YA clasificado (movimientos con mp_op_id y nombre real):
// resuelve cada operación → user id y guarda su clasificación. Muta userMap y los movimientos.
export async function backfillMpUserMap({ movements, userMap }) {
  const at = await mintToken();
  const me = await myUserId(at);
  let resolved = 0, seeded = 0, notFound = 0;
  for (const m of movements) {
    let info = null;
    try { info = await paymentInfo(at, m.mp_op_id); } catch { /* ignore */ }
    if (!info) { notFound++; await sleep(80); continue; }
    const other = m.flow === 'Egreso' ? info.collector_id : info.payer_id;
    if (!other || other === me) { await sleep(80); continue; }
    m.mp_user_id = other;
    resolved++;
    if (!userMap[other]) seeded++;
    userMap[other] = {
      counterparty: m.counterparty, counterparty_type: m.counterparty_type || null,
      supplier_id: m.supplier_id || null, client_id: m.client_id || null,
      category: m.category || null, subcategory: m.subcategory || null,
      expense_type: m.expense_type || null, learned_at: new Date().toISOString(),
    };
    await sleep(120);
  }
  return { resolved, seeded, notFound, mapSize: Object.keys(userMap).length };
}

// ---- Patrón async (para la UI; los reportes tardan minutos) ----
// start: crea el reporte y devuelve el jobId (id del reporte). No espera.
export async function startMpReport({ days = 45 } = {}) {
  const at = await mintToken();
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  return { jobId: await createReport(at, from, to) };
}

// poll: si el reporte (jobId) está listo, lo baja y devuelve el preview; si no, {ready:false}.
// userMap (db.settings.mp_user_map): enriquece por user id antes de devolver el preview.
export async function getMpReport({ jobId, existing = [], userMap = {} }) {
  const at = await mintToken();
  const ls = await jget(`${API}/v1/account/settlement_report/list`, at);
  const arr = Array.isArray(ls.v) ? ls.v : (ls.v.results || []);
  const mine = arr.find((x) => String(x.id) === String(jobId) && x.file_name);
  if (!mine) return { ready: false };
  const dl = await fetch(`${API}/v1/account/settlement_report/${mine.file_name}`, withTimeout({ headers: { Authorization: `Bearer ${at}` } }));
  const raw = parseReportBuffer(Buffer.from(await dl.arrayBuffer()));
  const { movements } = buildMovements({ raw, existing });
  try { await enrichWithMpUsers(movements, { userMap, at }); } catch (e) { console.warn('[mp] enrich por user id falló (sigue sin nombres):', e.message); }
  return { ready: true, movements, report: reportStats(movements, { source: 'mp-api', caja: MP_NAME }) };
}

// Sincrónico (para el CLI scripts/sync-mp.mjs): crea, espera y construye.
export async function syncMp({ from, to, existing = [] }) {
  const at = await mintToken();
  const raw = await fetchSettlement(at, from, to);
  return buildMovements({ raw, existing });
}

// Parsea un settlement YA descargado (ej.: adjunto del email programado de MP,
// que usa este formato — no el account_statement con nombres).
export function parseSettlementBuffer(buffer, existing = []) {
  return buildMovements({ raw: parseReportBuffer(buffer), existing });
}

// Clasifica + deduplica filas crudas → {movements, report}. existing = db.cashflow.
function buildMovements({ raw, existing = [] }) {
  const TC = lastBlue();   // TC Blue en vivo (refrescado por el server antes de llamar)
  // índice de lo ya cargado en MP: fecha±3 + |monto ARS|
  const sameCaja = existing.filter((m) => m.caja_id === MP);
  const seen = new Set();
  for (const m of sameCaja) {
    const dd = (m.date || '').slice(0, 10); if (!dd || m.amount_ars == null) continue;
    for (const key of windowKeys(dd, m.amount_ars)) seen.add(key);
  }

  const peajeByDay = {};
  const movements = [];
  for (const m of raw) {
    if (/rendimiento|interes/i.test(m.tipo)) continue;          // ruido
    // Rendimientos del saldo MP: ingreso positivo sin medio de pago (crédito de interés). Se omiten.
    if (m.amount > 0 && !String(m.medio || '').trim()) continue;
    const flow = m.amount < 0 ? 'Egreso' : 'Ingreso';
    const abs = Math.abs(m.amount);
    if (flow === 'Egreso' && isPeajeAmount(abs)) { peajeByDay[m.date] = (peajeByDay[m.date] || 0) + abs; continue; }
    movements.push({
      date: m.date + 'T00:00:00.000Z', flow, caja_id: MP, caja_name: MP_NAME,
      // S4: egresos sin nombre van a un bucket claro (no 'Otros' con expense_type null),
      // así quedan contados en el P&L y son fáciles de filtrar hasta clasificarlos.
      category: flow === 'Ingreso' ? 'Venta - No Pisos' : 'Sin clasificar',
      subcategory: null,
      counterparty: flow === 'Ingreso' ? 'Cobro MP (sin nombre)' : 'Pago MP (sin nombre)',
      counterparty_type: flow === 'Ingreso' ? 'client' : 'supplier',
      client_id: null, supplier_id: null,
      description: `MP API · ${m.tipo} · ${m.medio} · op ${m.source_id}`, sale_ref: null,
      currency: 'ARS', amount_ars: r2(abs), amount_usd: r2(abs / TC), exchange_rate: TC,
      fixed_variable: 'Variable', expense_type: flow === 'Ingreso' ? null : 'Otros Gastos y Ajustes',
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
  const out = movements.map((m, i) => ({ ...m, _idx: i, _dupe: seen.has(dedupKey(m.date.slice(0, 10), m.amount_ars)) }));
  return { movements: out, report: reportStats(out, { source: 'mp-api', caja: MP_NAME }) };
}
