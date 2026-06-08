#!/usr/bin/env node
// Sync de Mercado Pago por API: genera el reporte "Todas las transacciones"
// (account money), lo descarga, y lo deja como CSV para que lo procese el
// importador existente (scripts/import-mp-statements.mjs), que ya clasifica y
// deduplica contra el cashflow. Re-ejecutable.
//
// TOKEN (secreto, NO se commitea): en data/sources/.mp-token (gitignored) o
// en la variable de entorno MP_ACCESS_TOKEN.
//
// Uso:
//   node scripts/sync-mp.mjs                 # últimos ~75 días
//   node scripts/sync-mp.mjs 2026-04-01 2026-06-08
//
// Notas: la API de reportes de MP es asíncrona (crear → esperar → descargar).
// El script valida el token primero y loguea las respuestas reales para ajustar
// endpoints/columnas si MP cambió algo.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const SRC = path.join(DATA, 'sources');
const API = 'https://api.mercadopago.com';

// ── token ────────────────────────────────────────────────────────────
function getToken() {
  if (process.env.MP_ACCESS_TOKEN) return process.env.MP_ACCESS_TOKEN.trim();
  const f = path.join(SRC, '.mp-token');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  console.error('Falta el access token de Mercado Pago.');
  console.error('Ponelo en data/sources/.mp-token (gitignored) o exportá MP_ACCESS_TOKEN.');
  process.exit(1);
}
const TOKEN = getToken();
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

// ── fechas ───────────────────────────────────────────────────────────
const iso = (d) => d.toISOString().slice(0, 19) + 'Z';
const today = new Date();
const fromArg = process.argv[2], toArg = process.argv[3];
const from = fromArg ? new Date(fromArg + 'T00:00:00Z') : new Date(today.getTime() - 75 * 86400000);
const to = toArg ? new Date(toArg + 'T23:59:59Z') : today;

async function jget(url) { const r = await fetch(url, { headers: H }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { ok: r.ok, status: r.status, body: j }; }
async function jpost(url, body) { const r = await fetch(url, { method: 'POST', headers: H, body: JSON.stringify(body) }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { ok: r.ok, status: r.status, body: j }; }

async function main() {
  // 1) Validar token + cuenta
  const me = await jget(`${API}/users/me`);
  if (!me.ok) { console.error('Token inválido o sin permisos:', me.status, JSON.stringify(me.body).slice(0, 300)); process.exit(1); }
  console.log(`✓ Conectado a Mercado Pago: ${me.body.nickname || me.body.id} (${me.body.email || ''})`);
  console.log(`  Rango: ${iso(from)} → ${iso(to)}`);

  // 2) Crear el reporte "Todas las transacciones" (account money).
  // Endpoint canónico del reporte de movimientos de la cuenta:
  const REPORT = `${API}/v1/account/release_report`;
  console.log('\nGenerando reporte de movimientos…');
  const create = await jpost(REPORT, { begin_date: iso(from), end_date: iso(to) });
  if (!create.ok) {
    console.error('No se pudo crear el reporte:', create.status);
    console.error(JSON.stringify(create.body, null, 2).slice(0, 800));
    console.error('\n(Si el endpoint cambió, con esta respuesta ajusto el script al toque.)');
    process.exit(1);
  }
  console.log('  Solicitado. Esperando a que se procese…');

  // 3) Poll de la lista hasta que aparezca procesado.
  let fileName = null;
  for (let i = 0; i < 30 && !fileName; i++) {
    await new Promise(r => setTimeout(r, 4000));
    const list = await jget(`${REPORT}/list`);
    if (!list.ok) { console.error('Error listando reportes:', list.status, JSON.stringify(list.body).slice(0, 300)); break; }
    const arr = Array.isArray(list.body) ? list.body : (list.body.results || []);
    const done = arr.filter(x => /process|complet|finish/i.test(x.status || x.state || '')).sort((a, b) => (b.date_created || '').localeCompare(a.date_created || ''))[0];
    if (done) fileName = done.file_name || done.fileName;
    process.stdout.write('.');
  }
  console.log('');
  if (!fileName) { console.error('El reporte no estuvo listo a tiempo. Volvé a correr el script en un minuto.'); process.exit(1); }

  // 4) Descargar (guardamos bytes crudos; XLSX.readFile detecta xlsx o csv)
  const dl = await fetch(`${REPORT}/${fileName}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!dl.ok) { console.error('No se pudo descargar el archivo:', dl.status); process.exit(1); }
  const buf = Buffer.from(await dl.arrayBuffer());
  const ext = /sheet|excel|officedocument/i.test(dl.headers.get('content-type') || '') || String(fileName).endsWith('.xlsx') ? 'xlsx' : 'csv';
  const out = path.join(SRC, `mp_api_${iso(from).slice(0, 10)}_${iso(to).slice(0, 10)}.${ext}`);
  fs.writeFileSync(out, buf);
  console.log(`✓ Descargado: ${out} (${buf.length} bytes)`);
  console.log('\nAhora procesalo con el importador (clasifica + deduplica):');
  console.log(`  node scripts/import-mp-statements.mjs "${out}"`);
}
main().catch(e => { console.error('Error:', e.message); process.exit(1); });
