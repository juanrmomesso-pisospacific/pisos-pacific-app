#!/usr/bin/env node
// Ronda 4 de conciliación (grilling 2026-06-05): correcciones a sales.seed.json.
// Ver data/sales-reconcile-notes.md. Los cobros/comisiones van en import-reconcile.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const f = path.join(DATA, 'sales.seed.json');
let s = JSON.parse(fs.readFileSync(f, 'utf8'));

// 1) Borrar ventas duplicadas/sin avance (fusionadas en otra o canceladas).
const DEL = new Set(['0000097', '0000108', '0000105', '0000101', '0000049']);
const before = s.length;
s = s.filter(x => !DEL.has(x.quote_number));

// 2) Error de signo: item.total y contract_total a positivo (valor real = absoluto).
const FLIP = new Set(['0000018', '0000037', '0000067', '0000123', '0000081', '0000032', '0000068']);
for (const v of s) {
  if (!FLIP.has(v.quote_number)) continue;
  (v.items || []).forEach(it => {
    const t = Number(it.total) || 0;
    if (t < 0) it.total = Math.abs(t);
  });
  v.contract_total = Math.abs(Number(v.contract_total) || 0);
}

// 3) Valor de venta = lo cobrado (incluye IVA/ajustes) para las que quedan en saldo 0.
const CONTRACT = { '0000081': 913.55, '0000032': 871.20, '0000123': 939, '0000125': 2272.20, '0000129': 2400 };
for (const v of s) if (CONTRACT[v.quote_number] != null) v.contract_total = CONTRACT[v.quote_number];

// 4) Cliente correcto en la venta única de Francisco Royo.
const royo = s.find(v => v.quote_number === '0000107');
if (royo) royo.client_name = 'Francisco Royo';

// 5) Canje: ventas saldadas contra el alquiler del depósito (sin movimiento de caja).
//    Marcamos financial_position como saldado para que no figuren como pendientes.
for (const q of ['0000018', '0000037']) {
  const v = s.find(x => x.quote_number === q);
  if (!v) continue;
  v.financial_position = { ...(v.financial_position || {}), total_invoiced: v.contract_total, total_paid: v.contract_total, balance_due: 0 };
  v.payment_state = 'Cobrado';
  v.internal_notes = ((v.internal_notes || '') + ' [Saldada por canje contra alquiler del depósito]').trim();
}

fs.writeFileSync(f, JSON.stringify(s, null, 2));
console.log('sales.seed.json:', before, '→', s.length, 'ventas (borradas', before - s.length + ')');
console.log('sign-flip:', [...FLIP].join(','), '| contract fijos:', Object.keys(CONTRACT).join(','));
