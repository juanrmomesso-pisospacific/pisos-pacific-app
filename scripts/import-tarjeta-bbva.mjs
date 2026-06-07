#!/usr/bin/env node
// Resumen tarjeta BBVA Visa Platinum — cierre 28-May-2026 (pagado 05-Jun, débito de cuenta BBVA).
// Clasificación aprobada por el dueño (grilling 2026-06-07). Caja = BBVA (CAJ-001).
// Los consumos de ABRIL ya estaban cargados (registrados el 8/5 contra Banco de Comercio);
// acá van solo los consumos de MAYO de este resumen, sin duplicar. El pago consolidado NO se
// carga (lo saldan los consumos). Sale de la conciliación (achica el ajuste de apertura BBVA).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const TC = 1400;
const BBVA = 'CAJ-001', NAME = 'BBVA';
let n = 0;
const out = [];
// e: egreso con monto en pesos (USD derivado). u: egreso en USD.
const mk = (date, cp, ars, usd, expType, cat, desc, fv = 'Variable') => out.push({
  id: 'MOV-TARJ-' + String(++n).padStart(3, '0'), source: 'tarjeta-bbva',
  date: date + 'T00:00:00.000Z', flow: 'Egreso', caja_id: BBVA, caja_name: NAME,
  category: cat, subcategory: null, counterparty: cp, counterparty_type: 'supplier',
  client_id: null, supplier_id: null, description: desc, sale_ref: null,
  currency: ars != null ? 'ARS' : 'USD', amount_ars: ars, amount_usd: usd != null ? usd : Math.round((ars / TC) * 100) / 100,
  exchange_rate: ars != null ? TC : null, fixed_variable: fv, expense_type: expType,
  transfer: false, needs_review: false, review_reason: null,
});
const MKT = 'Marketing y Ventas', SUM = 'Gastos de Instalaciones y Suministros', FLO = 'Gastos de Flota/Vehículos', ADM = 'Gastos Administrativos', IMP = 'Impuestos y Tasas';

// ── NEGOCIO ──────────────────────────────────────────────────────────
// Publicidad (USD), agrupada como venís haciendo
mk('2026-05-26', 'Meta', null, 1258.76, MKT, 'Marketing', 'Facebook/Meta Ads (consumos mayo, agrupado)');
mk('2026-05-22', 'Google', null, 69.22, MKT, 'Marketing', 'Google Ads + Workspace (mayo, agrupado)');
// Suministros
mk('2026-05-15', 'DecoTurner', 379466.54, null, SUM, 'Insumos', 'DecoTurner — zócalos/varillas');
mk('2026-01-09', 'Autoservicio y Ferretería', 32550.00, null, SUM, 'Insumos', 'Insumos colocación (cuota)');
// Flota
mk('2026-05-06', 'Volkswagen', 549229.56, null, FLO, 'Flota', 'Volkswagen (auto)');
mk('2026-05-10', 'BBVA Seguros', 29136.26, null, FLO, 'Flota', 'BBVA Seguros (auto)', 'Fijo');
mk('2026-05-13', 'ACA Acceso Norte', 40000.00, null, FLO, 'Flota', 'ACA / Acceso Norte (peaje/servicio)');
mk('2026-05-11', 'YPF / Shell', 119168.96, null, FLO, 'Flota', 'Nafta (Shell)');
// Administrativos
mk('2026-05-15', 'IPlan Networks', 72750.52, null, ADM, 'Administrativos', 'Internet IPlan', 'Fijo');
mk('2026-05-17', 'Claude AI', null, 20.00, ADM, 'Administrativos', 'Claude.ai (suscripción)', 'Fijo');
mk('2026-04-30', 'Framer', null, 31.91, ADM, 'Administrativos', 'Framer.com (web)', 'Fijo');
// Impuestos y financieros de la tarjeta (solo pesos; el saldo USD = consumos, sin impuestos USD)
const imp = 70715.47 /*sellos*/ + 26685.96 /*intereses*/ + 56173.48 /*DB IVA*/ + 37797.92 /*IIBB*/ + 396878.30 /*IVA RG4240*/ + 755020.80 /*DB RG5617 30%*/;
mk('2026-05-28', 'BBVA Tarjeta', Math.round(imp * 100) / 100, null, IMP, 'Impuestos', 'Impuestos y cargos tarjeta BBVA (sellos+IVA+IIBB+perc.+intereses)', 'Fijo');

// ── PERSONAL (Juan & Pipi) ───────────────────────────────────────────
// Consumos personales del resumen (pesos) + AssistCard/Despegar/DataRGSA + USD personales.
const persArs =
  9355.16 + 12428.50 + 51816.66 + 8750.00 + 19166.66 + 62133.33 + 13046.17 + 42333.00 + 6598.00 +
  17900.00 + 15000.00 + 92000.00 + (21799 + 750 + 25144 + 750 + 28141.50 + 750 + 1508.86 + 42299 + 750) /*PedidosYa*/ +
  10500.00 + 101849.00 + 23183.00 + 8990.00 + 11800.00 + 29400.00 + 10000.00 + 12500.00 + 46000.00 + 30598.47 /*Netflix*/ +
  4820.00 /*UNICEF*/ + 119104.50 /*AssistCard*/ + 21905.93 /*Despegar*/ + 22800.00 /*DataRGSA*/;
const persUsd = 9.00 /*Diet*/ + 4.02 /*Spotify*/ + 2.99 + 2.99 /*Apple*/ + 382.87 /*Sixt*/;
mk('2026-05-28', 'Juan & Pipi', Math.round(persArs * 100) / 100, null, 'Gastos de Personal (HR y Mano de Obra)', 'Sueldos', 'Consumos personales tarjeta BBVA (mayo)');
mk('2026-05-28', 'Juan & Pipi', null, Math.round((persUsd + 0) * 100) / 100, 'Gastos de Personal (HR y Mano de Obra)', 'Sueldos', 'Consumos personales tarjeta BBVA en USD (mayo)');

fs.writeFileSync(path.join(DATA, 'cashflow-tarjeta-extra.seed.json'), JSON.stringify(out, null, 2));
const sum = (p) => out.filter(p).reduce((s, m) => s + (m.amount_usd || 0), 0);
console.log('cashflow-tarjeta-extra.seed.json:', out.length, 'movimientos');
console.log('  Negocio US$', Math.round(sum(m => m.counterparty !== 'Juan & Pipi')));
console.log('  Personal US$', Math.round(sum(m => m.counterparty === 'Juan & Pipi')));
console.log('  Total US$', Math.round(sum(() => true)));
