#!/usr/bin/env node
// Re-import the cashflow from the live Google Sheet export "CashFlow - Pisos Pacific (VF)".
// The previous cashflow came from a stale DataApp Excel snapshot (≤ abr-2026) that was
// missing Banco de Comercio and all may/jun-2026 movements. This sheet is the source of truth.
//
// Usage: node scripts/import-cashflow-vf.mjs "data/sources/cashflow_vf.xlsx"
// Writes data/cashflow.seed.json + data/cashflow-vf-report.json. Business currency = USD.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const require = createRequire(path.join(ROOT, 'dashboard-app', 'package.json'));
const XLSX = require('xlsx');

const SRC = process.argv[2] || path.join(DATA, 'sources', 'cashflow_vf.xlsx');
if (!fs.existsSync(SRC)) { console.error('No existe:', SRC); process.exit(1); }
const wb = XLSX.readFile(SRC, { cellDates: true });

const clean = (s) => { const v = String(s ?? '').trim(); return v === '' ? null : v; };
// Normalizar variantes/typos de Tipo de Gasto a los valores canónicos del P&L.
const EXPENSE_TYPE_FIX = {
  'Personal': 'Gastos de Personal (HR y Mano de Obra)',
  'Gastos de Flota/Vehiculos': 'Gastos de Flota/Vehículos',
};
const fixType = (t) => (t == null ? null : (EXPENSE_TYPE_FIX[t] || t));
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);
const toISO = (v) => {
  if (v instanceof Date) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())).toISOString();
  if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 86400000)); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString(); }
  const d = new Date(v); return isNaN(d) ? null : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
};

// ---- Cajas: nombre de la planilla → caja_id del maestro (Mastercard BBVA → BBVA) ----
const cajas = JSON.parse(fs.readFileSync(path.join(DATA, 'cajas.seed.json'), 'utf8'));
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const cajaByName = new Map(cajas.map((c) => [norm(c.name), c]));
const cajaOverride = { 'mastercard bbva': 'CAJ-001' };
function resolveCaja(name) {
  const n = norm(name);
  if (cajaOverride[n]) { const c = cajas.find((x) => x.id === cajaOverride[n]); return { id: c.id, name: c.name }; }
  const c = cajaByName.get(n);
  return c ? { id: c.id, name: c.name } : { id: null, name: clean(name) };
}

// ---- Categorías maestro (lista cerrada) para validar ----
const categories = JSON.parse(fs.readFileSync(path.join(DATA, 'categories.seed.json'), 'utf8'));
const catByCat = new Set(categories.map((c) => `${norm(c.flow)}|${norm(c.category)}`));

const report = { generatedAt: new Date().toISOString(), source: path.basename(SRC), ingresos: 0, egresos: 0, transfers: 0, needsReview: 0, sinCaja: 0, byCaja: {} };
const out = [];
let seq = 0;
const id = () => 'MOV-' + String(++seq).padStart(5, '0');

// ---------- INGRESOS ----------
const I = XLSX.utils.sheet_to_json(wb.Sheets['Ingresos'], { header: 1, defval: null, raw: true });
const ihi = I.findIndex((r) => r && r.some((c) => /medio de pago/i.test(String(c))));
for (const r of I.slice(ihi + 1)) {
  if (!r || !clean(r[4])) continue;                      // sin medio de pago → fila vacía
  const negocio = clean(r[1]);
  const caja = resolveCaja(r[4]);
  const usd = num(r[3]);
  if (usd == null) continue;
  const isPisos = /pisos/i.test(negocio || '');
  const counterparty = isPisos ? (clean(r[6]) || negocio) : negocio;     // PISOS → cliente; resto → negocio
  out.push({
    id: id(), date: toISO(r[2]), flow: 'Ingreso',
    caja_id: caja.id, caja_name: caja.name,
    category: isPisos ? 'Venta - Pisos' : 'Venta - No Pisos', subcategory: null,
    counterparty, counterparty_type: 'client', client_id: null, supplier_id: null,
    description: clean(r[7]) || negocio, sale_ref: /^0+\d+$/.test(String(r[0] ?? '')) ? clean(r[0]) : null,
    currency: 'USD', amount_ars: null, amount_usd: r2(usd), exchange_rate: null,
    fixed_variable: null, expense_type: null, transfer: false, needs_review: false, review_reason: null,
  });
  report.ingresos++;
}

// ---------- EGRESOS ----------
const E = XLSX.utils.sheet_to_json(wb.Sheets['Egresos'], { header: 1, defval: null, raw: true });
for (const r of E.slice(1)) {
  if (!r || !clean(r[5])) continue;                      // sin medio de pago
  const caja = resolveCaja(r[5]);
  const expense_type = fixType(clean(r[7]));
  // Egresos sin categoría en la planilla son ajustes/movimientos → "Otros Gastos y Ajustes".
  const category = clean(r[2]) || 'Otros Gastos y Ajustes';
  const usd = num(r[10]), ars = num(r[9]);
  if (usd == null && ars == null) continue;
  const reasons = [];
  if (!caja.id) reasons.push('caja desconocida');
  if (category && !catByCat.has(`egreso|${norm(category)}`)) reasons.push(`categoría fuera de lista: ${category}`);
  out.push({
    id: id(), date: toISO(r[0]), flow: 'Egreso',
    caja_id: caja.id, caja_name: caja.name,
    category, subcategory: clean(r[1]),
    counterparty: clean(r[4]), counterparty_type: 'supplier', client_id: null, supplier_id: null,
    description: clean(r[3]), sale_ref: /^0+\d+$/.test(String(r[8] ?? '')) ? clean(r[8]) : null,
    currency: ars != null ? 'ARS' : 'USD', amount_ars: r2(ars), amount_usd: r2(usd), exchange_rate: num(r[11]),
    fixed_variable: clean(r[6]), expense_type,
    transfer: false, needs_review: reasons.length > 0, review_reason: reasons.join('; ') || null,
  });
  report.egresos++;
  if (reasons.length) report.needsReview++;
  if (!caja.id) report.sinCaja++;
}

// ---------- Transferencias (Movimientos entre cuentas) ----------
const TRANSFER_DESC = /movimiento\s+(entre cuenta|interno|de caja)|entre cuentas|galvasa/i;
const incomeAmts = new Set();
for (const m of out) {
  if (m.flow === 'Ingreso' && /entre cuenta/i.test(m.counterparty || '')) { m.transfer = true; if (m.amount_usd) incomeAmts.add(Math.round(m.amount_usd)); }
}
for (const m of out) {
  if (m.transfer || m.flow !== 'Egreso') continue;
  const isAdj = /otros gastos y ajustes/i.test(m.expense_type || '') || /otros/i.test(m.category || '');
  if (TRANSFER_DESC.test(m.description || '') && isAdj) m.transfer = true;
  else if (isAdj && m.amount_usd && incomeAmts.has(Math.round(m.amount_usd))) m.transfer = true;
}
report.transfers = out.filter((m) => m.transfer).length;

// ---------- Saldos por caja (USD, excluyendo transferencias del P&L pero no del saldo) ----------
for (const m of out) {
  const k = m.caja_name || '(sin caja)';
  report.byCaja[k] = report.byCaja[k] || { n: 0, usd: 0 };
  report.byCaja[k].n++;
  report.byCaja[k].usd += (m.flow === 'Ingreso' ? 1 : -1) * (m.amount_usd || 0);
}
for (const k in report.byCaja) report.byCaja[k].usd = Math.round(report.byCaja[k].usd);

fs.writeFileSync(path.join(DATA, 'cashflow.seed.json'), JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(DATA, 'cashflow-vf-report.json'), JSON.stringify(report, null, 2));

console.log('=== CASHFLOW VF ===');
console.log('ingresos:', report.ingresos, '| egresos:', report.egresos, '| total:', out.length);
console.log('transferencias:', report.transfers, '| needs_review:', report.needsReview, '| sin caja:', report.sinCaja);
console.log('saldos por caja (USD):');
for (const [k, v] of Object.entries(report.byCaja)) console.log('  ' + k.padEnd(34) + ' n:' + String(v.n).padStart(5) + ' saldo:' + String(v.usd).padStart(9));
