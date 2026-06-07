#!/usr/bin/env node
// Reconciliación de extractos de Mercado Pago (account_statement-*.xlsx) contra el
// cashflow. Mercado Pago es CAJ-002. Marzo/abril ya están cargados (con peajes
// agrupados); el agujero real es MAYO (6 de 159 movs). Este script:
//  - Agrega los movimientos de MAYO que faltan, clasificados.
//  - Para meses ya cubiertos (≥10 peajes existentes) NO recarga peajes (evita duplicar).
//  - Peajes → 1 egreso agrupado por día (Flota), como la convención existente.
//  - "Ingreso de dinero"/"Liquidación" → MOV entre cuentas (fondeo).
//  - "Rendimientos" → se omiten (interés, ruido); se reporta el total.
//  - Resto: dedup contra lo cargado (fecha±3 + monto); los nuevos se clasifican,
//    y lo dudoso queda needs_review para que el dueño lo ajuste en la UI.
//
// Salida: data/cashflow-mp-extra.seed.json (se mergea en el cashflow al bootear).
// Uso: node scripts/import-mp-statements.mjs file1.xlsx file2.xlsx ...

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const require = createRequire(path.join(ROOT, 'dashboard-app', 'package.json'));
const XLSX = require('xlsx');

const FILES = process.argv.slice(2);
if (!FILES.length) { console.error('Pasá al menos un .xlsx de Mercado Pago'); process.exit(1); }

const MP = 'CAJ-002', MP_NAME = 'Mercado Pago';
const num = (s) => { if (s == null) return null; const v = parseFloat(String(s).replace(/\./g, '').replace(',', '.')); return isNaN(v) ? null : v; };
const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

// ---- Movimientos del extracto ----
const parseFile = (f) => {
  const wb = XLSX.readFile(f, { cellDates: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: true });
  const hi = rows.findIndex((r) => r && r[0] === 'RELEASE_DATE');
  return rows.slice(hi + 1).filter((r) => r && r[0])
    .map((r) => ({ date: String(r[0]).split('-').reverse().join('-'), type: String(r[1] || ''), ref: String(r[2] || ''), amt: num(r[3]) }))
    .filter((m) => m.amt != null);
};
const movs = FILES.flatMap(parseFile);

// ---- Índice de lo ya cargado (CAJ-002): fecha±3 + |monto| ----
const cf = JSON.parse(fs.readFileSync(path.join(DATA, 'cashflow.seed.json'), 'utf8'));
const existing = cf.filter((m) => m.caja_id === MP);
const k = (d, a) => d + '|' + Math.round(Math.abs(a));
const seen = new Set();
for (const m of existing) {
  if (m.amount_ars == null || !m.date) continue;
  const d = new Date(m.date);
  for (let o = -3; o <= 3; o++) { const dd = new Date(d); dd.setDate(dd.getDate() + o); seen.add(k(dd.toISOString().slice(0, 10), m.amount_ars)); }
}
// meses con peajes ya cargados → no recargar peajes ahí
const peajeMonths = new Set();
for (const m of existing) if (/ausol|ausa|aubasa|telepase|autopista|corredores viales|peaje/i.test((m.description || '') + (m.counterparty || ''))) peajeMonths.add((m.date || '').slice(0, 7));

const PER = 'Gastos de Personal (HR y Mano de Obra)';
const SUM = 'Gastos de Instalaciones y Suministros';
const isPeaje = (t) => /ausol|\bausa\b|aubasa|telepase|autopista|au oeste|au del oeste|corredores viales|caminos del|\bpeaje/i.test(t);
// Colocadores (van a Instalaciones). Oso/Maldo NO están (son depósito/personal → PER via NAME_MAP/genérico).
const STAFF = /\b(hugo|huguito|ramirez|ariel|victor|leonardo|leo|fabian|fabián|martin|martín|mike)\b/i;
const OWNER = /rodriguez\s+juan|juan\s+rodriguez|momesso|collado|\bpipi\b/i;       // retiros del dueño → personal
const RETAIL = /carrefour|\bcoto\b|jumbo|\bdisco\b|\bdia\b|farmacia|chango|\bvea\b|starbucks|mcdonald|rappi|pedidosya|cabify|\buber\b/i; // consumo personal
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
// Personas identificadas por el dueño → contraparte real + tipo.
const NAME_MAP = {
  'cristian adrian tevez': { cp: 'Oso', et: PER, cat: 'Mano de Obra', desc: 'Jornal Oso (depósito/personal)' },
  'gonzalez marina sofia': { cp: 'Via Cargo', et: SUM, cat: 'Insumos', desc: 'Flete / envíos Via Cargo' },
};
// Amigos / gastos personales confirmados por el dueño → todo personal.
const PERSONAL = /franco cafferata|oscar.*resburgo|andres bruno de luca|lil doctor|guido tasselli|gabriel.*avendano|rodrigo.*rosales|wc market plus|aeropuertos argentina|picca facundo/i;
const stripName = (t) => t.replace(/^(Transferencia enviada|Transferencia recibida|Pago|Compra|Cobro)\s*/i, '').trim();
const personal = (name, desc) => ({ kind: 'egreso', counterparty: 'Juan & Pipi', category: 'Sueldos', subcategory: 'Retiro/Personal', expense_type: PER, desc: 'Personal — ' + (name || desc) });

function classify(m) {
  const t = m.type, name = stripName(t);
  if (m.amt > 0) {
    if (/rendimiento/i.test(t)) return { kind: 'skip' };
    if (/ingreso de dinero|liquidaci[oó]n de dinero/i.test(t))
      return { kind: 'transfer', counterparty: 'MOV ENTRE CUENTAS', category: 'Otros Gastos y Ajustes', expense_type: 'Otros Gastos y Ajustes', subcategory: 'Ajuste', desc: 'Fondeo Mercado Pago' };
    if (/devoluci[oó]n/i.test(t))
      return { kind: 'ingreso', counterparty: 'Mercado Libre', category: 'Otros', desc: t };  // reintegro de compra
    if (PERSONAL.test(name) || PERSONAL.test(t))
      return { kind: 'ingreso', counterparty: 'Juan & Pipi', category: 'Otros', desc: 'Personal — ' + (name || t) };
    return { kind: 'ingreso', counterparty: name || 'Mercado Pago', category: 'Venta - No Pisos', desc: t || 'Ingreso MP', review: 'ingreso MP a clasificar' };
  }
  if (isPeaje(t)) return { kind: 'peaje' };
  if (/ARCA|AFIP|ARBA|rentas|DGR|\bimpuesto/i.test(t))
    return { kind: 'egreso', counterparty: 'ARCA', category: 'Impuestos', expense_type: 'Impuestos y Tasas', fv: 'Fijo', desc: t };
  const mapped = NAME_MAP[norm(name)];
  if (mapped) return { kind: 'egreso', counterparty: mapped.cp, category: mapped.cat, expense_type: mapped.et, desc: mapped.desc };
  if (PERSONAL.test(name) || PERSONAL.test(t)) return personal(name, t);
  if (OWNER.test(name)) return personal(name, t);
  if (RETAIL.test(t)) return personal(name, t);
  if (/\beasy\b|sodimac|pinturer|ferreter/i.test(t))
    return { kind: 'egreso', counterparty: 'EASY', category: 'Insumos', expense_type: SUM, desc: t };
  if (/ceamse/i.test(t))
    return { kind: 'egreso', counterparty: 'CEAMSE', category: 'Otros', expense_type: 'Otros Gastos y Ajustes', desc: 'CEAMSE — disposición de residuos' };
  if (/mercado libre/i.test(t))
    return { kind: 'egreso', counterparty: 'Mercado Libre', category: 'Insumos', expense_type: SUM, desc: t };
  if (/^Transferencia enviada/i.test(t)) {
    if (STAFF.test(name)) return { kind: 'egreso', counterparty: name, category: 'Mano de Obra', expense_type: SUM, desc: 'Transferencia ' + name };
    return { kind: 'egreso', counterparty: name, category: 'Otros', expense_type: null, desc: 'Transferencia ' + name, review: 'transferencia MP — ¿trabajador, proveedor o personal?' };
  }
  // Pago QR y otros
  return { kind: 'egreso', counterparty: name || t, category: 'Otros', expense_type: null, desc: t, review: 'pago MP a clasificar' };
}

const out = [];
let nseq = 0;
const id = () => 'MOV-MP-' + String(++nseq).padStart(4, '0');
const peajeByDay = {};
const report = { in: movs.length, skipRendimientos: 0, rendimientosTotal: 0, dupes: 0, peajeMonthsSkipped: 0, added: { peajeDias: 0, transfer: 0, egreso: 0, ingreso: 0, review: 0 } };

for (const m of movs) {
  const c = classify(m);
  if (c.kind === 'skip') { report.skipRendimientos++; report.rendimientosTotal += m.amt; continue; }
  if (c.kind === 'peaje') {
    const month = m.date.slice(0, 7);
    if (peajeMonths.has(month)) { report.peajeMonthsSkipped++; continue; }  // mes ya cubierto
    peajeByDay[m.date] = (peajeByDay[m.date] || 0) + m.amt;                  // agrupar por día
    continue;
  }
  if (seen.has(k(m.date, m.amt))) { report.dupes++; continue; }              // ya cargado
  const flow = m.amt > 0 ? 'Ingreso' : 'Egreso';                            // la dirección la da el signo
  out.push({
    id: id(), source: 'mp-statement', date: m.date + 'T00:00:00.000Z', flow,
    caja_id: MP, caja_name: MP_NAME, category: c.category, subcategory: c.subcategory || null,
    counterparty: c.counterparty, counterparty_type: flow === 'Ingreso' ? 'client' : 'supplier',
    client_id: null, supplier_id: null, description: c.desc, sale_ref: null,
    currency: 'ARS', amount_ars: r2(Math.abs(m.amt)), amount_usd: r2(Math.abs(m.amt) / 1400), exchange_rate: 1400,
    fixed_variable: c.fv || 'Variable', expense_type: c.expense_type || null,
    transfer: c.kind === 'transfer', needs_review: !!c.review, review_reason: c.review || null,
  });
  if (c.kind === 'transfer') report.added.transfer++;
  else if (flow === 'Ingreso') report.added.ingreso++;
  else report.added.egreso++;
  if (c.review) report.added.review++;
}
// Peajes agrupados por día → 1 egreso de Flota
for (const [date, sum] of Object.entries(peajeByDay).sort()) {
  out.push({
    id: id(), source: 'mp-statement', date: date + 'T00:00:00.000Z', flow: 'Egreso',
    caja_id: MP, caja_name: MP_NAME, category: 'Flota', subcategory: 'Peajes',
    counterparty: 'Peajes (AUSOL/AUSA/AUBASA)', counterparty_type: 'supplier',
    client_id: null, supplier_id: null, description: 'Peajes Mercado Pago (agrupados del día)', sale_ref: null,
    currency: 'ARS', amount_ars: r2(Math.abs(sum)), amount_usd: r2(Math.abs(sum) / 1400), exchange_rate: 1400,
    fixed_variable: 'Variable', expense_type: 'Gastos de Flota/Vehículos', transfer: false, needs_review: false, review_reason: null,
  });
  report.added.peajeDias++;
}

fs.writeFileSync(path.join(DATA, 'cashflow-mp-extra.seed.json'), JSON.stringify(out, null, 2));
console.log('=== IMPORT MP ===');
console.log('movs en extractos:', report.in);
console.log('rendimientos omitidos:', report.skipRendimientos, '($' + Math.round(report.rendimientosTotal).toLocaleString() + ')');
console.log('peajes en meses ya cubiertos (omitidos):', report.peajeMonthsSkipped);
console.log('duplicados (ya cargados):', report.dupes);
console.log('AGREGADOS:', out.length, '→', JSON.stringify(report.added));
const nr = out.filter((m) => m.needs_review).length;
console.log('needs_review:', nr);
