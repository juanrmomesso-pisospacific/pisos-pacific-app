#!/usr/bin/env node
// Conciliación final (sesión grilling 2026-06-05): carga los cobros de ventas que
// faltaban + comisión asociada, y genera un ajuste de apertura por caja para que
// cada saldo coincida con el arqueo real del dueño. TC = 1400.
//
// Salida: data/cashflow-reconcile-extra.seed.json (se mergea al bootear).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const TC = 1400;
const out = [];
let n = 0;
const id = () => 'MOV-REC-' + String(++n).padStart(3, '0');

// ---- Saldos REALES (arqueo del dueño) por caja, en USD ----
const REAL_USD = {
  'CAJ-001': 9952122.35 / TC,   // BBVA
  'CAJ-002': 4698604.79 / TC,   // Mercado Pago
  'CAJ-003': 46411011.98 / TC,  // BdC Pesos
  'CAJ-004': 1812.40,           // BdC USD
  'CAJ-005': 37900 + 1002000 / TC, // Caja General (USD efectivo + pesos)
  'CAJ-006': 16629,             // Wise (coincide)
};
const CAJA_NAME = {
  'CAJ-001': 'BBVA', 'CAJ-002': 'Mercado Pago', 'CAJ-003': 'Banco de Comercio - Cuenta Pesos',
  'CAJ-004': 'Banco de Comercio - Cuenta USD', 'CAJ-005': 'Caja General', 'CAJ-006': 'Wise',
};

// ---- 1) Cobros de ventas que faltaban (→ Caja General, efectivo/USD) ----
const cobro = (date, usd, ref, counterparty, desc) => out.push({
  id: id(), source: 'reconcile', date: date + 'T00:00:00.000Z', flow: 'Ingreso',
  caja_id: 'CAJ-005', caja_name: 'Caja General', category: 'Venta - Pisos', subcategory: null,
  counterparty, counterparty_type: 'client', client_id: null, supplier_id: null,
  description: desc, sale_ref: ref, currency: 'USD', amount_ars: null, amount_usd: usd,
  exchange_rate: null, fixed_variable: null, expense_type: null, transfer: false,
  needs_review: false, review_reason: null,
});
cobro('2026-05-07', 5350, '0000107', 'Francisco Rollo', 'Cobro saldo - Tortugas Country');
cobro('2026-05-11', 605, '0000132', 'Alessio Tricacci', 'Cobro saldo - Av. Corrientes 5694');
cobro('2026-04-10', 1789, '0000120', 'Cami Fuks', 'Cobro - Oficinas Vicente López');
// Devolución 0000116 Mapuches: se restaron 35m2; se devolvió US$2.075,15 (23/5, desde USD).
// Ingreso negativo → reduce el cobrado de la venta y el saldo de la caja.
cobro('2026-05-23', -2075.15, '0000116', 'Arq. Estefy', 'Devolución 35m2 - Obra Mapuches');
// Egresos de comisión asociados a ventas
const comision = (date, usd, counterparty, ref, desc) => out.push({
  id: id(), source: 'reconcile', date: date + 'T00:00:00.000Z', flow: 'Egreso',
  caja_id: 'CAJ-005', caja_name: 'Caja General', category: 'Comisiones', subcategory: null,
  counterparty, counterparty_type: 'supplier', client_id: null, supplier_id: null,
  description: desc, sale_ref: ref, currency: 'USD', amount_ars: null, amount_usd: usd,
  exchange_rate: null, fixed_variable: 'Variable', expense_type: 'Marketing y Ventas',
  transfer: false, needs_review: false, review_reason: null,
});
comision('2026-04-10', 440, 'Cami Fuks', '0000120', 'Comisión Cami Fuks - Oficinas Vicente López');
comision('2026-05-17', 1078, 'Oppel', '0000138', 'Comisión Oppel - Obra Highland');

// ---- 2) Balance actual por caja (todos los seeds del cashflow + los cobros de arriba) ----
const load = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { return []; } };
const all = [
  ...load('cashflow.seed.json'), ...load('cashflow-bank-extra.seed.json'),
  ...load('cashflow-mp-extra.seed.json'), ...load('cashflow-cash-extra.seed.json'), ...out,
];
const bal = {};
for (const m of all) {
  if (!m.caja_id) continue;
  bal[m.caja_id] = (bal[m.caja_id] || 0) + (m.flow === 'Ingreso' ? 1 : -1) * (m.amount_usd || 0);
}

// ---- 3) Ajuste de apertura por caja (real − actual), fuera del P&L (transfer:true) ----
console.log('=== ajustes de apertura ===');
for (const caja of Object.keys(REAL_USD)) {
  const actual = bal[caja] || 0;
  const adj = Math.round((REAL_USD[caja] - actual) * 100) / 100;
  console.log('  ' + CAJA_NAME[caja].padEnd(34) + ' actual:' + Math.round(actual).toLocaleString().padStart(8) + ' real:' + Math.round(REAL_USD[caja]).toLocaleString().padStart(8) + ' ajuste:' + Math.round(adj).toLocaleString().padStart(8));
  if (Math.abs(adj) < 1) continue;  // Wise coincide → sin ajuste
  const isBBVA = caja === 'CAJ-001';
  out.push({
    id: id(), source: 'reconcile', date: '2026-06-05T00:00:00.000Z',
    flow: adj > 0 ? 'Ingreso' : 'Egreso', caja_id: caja, caja_name: CAJA_NAME[caja],
    category: 'Otros Gastos y Ajustes', subcategory: 'Saldo de apertura',
    counterparty: isBBVA ? 'Juan & Pipi' : 'Ajuste conciliación', counterparty_type: isBBVA ? 'supplier' : 'internal',
    client_id: null, supplier_id: null,
    description: isBBVA ? 'Ajuste de apertura BBVA (saldo personal sin detallar)' : 'Ajuste de apertura — conciliación con saldo real del banco',
    sale_ref: null, currency: 'USD', amount_ars: null, amount_usd: Math.abs(adj), exchange_rate: null,
    fixed_variable: null, expense_type: 'Otros Gastos y Ajustes', transfer: true,
    needs_review: false, review_reason: null,
  });
}

fs.writeFileSync(path.join(DATA, 'cashflow-reconcile-extra.seed.json'), JSON.stringify(out, null, 2));
console.log('\ncashflow-reconcile-extra.seed.json:', out.length, 'movimientos (3 cobros + 1 comisión + ajustes)');
