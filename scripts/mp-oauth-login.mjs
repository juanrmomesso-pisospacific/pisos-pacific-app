#!/usr/bin/env node
// Login OAuth de USUARIO (authorization_code) para Mercado Pago.
// Levanta un server local que captura el ?code=, lo canjea por un access_token de
// usuario (no de app) y prueba si ese token revela nombres de pagador/contraparte
// (que el token de app recorta). Guarda el token en data/sources/.mp-user-token.json
//
// Requisito: en el panel de MP → tu app → "Configuración de la aplicación" →
// "URLs de redireccionamiento", agregá EXACTAMENTE:  http://localhost:8910/callback
//
// Uso: node scripts/mp-oauth-login.mjs   (deja corriendo; abrí el link que imprime)

import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'sources');
const { client_id, client_secret } = JSON.parse(fs.readFileSync(path.join(DATA, '.mp-oauth.json'), 'utf8'));
const PORT = 8910;
const REDIRECT = `https://localhost:${PORT}/callback`;
const TLS = { key: fs.readFileSync(path.join(DATA, 'mp-key.pem')), cert: fs.readFileSync(path.join(DATA, 'mp-cert.pem')) };
const API = 'https://api.mercadopago.com';
const AUTH = `https://auth.mercadopago.com.ar/authorization?client_id=${client_id}&response_type=code&platform_id=mp&redirect_uri=${encodeURIComponent(REDIRECT)}`;

async function jpost(url, body) { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const t = await r.text(); try { return { s: r.status, v: JSON.parse(t) } } catch { return { s: r.status, v: t } } }
async function jget(url, at) { const r = await fetch(url, { headers: { Authorization: `Bearer ${at}` } }); const t = await r.text(); try { return { s: r.status, v: JSON.parse(t) } } catch { return { s: r.status, v: t } } }

console.log('\n1) En el panel de MP, agregá esta Redirect URI (si no está):');
console.log(`   ${REDIRECT}`);
console.log('\n2) Abrí este link en el navegador (logueado como ACU Design) y autorizá:\n');
console.log('   ' + AUTH + '\n');
console.log('Esperando la autorización…');

const server = https.createServer(TLS, async (req, res) => {
  if (!req.url.startsWith('/callback')) { res.writeHead(404); res.end(); return; }
  const code = new URL(req.url, REDIRECT).searchParams.get('code');
  if (!code) { res.writeHead(400); res.end('Sin code'); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h2>✓ Autorización recibida. Volvé a la terminal.</h2>');

  console.log('\nCode recibido, canjeando por token de usuario…');
  const tok = await jpost(`${API}/oauth/token`, { client_id, client_secret, grant_type: 'authorization_code', code, redirect_uri: REDIRECT });
  if (!tok.v.access_token) { console.log('No se pudo canjear:', tok.s, JSON.stringify(tok.v).slice(0, 300)); server.close(); return; }
  fs.writeFileSync(path.join(DATA, '.mp-user-token.json'), JSON.stringify(tok.v, null, 2));
  console.log('✓ Token de USUARIO obtenido (guardado en .mp-user-token.json). scope:', tok.v.scope?.slice(0, 60), '…');
  const AT = tok.v.access_token;

  // PRUEBA CLAVE: ¿revela nombres/pagador/descripcion?
  const me = await jget(`${API}/users/me`, AT);
  console.log('\nusers/me:', me.s, me.s === 200 ? `${me.v.nickname}/${me.v.email}` : '');
  const pay = await jget(`${API}/v1/payments/search?range=date_created&begin_date=2026-03-10T00:00:00.000-03:00&end_date=2026-06-09T00:00:00.000-03:00&limit=12&sort=date_created&criteria=desc`, AT);
  const rs = pay.v.results || [];
  console.log(`payments/search: ${pay.s} (total=${pay.v.paging?.total})`);
  console.log('\n¿VIENEN NOMBRES/DESCRIPCIÓN AHORA?');
  for (const p of rs.slice(0, 10)) {
    const payer = p.payer ? (p.payer.email || `${p.payer.first_name || ''} ${p.payer.last_name || ''}`.trim() || p.payer.identification?.number || p.payer.id) : '';
    console.log(`  ${(p.date_approved || p.date_created)?.slice(0, 10)} | ${p.operation_type} | $${p.transaction_amount} | desc="${p.description || ''}" | payer="${payer}"`);
  }
  console.log('\nListo. Cerrando server.');
  server.close();
});
server.listen(PORT);
