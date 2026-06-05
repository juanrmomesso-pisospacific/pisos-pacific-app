#!/usr/bin/env node
// Aplica el resultado del grilling de ventas (ver data/sales-reconcile-notes.md):
// para las ventas confirmadas como SALDO 0 (cobradas; el gap era IVA/ajustes),
// fija contract_total = lo realmente cobrado (cashflow_paid del server) → saldo 0
// y valor de venta = lo cobrado. Las PENDIENTES reales no se tocan. 0000007/0000006
// quedan pendientes (cobro mal atribuido, a confirmar).
//
// Lee cashflow_paid desde la API (server en :4173). Uso: node scripts/apply-sales-saldos.mjs

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const cookie = 'pp_session=' + fs.readFileSync('/tmp/pp.txt', 'utf8').trim().split(/\s+/).pop();
const get = (p) => new Promise((res) => http.get({ host: 'localhost', port: 4173, path: p, headers: { Cookie: cookie } }, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d))); }));

// Ventas confirmadas SALDO 0 en el grilling (incluye las 3 con cobro recién cargado).
const SALDO0 = new Set([
  '0000005', '0000011', '0000021', '0000028', '0000029', '0000030', '0000038', '0000041',
  '0000045', '0000047', '0000050', '0000053', '0000055', '0000058', '0000060', '0000062',
  '0000063', '0000064', '0000065', '0000069', '0000070', '0000073', '0000077', '0000082',
  '0000084', '0000087', '0000090', '0000091', '0000094', '0000095', '0000099', '0000102',
  '0000104', '0000110', '0000113', '0000117', '0000118', '0000120', '0000132', '0000107',
]);

const sales = await get('/api/sales');
const paidBy = new Map();
for (const s of sales) { const k = s.quote_number || s.venta_nro; if (k) paidBy.set(k, s.cashflow_paid || 0); }

const seed = JSON.parse(fs.readFileSync(path.join(DATA, 'sales.seed.json'), 'utf8'));
let changed = 0;
const log = [];
for (const s of seed) {
  const k = s.quote_number || s.venta_nro;
  if (!SALDO0.has(k)) continue;
  const paid = paidBy.get(k);
  if (paid == null || paid <= 0) { log.push(`  ${k} SKIP (cobrado=${paid})`); continue; }
  const round = Math.round(paid * 100) / 100;
  if (Math.abs((s.contract_total || 0) - round) > 1) {
    log.push(`  ${k} ${String(s.title || '').slice(0, 22).padEnd(22)} contract ${Math.round(s.contract_total || 0)} → ${Math.round(round)}`);
    s.contract_total = round;
    changed++;
  }
}
fs.writeFileSync(path.join(DATA, 'sales.seed.json'), JSON.stringify(seed, null, 2));
console.log(log.join('\n'));
console.log(`\nVentas ajustadas a saldo 0 (contract_total = cobrado): ${changed}`);
