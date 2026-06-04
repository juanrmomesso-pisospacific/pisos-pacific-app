#!/usr/bin/env node
// Merge the Vercel app's SKU-level sale detail into the local sales, recover the recent
// sales the DataApp Excel left blank, and drop the truly-empty rows.
//
// Sources (all committed under data/):
//   sales.seed.json            — current sales (0000001..0000158)
//   ventas_recientes.seed.json — recovered 0000125..0000138 (from Planilla Ventas)
//   vercel_sales.json          — Vercel sales with SKU line-items (snapshot)
//   vercel_quotes.json         — Vercel quotes with SKU line-items (snapshot)
//   vercel_sale_matches.json   — { venta_nro: vercel_quote_number } confirmed mapping
//   sku_remap.json             — { vercelSku: catalogSku } remaps
//   products.seed.json         — catalog (for locking cost into items)
//
// Writes sales.seed.json + quotes.seed.json + merge-report.json. Idempotent.
//
// Rule recap: Planilla manda en fecha/financials; de Vercel se toman items + status.
// El costo se BLOQUEA en cada item (snapshot del catálogo al momento de confirmar).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const round2 = (n) => Math.round((n || 0) * 100) / 100;

const sales = read('sales.seed.json');
const recientes = read('ventas_recientes.seed.json');
const vsales = read('vercel_sales.json');
const vquotes = read('vercel_quotes.json');
const matches = read('vercel_sale_matches.json');      // venta_nro -> vercel qnum
const remap = read('sku_remap.json');
const products = read('products.seed.json');
const prodBySku = new Map(products.map((p) => [p.sku, p]));

const NOW = new Date().toISOString();
const report = { generatedAt: NOW, recovered: 0, deleted: 0, enriched: 0, quotes: 0, missingSku: {}, dudosos: ['A0073→0000136 (Centauros/Casa Propia)', 'A0052→0000116 (Mapuches/Eslavonia)'] };

const isDiscount = (it) => it.product_id === 'discount' || /^desc/i.test(it.sku || '') || /descuento/i.test(it.description || '');

// Build SaleItem[] from a Vercel items array: remap sku, lock cost, split discounts.
function buildItems(vitems) {
  const items = [];
  let discount_total = 0;
  for (const it of vitems || []) {
    if (isDiscount(it)) { discount_total += Math.abs(it.total || 0); continue; }
    const sku = remap[it.sku] || it.sku || it.product_id || '';
    const prod = prodBySku.get(sku);
    if (!prod) report.missingSku[sku] = (report.missingSku[sku] || 0) + 1;
    const quantity = Number(it.quantity) || 0;
    const unit_price = Number(it.unit_price) || 0;
    items.push({
      product_id: sku,
      sku,
      description: it.description || (prod ? prod.name : ''),
      quantity,
      unit_price,
      total: it.total != null ? round2(it.total) : round2(quantity * unit_price),
      cost: prod ? Number(prod.cost) || 0 : 0,   // LOCKED at confirmation
      category: prod ? prod.category : (it.category || ''),
    });
  }
  return { items, discount_total: round2(discount_total) };
}

const byId = new Map(sales.map((s) => [s.id, s]));

// ---- 1. Recover recent sales (fill the blank 0000125..0000138) ----
for (const r of recientes) {
  let s = byId.get(r.venta_nro);
  if (!s) { s = { id: r.venta_nro, quote_number: r.venta_nro }; sales.push(s); byId.set(r.venta_nro, s); }
  Object.assign(s, {
    quote_number: r.venta_nro,
    title: r.obra || r.client_name,
    description: r.variedad || '',
    client_name: r.client_name,
    client_id: '', client_dni: '', client_email: '', client_phone: '', client_address: r.obra || '',
    contract_total: r.financial_position.total_invoiced,
    created_at: r.created_at || '',
    fecha_pendiente: !!r.fecha_pendiente,
    payment_state: r.payment_state,
    delivery_status: r.delivery_status,
    condicion: r.condicion,
    comentarios: r.comentarios,
    has_iva: /facturado/i.test(r.condicion || ''),
    financial_position: r.financial_position,
    status: r.isFinal ? 'Finalizado' : 'En proceso',
    stock_reserved: !!r.delivery_status && !r.isFinal,
    stock_deducted: !!r.isFinal,
    seller_name: '',
    items: [{ product_id: null, sku: '', description: r.variedad || '', quantity: r.cantidad, unit_price: r.precio, total: round2(r.cantidad * r.precio), cost: 0, category: '' }],
    source: 'planilla-reciente',
  });
  report.recovered++;
}

// ---- 2. Delete truly-empty rows (no fecha, no client, no value) ----
const before = sales.length;
const kept = sales.filter((s) => {
  const empty = !s.created_at && !(s.client_name && String(s.client_name).trim()) && !(s.contract_total > 0);
  return !empty;
});
report.deleted = before - kept.length;

// ---- 3. Enrich matched sales with Vercel SKU items + real status ----
const vByQnum = new Map(vsales.map((v) => [v.quote_number, v]));
const keptById = new Map(kept.map((s) => [s.id, s]));
for (const [venta, qnum] of Object.entries(matches)) {
  const s = keptById.get(venta);
  const v = vByQnum.get(qnum);
  if (!s || !v) { report[`unmatched_${venta}`] = qnum; continue; }
  const { items, discount_total } = buildItems(v.items);
  s.items = items;
  s.discount_total = discount_total;
  s.status = v.status || s.status;             // Vercel real pipeline status
  if (v.client_address) { s.title = v.client_address; s.client_address = v.client_address; }
  if (v.client_phone) s.client_phone = v.client_phone;
  if (v.client_email) s.client_email = v.client_email;
  if (v.client_dni) s.client_dni = v.client_dni;
  s.vercel_qnum = qnum;
  s.source = (s.source ? s.source + '+' : '') + 'vercel';
  report.enriched++;
}

// ---- 4. Import Vercel quotes ----
const quotes = vquotes.map((q) => {
  const { items, discount_total } = buildItems(q.items);
  return {
    id: q.id || q.quote_number,
    quote_number: q.quote_number,
    client_id: q.client_id || '',
    client_name: q.client_name || '',
    client_dni: q.client_dni || '', client_email: q.client_email || '', client_phone: q.client_phone || '', client_address: q.client_address || '',
    seller_name: q.seller_name || '', seller_phone: q.seller_phone || '',
    title: q.client_address || q.title || q.client_name || '',
    description: q.description || '',
    created_at: q.created_at || '',
    price: round2(q.contract_total ?? q.price ?? 0),
    has_iva: !!q.has_iva,
    items, discount_total,
    status: q.status || 'Enviado',
    source: 'vercel',
  };
});
report.quotes = quotes.length;

fs.writeFileSync(path.join(DATA, 'sales.seed.json'), JSON.stringify(kept, null, 2));
fs.writeFileSync(path.join(DATA, 'quotes.seed.json'), JSON.stringify(quotes, null, 2));
fs.writeFileSync(path.join(DATA, 'merge-report.json'), JSON.stringify(report, null, 2));

console.log('=== MERGE VERCEL ===');
console.log('recuperadas (recientes):', report.recovered);
console.log('borradas (vacías):', report.deleted);
console.log('enriquecidas con SKU Vercel:', report.enriched);
console.log('cotizaciones importadas:', report.quotes);
console.log('total ventas:', kept.length);
console.log('SKUs sin costo en catálogo:', Object.keys(report.missingSku).length ? JSON.stringify(report.missingSku) : 'ninguno');
