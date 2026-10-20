#!/usr/bin/env node
// Gate A/B de regresión para el perfil AR (Etapa 0 — anillos de deploy).
//
// Qué hace: levanta el server de un checkout de código (--server-dir) contra una COPIA
// de la DB real de AR (--db), y captura "señales" deterministas del perfil AR:
//   - GET /api/config           (moneda/impuesto/locale/módulos de AR)
//   - GET /api/sales            (derivación de cobrado/saldo de TODAS las ventas)
//   - GET /p/q/:id/:token       (PDF de presupuesto del cliente — hash sin metadata)
// El PDF es el artefacto que ve el cliente: captura regresiones de moneda, labels,
// IVA, layout. Se le quita la metadata no-determinista (fechas/ID) antes de hashear.
//
// Uso:
//   node scripts/ab-gate.mjs capture --db <ar-db.json> --server-dir <dir> --out golden.json
//   node scripts/ab-gate.mjs check   --db <ar-db.json> --server-dir <dir> --golden golden.json
//
// "check" captura el candidato y lo compara contra el golden; sale !=0 si hay diferencias.
// Determinista: cada corrida usa una copia fresca de la DB (los backfills del boot no
// contaminan) y NO define DB_GITHUB_* (la capa de persistencia remota queda inerte).

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const ADMIN_EMAIL = process.env.GATE_ADMIN_EMAIL || 'info@pisospacific.com';
const ADMIN_PASS  = process.env.GATE_ADMIN_PASSWORD || 'admin123';
const N_QUOTES    = Number(process.env.GATE_QUOTES || 10);   // cuántos PDFs de presupuesto

function parseArgs(argv) {
  const mode = argv[2];
  const o = { mode };
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) o[a.slice(2)] = argv[++i];
  }
  return o;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// El PDF binario de pdfkit NO es determinista (trae un /ID aleatorio + fechas), pero su
// RENDER visual sí lo es. Rendereamos con qlmanage (macOS) a PNG y hasheamos la imagen:
// es exactamente lo que ve el cliente e inmune a la basura binaria del contenedor PDF.
// (Requiere macOS. En otro SO el gate avisa y deja los PDFs sin hashear.)
function renderPdfPngHash(pdfBuf, tmpDir, name) {
  const pdfPath = path.join(tmpDir, `${name}.pdf`);
  fs.writeFileSync(pdfPath, pdfBuf);
  try {
    execFileSync('qlmanage', ['-t', '-s', '1000', '-o', tmpDir, pdfPath], { stdio: 'ignore' });
  } catch { /* qlmanage ruidoso / ausente */ }
  const pngPath = `${pdfPath}.png`;
  if (!fs.existsSync(pngPath)) return { bytes: pdfBuf.length, png: null, __error: 'qlmanage no generó PNG (¿macOS?)' };
  return { bytes: pdfBuf.length, png: sha(fs.readFileSync(pngPath)) };
}

function pickQuotes(dbPath, n) {
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  return (db.quotes || [])
    .filter((q) => q.id && q.share_token)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))   // orden estable
    .slice(0, n)
    .map((q) => ({ id: q.id, token: q.share_token }));
}

async function waitHealthz(base, ms = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(`${base}/healthz`);
      if (r.ok) return true;
    } catch { /* aún no levanta */ }
    await sleep(400);
  }
  return false;
}

async function capture({ db, serverDir }) {
  // DB copia fresca (el boot la muta con backfills; no queremos contaminar el original)
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'abgate-'));
  const dbCopy = path.join(tmpRoot, 'db.json');
  fs.copyFileSync(db, dbCopy);
  const port = 40000 + Math.floor(Math.random() * 2000);
  const base = `http://127.0.0.1:${port}`;
  const logFd = fs.openSync(path.join(tmpRoot, 'server.log'), 'w');

  const env = { ...process.env, PORT: String(port), DB_PATH: dbCopy, UPLOAD_DIR: path.join(tmpRoot, 'uploads') };
  // Nos aseguramos de NO activar la persistencia remota ni integraciones externas.
  for (const k of ['DB_GITHUB_REPO', 'DB_GITHUB_TOKEN', 'DB_GITHUB_BRANCH']) delete env[k];

  const srv = spawn('node', [path.join(serverDir, 'server.js')], { cwd: serverDir, env, stdio: ['ignore', logFd, logFd] });
  let signals = null, err = null;
  try {
    const up = await waitHealthz(base);
    if (!up) throw new Error(`el server no respondió /healthz (ver ${tmpRoot}/server.log)`);

    signals = { config: null, sales: null, quotes: {} };

    // 1) login admin → cookie (config y sales están detrás del gate de auth)
    const loginR = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS }),
    });
    const setCookie = loginR.headers.get('set-cookie') || '';
    const cookie = setCookie.split(';')[0]; // pp_session=...

    // 2) /api/config — perfil de operación de AR
    const cfgR = await fetch(`${base}/api/config`, { headers: cookie ? { cookie } : {} });
    signals.config = cfgR.ok ? await cfgR.json() : { __error: cfgR.status };

    // 3) /api/sales — derivación de cobrado/saldo por venta (lo sensible del núcleo)
    const salesR = await fetch(`${base}/api/sales`, { headers: cookie ? { cookie } : {} });
    if (salesR.ok) {
      const sales = await salesR.json();
      const map = {};
      for (const s of (Array.isArray(sales) ? sales : [])) {
        map[s.id] = {
          total: s.contract_total ?? null,
          cobrado: s.cashflow_paid ?? s.financial_position?.total_paid ?? null,
          saldo: s.financial_position?.balance_due ?? null,
          status: s.status ?? null,
        };
      }
      signals.sales = { count: Object.keys(map).length, map };
    } else {
      signals.sales = { __error: salesR.status };
    }

    // 4) PDFs de presupuesto (artefacto del cliente) — hash del render visual (PNG)
    const pngDir = path.join(tmpRoot, 'png');
    fs.mkdirSync(pngDir, { recursive: true });
    for (const q of pickQuotes(db, N_QUOTES)) {
      try {
        const r = await fetch(`${base}/p/q/${q.id}/${q.token}`);
        if (!r.ok) { signals.quotes[q.id] = { __error: r.status }; continue; }
        const buf = Buffer.from(await r.arrayBuffer());
        signals.quotes[q.id] = renderPdfPngHash(buf, pngDir, String(q.id));
      } catch (e) {
        signals.quotes[q.id] = { __error: String(e.message || e) };
      }
    }
  } catch (e) {
    err = e;
  } finally {
    srv.kill('SIGKILL');
    fs.closeSync(logFd);
  }
  if (err) throw err;
  return signals;
}

// Diff recursivo simple → lista de rutas que difieren
function diff(a, b, pathStr = '') {
  const out = [];
  const ka = a && typeof a === 'object' ? Object.keys(a) : [];
  const kb = b && typeof b === 'object' ? Object.keys(b) : [];
  if (!(a && typeof a === 'object') || !(b && typeof b === 'object')) {
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${pathStr || '(raíz)'}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
    return out;
  }
  for (const k of new Set([...ka, ...kb])) {
    out.push(...diff(a?.[k], b?.[k], pathStr ? `${pathStr}.${k}` : k));
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.mode || !['capture', 'check'].includes(args.mode)) {
    console.error('uso: node scripts/ab-gate.mjs capture|check --db <db> --server-dir <dir> [--out <json> | --golden <json>]');
    process.exit(2);
  }
  if (!args.db || !args['server-dir']) { console.error('faltan --db y/o --server-dir'); process.exit(2); }

  const signals = await capture({ db: args.db, serverDir: args['server-dir'] });

  if (args.mode === 'capture') {
    const out = args.out || 'gate-golden.json';
    fs.writeFileSync(out, JSON.stringify(signals, null, 2));
    const nq = Object.keys(signals.quotes).length;
    const okq = Object.values(signals.quotes).filter((v) => v.png).length;
    console.log(`✓ golden capturado → ${out}`);
    console.log(`  config: ${signals.config && !signals.config.__error ? 'ok' : 'ERROR ' + JSON.stringify(signals.config)}`);
    console.log(`  ventas: ${signals.sales?.count ?? 'ERROR'} derivadas`);
    console.log(`  PDFs:   ${okq}/${nq} presupuestos hasheados`);
    return;
  }

  // check
  if (!args.golden) { console.error('check necesita --golden <json>'); process.exit(2); }
  const golden = JSON.parse(fs.readFileSync(args.golden, 'utf8'));
  const diffs = diff(golden, signals);
  if (diffs.length === 0) {
    console.log('✓ GATE OK — el perfil AR es idéntico (config + derivación de ventas + PDFs de presupuesto).');
    process.exit(0);
  }
  console.log(`✗ GATE FALLÓ — ${diffs.length} diferencia(s) en el perfil AR:\n`);
  for (const d of diffs.slice(0, 60)) console.log('  • ' + d);
  if (diffs.length > 60) console.log(`  … y ${diffs.length - 60} más`);
  console.log('\nSi el cambio NO debía tocar AR, es una regresión: NO promover a AR.');
  process.exit(1);
}

main().catch((e) => { console.error('gate error:', e.message || e); process.exit(3); });
