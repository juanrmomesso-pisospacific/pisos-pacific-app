#!/usr/bin/env node
// Manual reconciliation of bank statements vs the Google-Sheet cashflow.
// Adds business movements that were missing from the sheet, WITHOUT duplicating
// what's already loaded. Output: data/cashflow-bank-extra.seed.json, merged into
// the cashflow at boot (server.js). Re-runnable (deterministic ids).
//
// Decisions (confirmed with the owner):
//  - Currency: pesos → USD at TC ≈ 1400 (store amount_ars + amount_usd).
//  - Own-account transfers + MercadoLibre DEBIN (MP funding) → MOV entre cuentas (transfer).
//  - Bank taxes → grouped (Ley 25413 + IVA + comisiones) as one "Impuestos y Tasas"
//    egreso per account/month. SIRCREB/IIBB skipped (already in the ARCA entries).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const TC = 1400;
const usd = (ars) => Math.round((ars / TC) * 100) / 100;
const out = [];
let n = 0;
const mk = (acc, o) => { n++; return { id: `MOV-${acc}-${String(n).padStart(3, '0')}`, source: 'bank-statement', ...o }; };

// ===================== BANCO DE COMERCIO — mayo 2026 (CAJ-003) =====================
const BDC = 'CAJ-003', BDC_NAME = 'Banco de Comercio - Cuenta Pesos';
const ing = (date, ars, counterparty, opts = {}) => out.push(mk('BDC', {
  date: `2026-05-${date}T00:00:00.000Z`, flow: 'Ingreso', caja_id: BDC, caja_name: BDC_NAME,
  category: opts.category || 'Venta - No Pisos', subcategory: null,
  counterparty, counterparty_type: 'client', client_id: null, supplier_id: null,
  description: opts.desc || counterparty, sale_ref: opts.sale || null,
  currency: 'ARS', amount_ars: ars, amount_usd: usd(ars), exchange_rate: TC,
  fixed_variable: null, expense_type: null, transfer: false,
  needs_review: !!opts.review, review_reason: opts.review || null,
}));
const egr = (date, ars, counterparty, expense_type, opts = {}) => out.push(mk('BDC', {
  date: `2026-05-${date}T00:00:00.000Z`, flow: 'Egreso', caja_id: BDC, caja_name: BDC_NAME,
  category: opts.category || 'Otros', subcategory: opts.sub || null,
  counterparty, counterparty_type: 'supplier', client_id: null, supplier_id: null,
  description: opts.desc || counterparty, sale_ref: null,
  currency: 'ARS', amount_ars: ars, amount_usd: usd(ars), exchange_rate: TC,
  fixed_variable: opts.fv || 'Variable', expense_type, transfer: !!opts.transfer,
  needs_review: !!opts.review, review_reason: opts.review || null,
}));

// Cobros faltantes
ing('05', 869022.00, 'Alessio Tiracchia', { category: 'Venta - Pisos', sale: '0000132', desc: 'Cobro venta Alessio' });
ing('08', 6406774.03, 'Ailen FIEM S.A.', { category: 'Venta - Pisos', sale: '0000133', desc: 'Cobro venta FIEM (IB Proveedores)' });
ing('11', 14000.00, 'Gabriela Esperanza', { desc: 'Crédito CREDIN (MercadoPago)' });
ing('06', 941605.00, 'Cheque s/identificar', { desc: 'Acreditación cheque 000016404', review: 'cheque sin cliente identificado' });
ing('08', 5025001.35, 'Cheque s/identificar', { desc: 'Acreditación cheque 066098176', review: 'cheque sin cliente identificado' });
ing('14', 768275.00, 'Cheque s/identificar', { desc: 'Acreditación cheque 000000193', review: 'cheque sin cliente identificado' });

// Egreso real
egr('29', 168000.00, 'Matias Trejo', 'Gastos de Instalaciones y Suministros', { category: 'Instalaciones', desc: 'Entrega Zócalos' });

// MOV entre cuentas (transferencia propia + fondeo Mercado Pago vía DEBIN ML)
egr('08', 5000000.00, 'MOV ENTRE CUENTAS', 'Otros Gastos y Ajustes', { category: 'Otros Gastos y Ajustes', sub: 'Ajuste', desc: 'Transferencia a cuenta propia', transfer: true });
for (const [date, ars] of [['07', 200000], ['11', 100000], ['13', 200457], ['18', 900000]])
  egr(date, ars, 'MOV ENTRE CUENTAS', 'Otros Gastos y Ajustes', { category: 'Otros Gastos y Ajustes', sub: 'Ajuste', desc: 'Fondeo Mercado Pago (DEBIN ML)', transfer: true });

// Impuestos bancarios agrupados (Ley 25413 déb+créd + IVA + comisiones cheque)
egr('31', 16871.81 + 204786.75 + 474.12 + (752.57 * 3) + (158.04 * 3), 'Banco de Comercio', 'Impuestos y Tasas', { category: 'Impuestos', fv: 'Fijo', desc: 'Impuestos bancarios mayo (Ley 25413 + IVA + comisiones)' });

// ============================================================================
fs.writeFileSync(path.join(DATA, 'cashflow-bank-extra.seed.json'), JSON.stringify(out, null, 2));
const ingN = out.filter((m) => m.flow === 'Ingreso').length, egrN = out.filter((m) => m.flow === 'Egreso').length, tr = out.filter((m) => m.transfer).length;
const net = out.reduce((s, m) => s + (m.flow === 'Ingreso' ? 1 : -1) * (m.amount_usd || 0), 0);
console.log(`cashflow-bank-extra.seed.json: ${out.length} movimientos (${ingN} ingresos, ${egrN} egresos, ${tr} transferencias)`);
console.log(`impacto neto en el saldo de Banco de Comercio: US$ ${Math.round(net)}`);
