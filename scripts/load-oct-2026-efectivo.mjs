#!/usr/bin/env node
// Carga de EFECTIVO Octubre 2026 (chat "Gastos en efectivo" 02–11/10) vía API del server.
// Pesos → CAJ-009 (Efectivo Pesos) · USD → CAJ-005 (Efectivo USD). 2 cambios de dólar como
// transferencia entre cajas. Idempotente (id determinístico). Dry-run por defecto.
//   node scripts/load-oct-2026-efectivo.mjs            → DRY-RUN
//   node scripts/load-oct-2026-efectivo.mjs --commit   → aplica por API
import readline from 'node:readline';
const COMMIT = process.argv.includes('--commit');
const BASE = process.env.BASE || `http://127.0.0.1:${process.env.PORT || 10000}`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'info@pisospacific.com';
const ADMIN_PASS = process.env.ADMIN_PASS || '';
const PESOS = 'CAJ-009', PESOS_N = 'Efectivo Pesos', USDC = 'CAJ-005', USDC_N = 'Efectivo USD';
const iso = (d) => `2026-${d}T00:00:00.000Z`;
const PER = 'Gastos de Personal (HR y Mano de Obra)', SUM = 'Gastos de Instalaciones y Suministros';
const FLOTA = 'Gastos de Flota/Vehículos';

// [dateMMDD, amountARS, counterparty, category, expense_type, {review, sub}]
const P = [
  ['10-02', 2000000, 'Gastón Aguilera', 'Mano de Obra', PER, { desc: 'Colocación (colocador)' }],
  ['10-02', 100000, 'Juan & Pipi', 'Sueldos', PER, { sub: 'Retiro/Personal', desc: 'Leo' }],
  ['10-02', 30000, 'Juan & Pipi', 'Sueldos', PER, { sub: 'Retiro/Personal', desc: 'Martin' }],
  ['10-02', 80000, 'Juan & Pipi', 'Sueldos', PER, { sub: 'Retiro/Personal', desc: 'Verdulería/café/almuerzo Plaza Fili' }],
  ['10-02', 20000, 'Oso', 'Sueldos', PER, { desc: 'Oso (sueldo depósito) — jornal' }],
  ['10-02', 1010000, 'Ariel Ernesto Garcia', 'Mano de Obra', PER, { desc: 'Ariel (colocador)' }],
  ['10-02', 1600000, 'Hugo Ramirez', 'Mano de Obra', PER, { desc: 'Hugo (colocador)' }],
  ['10-02', 220000, 'Oso', 'Sueldos', PER, { desc: 'Oso (sueldo depósito)' }],
  ['10-03', 780000, 'Charly Fletes', 'Logística', SUM, { desc: 'Flete (Charly)' }],
  ['10-05', 30000, 'Juan & Pipi', 'Sueldos', PER, { sub: 'Retiro/Personal', desc: 'Café Pipi' }],
  ['10-05', 54600, 'Nivelación', 'Instalaciones', SUM, { desc: '2 rollos manta de fibra (nivelación)' }],
  ['10-05', 17000, 'Juan & Pipi', 'Sueldos', PER, { sub: 'Retiro/Personal', desc: 'Desayuno con Fili' }],
  ['10-05', 7500, 'Instalaciones', 'Instalaciones', SUM, { desc: 'Bolsa escombro' }],
  ['10-05', 185000, 'YPF/Estación', 'Flota', FLOTA, { desc: 'Nafta camioneta y clark' }],
  ['10-05', 20000, 'Oso', 'Sueldos', PER, { desc: 'Oso (sueldo depósito)' }],
  ['10-07', 20000, 'Oso', 'Sueldos', PER, { desc: 'Oso (sueldo depósito)' }],
  ['10-07', 100000, 'Juan & Pipi', 'Sueldos', PER, { sub: 'Retiro/Personal', desc: 'Juan' }],
  ['10-07', 283000, 'Juan & Pipi', 'Sueldos', PER, { sub: 'Retiro/Personal', desc: 'Ale (sueldo Juan y Pipi)' }],
  ['10-07', 1326000, 'Nuciari Materiales', 'Instalaciones', SUM, { desc: 'Bolsas de Mapei (Nuciari)' }],
  ['10-07', 40000, 'Oso', 'Sueldos', PER, { desc: 'Oso (sueldo depósito)' }],
  ['10-07', 800000, 'Juan & Pipi', 'Sueldos', PER, { sub: 'Retiro/Personal', desc: 'Expensas Juncal (sueldo Juan y Pipi)' }],
  ['10-07', 160600, 'Juan & Pipi', 'Sueldos', PER, { sub: 'Retiro/Personal', desc: 'Ropa Pipi (sueldo Juan y Pipi)' }],
  ['10-09', 100000, 'Juan & Pipi', 'Sueldos', PER, { sub: 'Retiro/Personal', desc: 'Leo semana (sueldo Juan y Pipi)' }],
  ['10-09', 20000, 'Juan & Pipi', 'Sueldos', PER, { sub: 'Retiro/Personal', desc: 'Martin zeta (sueldo Juan y Pipi)' }],
  ['10-09', 40000, 'Juan & Pipi', 'Sueldos', PER, { sub: 'Retiro/Personal', desc: 'Comida Pipi (sueldo Juan y Pipi)' }],
  ['10-09', 150000, 'Juan & Pipi', 'Sueldos', PER, { sub: 'Retiro/Personal', desc: 'Lautaro zeta (sueldo Juan y Pipi)' }],
  ['10-09', 30000, 'Juan & Pipi', 'Sueldos', PER, { sub: 'Retiro/Personal', desc: 'Verdulería Moises (sueldo Juan y Pipi)' }],
  ['10-09', 30000, 'Juan & Pipi', 'Sueldos', PER, { sub: 'Retiro/Personal', desc: 'Café Juncal grano (sueldo Juan y Pipi)' }],
  ['10-09', 160000, 'Atrim', 'Producto', 'COGS', { desc: 'Atrim (DecoTurner) — zócalos' }],
  ['10-09', 695000, 'Jose Nylon', 'Instalaciones', SUM, { desc: 'Nylon 20 rollos (Jose Nylon)' }],
  ['10-09', 270000, 'Showroom', 'Otros', 'Gastos Administrativos', { desc: 'Vasos/perfume showroom + colgadores', review: 'mezcla showroom/personal — confirmar' }],
  ['10-09', 106000, 'Instalaciones', 'Instalaciones', SUM, { desc: 'Varillas' }],
  ['10-09', 210000, 'Instalaciones', 'Instalaciones', SUM, { desc: 'Zócalos adicionales' }],
  ['10-09', 485500, 'Clark', 'Sin clasificar', null, { desc: 'Clark', review: '¿persona (colocador) o autoelevador (Flota)? confirmar' }],
  ['10-09', 200000, 'Oso', 'Sueldos', PER, { desc: 'Oso (sueldo depósito)' }],
  ['10-09', 390000, 'Julián', 'Sin clasificar', null, { desc: 'Julián', review: '¿colocador u otro? confirmar' }],
  ['10-09', 2160000, 'Gastón Aguilera', 'Mano de Obra', PER, { desc: 'Gastón (colocador)' }],
  ['10-09', 1420000, 'Ariel Ernesto Garcia', 'Mano de Obra', PER, { desc: 'Ariel (colocador)' }],
  ['10-09', 2000000, 'Hugo Ramirez', 'Mano de Obra', PER, { desc: 'Hugo (colocador)' }],
  ['10-09', 65000, 'Instalaciones', 'Instalaciones', SUM, { desc: 'Pinturas adicionales' }],
  ['10-10', 50000, 'Oso', 'Sueldos', PER, { desc: 'Oso (sueldo depósito)' }],
  ['10-10', 160000, 'YPF/Estación', 'Flota', FLOTA, { desc: 'Nafta Ram' }],
  ['10-11', 200000, 'Ariel Ernesto Garcia', 'Mano de Obra', PER, { desc: 'Adelanto Ariel (colocador)' }],
];
// USD → CAJ-005
const U = [
  ['10-05', 300, 'Juan & Pipi', 'Sueldos', PER, { sub: 'Retiro/Personal', desc: 'Fausto (sueldo Juan y Pipi)' }],
  ['10-05', 100, 'Julieta Piñero', 'Comisiones', 'Marketing y Ventas', { desc: 'Comisión Julieta Piñero', review: 'comisión de revendedor — confirmar' }],
];
// Cambios de dólar (CAJ-005 USD → CAJ-009 Pesos)
const CONV = [
  { date: '10-02', usd: 2500, tc: 1540 },
  { date: '10-09', usd: 4000, tc: 1530 },
];

function egreso(pfx, i, [date, amt, cp, cat, et, o], usd) {
  return {
    id: `oct26-efe-${pfx}-${i}`, source: 'load-oct-2026-efectivo',
    flow: 'Egreso', date: iso(date), caja_id: usd ? USDC : PESOS, caja_name: usd ? USDC_N : PESOS_N,
    category: cat, subcategory: o.sub ?? null, counterparty: cp, counterparty_type: 'supplier',
    client_id: null, supplier_id: null, description: `Efectivo — ${o.desc}`, sale_ref: null,
    currency: usd ? 'USD' : 'ARS',
    amount_ars: usd ? null : amt, amount_usd: usd ? amt : Math.round((amt / 1530) * 100) / 100,
    exchange_rate: usd ? null : 1530, fixed_variable: 'Variable', expense_type: et,
    transfer: false, needs_review: !!o.review, review_reason: o.review || null,
  };
}
const MOVS = [...P.map((e, i) => egreso('p', i, e, false)), ...U.map((e, i) => egreso('u', i, e, true))];

// ===================== API =====================
function prompt(q, hidden = false) {
  return new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (hidden) { process.stdout.write(q); rl._writeToOutput = () => {}; rl.question('', (a) => { process.stdout.write('\n'); rl.close(); res(a.trim()); }); }
    else rl.question(q, (a) => { rl.close(); res(a.trim()); });
  });
}
const email = ADMIN_EMAIL, pass = ADMIN_PASS || (await prompt('Contraseña: ', true));
let COOKIE = '';
async function api(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(COOKIE ? { Cookie: COOKIE } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) COOKIE = sc.split(';')[0];
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${await r.text().catch(() => '')}`);
  const ct = r.headers.get('content-type') || ''; return ct.includes('json') ? r.json() : r.text();
}
try { await api('POST', '/api/auth/login', { email, password: pass }); }
catch (e) { console.error(String(e.message).includes('401') ? '\n❌ Usuario o contraseña incorrectos.\n' : `\n❌ No conecta a ${BASE}: ${e.message}\n`); process.exit(1); }
const live = await api('GET', '/api/cashflow');
const liveIds = new Set(live.map((m) => m.id));
const fmt = (n) => (n >= 1000 || n === 0 ? '$ ' : 'u$s ') + Math.round(n).toLocaleString('es-AR');

const toAdd = MOVS.filter((m) => !liveIds.has(m.id));
console.log(`\n=== EFECTIVO OCT 2026 (${COMMIT ? 'COMMIT' : 'DRY-RUN'}) · cashflow vivo ${live.length} ===\n`);
console.log(`--- EGRESOS a agregar (${toAdd.length}/${MOVS.length}) ---`);
let totP = 0, totU = 0, rev = 0;
for (const m of toAdd) {
  const amt = m.currency === 'USD' ? m.amount_usd : m.amount_ars;
  if (m.currency === 'USD') totU += amt; else totP += amt;
  if (m.needs_review) rev++;
  console.log(`  ${m.date.slice(5)} ${m.caja_id} ${(m.currency === 'USD' ? 'u$s ' + amt : '$ ' + amt.toLocaleString('es-AR')).padStart(14)}  ${(m.category || '').padEnd(14)} ${m.needs_review ? '[REV]' : '     '} ${m.description}`);
}
console.log(`  Totales: pesos $${totP.toLocaleString('es-AR')} · USD u$s${totU} · (${rev} a revisión)\n`);
console.log(`--- CAMBIOS DE DÓLAR (CAJ-005 → CAJ-009) ---`);
for (const c of CONV) console.log(`  ${c.date}: ${c.usd} USD @ ${c.tc} = $${(c.usd * c.tc).toLocaleString('es-AR')}`);
console.log();

if (!COMMIT) { console.log('DRY-RUN: no se tocó nada.\n'); process.exit(0); }
let ok = 0;
for (const m of toAdd) { await api('POST', '/api/cashflow', m); ok++; }
// cambios de dólar: internal-transfer (idempotente por nota/monto → chequeo si ya existe)
let okc = 0;
const existConv = new Set(live.filter((m) => m.transfer_group).map((m) => `${String(m.date).slice(0, 10)}|${Math.round(Math.abs(m.amount_usd || 0))}`));
for (const c of CONV) {
  const key = `2026-${c.date}|${c.usd}`;
  if (existConv.has(key)) { console.log(`  cambio ${c.date} ${c.usd}USD ya existe → salteado`); continue; }
  await api('POST', '/api/cashflow/internal-transfer', { from_caja_id: USDC, to_caja_id: PESOS, amount_from: c.usd, amount_to: c.usd * c.tc, date: iso(c.date), note: `Cambio ${c.usd} USD @ ${c.tc}` });
  okc++;
}
console.log(`\n✅ COMMIT: +${ok} egresos de efectivo, +${okc} cambios de dólar (vía API).\n`);
