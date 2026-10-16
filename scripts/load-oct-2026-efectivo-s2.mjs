#!/usr/bin/env node
// Efectivo semana 13–16/10/2026 (lista por día del dueño) vía API. Pesos→CAJ-009, USD→CAJ-005.
// Dedup por id determinístico + ventana (±3d/monto/caja/flujo) para no pisar la carga anterior.
//   node scripts/load-oct-2026-efectivo-s2.mjs [--commit]
import readline from 'node:readline';
import { windowKeys } from '../import/dedup.mjs';
const COMMIT = process.argv.includes('--commit');
const BASE = process.env.BASE || `http://127.0.0.1:${process.env.PORT || 10000}`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'info@pisospacific.com';
const ADMIN_PASS = process.env.ADMIN_PASS || '';
const PESOS = 'CAJ-009', PESOS_N = 'Efectivo Pesos', USDC = 'CAJ-005', USDC_N = 'Efectivo USD';
const RATE = 1540, iso = (d) => `2026-${d}T00:00:00.000Z`;
const PER = 'Gastos de Personal (HR y Mano de Obra)', SUM = 'Gastos de Instalaciones y Suministros';

// [date, amount, counterparty, category, expense_type, {sub, desc, review}]
const P = [
  ['10-13', 200000, 'Ariel Ernesto Garcia', 'Mano de Obra', PER, { desc: 'Anticipo Ariel — pago colocaciones' }],
  ['10-13', 30000, 'Insumos obra', 'Instalaciones', SUM, { desc: 'Insumos generales colocación — Arena' }],
  ['10-13', 20000, 'Oso', 'Sueldos', PER, { desc: 'Oso (sueldo depósito) — día' }],
  ['10-14', 12000, 'Otros', 'Otros', 'Otros Gastos y Ajustes', { desc: 'Estacionamiento — visita de obra' }],
  ['10-14', 30000, 'Oso', 'Sueldos', PER, { desc: 'Oso (sueldo depósito) — día' }],
  ['10-15', 3585000, 'Gastón Aguilera', 'Mano de Obra', PER, { desc: 'Gastón — colocaciones de la semana' }],
  ['10-16', 180000, 'Juan & Pipi', 'Sueldos', PER, { sub: 'Retiro/Personal', desc: 'Sueldo Juan y Pipi — cosas de la semana' }],
  ['10-16', 2850000, 'Hugo Ramirez', 'Mano de Obra', PER, { desc: 'Hugo — pago de la semana' }],
  ['10-16', 2110000, 'Ariel Ernesto Garcia', 'Mano de Obra', PER, { desc: 'Ariel — pago de la semana' }],
];
const U = [
  ['10-13', 4000, 'Gastón Aguilera', 'Mano de Obra', PER, { desc: 'Adelanto Gastón — colocación obra grande' }],
  ['10-13', 650, 'Juan & Pipi', 'Sueldos', PER, { sub: 'Retiro/Personal', desc: 'Sueldo Juan y Pipi — cama de Filipa' }],
  ['10-16', 300, 'IMDO', 'Instalaciones', SUM, { desc: 'IMDO — zócalos (insumos generales)' }],
  ['10-16', 600, 'Joaquin Gonzalez', 'Comisiones', 'Marketing y Ventas', { desc: 'Comisión Joaquin Gonzalez — venta cielorraso Nordelta', review: 'comisión — confirmar' }],
];
function mk(pfx, i, [date, amt, cp, cat, et, o], usd) {
  return {
    id: `oct26s2-efe-${pfx}-${i}`, source: 'load-oct-2026-efectivo-s2',
    flow: 'Egreso', date: iso(date), caja_id: usd ? USDC : PESOS, caja_name: usd ? USDC_N : PESOS_N,
    category: cat, subcategory: o.sub ?? null, counterparty: cp, counterparty_type: 'supplier',
    client_id: null, supplier_id: null, description: `Efectivo — ${o.desc}`, sale_ref: null,
    currency: usd ? 'USD' : 'ARS', amount_ars: usd ? null : amt,
    amount_usd: usd ? amt : Math.round((amt / RATE) * 100) / 100, exchange_rate: usd ? null : RATE,
    fixed_variable: 'Variable', expense_type: et, transfer: false,
    needs_review: !!o.review, review_reason: o.review || null,
  };
}
const MOVS = [...P.map((e, i) => mk('p', i, e, false)), ...U.map((e, i) => mk('u', i, e, true))];

// ===== API =====
function prompt(q, h = false) { return new Promise((res) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); if (h) { process.stdout.write(q); rl._writeToOutput = () => {}; rl.question('', (a) => { process.stdout.write('\n'); rl.close(); res(a.trim()); }); } else rl.question(q, (a) => { rl.close(); res(a.trim()); }); }); }
const pass = ADMIN_PASS || (await prompt('Contraseña: ', true)); let COOKIE = '';
async function api(m, p, b) { const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(COOKIE ? { Cookie: COOKIE } : {}) }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) COOKIE = sc.split(';')[0]; if (!r.ok) throw new Error(`${m} ${p} → ${r.status} ${await r.text().catch(() => '')}`); const ct = r.headers.get('content-type') || ''; return ct.includes('json') ? r.json() : r.text(); }
try { await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: pass }); } catch (e) { console.error(String(e.message).includes('401') ? '\n❌ Credenciales incorrectas.\n' : `\n❌ No conecta: ${e.message}\n`); process.exit(1); }
const live = await api('GET', '/api/cashflow');
const liveIds = new Set(live.map((m) => m.id));
const idx = new Set();
for (const m of live) { const a = m.currency === 'USD' ? m.amount_usd : m.amount_ars; for (const k of windowKeys(String(m.date || '').slice(0, 10), a, m.flow)) idx.add(m.caja_id + '|' + k); }
// Se cargan TODOS los de la lista del dueño (verificado contra prod: no son duplicados reales,
// son pagos recurrentes de efectivo). Solo se marca con ⚠️ el que tiene un monto parecido a uno
// reciente (±3d), para revisión del dueño. Idempotente por id.
const toAdd = [], warns = new Set();
for (const m of MOVS) {
  if (liveIds.has(m.id)) continue;
  const a = m.currency === 'USD' ? m.amount_usd : m.amount_ars;
  for (const k of windowKeys(String(m.date).slice(0, 10), a, m.flow)) if (idx.has(m.caja_id + '|' + k)) { warns.add(m.id); break; }
  toAdd.push(m);
}
const f = (m) => `${m.date.slice(5)} ${m.caja_id} ${(m.currency === 'USD' ? 'u$s ' + m.amount_usd : '$ ' + m.amount_ars.toLocaleString('es-AR')).padStart(14)}  ${(m.category || '').padEnd(13)} ${warns.has(m.id) ? '⚠️dup?' : m.needs_review ? '[REV]' : '      '} ${m.description}`;
console.log(`\n=== EFECTIVO SEMANA 13–16/10 (${COMMIT ? 'COMMIT' : 'DRY-RUN'}) · cashflow vivo ${live.length} ===\n`);
console.log(`--- A AGREGAR (${toAdd.length}) ---`); toAdd.forEach((m) => console.log('  ' + f(m)));
if (warns.size) console.log(`\n  ⚠️ = monto parecido a uno reciente (±3d) — revisar si no es doble carga`);
console.log();
if (!COMMIT) { console.log('DRY-RUN: no se tocó nada.\n'); process.exit(0); }
let ok = 0; for (const m of toAdd) { await api('POST', '/api/cashflow', m); ok++; }
console.log(`✅ COMMIT: +${ok} movimientos de efectivo \n`);
