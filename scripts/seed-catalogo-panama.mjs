// Precarga el catálogo inicial de Pacific Panamá (data/catalogo.panama.json) en una
// instancia por API. RE-EJECUTABLE: deduplica por SKU (si ya existe, no lo toca — así
// no pisa los precios/costos que el socio haya cargado desde Inventario).
//
// Uso:  node scripts/seed-catalogo-panama.mjs <base-url> <admin-email> <admin-password>
// Ej.:  node scripts/seed-catalogo-panama.mjs https://pacific-panama.onrender.com socio@... '...'
//       node scripts/seed-catalogo-panama.mjs http://localhost:4600 socio@pa.com pa
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [base, email, password] = process.argv.slice(2);
if (!base || !email || !password) {
  console.error('Uso: node scripts/seed-catalogo-panama.mjs <base-url> <admin-email> <admin-password>');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { products } = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/catalogo.panama.json'), 'utf8'));

const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
if (!login.ok) { console.error(`Login falló (${login.status}) — revisá credenciales/URL`); process.exit(1); }
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
const H = { 'Content-Type': 'application/json', Cookie: cookie };

const existing = await (await fetch(`${base}/api/products`, { headers: H })).json();
const bySku = new Set(existing.map((p) => p.sku));

let created = 0, skipped = 0;
for (const p of products) {
  if (bySku.has(p.sku)) { skipped++; continue; }
  const r = await fetch(`${base}/api/products`, { method: 'POST', headers: H, body: JSON.stringify(p) });
  if (!r.ok) { console.error(`  ✗ ${p.sku} (${r.status})`); continue; }
  console.log(`  ✓ ${p.sku} — ${p.name}`);
  created++;
}
console.log(`\nCatálogo Panamá: ${created} creados, ${skipped} ya existían (no se tocaron).`);
if (created) console.log('OJO: precios y costos van en 0 — los carga el socio desde Inventario.');
