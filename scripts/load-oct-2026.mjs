#!/usr/bin/env node
// Carga de extractos OCTUBRE 2026 (BdC Pesos + BBVA + resúmenes de tarjeta Sep).
// Re-ejecutable + idempotente: lee el db VIVO (DB_PATH), deduplica por id determinístico
// y por ventana (misma caja/flujo/±3d/monto), hace BACKUP antes de escribir.
// Uso en Render One-Off Job:
//   node scripts/load-oct-2026.mjs           → DRY-RUN (no toca nada, imprime todo)
//   node scripts/load-oct-2026.mjs --commit  → aplica (backup + escribe db.json)
import fs from 'node:fs';
import { windowKeys } from '../import/dedup.mjs';

const COMMIT = process.argv.includes('--commit');
const DB_PATH = process.env.DB_PATH || '/var/data/db.json';
const RATE = 1500;            // blue aprox oct-26 para amount_usd de cajas ARS (consolidación)
const TC_CARD = 1548;         // TC efectivo del pago de tarjeta (verificado)
const usd = (ars) => Math.round((ars / RATE) * 100) / 100;
const iso = (d) => `2026-${d}T00:00:00.000Z`;   // d = 'MM-DD'

// ---------- movimiento canónico ----------
function mov(id, o) {
  return {
    id, source: 'load-oct-2026',
    flow: o.flow, date: o.date, caja_id: o.caja, caja_name: o.caja_name,
    category: o.category ?? 'Otros', subcategory: o.subcategory ?? null,
    counterparty: o.counterparty ?? null, counterparty_type: o.counterparty_type ?? (o.flow === 'Ingreso' ? 'client' : 'supplier'),
    client_id: null, supplier_id: null,
    description: o.description ?? o.counterparty ?? '', sale_ref: o.sale_ref ?? null,
    currency: o.currency ?? 'ARS',
    amount_ars: o.amount_ars ?? null, amount_usd: o.amount_usd ?? null,
    exchange_rate: o.currency === 'USD' ? null : (o.rate ?? RATE),
    fixed_variable: o.fixed_variable ?? (o.flow === 'Egreso' ? 'Variable' : null),
    expense_type: o.flow === 'Egreso' ? (o.expense_type ?? null) : null,
    transfer: !!o.transfer,
    needs_review: !!o.review, review_reason: o.review || null,
  };
}
// egreso/ingreso ARS helpers (caja pesos)
const E = (id, caja, cajaName, date, ars, counterparty, cat, et, opts = {}) =>
  mov(id, { flow: 'Egreso', caja, caja_name: cajaName, date: iso(date), currency: 'ARS', amount_ars: ars, amount_usd: usd(ars), category: cat, expense_type: et, counterparty, ...opts });
const I = (id, caja, cajaName, date, ars, counterparty, cat, opts = {}) =>
  mov(id, { flow: 'Ingreso', caja, caja_name: cajaName, date: iso(date), currency: 'ARS', amount_ars: ars, amount_usd: usd(ars), category: cat, counterparty, ...opts });

const BBVA = 'CAJ-001', BBVA_N = 'BBVA';
const BDC = 'CAJ-003', BDC_N = 'Banco de Comercio - Cuenta Pesos';

// ===================== TARJETAS (egresos de BBVA, fecha pago 13/10) =====================
// Consumos reales por categoría (USD@1548). Reconcilian ~ al pago; BBVA concilia la dif.
const CARD = [];
const cardLine = (tag, cat, et, ars, opts = {}) => CARD.push(E(`oct26-tarj-${tag}`, BBVA, BBVA_N, '10-13', Math.round(ars), opts.cp || 'BBVA Tarjeta', cat, et, { description: opts.desc, ...opts }));
// VISA Sep
cardLine('visa-personal', 'HR', 'Gastos de Personal (HR y Mano de Obra)', 3248212, { cp: 'Juan & Pipi', desc: 'Tarjeta Visa Sep — consumos personales (Juan & Pipi)', subcategory: 'Retiro/Personal' });
cardLine('visa-mkt', 'Marketing', 'Marketing y Ventas', 1835417, { cp: 'Google/Meta/Framer', desc: 'Tarjeta Visa Sep — Google Ads, Meta, Framer' });
cardLine('visa-imp', 'Impuestos', 'Impuestos y Tasas', 1063342, { cp: 'ARCA / Banco', desc: 'Tarjeta Visa Sep — IVA, IIBB CABA, RG4240, RG5617', fixed_variable: 'Fijo' });
cardLine('visa-flota', 'Flota', 'Gastos de Flota/Vehículos', 688784, { cp: 'YPF/Mapfre/Barbuss/Peajes', desc: 'Tarjeta Visa Sep — nafta, peajes, Mapfre, Barbuss, lavadero' });
cardLine('visa-admin', 'Administración', 'Gastos Administrativos', 344047, { cp: 'IPlan/Render/Anthropic/Workspace', desc: 'Tarjeta Visa Sep — IPlan, Render, Anthropic, Workspace' });
cardLine('visa-otros', 'Otros', 'Gastos Administrativos', 315570, { cp: 'Showroom (Nespresso)', desc: 'Tarjeta Visa Sep — Nespresso (showroom)' });
cardLine('visa-interes', 'Otros Gastos y Ajustes', 'Otros Gastos y Ajustes', 17417, { cp: 'Interés financiación tarjeta', desc: 'Tarjeta Visa Sep — intereses de financiación' });
// MASTER Sep
cardLine('master-personal', 'HR', 'Gastos de Personal (HR y Mano de Obra)', 67952, { cp: 'Juan & Pipi', desc: 'Tarjeta Master Sep — consumos personales', subcategory: 'Retiro/Personal' });
cardLine('master-mkt', 'Marketing', 'Marketing y Ventas', 57709, { cp: 'Framer', desc: 'Tarjeta Master Sep — Framer' });
cardLine('master-imp', 'Impuestos', 'Impuestos y Tasas', 18237, { cp: 'ARCA / Banco', desc: 'Tarjeta Master Sep — impuestos/fees', fixed_variable: 'Fijo' });
cardLine('master-interes', 'Otros Gastos y Ajustes', 'Otros Gastos y Ajustes', 6053, { cp: 'Interés financiación tarjeta', desc: 'Tarjeta Master Sep — intereses' });

// ===================== BANCO DE COMERCIO (CAJ-003) — nuevo 05–13/10 =====================
const BDC_MOV = [
  // Transferencia BdC→BBVA (par con CR TRF INM COE $7.000.000 de BBVA) → fuera del P&L
  E('oct26-bdc-hb7m', BDC, BDC_N, '10-13', 7000000, 'MOV ENTRE CUENTAS', 'Otros Gastos y Ajustes', 'Otros Gastos y Ajustes', { transfer: true, subcategory: 'Transferencia entre cuentas', description: 'Transferencia BdC → BBVA (Debito Transf. HB $7.000.000)' }),
  // HB sin identificar → revisión
  E('oct26-bdc-hb2420', BDC, BDC_N, '10-09', 2420700, 'Sin clasificar', 'Sin clasificar', null, { review: 'HB (Debito Transf. HB) — el banco no da destinatario; clasificar con el detalle del home banking' }),
  E('oct26-bdc-hb400', BDC, BDC_N, '10-06', 400000, 'Sin clasificar', 'Sin clasificar', null, { review: 'HB (Debito Transf. HB) — clasificar con el detalle del home banking' }),
  // Ingresos → revisión (asignar a venta)
  I('oct26-bdc-ib319', BDC, BDC_N, '10-09', 3191300, 'Sin clasificar', 'Venta - Pisos', { review: 'IB Proveedores — cobro de cliente, asignar a una venta' }),
  I('oct26-bdc-crtrf633', BDC, BDC_N, '10-08', 6330468.92, 'Sin clasificar', 'Venta - Pisos', { review: 'CRÉDITO POR TRANSFERENCIA — ¿cobro de cliente o entre cuentas? asignar' }),
  I('oct26-bdc-credin800', BDC, BDC_N, '10-07', 800000, 'Sin clasificar', 'Venta - No Pisos', { review: 'CRÉDITO POR CREDIN — asignar (¿paneles/cobro?)' }),
  // Impuestos bancarios agrupados (Ley 25413 + IVA + Comi Trf)
  E('oct26-bdc-imp', BDC, BDC_N, '10-13', 86066.03, 'Impuestos / Banco', 'Impuestos', 'Impuestos y Tasas', { fixed_variable: 'Fijo', description: 'BdC — impuestos y comisiones bancarias (Ley 25413, IVA, Comi Trf) 05–13/10' }),
  // Interés (Remuneración de Saldo) → fuera del P&L
  I('oct26-bdc-interes', BDC, BDC_N, '10-13', 26950.59, 'Interés bancario', 'Otros Gastos y Ajustes', { transfer: true, subcategory: 'Resultado financiero', description: 'BdC — Remuneración de Saldo (interés) 05–13/10' }),
];

// ===================== BBVA (CAJ-001) — nuevo 01–13/10 (sin pagos de tarjeta) =====================
const BBVA_MOV = [
  I('oct26-bbva-crtrf7m', BBVA, BBVA_N, '10-13', 7000000, 'MOV ENTRE CUENTAS', 'Otros Gastos y Ajustes', { transfer: true, subcategory: 'Transferencia entre cuentas', description: 'Transferencia BdC → BBVA (CR TRF INM COE $7.000.000)' }),
  E('oct26-bbva-transfdeb', BBVA, BBVA_N, '10-13', 1305779, 'Sin clasificar', 'Sin clasificar', null, { review: 'TRANSF DEBITO — destinatario no identificado, clasificar' }),
  E('oct26-bbva-ccp-out', BBVA, BBVA_N, '10-13', 50000, 'MOV ENTRE CUENTAS', 'Otros Gastos y Ajustes', 'Otros Gastos y Ajustes', { transfer: true, subcategory: 'Transferencia entre cuentas', description: 'TRANSFERENCIA CCP121 (sale) — ida/vuelta con el ingreso del 09/10' }),
  I('oct26-bbva-ccp-in', BBVA, BBVA_N, '10-09', 50000, 'MOV ENTRE CUENTAS', 'Otros Gastos y Ajustes', { transfer: true, subcategory: 'Transferencia entre cuentas', description: 'TRANSFERENCIA CCP121 (entra)' }),
  I('oct26-bbva-crtrf1045', BBVA, BBVA_N, '10-12', 1045000, 'Sin clasificar', 'Venta - Pisos', { review: 'CR TRF INM COE — ¿cobro de cliente? asignar' }),
  E('oct26-bbva-transf436', BBVA, BBVA_N, '10-07', 436189.50, 'Sin clasificar', 'Sin clasificar', null, { review: 'TRANSFERENCIA saliente — clasificar destinatario' }),
  E('oct26-bbva-vep150', BBVA, BBVA_N, '10-05', 150000, 'Sin clasificar', 'Sin clasificar', null, { review: 'VEP (PAGO SERVICIOS TARJETA 17230770) — puede ser nacionalización/Google/impuesto' }),
  E('oct26-bbva-vep19', BBVA, BBVA_N, '10-05', 19799.60, 'Sin clasificar', 'Sin clasificar', null, { review: 'VEP (PAGO SERVICIOS TARJETA 17230770) — clasificar' }),
  E('oct26-bbva-debdir', BBVA, BBVA_N, '10-05', 175311.36, 'Sin clasificar', 'Sin clasificar', null, { review: 'DEBITO DIRECTO (Medios de pago) — clasificar servicio' }),
  E('oct26-bbva-visadeb', BBVA, BBVA_N, '10-05', 309736.10, 'Sin clasificar', 'Sin clasificar', null, { review: 'PAGO CON VISA DEBITO — clasificar compra' }),
  I('oct26-bbva-reintegro', BBVA, BBVA_N, '10-05', 25000, 'Reintegro Promo BBVA', 'Otros Gastos y Ajustes', { transfer: true, subcategory: 'Ajuste', description: 'Reintegro Promo BBVA 20% Disco (personal) — fuera del P&L' }),
  I('oct26-bbva-transf578', BBVA, BBVA_N, '10-02', 578346, 'Sin clasificar', 'Venta - Pisos', { review: 'Transferencia inmediata (entra) — ¿cobro de cliente? asignar' }),
  I('oct26-bbva-interes', BBVA, BBVA_N, '10-01', 98.44, 'Interés bancario', 'Otros Gastos y Ajustes', { transfer: true, subcategory: 'Resultado financiero', description: 'BBVA — Intereses ganados' }),
];

const ALL = [...CARD, ...BDC_MOV, ...BBVA_MOV];

// ===================== dedup contra el db vivo =====================
const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
db.cashflow = db.cashflow || [];
const existingIds = new Set(db.cashflow.map(m => m.id));
// índice ventana por caja+flujo
const idx = new Set();
for (const m of db.cashflow) {
  const amt = m.currency === 'USD' ? m.amount_usd : m.amount_ars;
  for (const k of windowKeys(String(m.date || '').slice(0, 10), amt, m.flow)) idx.add(m.caja_id + '|' + k);
}
const toAdd = [], skipped = [];
for (const m of ALL) {
  if (existingIds.has(m.id)) { skipped.push([m.id, 'id ya existe']); continue; }
  const amt = m.currency === 'USD' ? m.amount_usd : m.amount_ars;
  let dup = false;
  for (const k of windowKeys(String(m.date).slice(0, 10), amt, m.flow)) { if (idx.has(m.caja_id + '|' + k)) { dup = true; break; } }
  if (dup) { skipped.push([m.id, `posible duplicado (ventana ±3d $${Math.round(Math.abs(amt))})`]); continue; }
  toAdd.push(m);
}

// ===================== cp_rules genéricas APRENDIDAS a borrar (footgun) =====================
// Solo reglas aprendidas (source != 'seed') sobre descriptores genéricos del banco. El seed de
// counterparty-map.json es curado → se deja. match es un array → se joinea para el test.
const GENERIC = /transf\.?\s*hb|debito transf|d[eé]bito por|cr[eé]dito por|ib proveedores|\bdebin\b|mov(imiento)? entre cuentas|transferencia (inmediata|recibida|enviada)|pago de servicios tarjeta|dep[oó]sito autoservicio|su pago en pesos/i;
const ruleStr = (r) => [].concat(r.match || [], r.name || [], r.pattern || []).join(' · ');
const isBadRule = (r) => r.source !== 'seed' && GENERIC.test(ruleStr(r));
const badRules = (db.cp_rules || []).filter(isBadRule);

// ===================== reporte =====================
const fmt = (n) => '$ ' + Math.round(n).toLocaleString('es-AR');
console.log(`\n=== CARGA OCT 2026 (${COMMIT ? 'COMMIT' : 'DRY-RUN'}) · DB_PATH=${DB_PATH} ===`);
console.log(`cashflow actual: ${db.cashflow.length} movimientos\n`);
console.log(`--- A AGREGAR (${toAdd.length}) ---`);
let addImport = 0, addReview = 0;
for (const m of toAdd) {
  const flag = m.transfer ? '[transfer]' : m.needs_review ? '[REVISIÓN]' : '';
  console.log(`  ${m.date.slice(5, 10)} ${m.caja_id} ${m.flow.padEnd(7)} ${fmt(m.amount_ars ?? m.amount_usd).padStart(16)}  ${(m.category || '').padEnd(14)} ${flag}  ${m.description?.slice(0, 50) || m.counterparty}`);
  if (m.needs_review) addReview++;
}
console.log(`  (${addReview} a revisión)\n`);
if (skipped.length) { console.log(`--- SALTEADOS / dup (${skipped.length}) ---`); for (const [id, why] of skipped) console.log(`  ${id}: ${why}`); console.log(); }
console.log(`--- cp_rules genéricas a BORRAR (${badRules.length}) ---`);
for (const r of badRules) console.log(`  ${ruleStr(r)} → ${r.counterparty || r.category || '?'}`);
console.log();

if (!COMMIT) { console.log('DRY-RUN: no se escribió nada. Corré con --commit para aplicar.\n'); process.exit(0); }

// ---------- COMMIT: backup + escribir ----------
const bak = `${DB_PATH}.bak-oct2026-${Date.now()}`;
fs.copyFileSync(DB_PATH, bak);
db.cashflow.push(...toAdd);
db.cp_rules = (db.cp_rules || []).filter(r => !isBadRule(r));
const tmp = `${DB_PATH}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
fs.renameSync(tmp, DB_PATH);
console.log(`✅ COMMIT: +${toAdd.length} movimientos, -${badRules.length} reglas genéricas.`);
console.log(`   Backup: ${bak}`);
console.log(`   cashflow ahora: ${db.cashflow.length}\n`);
