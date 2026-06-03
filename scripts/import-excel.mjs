#!/usr/bin/env node
// Import Pisos Pacific business data from the cleaned Excel workbook into the
// app's seed files (data/*.seed.json) + an import report (data/import-report.json).
//
// Usage:  node scripts/import-excel.mjs "/path/to/PisosPacific_DataApp_v1.xlsx"
//
// Re-runnable / idempotent: ids are stable (PROD-/CLI-/PROV-/CAJ-/CAT-/MOV-/venta_nro),
// so each run fully regenerates the seed files from the workbook.
//
// xlsx is resolved from dashboard-app/node_modules (already installed there).

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const require = createRequire(path.join(ROOT, 'dashboard-app', 'package.json'));
const XLSX = require('xlsx');

const SRC = process.argv[2];
if (!SRC) { console.error('Usage: node scripts/import-excel.mjs "<xlsx path>"'); process.exit(1); }
if (!fs.existsSync(SRC)) { console.error('File not found: ' + SRC); process.exit(1); }

const NOW = new Date().toISOString();
const wb = XLSX.readFile(SRC);  // dates handled manually from serials to avoid TZ drift

// ---------- helpers ----------
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const clean = (s) => { const v = String(s ?? '').trim(); return v === '' ? null : v; };
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
// Excel serial / Date / string -> "YYYY-MM-DDT00:00:00.000Z" (UTC, no TZ drift), or null
function toISO(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())).toISOString();
  }
  if (typeof v === 'number') {
    const ms = Math.round((v - 25569) * 86400 * 1000); // 25569 = days between 1899-12-30 and 1970-01-01
    const d = new Date(ms);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

// Robust sheet loader: find the header row that contains `token`, use it as keys.
function load(sheet, token) {
  const ws = wb.Sheets[sheet];
  if (!ws) throw new Error('Sheet not found: ' + sheet);
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  const h = aoa.findIndex(r => r.some(c => String(c).trim() === token));
  if (h < 0) throw new Error(`Header token "${token}" not found in sheet ${sheet}`);
  const headers = aoa[h].map(c => (c == null ? '' : String(c).trim()));
  return aoa.slice(h + 1)
    .filter(r => r.some(c => c != null && String(c).trim() !== ''))
    .map(r => Object.fromEntries(headers.map((k, i) => [k, r[i] ?? null])))
    // drop footer/totals rows whose key cell isn't a real record code
    .filter(r => { const v = String(r[token] ?? '').trim().toUpperCase(); return v !== '' && v !== 'TOTALES' && v !== 'TOTAL'; });
}

const report = {
  generatedAt: NOW,
  source: path.basename(SRC),
  sheets: {},
  fkMismatches: { cashflow_caja: [], cashflow_categoria: [], cashflow_counterparty: [], ventas_cliente: [] },
  flags: [],
};
const sheetStat = (name, read) => (report.sheets[name] = { read, imported: 0, errors: 0, notes: [] });

// ---------- 1. Cajas (closed list) ----------
const cajasRaw = load('Cajas', 'codigo');
const cajasStat = sheetStat('Cajas', cajasRaw.length);
const cajas = cajasRaw.map(r => ({
  id: clean(r.codigo),
  name: clean(r.nombre),
  type: clean(r.tipo),
  currency: clean(r.moneda_default) || 'ARS',
  active: r.activo === true || norm(r.activo) === 'true' || r.activo === 1,
  notes: clean(r.notas),
}));
cajasStat.imported = cajas.length;
const cajaByName = new Map(cajas.map(c => [norm(c.name), c]));

// ---------- 2. Categorias (closed list) ----------
const catsRaw = load('Categorias', 'codigo');
const catsStat = sheetStat('Categorias', catsRaw.length);
const categories = catsRaw.map(r => ({
  id: clean(r.codigo),
  flow: clean(r.tipo),               // Ingreso | Egreso
  category: clean(r.categoria),
  subcategory: clean(r.subcategoria),
  active: r.activo === true || norm(r.activo) === 'true' || r.activo === 1,
  notes: clean(r.notas),
}));
catsStat.imported = categories.length;
const catKey = (flow, cat, sub) => `${norm(flow)}|${norm(cat)}|${norm(sub)}`;
const catByFull = new Set(categories.map(c => catKey(c.flow, c.category, c.subcategory)));
const catByCat = new Set(categories.map(c => `${norm(c.flow)}|${norm(c.category)}`));

// ---------- 3. Productos ----------
const CAT_MAP = {
  'piso madera': 'Pisos de Madera',
  'piso h2o': 'Pisos H2O',
  'deck': 'Deck',
  'zócalo': 'Zócalo', 'zocalo': 'Zócalo',
  'servicio': 'Servicio',
  'accesorio': 'Extras',
  'material colocación': 'Extras', 'material colocacion': 'Extras',
};
const prodRaw = load('Productos', 'sku_code');
const prodStat = sheetStat('Productos', prodRaw.length);
const products = prodRaw.map(r => {
  const price = num(r.precio_venta_sin_iva) ?? 0;
  const cost = num(r.costo_interno) ?? 0;
  const rawCat = clean(r.categoria);
  return {
    id: clean(r.sku_code),
    sku: clean(r.sku_code),
    name: clean(r.nombre_completo) || clean(r.nombre_corto) || clean(r.sku_code),
    category: CAT_MAP[norm(rawCat)] || 'Extras',
    rawCategory: rawCat,
    price, cost,
    currency: clean(r.moneda) || 'USD',
    active: norm(r.estado) === 'activo',
    margin: cost > 0 ? Math.round(((price - cost) / cost) * 1000) / 10 : 0,
    stock: 0,
    reservedStock: 0,
    // extra catalog metadata
    subLine: clean(r.sub_linea),
    shortName: clean(r.nombre_corto),
    thicknessMm: num(r.espesor_mm),
    widthCm: num(r.ancho_cm),
    lengthCm: num(r.largo_cm),
    m2PerBox: num(r.m2_por_caja),
    stockTrack: r.stock_track === true,
    stockCodeLegacy: clean(r.stock_code_legacy),
    createdAt: NOW,
    updatedAt: NOW,
  };
});
prodStat.imported = products.length;
const prodById = new Map(products.map(p => [p.id, p]));
// flag new SKUs (not in the legacy price list)
for (const sku of ['PROD-201', 'PROD-202']) {
  if (prodById.has(sku)) report.flags.push({ type: 'new_sku', sku, note: prodById.get(sku).name });
}

// ---------- 4. Stock -> products.stock + stock_movements ----------
const stockRaw = load('Stock', 'sku_code');
const stockStat = sheetStat('Stock', stockRaw.length);
const stock_movements = [];
let stockApplied = 0;
for (const r of stockRaw) {
  const sku = clean(r.sku_code);
  const p = prodById.get(sku);
  const m2 = num(r.m2_disponible) ?? 0;
  if (!p) { stockStat.errors++; stockStat.notes.push(`stock row for unknown product ${sku}`); continue; }
  p.stock = m2;
  p.lowStockAlarm = num(r.alarma_minima);
  p.location = clean(r.ubicacion);
  p.stockObs = clean(r.observaciones);
  stock_movements.push({ ts: NOW, type: 'initial_import', ref: 'excel-import', product_id: p.id, sku: p.id, qty: m2 });
  stockApplied++;
  if (/heavy smoked/i.test(p.name) || sku === 'PROD-019') {
    report.flags.push({ type: 'stock_audit', sku, note: `Revisar movimientos: ${clean(r.observaciones) || 'diferencia reportada'}` });
  }
}
stockStat.imported = stockApplied;
// stock-tracked products without a stock row
for (const p of products) {
  if (p.stockTrack && !stock_movements.some(m => m.product_id === p.id)) {
    report.flags.push({ type: 'stock_missing', sku: p.id, note: `${p.name}: stock_track=true pero sin fila en hoja Stock` });
  }
}

// ---------- 5. Clientes ----------
const cliRaw = load('Clientes', 'codigo');
const cliStat = sheetStat('Clientes', cliRaw.length);
const clients = cliRaw.map(r => ({
  id: clean(r.codigo),
  name: clean(r.nombre),
  type: 'client',
  segment: clean(r.tipo),            // Arquitecto | Empresa/Estudio | Particular | Final
  dni: '',
  emails: [], phones: [], addresses: [],
  active: r.activo === true || norm(r.activo) === 'true' || r.activo === 1,
  notes: clean(r.notas),
  updated_at: NOW,
}));
cliStat.imported = clients.length;
const clientByName = new Map(clients.map(c => [norm(c.name), c]));

// ---------- 6. Proveedores ----------
const provRaw = load('Proveedores', 'codigo');
const provStat = sheetStat('Proveedores', provRaw.length);
const suppliers = provRaw.map(r => ({
  id: clean(r.codigo),
  name: clean(r.nombre),
  type: clean(r.tipo),
  stock_code: clean(r.codigo_stock),
  category_default: clean(r.categoria_default),
  active: r.activo === true || norm(r.activo) === 'true' || r.activo === 1,
  notes: clean(r.notas),
}));
provStat.imported = suppliers.length;
const supplierByName = new Map(suppliers.map(s => [norm(s.name), s]));

// ---------- 7. Ventas ----------
const STATUS_MAP_PAY = { cobrado: 'Cobrado', adelanto: 'Adelanto', pendiente: 'Pendiente' };
const ventasRaw = load('Ventas', 'venta_nro');
const ventasStat = sheetStat('Ventas', ventasRaw.length);
let ventasNoDate = 0;
const sales = ventasRaw.map(r => {
  const nro = clean(r.venta_nro);
  const created = toISO(r.fecha);
  if (!created) ventasNoDate++;
  const clientName = clean(r.cliente) || '';
  const matched = clientByName.get(norm(clientName));
  if (clientName && !matched) report.fkMismatches.ventas_cliente.push({ venta: nro, cliente: clientName });
  const total = num(r.total_usd) ?? 0;
  const cobrado = num(r.cobrado_usd) ?? 0;
  const saldo = num(r.saldo_usd) ?? (total - cobrado);
  const qty = num(r.cantidad_m2) ?? 0;
  const unit = num(r.precio_m2_usd) ?? 0;
  return {
    id: nro,
    quote_number: nro,
    title: clean(r.descripcion_obra) || `Venta ${nro}`,
    description: clean(r.variedad) || '',
    client_id: matched ? matched.id : '',
    client_name: clientName,
    client_dni: '', client_email: '', client_phone: '', client_address: '',
    contract_total: total,
    items: [{
      product_id: null,
      sku: '',
      description: clean(r.variedad) || '',
      quantity: qty,
      unit_price: unit,
      total,
      category: '',
    }],
    status: 'Finalizado',
    created_at: created || '',   // '' keeps sorts/date-checks null-safe; flagged via fecha_pendiente
    fecha_pendiente: !created,
    has_iva: norm(r.condicion) === 'facturado',
    condicion: clean(r.condicion),
    factura: clean(r.factura),
    comentarios: clean(r.comentarios),
    payment_state: STATUS_MAP_PAY[norm(r.estado)] || clean(r.estado),
    financial_position: { total_invoiced: total, total_paid: cobrado, balance_due: saldo },
    stock_reserved: false,
    stock_deducted: true,   // historical: do NOT re-deduct inventory (Stock sheet is current snapshot)
    seller_name: '',
    payments: cobrado ? [{ ts: created || NOW, amount: cobrado, method: 'import', notes: 'Saldo inicial migración' }] : [],
    source: 'excel-import',
  };
});
ventasStat.imported = sales.length;
// De-duplicate sale ids (some venta_nro repeat in the sheet for distinct sales). Keep
// quote_number = raw nro for display; suffix the internal id so keys stay unique.
const seenSaleIds = new Map();
for (const sale of sales) {
  if (seenSaleIds.has(sale.id)) {
    const n = seenSaleIds.get(sale.id) + 1; seenSaleIds.set(sale.id, n);
    report.flags.push({ type: 'venta_nro_duplicado', venta: sale.quote_number, note: `id ajustado a ${sale.id}-${n}` });
    sale.id = `${sale.id}-${n}`;
  } else { seenSaleIds.set(sale.id, 1); }
}
if (ventasNoDate) { ventasStat.notes.push(`${ventasNoDate} ventas sin fecha (fecha_pendiente=true)`); report.flags.push({ type: 'ventas_sin_fecha', count: ventasNoDate }); }

// ---------- 8. CashFlow ----------
const cfRaw = load('CashFlow', 'id');
const cfStat = sheetStat('CashFlow', cfRaw.length);
let needsReview = 0;
const cashflow = cfRaw.map(r => {
  const flow = clean(r.tipo);                       // Ingreso | Egreso
  const cajaName = clean(r.caja);
  const caja = cajaName ? cajaByName.get(norm(cajaName)) : null;
  const category = clean(r.categoria);
  const subcategory = clean(r.subcategoria);
  const counterparty = clean(r.contraparte);
  const isIncome = norm(flow) === 'ingreso';
  const cpMatch = counterparty ? (isIncome ? clientByName.get(norm(counterparty)) : supplierByName.get(norm(counterparty))) : null;

  const reasons = [];
  if (!caja) reasons.push(cajaName ? `caja desconocida: ${cajaName}` : 'caja vacía');
  if (category) {
    const okFull = subcategory ? catByFull.has(catKey(flow, category, subcategory)) : catByCat.has(`${norm(flow)}|${norm(category)}`);
    const okCat = catByCat.has(`${norm(flow)}|${norm(category)}`);
    if (!okFull && !okCat) reasons.push(`categoría fuera de lista: ${category}${subcategory ? ' / ' + subcategory : ''}`);
  }
  if (!caja && cajaName) report.fkMismatches.cashflow_caja.push({ mov: clean(r.id), caja: cajaName });
  if (category && !catByCat.has(`${norm(flow)}|${norm(category)}`)) report.fkMismatches.cashflow_categoria.push({ mov: clean(r.id), flow, category, subcategory });
  if (counterparty && !cpMatch) report.fkMismatches.cashflow_counterparty.push({ mov: clean(r.id), flow, counterparty });

  const ars = num(r.monto_ars);
  const usd = num(r.monto_usd);
  if (reasons.length) needsReview++;
  return {
    id: clean(r.id),
    date: toISO(r.fecha),
    flow,
    caja_id: caja ? caja.id : null,
    caja_name: cajaName,
    category, subcategory,
    counterparty,
    counterparty_type: isIncome ? 'client' : 'supplier',
    client_id: isIncome && cpMatch ? cpMatch.id : null,
    supplier_id: !isIncome && cpMatch ? cpMatch.id : null,
    description: clean(r.descripcion),
    sale_ref: clean(r.venta_ref),
    currency: clean(r.moneda) || (usd != null && ars == null ? 'USD' : 'ARS'),
    amount_ars: ars,
    amount_usd: usd,
    exchange_rate: ars != null && usd != null && usd !== 0 ? Math.round((ars / usd) * 100) / 100 : null,
    fixed_variable: clean(r.tipo_fv),
    expense_type: clean(r.tipo_gasto),
    transfer: false,   // set below — inter-account movements / FX swaps, excluded from P&L
    needs_review: reasons.length > 0,
    review_reason: reasons.length ? reasons.join('; ') : null,
  };
});
cfStat.imported = cashflow.length;
cfStat.notes.push(`${needsReview} movimientos needs_review`);

// ---- Tag inter-account transfers (Movimientos entre cuentas / cambios de moneda) ----
// They are recorded in two legs (an Ingreso tagged "MOV ENTRE CUENTAS" + an Egreso tagged
// "Otros Gastos y Ajustes"). They are NOT real revenue/expense, so we exclude them from the
// P&L — but keep them for caja balances (money really moves between accounts).
const TRANSFER_DESC = /movimiento\s+(entre cuenta|interno|de caja)|entre cuentas|galvasa/i;
const incomeTransferAmts = new Set();
for (const m of cashflow) {
  if (m.flow === 'Ingreso' && /entre cuenta/i.test(m.counterparty || '')) {
    m.transfer = true;
    if (m.amount_usd) incomeTransferAmts.add(Math.round(m.amount_usd));
  }
}
for (const m of cashflow) {
  if (m.transfer || m.flow !== 'Egreso' || m.expense_type !== 'Otros Gastos y Ajustes') continue;
  const cpAdj = /ajuste|otros/i.test(m.counterparty || '');
  const matchesDesc = TRANSFER_DESC.test(m.description || '');
  const matchesAmt = cpAdj && m.amount_usd && incomeTransferAmts.has(Math.round(m.amount_usd));
  if (matchesDesc || matchesAmt) m.transfer = true;   // "Ajuste Puerta"/"Bola Ajuste"/"diferencia caja" stay as real expenses
}
const transfers = cashflow.filter(m => m.transfer);
const tIn = transfers.filter(m => m.flow === 'Ingreso').reduce((s, m) => s + (m.amount_usd || 0), 0);
const tEg = transfers.filter(m => m.flow === 'Egreso').reduce((s, m) => s + (m.amount_usd || 0), 0);
cfStat.notes.push(`${transfers.length} transferencias entre cuentas (excluidas del P&L)`);
report.flags.push({ type: 'movimientos_entre_cuentas', count: transfers.length, note: `Ingreso USD ${Math.round(tIn)} / Egreso USD ${Math.round(tEg)} — excluidos del P&L, incluidos en saldos de caja` });

// ---------- write seeds + report ----------
const out = {
  'cajas.seed.json': cajas,
  'categories.seed.json': categories,
  'products.seed.json': products,
  'stock_movements.seed.json': stock_movements,
  'clients.seed.json': clients,
  'suppliers.seed.json': suppliers,
  'sales.seed.json': sales,
  'cashflow.seed.json': cashflow,
};
for (const [file, data] of Object.entries(out)) {
  fs.writeFileSync(path.join(DATA, file), JSON.stringify(data, null, 2));
}
report.totals = Object.fromEntries(Object.entries(out).map(([f, d]) => [f.replace('.seed.json', ''), d.length]));
report.fkMismatchCounts = Object.fromEntries(Object.entries(report.fkMismatches).map(([k, v]) => [k, v.length]));
fs.writeFileSync(path.join(DATA, 'import-report.json'), JSON.stringify(report, null, 2));

// ---------- console summary ----------
console.log('\n=== IMPORT SUMMARY ===');
for (const [name, s] of Object.entries(report.sheets)) {
  console.log(`  ${name.padEnd(12)} read ${String(s.read).padStart(5)}  imported ${String(s.imported).padStart(5)}  errors ${s.errors}` + (s.notes.length ? `  — ${s.notes.join('; ')}` : ''));
}
console.log('\n  FK mismatches:', JSON.stringify(report.fkMismatchCounts));
console.log('  Flags:', report.flags.length, '→', JSON.stringify(report.flags.map(f => f.type + (f.sku ? ':' + f.sku : '') + (f.count ? ':' + f.count : '')).slice(0, 12)));
console.log('  Seed files written to', DATA);
console.log('  Report: data/import-report.json');
