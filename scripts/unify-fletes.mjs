#!/usr/bin/env node
// Unifica los gastos de FLETE de terceros en un solo grupo del P&L:
//   expense_type = "Gastos de Instalaciones y Suministros" (se computa como COGS),
//   category = "Logística".
// "Gastos de Flota/Vehículos" queda SOLO para la flota propia (nafta, seguros,
// patentes, peajes, service). El flete de IMPORTACIÓN (COMEX, Grama terminal/
// importación) NO se toca: es costo de mercadería (COGS proper).
// También borra el duplicado MOV-CASH-009 (pago en efectivo a Matias ya registrado
// por transferencia en Banco de Comercio).
//
// Uso: node scripts/unify-fletes.mjs [--apply]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const APPLY = process.argv.includes('--apply');
const db = JSON.parse(fs.readFileSync(path.join(DATA, 'db.json'), 'utf8'));
const SUM = 'Gastos de Instalaciones y Suministros';
const FLOTA = 'Gastos de Flota/Vehículos';
const FLETE_PROVIDERS = new Set(['Carlos Vera', 'Matias Flete', 'Via Cargo', 'Logistica AR']);

const before = db.cashflow.length;
// 1) borrar duplicado
const dup = db.cashflow.find((x) => x.id === 'MOV-CASH-009');
console.log('Duplicado a borrar:', dup ? `${dup.id} ${dup.caja_name} "${dup.description}" $${Math.round(dup.amount_ars)}` : '(no encontrado)');
if (APPLY && dup) db.cashflow = db.cashflow.filter((x) => x.id !== 'MOV-CASH-009');

// 2) unificar fletes
let n = 0; const sample = [];
for (const x of db.cashflow) {
  if (x.flow !== 'Egreso') continue;
  const isFleteProv = FLETE_PROVIDERS.has(x.counterparty);
  const isFleteDesc = x.expense_type === FLOTA && /\bflete/i.test(x.description || '');
  if (!isFleteProv && !isFleteDesc) continue;
  if (x.expense_type === SUM && x.category === 'Logística') continue;     // ya unificado
  if (sample.length < 12) sample.push(`${x.counterparty} | ${x.expense_type}→${SUM} | ${(x.description || '').slice(0, 26)}`);
  n++;
  if (APPLY) { x.expense_type = SUM; x.category = 'Logística'; }
}
console.log(`\nMovimientos de flete a unificar → ${SUM} / Logística: ${n}`);
sample.forEach((s) => console.log('  ', s));

console.log(`\n${APPLY ? 'APLICADO' : 'DRY-RUN'} — cashflow ${before} → ${db.cashflow.length}`);
if (APPLY) {
  fs.copyFileSync(path.join(DATA, 'db.json'), path.join(DATA, 'db.json.bak-fletes'));
  fs.writeFileSync(path.join(DATA, 'db.json'), JSON.stringify(db, null, 2));
  console.log('db.json escrito (backup en db.json.bak-fletes).');
} else {
  console.log('Repetí con --apply para escribir.');
}
