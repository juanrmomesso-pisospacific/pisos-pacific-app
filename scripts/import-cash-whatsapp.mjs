#!/usr/bin/env node
// Gastos en EFECTIVO del grupo de WhatsApp "GASTOS PACIFIC" que NO estaban en la
// Caja General (CAJ-005, la caja de efectivo, contabilizada en USD).
//
// El efectivo de ene–abr ya está transcripto en la Caja General. El agujero es
// mayo–junio 2026. Acá van solo los movimientos de efectivo que, tras cruzar
// contra lo ya cargado, faltaban. Se EXCLUYE:
//   - lo que dice "mercado pago"/"transferencia" (ya viene del extracto MP / bancos),
//   - lo pago con "tarjeta" (las compras ya están registradas),
//   - cambios de divisa (no son gastos),
//   - las listas-resumen de "PAGOS" del 29/05 y 05/06 (son re-statements de pagos
//     de Ariel/Hugo ya itemizados por obra → duplicarían).
// Personal → Gastos de Personal, contraparte "Juan & Pipi" (criterio del dueño).
//
// Salida: data/cashflow-cash-extra.seed.json (se mergea al bootear).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const TC = 1400;
const CG = 'CAJ-005', CG_NAME = 'Caja General';
let n = 0;
const out = [];
// e = egreso ARS (efectivo); montos en pesos
const e = (date, ars, counterparty, expense_type, desc, opts = {}) => out.push({
  id: 'MOV-CASH-' + String(++n).padStart(3, '0'), source: 'whatsapp-cash',
  date: date + 'T00:00:00.000Z', flow: 'Egreso', caja_id: CG, caja_name: CG_NAME,
  category: opts.category || 'Otros', subcategory: opts.sub || null,
  counterparty, counterparty_type: 'supplier', client_id: null, supplier_id: null,
  description: desc, sale_ref: null,
  currency: 'ARS', amount_ars: ars, amount_usd: Math.round((ars / TC) * 100) / 100, exchange_rate: TC,
  fixed_variable: opts.fv || 'Variable', expense_type, transfer: false,
  needs_review: !!opts.review, review_reason: opts.review || null,
});
// u = egreso en USD efectivo
const u = (date, usd, counterparty, expense_type, desc, opts = {}) => out.push({
  id: 'MOV-CASH-' + String(++n).padStart(3, '0'), source: 'whatsapp-cash',
  date: date + 'T00:00:00.000Z', flow: 'Egreso', caja_id: CG, caja_name: CG_NAME,
  category: opts.category || 'Otros', subcategory: opts.sub || null,
  counterparty, counterparty_type: 'supplier', client_id: null, supplier_id: null,
  description: desc, sale_ref: null,
  currency: 'USD', amount_ars: null, amount_usd: usd, exchange_rate: null,
  fixed_variable: opts.fv || 'Variable', expense_type, transfer: false,
  needs_review: !!opts.review, review_reason: opts.review || null,
});

const SUM = 'Gastos de Instalaciones y Suministros';
const PER = 'Gastos de Personal (HR y Mano de Obra)';
const ADM = 'Gastos Administrativos';

// ---- mayo 2026 ----
e('2026-05-07', 29000,   'Ferretería',   SUM, 'Ferretería varios (efectivo)',            { category: 'Insumos' });
u('2026-05-07', 2000,    'Alquiler',     ADM, 'Alquiler (efectivo)',                      { category: 'Alquiler', fv: 'Fijo' });
e('2026-05-11', 2245000, 'Gastón',       PER, 'Obra Conni Suipacha — retiro alfombra, colocación m2 y nivelación', { category: 'Mano de Obra' });
e('2026-05-13', 40000,   'Registro Internacional', ADM, 'Registro internacional (efectivo)', { category: 'Administrativos' });
e('2026-05-13', 60000,   'Juan & Pipi',  PER, 'Sueldo Juan & Pipi (efectivo)',            { category: 'Sueldos', sub: 'Retiro/Personal' });
e('2026-05-14', 375000,  'Mapei',        SUM, 'Masa Mapei (efectivo)',                    { category: 'Insumos' });
e('2026-05-07', 10000,   'Ariel',        PER, 'Comida equipo (Ariel) — efectivo',         { category: 'Mano de Obra' });
e('2026-05-12', 40000,   'YPF',          'Gastos de Flota/Vehículos', 'Nafta Clark/autoelevador — efectivo', { category: 'Flota' });
e('2026-05-29', 168000,  'Matías',       SUM, 'Flete (efectivo)',                         { category: 'Insumos' });
e('2026-05-29', 714000,  'José',         SUM, 'Mantas protección pisos (efectivo)',       { category: 'Insumos' });
// ---- junio 2026 ----
e('2026-06-04', 200000,  'Hugo',         PER, 'Pintar zócalos Belgrano (efectivo)',       { category: 'Mano de Obra' });

fs.writeFileSync(path.join(DATA, 'cashflow-cash-extra.seed.json'), JSON.stringify(out, null, 2));
const usdTot = out.reduce((s, m) => s + (m.amount_usd || 0), 0);
console.log('cashflow-cash-extra.seed.json:', out.length, 'gastos en efectivo (mayo-junio) — US$', Math.round(usdTot));
