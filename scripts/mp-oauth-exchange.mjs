#!/usr/bin/env node
// Canjea un authorization_code de Mercado Pago por un access_token de USUARIO y
// prueba si revela nombres de pagador/descripción (que el token de app recorta).
// Usa redirect público (no localhost, que MP rechaza). El code dura 10 min.
//
// Uso: node scripts/mp-oauth-exchange.mjs <CODE>

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'sources');
const { client_id, client_secret } = JSON.parse(fs.readFileSync(path.join(DATA, '.mp-oauth.json'), 'utf8'));
const REDIRECT = 'https://pisos-pacific-app.vercel.app/mp-callback';   // debe coincidir con la registrada en el panel
const API = 'https://api.mercadopago.com';
let arg = process.argv[2];
if (!arg) { console.error('Pasá el code (o la URL completa): node scripts/mp-oauth-exchange.mjs <CODE|URL>'); process.exit(1); }
// acepta el code pelado o la URL completa de la barra
const code = arg.includes('code=') ? decodeURIComponent(new URL(arg).searchParams.get('code')) : arg.trim();

async function jpost(url, body) { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const t = await r.text(); try { return { s: r.status, v: JSON.parse(t) } } catch { return { s: r.status, v: t } } }
async function jget(url, at) { const r = await fetch(url, { headers: { Authorization: `Bearer ${at}` } }); const t = await r.text(); try { return { s: r.status, v: JSON.parse(t) } } catch { return { s: r.status, v: t } } }

const tok = await jpost(`${API}/oauth/token`, { client_id, client_secret, grant_type: 'authorization_code', code, redirect_uri: REDIRECT });
if (!tok.v.access_token) { console.error('No se pudo canjear el code:', tok.s, JSON.stringify(tok.v).slice(0, 400)); process.exit(1); }
fs.writeFileSync(path.join(DATA, '.mp-user-token.json'), JSON.stringify(tok.v, null, 2));
console.log('✓ Token de USUARIO obtenido (guardado en .mp-user-token.json).');
console.log('  scope:', (tok.v.scope || '').slice(0, 80), '…\n');
const AT = tok.v.access_token;

const me = await jget(`${API}/users/me`, AT);
console.log('users/me:', me.s, me.s === 200 ? `${me.v.nickname}/${me.v.email}` : JSON.stringify(me.v).slice(0, 120));
const pay = await jget(`${API}/v1/payments/search?range=date_created&begin_date=2026-03-10T00:00:00.000-03:00&end_date=2026-06-09T00:00:00.000-03:00&limit=12&sort=date_created&criteria=desc`, AT);
const rs = pay.v.results || [];
console.log(`payments/search: ${pay.s} (total=${pay.v.paging?.total})`);
console.log('\n¿VIENEN NOMBRES/DESCRIPCIÓN AHORA? (token de usuario)');
for (const p of rs.slice(0, 10)) {
  const payer = p.payer ? (p.payer.email || `${p.payer.first_name || ''} ${p.payer.last_name || ''}`.trim() || p.payer.identification?.number || p.payer.id || '') : '';
  console.log(`  ${(p.date_approved || p.date_created)?.slice(0, 10)} | ${p.operation_type} | $${p.transaction_amount} | desc="${p.description || ''}" | payer="${payer}"`);
}
