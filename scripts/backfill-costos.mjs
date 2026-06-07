#!/usr/bin/env node
// Backfill de costo bloqueado en ventas 2026 sin detalle (ítem genérico de piso sin SKU).
// Matchea la descripción del piso contra el catálogo (data/products.seed.json) por
// similitud de tokens y bloquea sku + cost. Solo pisos (stockTrack). Dry-run por defecto;
// pasar --apply para escribir. Solo toca ventas con created_at >= 2026-01-01.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const APPLY = process.argv.includes('--apply');
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = (s) => new Set(norm(s).split(' ').filter(w => w.length > 1 && !['x', 'mm', 'cm', 'm'].includes(w)));
const jaccard = (a, b) => { const i = [...a].filter(x => b.has(x)).length; const u = new Set([...a, ...b]).size; return u ? i / u : 0; };

const products = JSON.parse(fs.readFileSync(path.join(DATA, 'products.seed.json'), 'utf8'));
const floors = products.filter(p => p.stockTrack);
const floorTok = floors.map(p => ({ p, tok: tokens(p.name) }));

const sales = JSON.parse(fs.readFileSync(path.join(DATA, 'sales.seed.json'), 'utf8'));
const targets = sales.filter(s => (s.created_at || '') >= '2026-01-01' && !(s.items || []).some(it => it.sku && Number(it.cost) > 0));

const rows = [];
for (const s of targets) {
  const it = (s.items || []).find(x => x && x.product_id !== 'discount');
  if (!it) continue;
  const t = tokens(it.description);
  let best = null, bestScore = 0;
  for (const f of floorTok) { const sc = jaccard(t, f.tok); if (sc > bestScore) { bestScore = sc; best = f.p } }
  rows.push({ s, it, best, score: bestScore });
}

rows.sort((a, b) => b.score - a.score);
console.log(`Ventas a completar: ${rows.length}\n`);
for (const r of rows) {
  const ok = r.best && r.score >= 0.4;
  console.log(`${ok ? '✓' : '⚠'} #${r.s.quote_number} (${r.score.toFixed(2)}) "${(r.it.description || '').slice(0, 42)}"`);
  console.log(`   → ${r.best ? r.best.sku + ' ' + r.best.name.slice(0, 44) + ' · costo ' + r.best.cost : 'SIN MATCH'}`);
}

if (APPLY) {
  let n = 0;
  for (const r of rows) {
    if (!r.best || r.score < 0.4) continue;
    r.it.sku = r.best.sku; r.it.product_id = r.best.id; r.it.cost = Number(r.best.cost) || 0;
    r.it.category = r.best.category; r.it.total = (Number(r.it.quantity) || 0) * (Number(r.it.unit_price) || 0);
    n++;
  }
  fs.writeFileSync(path.join(DATA, 'sales.seed.json'), JSON.stringify(sales, null, 2));
  console.log(`\nAPLICADO: ${n} ventas con costo bloqueado.`);
} else {
  console.log('\n(dry-run — pasar --apply para escribir)');
}
