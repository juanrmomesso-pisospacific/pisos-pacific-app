import express from 'express';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import { parseStatement, CAJA as IMPORT_CAJA } from './import/statements.mjs';
import { startMpReport, getMpReport, parseSettlementBuffer, backfillMpUserMap } from './import/mp-api.mjs';
import { getBlueRate } from './import/fx.mjs';
import { handleInbound, sendOutbound, sendWhatsAppDocument } from './integrations/meta.mjs';
import { buildDailyDigest, todayArt } from './integrations/task-bot.mjs';
import { syncGmailLeads, syncGmailSent, fetchLatestMpReport, listSentRecipients } from './integrations/gmail.mjs';
import { listFolder as driveListFolder, getFileMedia as driveGetFile, getThumb as driveGetThumb, findFirstImage as driveFirstImage, driveConfigured } from './integrations/drive.mjs';
import { sendMail, isMailerConfigured } from './integrations/mailer.mjs';
import { findSupplierMatch, suggestSuppliers, normSup, isNonSupplier } from './integrations/supplier-match.mjs';
import { findClientMatch } from './integrations/client-match.mjs';
import { normProd } from './integrations/product-match.mjs';
import { touchConv } from './integrations/conv.mjs';
import { generatePdf } from './pdf/render.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CLONE = path.join(ROOT, 'clone-source');

const app = express();
app.use(express.json({ limit: '20mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(cookieParser());

// Health check público (Render/uptime) — 200 sin auth.
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

// Política de privacidad (requerida por Meta para pasar la app a Live). Pública.
app.get('/privacy', (_req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html><html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Política de Privacidad — Pisos Pacific</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#1a1a1a;line-height:1.6}h1{font-size:1.6rem}h2{font-size:1.1rem;margin-top:1.8rem}small{color:#666}a{color:#0b66c3}</style>
</head><body>
<h1>Política de Privacidad — Pisos Pacific</h1>
<small>Última actualización: junio 2026</small>
<p>Pisos Pacific (“nosotros”) opera una herramienta interna de gestión que recibe y administra los mensajes y consultas que las personas nos envían por <strong>Instagram, Facebook y WhatsApp</strong>, con el fin de atender consultas comerciales y gestionar pedidos de presupuesto.</p>
<h2>Qué datos tratamos</h2>
<ul>
<li>Nombre de usuario o nombre público y el <strong>contenido de los mensajes</strong> que nos enviás por Instagram/Facebook/WhatsApp.</li>
<li>Datos de contacto que vos nos compartas voluntariamente (teléfono, email, dirección de la obra).</li>
</ul>
<h2>Para qué los usamos</h2>
<ul>
<li>Responder tus consultas y enviarte presupuestos.</li>
<li>Gestionar tu pedido como contacto/lead dentro de nuestra herramienta interna.</li>
</ul>
<h2>Con quién los compartimos</h2>
<p>No vendemos ni alquilamos tus datos. Solo los procesamos en nuestra propia herramienta y en los servicios de Meta (Instagram/Facebook/WhatsApp) necesarios para recibir y responder los mensajes.</p>
<h2>Conservación</h2>
<p>Conservamos los datos el tiempo necesario para atender tu consulta y cumplir obligaciones legales/contables.</p>
<h2>Tus derechos y eliminación de datos</h2>
<p>Podés pedir acceder, corregir o <strong>eliminar tus datos</strong> en cualquier momento escribiéndonos a <a href="mailto:info@pisospacific.com">info@pisospacific.com</a>. Procesamos los pedidos de eliminación dentro de los 30 días.</p>
<h2>Contacto</h2>
<p>Pisos Pacific — <a href="mailto:info@pisospacific.com">info@pisospacific.com</a></p>
</body></html>`);
});

// ---------- Disk-backed db (loads db.json, seeds from dump on first run) ----------
// DB en disco. En producción, apuntá DB_PATH a un disco persistente (ej. /var/data/db.json)
// para no tapar las seeds del repo (data/*.seed.json).
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data/db.json');
// Archivos subidos (PDF/imágenes que se mandan a clientes desde el chat). En el mismo disco persistente que la DB.
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(path.dirname(DB_PATH), 'uploads');
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch { /* ya existe */ }

function seedFromDump() {
  // The core business dump (products/sales/quotes/clients/expenses + settings) lives in an
  // un-committed clone-source/ dir on the original machine. Fall back to empty collections so
  // the app can boot locally without it; drop the real files in to seed full data.
  const readJsonOr = (p, fallback) => {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { console.warn(`Seed source missing (${p}) — using empty fallback`); return fallback; }
  };
  const emptyBody = { body: [] };
  const dump = readJsonOr(path.join(CLONE, 'network/api-dump-core.json'), {
    products: emptyBody, sales: emptyBody, quotes: emptyBody, clients: emptyBody, expenses: emptyBody,
  });
  const settings = readJsonOr(path.join(CLONE, 'network/settings.json'), {});
  const containersSeed = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/containers.seed.json'), 'utf8'));
  // Default users: admin + 2 sellers. Passwords hashed at boot.
  const seedUsers = [
    { id: 'u-admin', email: 'info@pisospacific.com', name: 'Admin User',                password: 'admin123', role: 'admin',  seller_name: '' },
    { id: 'u-juan',  email: 'juan@pisospacific.com', name: 'Juan Rodriguez Momesso',    password: 'juan',     role: 'vendor', seller_name: 'Juan Rodriguez Momesso' },
    { id: 'u-vicky', email: 'victoria@pisospacific.com',name: 'Victoria Gonzalez Collado', password: 'vicky',    role: 'admin', seller_name: 'Victoria Gonzalez Collado' },
  ].map(u => ({ id: u.id, email: u.email, name: u.name, role: u.role, seller_name: u.seller_name, password_hash: bcrypt.hashSync(u.password, 10) }));
  const messagingSeed = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/messaging.seed.json'), 'utf8'));
  // Business data imported from PisosPacific_DataApp_v1.xlsx (scripts/import-excel.mjs).
  // Prefer the generated seeds; fall back to the (usually empty) dump bodies.
  const seedArr = (f) => readJsonOr(path.join(__dirname, 'data', f), null);
  return {
    products: seedArr('products.seed.json') || dump.products.body,
    sales:    seedArr('sales.seed.json')    || dump.sales.body,
    quotes:   seedArr('quotes.seed.json') || dump.quotes.body,
    clients:  seedArr('clients.seed.json')  || dump.clients.body,
    expenses: dump.expenses.body,
    cajas:      seedArr('cajas.seed.json')      || [],
    suppliers:  seedArr('suppliers.seed.json')  || [],
    categories: seedArr('categories.seed.json') || [],
    cashflow:   [...(seedArr('cashflow.seed.json') || []), ...(seedArr('cashflow-bank-extra.seed.json') || []), ...(seedArr('cashflow-mp-extra.seed.json') || []), ...(seedArr('cashflow-cash-extra.seed.json') || []), ...(seedArr('cashflow-vf-extra.seed.json') || []), ...(seedArr('cashflow-tarjeta-extra.seed.json') || []), ...(seedArr('cashflow-reconcile-extra.seed.json') || [])],
    containers: containersSeed,
    leads: [],          // T4.A
    conversations: messagingSeed.conversations,  // M-INBOX.A
    messages:      messagingSeed.messages,
    templates:     messagingSeed.templates,
    stock_movements: seedArr('stock_movements.seed.json') || [],
    users: seedUsers,
    sessions: {},
    settings: {
      ...settings,
      dashboardThresholds: { lateDeliveryDays: 7, overdueCobroDays: 30, conversionWindowDays: 30, lowStockUnits: 5 },
    },
  };
}

const db = (() => {
  if (fs.existsSync(DB_PATH)) {
    try {
      const loaded = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      console.log(`Loaded db.json (${(fs.statSync(DB_PATH).size / 1024).toFixed(0)} KB)`);
      return loaded;
    } catch (e) {
      // La DB existe pero no parsea (truncada/corrupta). NUNCA re-seedear encima:
      // eso borraría los datos reales. Respaldar y abortar el arranque para que un
      // humano lo recupere (Render mantiene viva la versión anterior si no levanta).
      const bak = `${DB_PATH}.corrupt-${Date.now()}`;
      try { fs.copyFileSync(DB_PATH, bak); } catch { /* noop */ }
      console.error(`FATAL: db.json no parsea (${e.message}). Respaldo en ${bak}. Abortando para no pisar datos reales.`);
      throw new Error('db.json corrupto — arranque abortado para proteger los datos');
    }
  }
  // Primer arranque sin DB: si hay un snapshot commiteado (data/db.bootstrap.json),
  // usarlo (datos reales en producción sin subir nada a mano). Si no, seedear.
  const BOOT = path.join(__dirname, 'data/db.bootstrap.json');
  let fresh;
  if (fs.existsSync(BOOT)) {
    try { fresh = JSON.parse(fs.readFileSync(BOOT, 'utf8')); console.log('Bootstrapped db from data/db.bootstrap.json'); }
    catch (e) { console.warn(`db.bootstrap.json inválido (${e.message}) — seedeando`); }
  }
  if (!fresh) { fresh = seedFromDump(); console.log('Seeded db.json from clone-source dump'); }
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(fresh, null, 2));
  return fresh;
})();

let saveTimer = null;
function flushSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  // Escritura atómica: escribir a .tmp y renombrar (rename es atómico en el mismo FS).
  // Evita dejar un db.json truncado si el proceso muere a mitad del write.
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_PATH);
}
function save() {
  // Debounce writes so a burst of mutations only writes once
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 50);
}
// Flush pendiente antes de salir (deploys de Render mandan SIGTERM) → no perder los últimos cambios.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => { try { flushSave(); } catch { /* noop */ } process.exit(0); });
}

// Depósito por defecto (gancho forward-compat para depósitos/distribuidores múltiples a futuro).
const DEFAULT_WAREHOUSE = 'main';
// Backfill collections added after the first seed so existing db.json files keep working.
if (!Array.isArray(db.leads)) db.leads = [];
// (El seed demo de leads web fue retirado: los leads reales entran solos desde Gmail.)
if (!Array.isArray(db.payment_links)) db.payment_links = [];
if (!Array.isArray(db.tasks)) db.tasks = [];
// One-shot rename: legacy task titles using "Informe de obra" → "Remito"
{
  let renamed = 0;
  for (const t of db.tasks) {
    if (typeof t.title === 'string' && t.title.includes('Informe de obra')) {
      t.title = t.title.replace(/Informe de obra/g, 'Remito');
      renamed += 1;
    }
  }
  if (renamed > 0) {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
    console.log(`Renamed ${renamed} legacy task title(s) "Informe de obra" → "Remito"`);
  }
}
if (!db.settings.integrations) db.settings.integrations = {};
if (!db.settings.integrations.mercadopago) db.settings.integrations.mercadopago = { enabled: false, access_token: '', public_key: '' };
// Vendedores para los selectores (cotización/venta) — derivados de los usuarios vendor.
{
  const phones = { 'Juan Rodriguez Momesso': '+54 11 51750097', 'Victoria Gonzalez Collado': '+54 11 36982222' };
  let changed = false;
  if (!Array.isArray(db.settings.sellers) || db.settings.sellers.length === 0) {
    db.settings.sellers = (db.users || []).filter(u => u.seller_name).map(u => ({ name: u.seller_name, phone: phones[u.seller_name] || '' }));
    changed = true;
  }
  for (const s of db.settings.sellers) { if (phones[s.name] && s.phone !== phones[s.name]) { s.phone = phones[s.name]; changed = true; } }
  // Equipos de colocación activos (responsables a quienes se les paga).
  const crews = ['Hugo Ramirez', 'Gastón Aguilera', 'Ariel Ernesto Garcia', 'Fabián Ortiz'];
  if (JSON.stringify(db.settings.crews || []) !== JSON.stringify(crews)) { db.settings.crews = crews; changed = true; }
  // Colocadores (mano de obra): se excluyen del opex del P&L híbrido (ya están en el costo del servicio).
  // Oso y Maldo NO son colocadores (depósito/personal) → quedan en Gastos de Personal.
  const installers = [...crews];
  if (JSON.stringify(db.settings.installers || []) !== JSON.stringify(installers)) { db.settings.installers = installers; changed = true; }
  if (changed) { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); console.log(`Synced ${db.settings.sellers.length} sellers into settings`); }
}
if (!Array.isArray(db.conversations) || db.conversations.length === 0 || !Array.isArray(db.messages) || !Array.isArray(db.templates)) {
  try {
    const messagingSeed = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/messaging.seed.json'), 'utf8'));
    if (!Array.isArray(db.conversations) || db.conversations.length === 0) db.conversations = messagingSeed.conversations;
    if (!Array.isArray(db.messages))                                       db.messages = messagingSeed.messages;
    if (!Array.isArray(db.templates))                                      db.templates = messagingSeed.templates;
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
    console.log('Seeded messaging collections into existing db.json');
  } catch (e) {
    console.warn('messaging seed missing or invalid:', e.message);
  }
}

// Backfill de plantillas: completar keywords faltantes + sumar plantillas nuevas del seed
// (prod ya tiene las plantillas SIN keywords → por eso las sugerencias casi no disparaban).
// Idempotente: solo agrega lo que falta.
if (Array.isArray(db.templates)) {
  try {
    const seedT = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/messaging.seed.json'), 'utf8')).templates || [];
    const byName = new Map(db.templates.map((t) => [t.name, t]));
    let added = 0, kw = 0, retag = 0, st = 0;
    for (const s of seedT) {
      const ex = byName.get(s.name);
      if (!ex) { db.templates.push({ ...s, id: s.id || `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}` }); added++; }
      else {
        if (s.keywords && !ex.keywords) { ex.keywords = s.keywords; kw++; }
        if (s.stage && !ex.stage) { ex.stage = s.stage; st++; }   // etapa del funnel (sugerencias por estado del lead)
      }
    }
    // Las 2 plantillas genéricas viejas pasan de "all" a "chat" → no compiten en los mails
    // con las plantillas de email nuevas (perfiles diferenciados). Idempotente.
    for (const name of ['respuesta_consulta', 'pedir_datos_presupuesto']) {
      const ex = byName.get(name);
      if (ex && ex.channel === 'all') { ex.channel = 'chat'; retag++; }
    }
    if (added || kw || retag || st) { try { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); } catch { /* noop */ } console.log(`Backfill plantillas: +${added} nuevas, ${kw} con keywords, ${st} con etapa, ${retag} re-tag a chat`); }
  } catch (e) { console.warn('backfill plantillas:', e.message); }
}

// Depósitos + alias de productos (importación de contenedores). Gancho forward-compat:
// todo contenedor/movimiento queda etiquetado con un depósito (default 'main' = Pacific) para
// que depósitos/distribuidores múltiples a futuro no obliguen a rehacer el flujo. Idempotente.
if (!Array.isArray(db.product_aliases)) db.product_aliases = [];
{
  let changed = false;
  if (!Array.isArray(db.settings.warehouses) || db.settings.warehouses.length === 0) {
    db.settings.warehouses = [{ id: DEFAULT_WAREHOUSE, name: 'Depósito Pacific' }];
    changed = true;
  }
  for (const c of db.containers || []) { if (c && c.warehouse_id == null) { c.warehouse_id = DEFAULT_WAREHOUSE; changed = true; } }
  for (const m of db.stock_movements || []) { if (m && m.warehouse_id == null) { m.warehouse_id = DEFAULT_WAREHOUSE; changed = true; } }
  if (changed) { try { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); } catch { /* noop */ } console.log('Backfill depósitos: warehouse_id en containers/movimientos + depósito default'); }
}

// Backfill del estado de respuesta de las conversaciones (dirección del último mensaje +
// timestamps por dirección). Idempotente: solo completa las que no lo tienen todavía
// (de ahí en más lo mantiene touchConv en cada escritura). "Pendiente" = última 'in'.
if (Array.isArray(db.conversations) && Array.isArray(db.messages)) {
  const lastMsg = new Map(), lastIn = new Map(), lastOut = new Map();
  for (const m of db.messages) {
    const cid = m.conversation_id, ts = m.ts || '';
    if (!cid || !ts) continue;
    if (!lastMsg.has(cid) || ts >= lastMsg.get(cid).ts) lastMsg.set(cid, { ts, dir: m.direction });
    if (m.direction === 'in') { if (!lastIn.has(cid) || ts > lastIn.get(cid)) lastIn.set(cid, ts); }
    else { if (!lastOut.has(cid) || ts > lastOut.get(cid)) lastOut.set(cid, ts); }
  }
  let n = 0;
  for (const c of db.conversations) {
    if (c.last_message_direction) continue;   // ya tiene estado → la mantiene touchConv
    const lm = lastMsg.get(c.id);
    if (lm) { c.last_message_direction = lm.dir; n++; }
    if (lastIn.has(c.id)) c.last_inbound_at = lastIn.get(c.id);
    if (lastOut.has(c.id)) c.last_outbound_at = lastOut.get(c.id);
  }
  if (n) { try { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); } catch { /* noop */ } console.log(`Backfill reply-state: ${n} conversaciones`); }
}

// Ensure auth state exists on older db.json files (for users who seeded before auth landed)
if (!Array.isArray(db.users) || db.users.length === 0) {
  const seedUsers = [
    { id: 'u-admin', email: 'info@pisospacific.com', name: 'Admin User',                password: 'admin123', role: 'admin',  seller_name: '' },
    { id: 'u-juan',  email: 'juan@pisospacific.com', name: 'Juan Rodriguez Momesso',    password: 'juan',     role: 'vendor', seller_name: 'Juan Rodriguez Momesso' },
    { id: 'u-vicky', email: 'victoria@pisospacific.com',name: 'Victoria Gonzalez Collado', password: 'vicky',    role: 'admin', seller_name: 'Victoria Gonzalez Collado' },
  ].map(u => ({ id: u.id, email: u.email, name: u.name, role: u.role, seller_name: u.seller_name, password_hash: bcrypt.hashSync(u.password, 10) }));
  db.users = seedUsers;
  db.sessions = db.sessions ?? {};
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  console.log('Seeded default users into existing db.json');
}
if (!db.sessions) db.sessions = {};

// Acceso de Victoria con su email real: migra el usuario vicky@ → victoria@pisospacific.com
// (una sola vez, persistido). Si ya existe victoria@, no toca nada (no pisa su contraseña).
if (!db.settings) db.settings = {};
if (!db.settings.victoria_access) {
  const existing = db.users.find(u => (u.email || '').toLowerCase() === 'victoria@pisospacific.com');
  const old = db.users.find(u => u.id === 'u-vicky' || (u.email || '').toLowerCase() === 'vicky@pisospacific.com');
  if (!existing && old) { old.email = 'victoria@pisospacific.com'; old.password_hash = bcrypt.hashSync('pacific2026', 10); }
  else if (!existing && !old) { db.users.push({ id: 'u-victoria', email: 'victoria@pisospacific.com', name: 'Victoria Gonzalez Collado', role: 'admin', seller_name: 'Victoria Gonzalez Collado', password_hash: bcrypt.hashSync('pacific2026', 10) }); }
  db.settings.victoria_access = true;
  try { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); } catch { /* se persiste igual en el próximo save */ }
  console.log('Acceso de Victoria activado (victoria@pisospacific.com)');
}
// Victoria con acceso total (ve todas las ventas) → role admin (una sola vez).
if (!db.settings.victoria_admin) {
  const v = db.users.find(u => (u.email || '').toLowerCase() === 'victoria@pisospacific.com');
  if (v) v.role = 'admin';
  db.settings.victoria_admin = true;
  try { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); } catch { /* se persiste en el próximo save */ }
  console.log('Victoria → admin (acceso total)');
}

// Backfill the imported business collections (cajas/suppliers/categories/cashflow) on
// older db.json files. Each loads from its seed if missing or empty.
for (const [key, file] of [['cajas','cajas.seed.json'],['suppliers','suppliers.seed.json'],['categories','categories.seed.json'],['cashflow','cashflow.seed.json']]) {
  if (!Array.isArray(db[key]) || db[key].length === 0) {
    try { db[key] = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', file), 'utf8')); }
    catch { if (!Array.isArray(db[key])) db[key] = []; }
  }
}

// S2: reglas de clasificación editables + que aprenden. Se siembran 1 vez desde
// counterparty-map.json (legacy) y a partir de ahí viven en la DB (editables por UI + auto-aprendidas).
if (!Array.isArray(db.cp_rules)) {
  db.cp_rules = [];
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'counterparty-map.json'), 'utf8'));
    let n = 0;
    for (const [cuit, e] of Object.entries(raw.byCuit || {}))
      db.cp_rules.push({ id: `cpr-seed-${++n}`, match: e.counterparty ? [e.counterparty] : [], cuit, counterparty: e.counterparty || null, category: e.category || null, expense_type: e.expense_type || null, personal: false, source: 'seed', note: e.note || null });
    for (const e of raw.byName || [])
      db.cp_rules.push({ id: `cpr-seed-${++n}`, match: e.match || [], cuit: null, counterparty: e.counterparty || null, category: e.category || null, expense_type: e.expense_type || null, personal: !!e.personal, source: 'seed', note: e.note || null });
  } catch { /* sin mapa legacy: arranca vacío */ }
}

console.log(`Loaded: ${db.products.length} products, ${db.quotes.length} quotes, ${db.sales.length} sales, ${db.clients.length} clients, ${db.expenses.length} expenses, ${db.containers.length} containers, ${db.users.length} users`);
console.log(`Business data: ${db.cajas.length} cajas, ${db.categories.length} categorías, ${db.suppliers.length} proveedores, ${db.cashflow.length} movimientos cashflow`);

// ---------- Auth helpers + endpoints ----------
const SESSION_COOKIE = 'pp_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;  // 14 days

function newToken() { return crypto.randomBytes(24).toString('base64url'); }
function sessionUser(req) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  const sess = db.sessions[token];
  if (!sess) return null;
  if (sess.expires < Date.now()) { delete db.sessions[token]; save(); return null; }
  return db.users.find(u => u.id === sess.userId) ?? null;
}
function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, seller_name: u.seller_name };
}
function requireAuth(req, res, next) {
  const u = sessionUser(req);
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  req.user = u;
  next();
}
// Solo admin: protege escrituras sensibles (finanzas, reglas, settings, imports).
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'solo admin' });
  next();
}

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: 'missing credentials' });
  const u = db.users.find(x => x.email.toLowerCase() === String(email).toLowerCase());
  if (!u || !bcrypt.compareSync(password, u.password_hash)) return res.status(401).json({ error: 'invalid credentials' });
  const token = newToken();
  db.sessions[token] = { userId: u.id, expires: Date.now() + SESSION_TTL_MS };
  save();
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', maxAge: SESSION_TTL_MS });
  res.json({ user: publicUser(u) });
});
app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token && db.sessions[token]) { delete db.sessions[token]; save(); }
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});
app.get('/api/auth/me', (req, res) => {
  const u = sessionUser(req);
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  res.json({ user: publicUser(u) });
});

const setPassword = (u, pw) => { u.password_hash = bcrypt.hashSync(String(pw), 10); };

// Cambiar contraseña (autenticado).
app.post('/api/auth/change-password', (req, res) => {
  const u = sessionUser(req);
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  const { current, new: next } = req.body ?? {};
  if (!bcrypt.compareSync(String(current ?? ''), u.password_hash)) return res.status(400).json({ error: 'La contraseña actual es incorrecta' });
  if (!next || String(next).length < 6) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
  setPassword(u, next);
  save();
  res.json({ ok: true });
});

// ---------- Gestión de usuarios / equipo (solo admin) ----------
const VALID_ROLES = new Set(['admin', 'vendor', 'logistica']);
app.get('/api/users', requireAuth, requireAdmin, (_req, res) => res.json(db.users.map(publicUser)));
app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  const { email, name, role, seller_name, password } = req.body ?? {};
  const em = String(email || '').trim().toLowerCase();
  if (!em || !/.+@.+\..+/.test(em)) return res.status(400).json({ error: 'email inválido' });
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'falta el nombre' });
  if (!VALID_ROLES.has(role)) return res.status(400).json({ error: 'rol inválido' });
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'la contraseña debe tener al menos 6 caracteres' });
  if (db.users.some(u => (u.email || '').toLowerCase() === em)) return res.status(409).json({ error: 'ya existe un usuario con ese email' });
  const u = { id: 'u-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), email: em, name: String(name).trim(), role, seller_name: seller_name || '', password_hash: bcrypt.hashSync(String(password), 10) };
  db.users.push(u); save();
  res.json({ user: publicUser(u) });
});
app.patch('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  const u = db.users.find(x => x.id === req.params.id);
  if (!u) return res.sendStatus(404);
  const { name, role, seller_name } = req.body ?? {};
  if (role !== undefined) {
    if (!VALID_ROLES.has(role)) return res.status(400).json({ error: 'rol inválido' });
    if (u.role === 'admin' && role !== 'admin' && db.users.filter(x => x.role === 'admin').length <= 1) return res.status(400).json({ error: 'no podés dejar el sistema sin administradores' });
    u.role = role;
  }
  if (name !== undefined && String(name).trim()) u.name = String(name).trim();
  if (seller_name !== undefined) u.seller_name = seller_name || '';
  save(); res.json({ user: publicUser(u) });
});
app.post('/api/users/:id/set-password', requireAuth, requireAdmin, (req, res) => {
  const u = db.users.find(x => x.id === req.params.id);
  if (!u) return res.sendStatus(404);
  const pw = req.body?.password;
  if (!pw || String(pw).length < 6) return res.status(400).json({ error: 'la contraseña debe tener al menos 6 caracteres' });
  setPassword(u, pw); save(); res.json({ ok: true });
});
app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  const u = db.users.find(x => x.id === req.params.id);
  if (!u) return res.sendStatus(404);
  if (u.id === req.user.id) return res.status(400).json({ error: 'no podés borrar tu propio usuario' });
  if (u.role === 'admin' && db.users.filter(x => x.role === 'admin').length <= 1) return res.status(400).json({ error: 'no podés borrar el último administrador' });
  db.users = db.users.filter(x => x.id !== u.id);
  for (const [tok, s] of Object.entries(db.sessions || {})) if (s.userId === u.id) delete db.sessions[tok];
  save(); res.json({ ok: true });
});

// Olvidé mi contraseña → genera token y manda email con link de reseteo.
if (!db.password_resets) db.password_resets = {};
app.post('/api/auth/forgot-password', async (req, res) => {
  const email = String(req.body?.email ?? '').toLowerCase().trim();
  const u = db.users.find(x => x.email.toLowerCase() === email);
  // Respuesta genérica siempre (no revelar si el email existe).
  if (u) {
    const token = crypto.randomBytes(24).toString('hex');
    db.password_resets[token] = { userId: u.id, expires: Date.now() + 60 * 60 * 1000 }; // 1h
    save();
    const base = process.env.APP_URL || `${req.headers['x-forwarded-proto'] || 'https'}://${req.get('host')}`;
    const link = `${base}/reset?token=${token}`;
    try {
      await sendMail({ to: u.email, subject: 'Recuperar tu contraseña — Pisos Pacific', html: `<p>Hola ${u.name || ''},</p><p>Para crear una nueva contraseña, entrá a este link (vence en 1 hora):</p><p><a href="${link}">${link}</a></p><p>Si no pediste esto, ignorá este mail.</p>` });
    } catch (e) {
      console.warn('[forgot-password] no se pudo enviar email:', e.message, '| link:', link);
    }
  }
  res.json({ ok: true, mailer: isMailerConfigured() });
});

// Resetear contraseña con el token del email.
app.post('/api/auth/reset-password', (req, res) => {
  // Purga de tokens vencidos (no se acumulan entre pedidos).
  let purged = false;
  for (const [t, e] of Object.entries(db.password_resets || {})) {
    if (e.expires < Date.now()) { delete db.password_resets[t]; purged = true; }
  }
  if (purged) save();
  const { token, password } = req.body ?? {};
  const entry = db.password_resets?.[token];
  if (!entry || entry.expires < Date.now()) return res.status(400).json({ error: 'El link venció o no es válido. Pedí uno nuevo.' });
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  const u = db.users.find(x => x.id === entry.userId);
  if (!u) return res.status(400).json({ error: 'Usuario no encontrado' });
  setPassword(u, password);
  delete db.password_resets[token];
  save();
  res.json({ ok: true });
});

// Gate all /api/* except the auth endpoints and the public webhooks (Meta/MP call them).
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  if (req.path.startsWith('/whatsapp/webhook')) return next();
  if (req.path.startsWith('/instagram/webhook')) return next();
  if (req.path.startsWith('/mp/webhook')) return next();
  if (req.path === '/integrations/google/callback') return next();   // Google redirige acá (code one-time)
  if (req.path.startsWith('/payment-links/') && req.path.endsWith('/simulate-paid')) return next();
  return requireAuth(req, res, next);
});

// Helper: append a stock movement (kept short). warehouseId etiqueta el movimiento por depósito;
// los callers actuales no lo pasan → quedan en 'main' por el default (sin cambios de comportamiento).
function movement(type, ref, productId, sku, qty, warehouseId = DEFAULT_WAREHOUSE) {
  db.stock_movements.push({ ts: new Date().toISOString(), type, ref, product_id: productId, sku, qty, warehouse_id: warehouseId });
}
function findProductByItem(it) {
  return db.products.find(p => p.id === it.product_id) || db.products.find(p => p.sku === it.sku);
}

// ---------- Mock REST endpoints ----------
// m² ya entregados de una venta por SKU (suma de las entregas de material parciales).
function deliveredBySku(s) {
  const m = {};
  for (const d of (s.material_deliveries || [])) {
    for (const it of (d.items || [])) { if (it && it.sku) m[it.sku] = (m[it.sku] || 0) + (Number(it.quantity) || 0); }
  }
  return m;
}
// Committed stock per SKU = qty PENDIENTE DE ENTREGAR en ventas no finalizadas (material reservado, aún
// en el depósito). Lo ya entregado salió físicamente del stock → no se cuenta como reserva.
function committedBySku() {
  const m = {};
  for (const s of db.sales) {
    if (s.status === 'Finalizado' || s.status === 'Cancelado') continue;   // ni entregadas ni canceladas reservan
    const delivered = deliveredBySku(s);
    for (const it of s.items || []) {
      if (!it || !it.sku) continue;
      const pending = Math.max(0, (Number(it.quantity) || 0) - (delivered[it.sku] || 0));
      if (pending > 0) m[it.sku] = (m[it.sku] || 0) + pending;
    }
  }
  return m;
}
app.get('/api/products', (_, res) => {
  const committed = committedBySku();
  // Only meaningful for stock-tracked products (floors); services/extras carry no stock.
  res.json(db.products.map(p => ({ ...p, committed: p.stockTrack ? Math.round((committed[p.sku] || 0) * 100) / 100 : 0 })));
});

// ---------- Auditoría de inventario (admin) ----------
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
// Movimientos que afectan el stock FÍSICO (no la reserva) → libro mayor del stock.
const PHYSICAL_MOVE_TYPES = new Set(['initial_import', 'container_receive', 'sale_deduct', 'manual_adjustment', 'stock_count', 'sale_cancel_restock']);
// Diagnóstico read-only: cuenta de cada producto contra el libro mayor + sobre-cotizados.
app.get('/api/inventory/audit', requireAdmin, (_req, res) => {
  const committed = committedBySku();
  const ledger = {};
  for (const m of db.stock_movements || []) {
    if (!m.sku || !PHYSICAL_MOVE_TYPES.has(m.type)) continue;
    ledger[m.sku] = (ledger[m.sku] || 0) + (Number(m.qty) || 0);
  }
  const rows = [];
  for (const p of db.products) {
    if (!p.stockTrack) continue;
    const stock = Number(p.stock) || 0;
    const comm = r2(committed[p.sku] || 0);
    const reserved = Number(p.reservedStock) || 0;
    const expected = (p.sku in ledger) ? r2(ledger[p.sku]) : null;
    const flags = [];
    if (stock - comm < -0.5) flags.push('sobre-cotizado');   // ventas reservadas > stock físico
    if (expected !== null && Math.abs(expected - stock) > 0.5) flags.push('stock≠libro');   // cambio sin registrar
    if (flags.length) rows.push({ sku: p.sku, name: p.name, stock, committed: comm, available: r2(stock - comm), reservedStock: reserved, ledger_expected: expected, flags });
  }
  // Ventas ACTIVAS con líneas de piso SIN producto vinculado → NO reservan stock (hay que asociarlas
  // o cerrar la venta). Se excluyen servicios/descuentos (que legítimamente no llevan producto).
  const SVC_RX = /colocaci|entrega|ajuste|medici|reparaci|servicio|mano de obra|flete|descuento|adicional|visita/i;
  const unlinked = [];
  for (const s of db.sales) {
    if (s.status === 'Finalizado' || s.status === 'Cancelado') continue;
    for (const it of (s.items || [])) {
      const qty = Number(it.quantity) || 0;
      if (qty <= 0 || it.sku || it.product_id) continue;
      if (/^SERV/i.test(it.sku || '') || SVC_RX.test(it.description || '')) continue;
      unlinked.push({ sale_id: s.id, quote_number: s.quote_number, client_name: s.client_name, status: s.status, description: it.description || '', quantity: r2(qty) });
    }
  }
  res.json({ checked: db.products.filter(p => p.stockTrack).length, issues: rows.length, rows, unlinked });
});
// Conciliación con el conteo físico (CSV de ida y vuelta). Dry-run por defecto; commit aplica.
app.post('/api/inventory/reconcile', requireAdmin, (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const commit = req.body?.commit === true;
  const committed = committedBySku();
  const bySku = new Map(db.products.map(p => [p.sku, p]));
  // Libro mayor por SKU (suma de movimientos físicos) → para que el conteo también lo sane.
  const ledger = {};
  for (const m of db.stock_movements || []) {
    if (!m.sku || !PHYSICAL_MOVE_TYPES.has(m.type)) continue;
    ledger[m.sku] = (ledger[m.sku] || 0) + (Number(m.qty) || 0);
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const out = []; let applied = 0;
  for (const r of rows) {
    const p = bySku.get(String(r.sku));
    if (!p) { out.push({ sku: r.sku, error: 'SKU no encontrado' }); continue; }
    const physical = Number(r.physical);
    if (!Number.isFinite(physical)) continue;   // fila sin conteo cargado → se ignora
    const stock = Number(p.stock) || 0;
    const comm = r2(committed[p.sku] || 0);
    const diff = r2(physical - stock);
    // El movimiento lleva el LIBRO MAYOR al físico (no solo el stock), así un conteo
    // también sana desajustes históricos del libro (stock≠libro previo).
    const ledgerBase = (p.sku in ledger) ? ledger[p.sku] : stock;
    const ledgerDelta = r2(physical - ledgerBase);
    const flags = [];
    if (diff > 0) flags.push('sobra'); else if (diff < 0) flags.push('falta');
    if (physical - comm < -0.5) flags.push('físico<reservado');
    if (commit && (diff !== 0 || ledgerDelta !== 0)) {
      p.stock = physical;
      if (ledgerDelta !== 0) movement('stock_count', `conciliacion-${stamp}`, p.id, p.sku, ledgerDelta);
      applied++;
    }
    out.push({ sku: p.sku, name: p.name, stock, physical, diff, committed: comm, available_after: r2(physical - comm), flags });
  }
  if (commit && applied) save();
  res.json({ commit, applied, count: out.length, rows: out });
});

// Categoría de un ítem de venta para el P&L híbrido: piso | servicio | extras.
function itemPnlCategory(it) {
  const p = it.sku ? db.products.find(x => x.sku === it.sku) : null;
  if (p) {
    if (p.stockTrack) return 'piso';
    if (/servicio/i.test(p.category || '')) return 'servicio';
    return 'extras';
  }
  // Ad-hoc (sin producto en catálogo): inferir por sku/descripción.
  const t = `${it.sku || ''} ${it.description || ''}`;
  if (/^SERV|colocaci|entrega|retiro|ajuste|medici|servicio|mano de obra|reparaci/i.test(t)) return 'servicio';
  return 'extras';
}

// Margin per sale (for dashboards): venta_neta = Σ(item.total) − discount_total; COGS = Σ(qty × item.cost locked).
// breakdown: ingreso y costo por categoría (piso/servicio/extras) para el P&L híbrido.
function saleMargin(s) {
  let net = 0, cogs = 0, hasSku = false;
  const bd = { piso: { rev: 0, cost: 0 }, servicio: { rev: 0, cost: 0 }, extras: { rev: 0, cost: 0 } };
  for (const it of s.items || []) {
    if (!it || it.product_id === 'discount') continue;
    const rev = Number(it.total) || 0;
    const c = (Number(it.quantity) || 0) * (Number(it.cost) || 0);
    net += rev;
    cogs += c;
    const cat = itemPnlCategory(it);
    bd[cat].rev += rev; bd[cat].cost += c;
    if (it.sku) hasSku = true;
  }
  // Sin detalle SKU no hay costo real → margen no calculable (evita un 100% engañoso en dashboards).
  if (!hasSku) return { venta_neta: null, cogs: null, margin: null, margin_pct: null, has_sku_detail: false };
  net -= Number(s.discount_total) || 0;
  // El descuento global se imputa proporcionalmente al ingreso de piso (es lo que más se descuenta).
  if (bd.piso.rev > 0) bd.piso.rev = Math.round((bd.piso.rev - (Number(s.discount_total) || 0)) * 100) / 100;
  const r2 = (n) => Math.round(n * 100) / 100;
  const margin_bd = {
    piso: { rev: r2(bd.piso.rev), cost: r2(bd.piso.cost) },
    servicio: { rev: r2(bd.servicio.rev), cost: r2(bd.servicio.cost) },
    extras: { rev: r2(bd.extras.rev), cost: r2(bd.extras.cost) },
  };
  const margin = net - cogs;
  return { venta_neta: Math.round(net * 100) / 100, cogs: Math.round(cogs * 100) / 100, margin: Math.round(margin * 100) / 100, margin_pct: net ? Math.round((margin / net) * 1000) / 10 : null, has_sku_detail: true, margin_bd };
}
app.get('/api/sales',    (_, res) => {
  // Reconcile each sale's collected amount from cashflow income lines tagged with its venta_nro.
  const paidByRef = {};
  for (const m of db.cashflow) {
    if (m.sale_ref && (m.flow || '').toLowerCase() === 'ingreso') {
      paidByRef[m.sale_ref] = (paidByRef[m.sale_ref] || 0) + (m.amount_usd || 0);
    }
  }
  res.json(db.sales.map(s => {
    const out = { ...s, ...saleMargin(s) };
    const cashflow_paid = paidByRef[s.quote_number];
    if (cashflow_paid != null) {
      const paid = Math.round(cashflow_paid * 100) / 100;
      out.cashflow_paid = paid;
      out.cashflow_balance_due = Math.round((s.contract_total - paid) * 100) / 100;
    }
    return out;
  }));
});
app.get('/api/quotes',   (_, res) => res.json(db.quotes));
app.get('/api/clients',  (_, res) => res.json(db.clients));
app.get('/api/expenses', (_, res) => res.json(db.expenses));
app.get('/api/leads',    (_, res) => res.json(db.leads));
app.get('/api/tasks',    (_, res) => res.json(db.tasks));
app.get('/api/suppliers',  (_, res) => res.json(db.suppliers));
app.get('/api/categories', (_, res) => res.json(db.categories));

// Dólar Blue (promedio compra/venta) — default exchange rate for new movements.
// Sourced from dolarapi.com (mirrors the blue shown on DolarHoy). Cached 15 min.
let fxCache = null;
app.get('/api/fx/blue', async (_, res) => {
  if (fxCache && Date.now() - fxCache.fetched_at < 15 * 60 * 1000) return res.json(fxCache);
  try {
    const r = await fetch('https://dolarapi.com/v1/dolares/blue', { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    const compra = Number(j.compra), venta = Number(j.venta);
    fxCache = { compra, venta, promedio: Math.round((compra + venta) / 2 * 100) / 100, source: 'Dólar Blue (DolarHoy)', updated_at: j.fechaActualizacion, fetched_at: Date.now() };
    res.json(fxCache);
  } catch (e) {
    if (fxCache) return res.json(fxCache);  // serve stale on failure
    res.status(502).json({ error: 'fx unavailable', promedio: 1425, compra: 1415, venta: 1435 });
  }
});

// CashFlow ledger with optional filters: ?flow=&caja_id=&from=&to=&needs_review=true
app.get('/api/cashflow', (req, res) => {
  const { flow, caja_id, from, to, needs_review } = req.query;
  let rows = db.cashflow;
  if (flow)        rows = rows.filter(m => (m.flow || '').toLowerCase() === String(flow).toLowerCase());
  if (caja_id)     rows = rows.filter(m => m.caja_id === caja_id);
  if (from)        rows = rows.filter(m => m.date && m.date >= from);
  if (to)          rows = rows.filter(m => m.date && m.date <= to);
  if (needs_review === 'true') rows = rows.filter(m => m.needs_review);
  res.json(rows);
});

// Cajas: list, plus derived balances (sum of cashflow per caja & currency, USD-consolidated).
app.get('/api/cajas', (_, res) => res.json(db.cajas));
app.get('/api/cajas/balances', (_, res) => {
  const sign = (m) => ((m.flow || '').toLowerCase() === 'ingreso' ? 1 : -1);
  const balances = db.cajas.map(c => {
    const movs = db.cashflow.filter(m => m.caja_id === c.id);
    const balance_usd = movs.reduce((s, m) => s + sign(m) * (m.amount_usd || 0), 0);
    const balance_ars = movs.reduce((s, m) => s + sign(m) * (m.amount_ars || 0), 0);
    return { caja_id: c.id, name: c.name, type: c.type, currency: c.currency,
             movements: movs.length, balance_usd: Math.round(balance_usd * 100) / 100, balance_ars: Math.round(balance_ars * 100) / 100 };
  });
  const unassigned = db.cashflow.filter(m => !m.caja_id).length;
  res.json({ balances, unassigned_movements: unassigned });
});

// Conciliación manual de una caja a su saldo real. Calcula el ajuste (real − sistema en USD)
// y lo registra como TRANSFERENCIA (corrige el saldo sin afectar el P&L). Dry-run por defecto.
// Para cuentas en ARS, el real se convierte a USD al blue del momento (las cuentas no tienen
// saldo inicial cargado → el balance se maneja consolidado en USD). Guarda historial.
app.post('/api/cajas/:id/reconcile', requireAdmin, async (req, res) => {
  const caja = db.cajas.find(c => c.id === req.params.id);
  if (!caja) return res.sendStatus(404);
  const realNum = Number(req.body?.real);
  if (!isFinite(realNum)) return res.status(400).json({ error: 'saldo real inválido' });
  const cur = req.body?.currency || caja.currency || 'ARS';
  const note = req.body?.note || null;
  const blue = await getBlueRate();
  const realUsd = cur === 'USD' ? realNum : realNum / blue;
  const sign = (m) => ((m.flow || '').toLowerCase() === 'ingreso' ? 1 : -1);
  const sysUsd = db.cashflow.filter(m => m.caja_id === caja.id).reduce((s, m) => s + sign(m) * (m.amount_usd || 0), 0);
  const adjUsd = Math.round((realUsd - sysUsd) * 100) / 100;
  const r2v = (n) => Math.round(n * 100) / 100;
  if (!req.body?.commit) return res.json({ caja: caja.name, blue, sys_usd: r2v(sysUsd), real_usd: r2v(realUsd), adj_usd: adjUsd });
  if (Math.abs(adjUsd) >= 0.01) {
    const amtUsd = Math.abs(adjUsd);
    db.cashflow.push({
      id: `MOV-CONC-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      date: new Date().toISOString().slice(0, 10),
      flow: adjUsd > 0 ? 'Ingreso' : 'Egreso',
      caja_id: caja.id, caja_name: caja.name, category: 'Otros',
      counterparty: 'Ajuste de conciliación', counterparty_type: null, client_id: null, supplier_id: null,
      currency: cur, amount_ars: Math.round(amtUsd * blue), amount_usd: amtUsd,
      exchange_rate: blue, fixed_variable: null, expense_type: null,
      transfer: true, needs_review: false, review_reason: null, source: 'reconcile-manual',
      description: `Conciliación al saldo real (${cur} ${realNum.toLocaleString('es-AR')})${note ? ' — ' + note : ''}`,
    });
  }
  db.reconciliations = db.reconciliations || [];
  db.reconciliations.push({ caja_id: caja.id, caja_name: caja.name, ts: new Date().toISOString(), real: realNum, currency: cur, blue, real_usd: r2v(realUsd), sys_usd: r2v(sysUsd), adj_usd: adjUsd, note });
  save();
  res.json({ ok: true, adj_usd: adjUsd, real_usd: r2v(realUsd) });
});
// Historial de conciliaciones (para mostrar la última por caja).
app.get('/api/cajas/reconciliations', requireAdmin, (_req, res) => {
  res.json({ reconciliations: (db.reconciliations || []).slice(-200).reverse() });
});
// Firmas de email (HTML email-safe del handoff). Se elige según el usuario que responde.
const FIRMAS = {};
try {
  FIRMAS.juan = fs.readFileSync(path.join(__dirname, 'assets/firma/firma-juan.html'), 'utf8');
  FIRMAS.victoria = fs.readFileSync(path.join(__dirname, 'assets/firma/firma-victoria.html'), 'utf8');
} catch { /* sin firmas cargadas */ }
function signatureFor(user) {
  const email = (user?.email || '').toLowerCase();
  const idstr = `${user?.name || ''} ${user?.seller_name || ''}`.toLowerCase();
  if (email.startsWith('victoria@') || /\b(victoria|vicky)\b/.test(idstr)) return FIRMAS.victoria || '';
  return FIRMAS.juan || '';   // default (info@ = Juan)
}
// Saludo por defecto al compartir un presupuesto (igual que el prefill del front). Una sola fuente.
function defaultQuoteMessage(q) {
  const firstName = q?.client_name ? ' ' + String(q.client_name).split(' ')[0] : '';
  return `Hola${firstName}, te comparto el presupuesto N${q?.quote_number || q?.id} adjunto. Cualquier consulta quedo a disposición.`;
}
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const LINK_STYLE = 'color:#1d4ed8;text-decoration:underline;';
// Hipervínculos en mails (solo email; el cuerpo ya viene HTML-escapado): las dos líneas de producto
// linkean a la web, y cualquier URL pegada queda clickeable. No toca chat (WA/IG van como texto).
function linkifyEmail(html) {
  return html
    .replace(/Colecci[oó]n\s+Madera/gi, `<a href="https://pisospacific.com/madera" style="${LINK_STYLE}">$&</a>`)
    .replace(/L[ií]nea\s+H2O/gi, `<a href="https://pisospacific.com/h2o" style="${LINK_STYLE}">$&</a>`)
    .replace(/(^|[\s(])((?:https?:\/\/|www\.)[^\s<)]+)/gi, (_m, pre, url) => `${pre}<a href="${/^https?:\/\//i.test(url) ? url : 'https://' + url}" style="${LINK_STYLE}">${url}</a>`);
}
function emailHtml(body, sig) {
  const bodyHtml = linkifyEmail(escHtml(body).replace(/\n/g, '<br>'));
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;color:#2a2723;">${bodyHtml}</div>` + (sig ? `<br><br>${sig}` : '');
}

app.get('/api/conversations', (_, res) => {
  // Ship the conversations sorted by most-recent-message-first for free
  const sorted = [...db.conversations].sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''));
  res.json(sorted);
});
// Resumen para el badge del nav / triage: cuántas esperan NUESTRA respuesta (última 'in')
// y cuántas esperan al cliente (última 'out' hace ≥3 días). Excluye cerradas.
// Umbral configurable de "esperando cliente / se enfrió" (días sin respuesta del cliente).
const waitingDays = () => Number(db.settings?.waiting_client_days) || 3;
app.get('/api/conversations/stats', (_req, res) => {
  const days = waitingDays();
  const cutoff = new Date(Date.now() - days * 86400e3).toISOString();
  let pending = 0, waiting_client = 0, oldestPending = null;
  for (const c of db.conversations) {
    if (c.status === 'closed') continue;
    if (c.last_message_direction === 'in') {
      pending++;
      const t = c.last_inbound_at || c.last_message_at || null;
      if (t && (!oldestPending || t < oldestPending)) oldestPending = t;
    }
    else if (c.last_message_direction === 'out' && (c.last_outbound_at || c.last_message_at || '') < cutoff) waiting_client++;
  }
  res.json({ pending, waiting_client, waiting_days: days, oldest_pending_at: oldestPending });
});
app.get('/api/conversations/:id/messages', (req, res) => {
  const msgs = db.messages.filter(m => m.conversation_id === req.params.id).sort((a, b) => a.ts.localeCompare(b.ts));
  res.json(msgs);
});
app.post('/api/conversations/:id/messages', async (req, res) => {
  const conv = db.conversations.find(c => c.id === req.params.id);
  if (!conv) return res.sendStatus(404);
  const body = String(req.body?.body ?? '').trim();
  if (!body) return res.status(400).json({ error: 'empty body' });
  // Envío real según canal (sendOutbound despacha Meta o Gmail); sin tokens → queda local.
  let delivery = { sent: true, local: true };
  try {
    const override = String(req.body?.subject ?? '').trim();
    const subject = override || (conv.email_subject ? `Re: ${conv.email_subject.replace(/^re:\s*/i, '')}` : undefined);
    // Email a cliente: arma HTML con el cuerpo + la firma del usuario que responde.
    const opts = { subject };
    if (conv.channel === 'email') opts.html = emailHtml(body, signatureFor(req.user));
    delivery = await sendOutbound(conv.channel, conv.contact_id, body, opts);
  } catch (e) { delivery = { sent: false, reason: e.message }; }
  const tokensMissing = delivery.reason && /faltan/i.test(delivery.reason);
  const msg = {
    id: `m-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    conversation_id: conv.id,
    direction: 'out',
    body,
    ts: new Date().toISOString(),
    status: delivery.sent ? 'sent' : (tokensMissing ? 'sent' : 'failed'),
    template_name: req.body?.template_name ?? undefined,
    ...(delivery.id ? { wa_id: delivery.id } : {}),
    ...(delivery.sent || tokensMissing ? {} : { error: delivery.reason }),
  };
  db.messages.push(msg);
  touchConv(conv, 'out', msg.ts, body);
  conv.unread_count = 0;  // reading + sending clears the unread count
  save();
  res.json(msg);
});
app.post('/api/conversations/:id/read', (req, res) => {
  const conv = db.conversations.find(c => c.id === req.params.id);
  if (!conv) return res.sendStatus(404);
  conv.unread_count = 0;
  save();
  res.json(conv);
});
// Compartir un presupuesto EN esta conversación: WhatsApp → PDF como documento;
// email → link en el cuerpo + firma; Instagram → link como mensaje. Queda registrado en el chat.
// Unificar leads duplicados: re-apunta conversaciones/cotizaciones al lead destino,
// completa campos faltantes y borra el duplicado.
app.post('/api/leads/:id/merge', (req, res) => {
  const src = db.leads.find(l => l.id === req.params.id);
  const tgt = db.leads.find(l => l.id === req.body?.into);
  if (!src || !tgt || src.id === tgt.id) return res.status(400).json({ error: 'leads inválidos para unificar' });
  for (const c of db.conversations) if (c.linked_lead_id === src.id) c.linked_lead_id = tgt.id;
  for (const q of db.quotes) if (q.lead_id === src.id) q.lead_id = tgt.id;
  for (const k of ['email', 'phone', 'address', 'approx_m2', 'needs_placement', 'assigned_seller', 'source']) if (!tgt[k] && src[k]) tgt[k] = src[k];
  tgt.interested_products = [...new Set([...(tgt.interested_products || []), ...(src.interested_products || [])])];
  if (src.notes && !(tgt.notes || '').includes(src.notes)) tgt.notes = [tgt.notes, src.notes].filter(Boolean).join(' · ');
  const order = ['New', 'Contacted', 'Quoted', 'Won', 'Lost'];
  if (order.indexOf(src.status) > order.indexOf(tgt.status) && src.status !== 'Lost') tgt.status = src.status;
  db.leads = db.leads.filter(l => l.id !== src.id);
  save();
  res.json({ ok: true, into: tgt.id });
});
app.post('/api/conversations/:id/share-quote', async (req, res) => {
  const conv = db.conversations.find(c => c.id === req.params.id);
  const q = db.quotes.find(x => x.id === req.body?.quote_id);
  if (!conv || !q) return res.sendStatus(404);
  if (!q.share_token) q.share_token = crypto.randomBytes(12).toString('hex');
  const link = `${appBase(req)}/p/q/${q.id}/${q.share_token}`;
  const filename = pdfFilename(`Presupuesto N${q.quote_number || q.id}`, q.title, q.client_name);
  const caption = `Presupuesto Pisos Pacific${q.title ? ' — ' + q.title : ''}`;
  const message = String(req.body?.message || '').trim() || defaultQuoteMessage(q);   // mensaje editable por el usuario
  let delivery;
  try {
    if (conv.channel === 'whatsapp') {
      const buf = await generatePdf(presupuestoData(q));
      delivery = await sendWhatsAppDocument(toWa(conv.contact_id), buf, filename, message);
    } else if (conv.channel === 'email') {
      const buf = await generatePdf(presupuestoData(q));
      const html = emailHtml(message, signatureFor(req.user));
      delivery = await sendOutbound('email', conv.contact_id, message, { subject: caption, html, attachments: [{ filename, content: buf, contentType: 'application/pdf' }] });
    } else {
      delivery = await sendOutbound(conv.channel, conv.contact_id, `${message}\n${link}`, {});
    }
  } catch (e) { delivery = { sent: false, reason: e.message }; }
  const ts = new Date().toISOString();
  const body = `${message}\n📄 ${filename}`;
  const tokensMissing = delivery?.reason && /faltan/i.test(delivery.reason);
  db.messages.push({
    id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, conversation_id: conv.id,
    direction: 'out', body, ts, status: delivery?.sent ? 'sent' : (tokensMissing ? 'sent' : 'failed'),
    template_name: 'presupuesto', ...(delivery?.id ? { wa_id: delivery.id } : {}),
  });
  touchConv(conv, 'out', ts, `📄 ${filename}`); conv.unread_count = 0;
  if (/borrador|draft/i.test(q.status || '')) q.status = 'Enviado';
  save();
  res.json({ ok: !!(delivery?.sent || tokensMissing), channel: conv.channel, link, delivery });
});
// Subir un archivo (PDF/imagen) desde la compu y mandarlo al cliente por el canal de la conversación.
app.post('/api/conversations/:id/send-file', async (req, res) => {
  const conv = db.conversations.find(c => c.id === req.params.id);
  if (!conv) return res.sendStatus(404);
  const { data_base64, filename, content_type } = req.body || {};
  if (!data_base64) return res.status(400).json({ error: 'falta el archivo' });
  const okType = /pdf|image\//i.test(content_type || '') || /\.(pdf|png|jpe?g|webp)$/i.test(filename || '');
  if (!okType) return res.status(400).json({ error: 'solo PDF o imágenes' });
  let buf;
  try { buf = Buffer.from(String(data_base64), 'base64'); } catch { return res.status(400).json({ error: 'archivo inválido' }); }
  if (buf.length > 16 * 1024 * 1024) return res.status(400).json({ error: 'archivo muy grande (máx 16MB)' });
  const safe = String(filename || 'archivo').replace(/[^\w.\-]+/g, '_').slice(-60) || 'archivo';
  const stored = `${crypto.randomBytes(8).toString('hex')}-${safe}`;
  try { fs.writeFileSync(path.join(UPLOAD_DIR, stored), buf); } catch (e) { return res.status(500).json({ error: 'no se pudo guardar: ' + e.message }); }
  const url = `${appBase(req)}/uploads/${stored}`;
  const isPdf = /pdf/i.test(content_type || '') || /\.pdf$/i.test(safe);
  let delivery;
  try {
    if (conv.channel === 'whatsapp' && isPdf) {
      delivery = await sendWhatsAppDocument(toWa(conv.contact_id), buf, safe, '');
    } else if (conv.channel === 'email') {
      const html = emailHtml('Te comparto un archivo adjunto. Cualquier consulta quedo a disposición.', signatureFor(req.user));
      delivery = await sendOutbound('email', conv.contact_id, 'Archivo adjunto', { subject: 'Pisos Pacific — archivo adjunto', html, attachments: [{ filename: safe, content: buf, contentType: content_type || 'application/octet-stream' }] });
    } else {
      delivery = await sendOutbound(conv.channel, conv.contact_id, `Te comparto un archivo:\n${url}`, {});
    }
  } catch (e) { delivery = { sent: false, reason: e.message }; }
  const ts = new Date().toISOString();
  const tokensMissing = delivery?.reason && /faltan/i.test(delivery.reason);
  db.messages.push({
    id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, conversation_id: conv.id,
    direction: 'out', body: `📎 ${safe}`, ts, status: delivery?.sent ? 'sent' : (tokensMissing ? 'sent' : 'failed'),
    ...(delivery?.id ? { wa_id: delivery.id } : {}),
  });
  touchConv(conv, 'out', ts, `📎 ${safe}`); conv.unread_count = 0;
  save();
  res.json({ ok: !!(delivery?.sent || tokensMissing), url, delivery });
});
app.get('/api/templates', (_, res) => res.json(db.templates));

// Traer leads desde Gmail (info@pisospacific.com) — requiere GOOGLE_* + GMAIL_REFRESH_TOKEN.
app.post('/api/integrations/gmail/sync', requireAdmin, async (req, res) => {
  try { const leads = await syncGmailLeads(db, save, req.body?.query); const sent = await syncGmailSent(db, save); res.json({ ...leads, salientes: sent.espejados }); }
  catch (e) { res.status(400).json({ error: e.message || 'no se pudo sincronizar Gmail' }); }
});

// Limpieza de la bandeja de email (admin): (1) revincula conversaciones de email a su
// lead por coincidencia de email, (2) marca "Contactado" los leads (en New) a los que ya
// les escribimos desde Gmail (carpeta Enviados) y limpia su contador de no-leídos.
// Por defecto es dry-run (preview); con { commit: true } aplica los cambios.
app.post('/api/admin/cleanup-email-leads', async (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'solo admin' });
  const commit = req.body?.commit === true;
  try {
    let sent = new Set(), gmailError = null;
    try { sent = await listSentRecipients({ max: req.body?.max || 800 }); }
    catch (e) { gmailError = e.message || 'no se pudo leer Gmail Enviados'; }
    const leadByEmail = new Map();
    for (const l of db.leads) { const e = String(l.email || '').toLowerCase(); if (e && !leadByEmail.has(e)) leadByEmail.set(e, l); }

    const relinked = [], contacted = [];
    for (const c of db.conversations) {
      if (c.channel !== 'email') continue;
      const email = String(c.contact_id || '').toLowerCase();
      const lead = leadByEmail.get(email);
      // (1) revincular conversación → lead
      if (lead && c.linked_lead_id !== lead.id) { if (commit) c.linked_lead_id = lead.id; relinked.push(email); }
      // (2) ya respondido por Gmail → Contactado + limpiar no-leídos
      if (email && sent.has(email)) {
        if (lead && lead.status === 'New') { if (commit) lead.status = 'Contacted'; contacted.push(lead.name || email); }
        if ((c.unread_count || 0) > 0 && commit) c.unread_count = 0;
      }
    }
    if (commit && (relinked.length || contacted.length)) save();
    res.json({ ok: true, commit, gmail_error: gmailError, sent_recipients: sent.size, relinked: relinked.length, contacted: contacted.length, contacted_names: contacted.slice(0, 80) });
  } catch (e) { res.status(400).json({ error: e.message || 'falló la limpieza' }); }
});

// ---------- Conexión Google OAuth (Gmail) — autorizar desde el navegador ----------
// Cuentas: 'pacific' (info@pisospacific.com → leads + envío) · 'acudesign' (reportes MP).
// Flujo: GET /api/integrations/google/connect?account=pacific → consentimiento Google →
// callback guarda el refresh_token en db.settings y lo hidrata a process.env.
const GOOGLE_ACCOUNTS = {
  pacific:   { scopes: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/drive.readonly', envs: ['GMAIL_REFRESH_TOKEN', 'GMAIL_SEND_REFRESH_TOKEN', 'GDRIVE_REFRESH_TOKEN'], hint: 'info@pisospacific.com' },
  acudesign: { scopes: 'https://www.googleapis.com/auth/gmail.readonly', envs: ['GMAIL_MP_REFRESH_TOKEN'], hint: 'infoacudesign@gmail.com' },
};
const googleRedirect = (req) => `${process.env.APP_URL || `${req.headers['x-forwarded-proto'] || 'https'}://${req.get('host')}`}/api/integrations/google/callback`;
// Hidratar env desde db (tokens guardados por el callback en arranques previos).
{
  const saved = db.settings?.integrations?.google || {};
  for (const [acct, cfg] of Object.entries(GOOGLE_ACCOUNTS)) {
    const tok = saved[acct]?.refresh_token;
    if (tok) for (const env of cfg.envs) if (!process.env[env]) process.env[env] = tok;
  }
}
app.get('/api/integrations/google/connect', (req, res) => {
  const acct = GOOGLE_ACCOUNTS[req.query.account];
  if (!acct) return res.status(400).send('account inválida (pacific | acudesign)');
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(400).send('Falta GOOGLE_CLIENT_ID en el entorno');
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: googleRedirect(req),
    response_type: 'code', access_type: 'offline', prompt: 'consent',
    scope: acct.scopes, state: req.query.account, login_hint: acct.hint,
  });
  res.redirect(u.toString());
});
app.get('/api/integrations/google/callback', async (req, res) => {
  try {
    const acct = GOOGLE_ACCOUNTS[req.query.state];
    if (!acct || !req.query.code) return res.status(400).send('callback inválido');
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: req.query.code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: googleRedirect(req), grant_type: 'authorization_code' }),
    });
    const j = await r.json();
    if (!j.refresh_token) return res.status(400).send('Google no devolvió refresh_token: ' + JSON.stringify(j).slice(0, 200));
    db.settings.integrations = db.settings.integrations || {};
    db.settings.integrations.google = db.settings.integrations.google || {};
    db.settings.integrations.google[req.query.state] = { refresh_token: j.refresh_token, connected_at: new Date().toISOString() };
    for (const env of acct.envs) process.env[env] = j.refresh_token;
    save();
    res.set('Content-Type', 'text/html; charset=utf-8').send(`<h2>✓ Cuenta ${acct.hint} conectada.</h2><p>Ya podés cerrar esta pestaña.</p>`);
  } catch (e) { res.status(500).send('Error: ' + e.message); }
});

// Webhooks de Meta (WhatsApp / Instagram): GET = verificación, POST = mensaje entrante.
const metaVerify = (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.META_VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
};
// Verifica la firma X-Hub-Signature-256 de Meta. WhatsApp firma con META_APP_SECRET;
// Instagram firma con SU PROPIO secret (IG_APP_SECRET) → distinto al de la app.
function metaSignatureOk(req, channel) {
  const igSecret = process.env.IG_APP_SECRET;
  const secret = channel === 'instagram' ? (igSecret || process.env.META_APP_SECRET) : process.env.META_APP_SECRET;
  if (!secret) { console.warn(`[webhook] ${channel} sin app secret — firma NO verificada`); return true; }
  const sig = req.get('x-hub-signature-256') || '';
  let valid = false;
  if (sig.startsWith('sha256=') && req.rawBody) {
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
    try { const a = Buffer.from(sig), b = Buffer.from(expected); valid = a.length === b.length && crypto.timingSafeEqual(a, b); } catch { /* noop */ }
  }
  if (valid) return true;
  console.warn(`[webhook] ${channel} firma ${sig ? 'INVÁLIDA' : 'AUSENTE'} (sig=${sig ? sig.slice(0, 20) : 'ninguna'})`);
  // WhatsApp: enforce (403). Instagram: enforce SOLO si está cargado su secret propio
  // (IG_APP_SECRET); si no, log-only para no perder DMs.
  if (channel === 'instagram' && !igSecret) return true;
  return false;
}
// Baja la media de un mensaje entrante (descriptor msg.media) y la guarda en UPLOAD_DIR
// para que quede permanente en el chat (las URLs de IG/WhatsApp son temporales).
const EXT_BY_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/aac': 'aac', 'application/pdf': 'pdf' };
async function persistInboundMedia(result) {
  const msg = result?.message; const md = msg?.media;
  if (!md) return;
  try {
    let buf, mime;
    if (md.source === 'ig-url' && md.url) {
      const token = process.env.IG_TOKEN;
      // La CDN de IG (lookaside.fbsbx.com) suele requerir el token de acceso. Probamos
      // con token y, si falla, sin token. Logueamos la URL real para diagnóstico.
      const attempts = [
        token ? { headers: { Authorization: `Bearer ${token}` } } : null,
        {},
        token ? { url: md.url + (md.url.includes('?') ? '&' : '?') + 'access_token=' + encodeURIComponent(token) } : null,
      ].filter(Boolean);
      let r;
      for (const a of attempts) {
        r = await fetch(a.url || md.url, { headers: a.headers || {}, redirect: 'follow', signal: AbortSignal.timeout(20000) });
        if (r.ok) break;
      }
      if (!r || !r.ok) { console.warn(`[media:inbound] IG media ${r?.status} url=${String(md.url).slice(0, 200)}`); throw new Error('IG media ' + (r?.status || '?')); }
      mime = r.headers.get('content-type') || ''; buf = Buffer.from(await r.arrayBuffer());
    } else if (md.source === 'wa-id' && md.mediaId) {
      const token = process.env.WHATSAPP_TOKEN;
      const meta = await (await fetch(`https://graph.facebook.com/v21.0/${md.mediaId}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) })).json();
      if (!meta.url) throw new Error('WA media sin url');
      const r = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
      mime = meta.mime_type || r.headers.get('content-type') || ''; buf = Buffer.from(await r.arrayBuffer());
    } else return;
    if (!buf?.length) throw new Error('media vacía');
    if (buf.length > 25 * 1024 * 1024) throw new Error('media muy grande');
    const ext = EXT_BY_MIME[(mime || '').split(';')[0].trim()] || 'bin';
    const stored = `${crypto.randomBytes(8).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, stored), buf);
    msg.media_url = `/uploads/${stored}`;
    msg.media_type = /^image\//.test(mime) ? 'image' : /^video\//.test(mime) ? 'video' : /^audio\//.test(mime) ? 'audio' : 'file';
    delete msg.media;
    save();
  } catch (e) { console.warn('[media:inbound] no se pudo guardar:', e.message); delete msg.media; }
}
const metaInbound = (channel) => (req, res) => {
  if (!metaSignatureOk(req, channel)) return res.sendStatus(403);   // firma inválida → no procesar
  res.sendStatus(200);   // ack rápido a Meta; procesamos en background
  handleInbound(db, save, channel, req.body)
    .then((result) => persistInboundMedia(result))
    .catch((e) => console.warn(`[${channel}:inbound] error`, e.message));
};
for (const ch of ['whatsapp', 'instagram']) {
  app.get(`/api/${ch}/webhook`, metaVerify);
  app.post(`/api/${ch}/webhook`, metaInbound(ch));
}
app.get('/api/settings', (_, res) => res.json(db.settings));
app.patch('/api/settings', requireAdmin, (req, res) => {
  const incoming = req.body ?? {};
  db.settings = { ...db.settings, ...incoming, dashboardThresholds: { ...db.settings.dashboardThresholds, ...(incoming.dashboardThresholds ?? {}) }, updatedAt: new Date().toISOString() };
  save();
  res.json(db.settings);
});

// ---------- Containers + stock movements ----------
app.get('/api/containers', (_, res) => res.json(db.containers));
app.get('/api/containers/:id', (req, res) => {
  const c = db.containers.find(x => x.id === req.params.id);
  if (!c) return res.sendStatus(404);
  res.json(c);
});
app.post('/api/containers', requireAdmin, (req, res) => {
  const c = { id: req.body.id ?? `local-${Date.now()}`, status: 'in_transit', items: [], warehouse_id: DEFAULT_WAREHOUSE, ...req.body };
  db.containers.push(c);
  save();
  res.json(c);
});
app.patch('/api/containers/:id', requireAdmin, (req, res) => {
  const i = db.containers.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.sendStatus(404);
  db.containers[i] = { ...db.containers[i], ...req.body };
  save();
  res.json(db.containers[i]);
});
// "Nacionalizar" = acreditar los m² del contenedor al stock del depósito. Solo suma cantidad;
// NO toca p.cost (el costo nacionalizado se gestiona aparte). Devuelve reporte de lo cargado y
// lo ignorado (ítems sin producto asociado) en vez de descartarlos en silencio.
app.post('/api/containers/:id/receive', requireAdmin, (req, res) => {
  const c = db.containers.find(x => x.id === req.params.id);
  if (!c) return res.sendStatus(404);
  if (c.status === 'received') return res.status(409).json({ error: 'already received' });
  const wh = c.warehouse_id || DEFAULT_WAREHOUSE;
  const credited = [], skipped = [];
  for (const item of (c.items || [])) {
    const qty = Number(item.quantity) || 0;
    const p = findProductByItem(item);
    if (!p) { skipped.push({ sku: item.sku || '', description: item.description || '', quantity: qty }); continue; }
    p.stock = (Number(p.stock) || 0) + qty;
    movement('container_receive', c.id, p.id, p.sku, qty, wh);
    credited.push({ sku: p.sku, name: p.name, quantity: qty });
  }
  c.status = 'received';
  c.received_at = new Date().toISOString();
  save();
  res.json({ container: c, credited, skipped });
});
// Adjuntar un documento al contenedor (invoice / packing / otro). Varios por contenedor.
app.post('/api/containers/:id/documents', requireAdmin, (req, res) => {
  const c = db.containers.find(x => x.id === req.params.id);
  if (!c) return res.sendStatus(404);
  const { data_base64, filename, content_type, kind } = req.body || {};
  if (!data_base64) return res.status(400).json({ error: 'falta el archivo' });
  const okType = /pdf|image\/|sheet|excel|csv|officedocument/i.test(content_type || '') || /\.(pdf|png|jpe?g|webp|xlsx|xls|csv)$/i.test(filename || '');
  if (!okType) return res.status(400).json({ error: 'tipo no soportado (PDF, imagen, Excel o CSV)' });
  let buf;
  try { buf = Buffer.from(String(data_base64), 'base64'); } catch { return res.status(400).json({ error: 'archivo inválido' }); }
  if (buf.length > 16 * 1024 * 1024) return res.status(400).json({ error: 'archivo muy grande (máx 16MB)' });
  const safe = String(filename || 'documento').replace(/[^\w.\-]+/g, '_').slice(-60) || 'documento';
  const stored = `${crypto.randomBytes(8).toString('hex')}-${safe}`;
  try { fs.writeFileSync(path.join(UPLOAD_DIR, stored), buf); } catch (e) { return res.status(500).json({ error: 'no se pudo guardar: ' + e.message }); }
  if (!Array.isArray(c.documents)) c.documents = [];
  const doc = { id: `doc-${crypto.randomBytes(4).toString('hex')}`, url: `${appBase(req)}/uploads/${stored}`, filename: safe, kind: ['invoice', 'packing', 'other'].includes(kind) ? kind : 'other', uploaded_at: new Date().toISOString() };
  c.documents.push(doc);
  save();
  res.json({ container: c, document: doc });
});
app.delete('/api/containers/:id/documents/:docId', requireAdmin, (req, res) => {
  const c = db.containers.find(x => x.id === req.params.id);
  if (!c) return res.sendStatus(404);
  c.documents = (c.documents || []).filter(d => d.id !== req.params.docId);
  save();
  res.json(c);
});
app.get('/api/stock_movements', (_, res) => res.json(db.stock_movements));
// Alias de productos aprendidos (descripción del packing/invoice → producto). Upsert por alias
// normalizado: la próxima importación resuelve ese nombre solo.
app.get('/api/product-aliases', (_, res) => res.json(db.product_aliases || []));
app.post('/api/product-aliases', (req, res) => {
  const { description, product_id } = req.body || {};
  const alias = normProd(description);
  if (!alias || !product_id) return res.status(400).json({ error: 'falta descripción o producto' });
  if (!Array.isArray(db.product_aliases)) db.product_aliases = [];
  const ex = db.product_aliases.find(a => a.alias === alias);
  if (ex) { ex.product_id = product_id; ex.raw = String(description); }
  else db.product_aliases.push({ id: `pa-${crypto.randomBytes(4).toString('hex')}`, alias, raw: String(description), product_id });
  save();
  res.json({ ok: true, alias });
});

// ---------- Banco de imágenes (Google Drive, solo lectura) ----------
const DRIVE_ROOT = process.env.DRIVE_ROOT_FOLDER || '1GttGPDMj120WiYPgCimclfsLFwopV107';
const DRIVE_CACHE = path.join(UPLOAD_DIR, 'drive-cache');
app.get('/api/drive/status', (_req, res) => res.json({ connected: driveConfigured(), root: DRIVE_ROOT }));
app.get('/api/drive/folder', async (req, res) => {
  if (!driveConfigured()) return res.status(400).json({ error: 'Drive no conectado' });
  try { res.json(await driveListFolder(req.query.id || DRIVE_ROOT)); }
  catch (e) { res.status(400).json({ error: e.message || 'no se pudo listar' }); }
});
// Primera imagen de una carpeta (para fijar la portada de un producto al vincularlo).
app.get('/api/drive/first-image', async (req, res) => {
  if (!driveConfigured() || !req.query.folder) return res.status(400).json({ error: 'falta carpeta' });
  try { res.json({ id: await driveFirstImage(String(req.query.folder)) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
// Miniatura (liviana) con caché — para grillas/galería y fotos de producto.
app.get('/api/drive/thumb/:id', async (req, res) => {
  if (!driveConfigured()) return res.sendStatus(404);
  const id = String(req.params.id).replace(/[^\w-]/g, '');
  if (!id) return res.sendStatus(400);
  try {
    fs.mkdirSync(DRIVE_CACHE, { recursive: true });
    const binPath = path.join(DRIVE_CACHE, id + '.thumb.bin'), metaPath = path.join(DRIVE_CACHE, id + '.thumb.json');
    if (fs.existsSync(binPath) && fs.existsSync(metaPath)) {
      const { mime } = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      res.set('Content-Type', mime); res.set('Cache-Control', 'private, max-age=604800');
      return res.send(fs.readFileSync(binPath));
    }
    const { buf, mime } = await driveGetThumb(id);
    try { fs.writeFileSync(binPath, buf); fs.writeFileSync(metaPath, JSON.stringify({ mime })); } catch { /* best-effort */ }
    res.set('Content-Type', mime); res.set('Cache-Control', 'private, max-age=604800');
    res.send(buf);
  } catch (e) { console.warn('[drive:thumb]', e.message); res.status(404).send('no thumb'); }
});
// Proxy de archivos del Drive (privado) con caché en disco. Sirve para <img src>.
app.get('/api/drive/file/:id', async (req, res) => {
  if (!driveConfigured()) return res.sendStatus(404);
  const id = String(req.params.id).replace(/[^\w-]/g, '');
  if (!id) return res.sendStatus(400);
  try {
    fs.mkdirSync(DRIVE_CACHE, { recursive: true });
    const binPath = path.join(DRIVE_CACHE, id + '.bin'), metaPath = path.join(DRIVE_CACHE, id + '.json');
    if (fs.existsSync(binPath) && fs.existsSync(metaPath)) {
      const { mime } = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      res.set('Content-Type', mime); res.set('Cache-Control', 'private, max-age=86400');
      return res.send(fs.readFileSync(binPath));
    }
    const { buf, mime } = await driveGetFile(id);
    try { fs.writeFileSync(binPath, buf); fs.writeFileSync(metaPath, JSON.stringify({ mime })); } catch { /* caché best-effort */ }
    res.set('Content-Type', mime); res.set('Cache-Control', 'private, max-age=86400');
    res.send(buf);
  } catch (e) { console.warn('[drive:file]', e.message); res.status(404).send('no media'); }
});

// ---------- Generic CRUD (POST/PATCH/DELETE) with persistence ----------
// Special-case: editar un producto que cambia `stock` deja un movimiento de auditoría
// (si no, el stock "salta" sin rastro y el libro mayor no cuadra). Va antes del CRUD genérico.
app.patch('/api/products/:id', (req, res) => {
  const i = db.products.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.sendStatus(404);
  const before = db.products[i];
  const hasStock = Object.prototype.hasOwnProperty.call(req.body || {}, 'stock');
  const oldStock = Number(before.stock) || 0;
  db.products[i] = { ...before, ...req.body };
  if (hasStock) {
    const newStock = Number(db.products[i].stock) || 0;
    const delta = Math.round((newStock - oldStock) * 100) / 100;
    if (delta !== 0) movement('manual_adjustment', `edit-${req.user?.email || 'admin'}`, before.id, before.sku, delta);
  }
  save();
  res.json(db.products[i]);
});
// Special-case: lead transition to Won auto-converts the most recent eligible quote into a sale.
// Runs BEFORE the generic PATCH below so it takes precedence for /api/leads/:id.
app.patch('/api/leads/:id', (req, res) => {
  const i = db.leads.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.sendStatus(404);
  const wasWon = db.leads[i].status === "Won";
  db.leads[i] = { ...db.leads[i], ...req.body };
  let createdSale = null;
  if (!wasWon && db.leads[i].status === "Won") {
    const lead = db.leads[i];
    const alreadyConverted = db.quotes.find(q => q.lead_id === lead.id && q.sale_id);
    if (!alreadyConverted) {
      const eligible = db.quotes
        .filter(q => q.lead_id === lead.id && !q.sale_id)
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
      if (eligible.length > 0) {
        createdSale = convertQuoteToSale(eligible[0]);
      }
    }
  }
  save();
  res.json({ ...db.leads[i], auto_sale_id: createdSale?.id });
});

// Editar los ítems de una venta que TODAVÍA NO se entregó (no Finalizada/Cancelada).
// Recalcula total del contrato + saldo con la misma fórmula del sistema (neto = Σ ítems −
// descuentos; IVA según el modo de la venta). El stock reservado y el margen se derivan solos.
app.patch('/api/sales/:id/edit-items', requireAdmin, (req, res) => {
  const s = db.sales.find((x) => x.id === req.params.id);
  if (!s) return res.sendStatus(404);
  if (s.status === 'Finalizado' || s.status === 'Cancelado')
    return res.status(400).json({ error: 'No se puede editar una venta entregada o cancelada.' });
  const items = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!items || !items.length) return res.status(400).json({ error: 'La venta necesita al menos un ítem.' });
  const itemDisc = (it) => {
    const g = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
    if (!it.disc_value || it.disc_value <= 0) return 0;
    const amt = it.disc_kind === 'amount' ? Number(it.disc_value) : g * Number(it.disc_value) / 100;
    return Math.min(g, Math.round(amt * 100) / 100);
  };
  const isReal = (it) => it.product_id !== 'discount' && !/^descuento/i.test(it.description || '');
  const norm = items.map((it) => ({
    ...it,
    quantity: Number(it.quantity) || 0,
    unit_price: Number(it.unit_price) || 0,
    total: Math.round((Number(it.quantity) || 0) * (Number(it.unit_price) || 0) * 100) / 100,
    discount: itemDisc(it),
  }));
  const real = norm.filter(isReal);
  const gross = real.reduce((a, it) => a + (Number(it.total) || 0), 0);
  // Descuento: si hay descuentos POR ÍTEM se recalculan; si no, se preserva el descuento a
  // nivel venta (ventas migradas: el descuento no está en los ítems sino en discount_total).
  const anyItemDisc = norm.some((it) => Number(it.disc_value) > 0);
  const discount_total = anyItemDisc
    ? Math.round(real.reduce((a, it) => a + (Number(it.discount) || 0), 0) * 100) / 100
    : (Number(s.discount_total) || 0);
  const net = Math.max(0, gross - discount_total);
  // IVA: se PRESERVA el tratamiento real de la venta derivándolo del total original (la bandera
  // has_iva/iva_mode puede estar inconsistente en datos migrados). factor ≈ 1.0 (sin IVA) o ≈ 1.21.
  let contract_total;
  if (s.iva_mode === 'fixed') {
    contract_total = Math.round(net + (Number(s.iva_amount) || 0));
  } else {
    const origReal = (s.items || []).filter(isReal);
    const origGross = origReal.reduce((a, it) => a + (Number(it.total) || 0), 0);
    const origNet = Math.max(0, origGross - discount_total);
    const origTotal = Number(s.contract_total) || origNet;
    const factor = origNet > 0 ? origTotal / origNet : 1;
    contract_total = Math.round(net * factor);
  }
  s.items = norm;
  s.discount_total = discount_total;
  s.contract_total = contract_total;
  const paid = Number(s.financial_position?.total_paid) || 0;
  s.financial_position = { total_invoiced: contract_total, total_paid: paid, balance_due: Math.max(0, contract_total - paid) };
  save();
  res.json(s);
});

// Special-case: crear proveedor con DEDUP. Si ya existe uno con el mismo nombre
// normalizado (sin importar mayúsculas/acentos/espacios), devuelve el existente en vez
// de duplicar. Corre ANTES del POST genérico de abajo. Idempotente.
app.post('/api/suppliers', (req, res) => {
  const name = req.body?.name;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'falta el nombre' });
  const existing = findSupplierMatch(db.suppliers, name);
  if (existing) return res.json({ ...existing, _existed: true });
  const id = req.body.id ?? `PROV-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const row = { id, type: 'supplier', active: true, stock_code: null, category_default: null, notes: null, ...req.body, name: String(name).trim() };
  db.suppliers.push(row);
  save();
  res.json(row);
});
// Special-case: crear cliente con DEDUP (por email / teléfono / nombre completo exacto). Si ya
// existe, devuelve el existente (_existed) en vez de duplicar. Corre ANTES del POST genérico.
app.post('/api/clients', (req, res) => {
  const name = req.body?.name;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'falta el nombre' });
  const emails = Array.isArray(req.body.emails) ? req.body.emails : [];
  const phones = Array.isArray(req.body.phones) ? req.body.phones : [];
  const existing = findClientMatch(db.clients, { name, email: emails[0], phone: phones[0] });
  if (existing) return res.json({ ...existing, _existed: true });
  const id = req.body.id ?? `CLI-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const row = { id, type: 'client', active: true, dni: '', emails: [], phones: [], addresses: [], notes: null, ...req.body, name: String(name).trim(), updated_at: new Date().toISOString() };
  db.clients.push(row);
  save();
  res.json(row);
});
// Buscar coincidencias / sugerencias de proveedor para un nombre (para ofrecer opciones
// "no existe → A/B/C o crear" sin duplicar). Devuelve match exacto + sugerencias parecidas.
app.get('/api/suppliers/match', (req, res) => {
  const q = String(req.query?.name || '');
  const match = findSupplierMatch(db.suppliers, q);
  const suggestions = suggestSuppliers(db.suppliers, q, 5).filter((s) => !match || s.id !== match.id);
  res.json({ match: match || null, suggestions });
});

// Revisión de proveedores: (a) "sin registrar" = contrapartes de egresos que NO son un
// proveedor cargado (y no son conceptos tipo impuesto/peaje/transfer), con sugerencias
// de a cuál vincular; (b) "duplicados" = proveedores cargados muy parecidos entre sí.
app.get('/api/suppliers/review', requireAdmin, (_req, res) => {
  // (a) sin registrar
  const agg = new Map();   // normSup → { name, count, total_usd }
  for (const m of db.cashflow) {
    if (m.flow !== 'Egreso' || m.transfer) continue;
    const cp = (m.counterparty || '').trim();
    if (!cp || isNonSupplier(cp)) continue;
    if (findSupplierMatch(db.suppliers, cp)) continue;   // ya existe como proveedor
    const k = normSup(cp);
    const cur = agg.get(k) || { name: cp, count: 0, total_usd: 0 };
    cur.count += 1; cur.total_usd += m.amount_usd || 0;
    agg.set(k, cur);
  }
  const unregistered = [...agg.values()]
    .map((u) => ({ ...u, suggestions: suggestSuppliers(db.suppliers, u.name, 4).map((s) => ({ id: s.id, name: s.name })) }))
    .sort((a, b) => b.count - a.count);
  // (b) duplicados entre proveedores cargados (cada uno contra el resto)
  const dups = [], seen = new Set();
  for (const s of db.suppliers) {
    if (seen.has(s.id)) continue;
    const near = suggestSuppliers(db.suppliers, s.name, 6).filter((o) => o.id !== s.id && !seen.has(o.id));
    if (near.length) {
      const group = [s, ...near];
      group.forEach((g) => seen.add(g.id));
      dups.push(group.map((g) => ({ id: g.id, name: g.name, count: db.cashflow.filter((m) => m.supplier_id === g.id || normSup(m.counterparty) === normSup(g.name)).length })));
    }
  }
  res.json({ unregistered, duplicates: dups });
});

// Registrar un proveedor (nuevo o existente) y VINCULARLO a todos los egresos con ese
// nombre. {name, supplier_id?, learn?, commit}. Dry-run por defecto (devuelve cuántos).
app.post('/api/suppliers/register-link', requireAdmin, (req, res) => {
  const { name, supplier_id, learn, commit } = req.body || {};
  if (!name && !supplier_id) return res.status(400).json({ error: 'falta name o supplier_id' });
  let target = supplier_id ? db.suppliers.find((s) => s.id === supplier_id) : findSupplierMatch(db.suppliers, name);
  const wouldCreate = !target;
  const targetName = target ? target.name : String(name).trim();
  const nk = normSup(name || targetName);
  const affected = db.cashflow.filter((m) => m.flow === 'Egreso' && !m.transfer && normSup(m.counterparty) === nk);
  if (!commit) return res.json({ target: target ? { id: target.id, name: target.name } : null, wouldCreate, targetName, affected: affected.length });
  if (!target) {
    target = { id: `PROV-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name: targetName, type: 'supplier', active: true, stock_code: null, category_default: null, notes: null };
    db.suppliers.push(target);
  }
  for (const m of affected) { m.supplier_id = target.id; m.counterparty = target.name; m.counterparty_type = 'supplier'; }
  if (learn && name && normSup(name) !== normSup(target.name)) {
    db.cp_rules = db.cp_rules || [];
    db.cp_rules.push({ id: `cpr-${Date.now().toString(36)}`, match: [String(name)], cuit: null, counterparty: target.name, category: null, expense_type: null, personal: false, source: 'learned', note: `Vinculado desde "${name}"` });
  }
  save();
  res.json({ target: { id: target.id, name: target.name }, created: wouldCreate, linked: affected.length });
});

// Asignar EN MASA un proveedor a todos los egresos de una categoría/tipo de gasto (ej: todos los
// "Impuestos" → ARCA), y opcionalmente sacarlos de la revisión. Para no cargar uno por uno.
// {category, supplier_name, clear_review?, commit?}. Dry-run por defecto.
app.post('/api/cashflow/bulk-assign-supplier', requireAdmin, (req, res) => {
  const { category, supplier_name, clear_review = true, commit } = req.body || {};
  if (!category || !supplier_name) return res.status(400).json({ error: 'falta category o supplier_name' });
  const ck = normSup(category);
  const affected = db.cashflow.filter((m) => m.flow === 'Egreso' && !m.transfer &&
    (normSup(m.category).includes(ck) || normSup(m.expense_type).includes(ck)));
  const byCp = {}; for (const m of affected) byCp[m.counterparty || '(vacío)'] = (byCp[m.counterparty || '(vacío)'] || 0) + 1;
  let target = findSupplierMatch(db.suppliers, supplier_name);
  const wouldCreate = !target;
  if (!commit) return res.json({ affected: affected.length, supplier: target ? target.name : `(crear) ${supplier_name}`, would_clear_review: clear_review ? affected.filter(m => m.needs_review).length : 0, counterparties: byCp });
  if (!target) {
    target = { id: `PROV-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name: String(supplier_name).trim(), type: 'supplier', active: true, stock_code: null, category_default: null, notes: null };
    db.suppliers.push(target);
  }
  let clearedReview = 0;
  for (const m of affected) {
    m.supplier_id = target.id; m.counterparty = target.name; m.counterparty_type = 'supplier';
    if (clear_review && m.needs_review) { m.needs_review = false; m.review_reason = null; clearedReview++; }
  }
  save();
  res.json({ supplier: { id: target.id, name: target.name }, created: wouldCreate, assigned: affected.length, cleared_review: clearedReview });
});

// Marcar EN MASA como transferencia (fuera del P&L, queda en saldo de caja) los movimientos cuya
// contraparte/descripción matchea alguno de los patrones, y sacarlos de la revisión. Para el ruido
// recurrente de extractos (interés, DPF, pagos de tarjeta, etc.). {patterns:[], only_review?, commit?}.
// only_review (default true): toca SOLO lo que está en revisión → no pisa clasificaciones ya hechas
// (ej. un movimiento ya marcado ARCA cuya descripción contiene "cuenta visa"). Dry-run por defecto.
app.post('/api/cashflow/bulk-mark-transfer', requireAdmin, (req, res) => {
  const patterns = (Array.isArray(req.body?.patterns) ? req.body.patterns : []).map((p) => normSup(p)).filter(Boolean);
  if (!patterns.length) return res.status(400).json({ error: 'faltan patterns' });
  const onlyReview = req.body?.only_review !== false;
  const hit = (m) => { const hay = normSup(m.counterparty) + ' ' + normSup(m.description); return patterns.some((p) => hay.includes(p)); };
  // No excluir los que ya son transfer: pueden estar igual trabados en revisión y hay que limpiarlos.
  const affected = db.cashflow.filter((m) => (!onlyReview || m.needs_review) && hit(m));
  const byCp = {}; for (const m of affected) byCp[m.counterparty || '(vacío)'] = (byCp[m.counterparty || '(vacío)'] || 0) + 1;
  if (req.body?.commit !== true) return res.json({ affected: affected.length, would_clear_review: affected.filter((m) => m.needs_review).length, counterparties: byCp });
  let cleared = 0;
  for (const m of affected) { m.transfer = true; if (m.needs_review) { m.needs_review = false; m.review_reason = null; cleared++; } }
  save();
  res.json({ marked: affected.length, cleared_review: cleared });
});

// Edición EN LOTE por ids desde el Libro (multiselección): aplica el mismo set de campos
// (whitelisteados) a todos los movimientos elegidos. {ids:[], set:{...}}. Sin dry-run: la UI
// muestra qué se va a aplicar y a cuántos antes de llamar.
const BULK_FIELDS = new Set(['transfer', 'category', 'subcategory', 'expense_type', 'counterparty', 'counterparty_type', 'supplier_id', 'client_id', 'needs_review', 'review_reason', 'fixed_variable']);
app.post('/api/cashflow/bulk-update', requireAdmin, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const set = req.body?.set && typeof req.body.set === 'object' ? req.body.set : null;
  if (!ids.length || !set) return res.status(400).json({ error: 'faltan ids o set' });
  const patch = {};
  for (const [k, v] of Object.entries(set)) if (BULK_FIELDS.has(k)) patch[k] = v;
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'ningún campo válido en set' });
  let updated = 0;
  for (const id of ids) {
    const m = db.cashflow.find((x) => x.id === id);
    if (!m) continue;
    Object.assign(m, patch);
    // Marcar fuera del P&L limpia el vínculo a venta (no es cobro) — mismo criterio que el form.
    if (patch.transfer === true) { m.sale_ref = null; m.linked_sale_id = null; }
    updated++;
  }
  save();
  res.json({ updated });
});

// Unificar dos proveedores: re-apunta movimientos (por supplier_id o por nombre) y reglas
// del 'from' al 'to', y borra el 'from'. {from_id, to_id, commit}. Dry-run por defecto.
app.post('/api/suppliers/merge', requireAdmin, (req, res) => {
  const { from_id, to_id, commit } = req.body || {};
  const from = db.suppliers.find((s) => s.id === from_id);
  const to = db.suppliers.find((s) => s.id === to_id);
  if (!from || !to || from_id === to_id) return res.status(400).json({ error: 'from/to inválidos' });
  const fk = normSup(from.name);
  const movs = db.cashflow.filter((m) => m.supplier_id === from_id || normSup(m.counterparty) === fk);
  const rules = (db.cp_rules || []).filter((r) => normSup(r.counterparty) === fk);
  if (!commit) return res.json({ from: { id: from.id, name: from.name }, to: { id: to.id, name: to.name }, movements: movs.length, rules: rules.length });
  for (const m of movs) { m.supplier_id = to.id; m.counterparty = to.name; m.counterparty_type = m.flow === 'Ingreso' ? m.counterparty_type : 'supplier'; }
  for (const r of rules) r.counterparty = to.name;
  db.suppliers = db.suppliers.filter((s) => s.id !== from_id);
  save();
  res.json({ merged: true, into: { id: to.id, name: to.name }, movements: movs.length, rules: rules.length });
});

// Corrección one-time: el importador de BBVA (source 'bbva-upload') invirtió el signo
// (el "Importe" positivo del extracto es ACREDITACIÓN/INGRESO, no egreso). Da vuelta el
// flow de esos movimientos. Idempotente (flag bbva_sign_fixed). Dry-run por defecto.
app.post('/api/admin/fix-bbva-signs', requireAdmin, (req, res) => {
  const commit = !!req.body?.commit;
  const targets = db.cashflow.filter((m) => m.source === 'bbva-upload' && !m.bbva_sign_fixed);
  const toIngreso = targets.filter((m) => m.flow === 'Egreso').length;
  const toEgreso = targets.filter((m) => m.flow === 'Ingreso').length;
  if (!commit) return res.json({ total: targets.length, toIngreso, toEgreso });
  for (const m of targets) {
    const nf = m.flow === 'Ingreso' ? 'Egreso' : 'Ingreso';
    m.flow = nf;
    m.counterparty_type = nf === 'Ingreso' ? 'client' : 'supplier';
    if (nf === 'Ingreso') { m.expense_type = null; m.supplier_id = null; }
    else { m.client_id = null; }
    m.needs_review = true;
    m.review_reason = 'corrección de signo BBVA (Importe positivo = ingreso)';
    m.bbva_sign_fixed = true;
  }
  save();
  res.json({ fixed: targets.length, toIngreso, toEgreso });
});

app.get('/api/cp_rules', (_, res) => res.json(db.cp_rules || []));

// Aprende el mapa user id de MP → contraparte/clasificación cada vez que un movimiento de MP
// con mp_user_id queda clasificado (a mano, por enriquecimiento del export o por link-sale).
// El próximo sync diario clasifica solo los pagos de esa misma contraparte.
function learnMpUser(m) {
  if (!m || !m.mp_user_id || m.needs_review || m.transfer) return;
  const name = m.counterparty || '';
  if (!name || /sin nombre|mov entre cuentas/i.test(name)) return;
  if (!db.settings.mp_user_map || typeof db.settings.mp_user_map !== 'object') db.settings.mp_user_map = {};
  db.settings.mp_user_map[m.mp_user_id] = {
    counterparty: name, counterparty_type: m.counterparty_type || null,
    supplier_id: m.supplier_id || null, client_id: m.client_id || null,
    category: m.category || null, subcategory: m.subcategory || null,
    expense_type: m.expense_type || null, learned_at: new Date().toISOString(),
  };
}
// Entidades financieras/config: escritura solo admin (un vendedor no toca caja ni reglas).
const ADMIN_ONLY_WRITE = new Set(['cashflow', 'cajas', 'cp_rules', 'categories', 'expenses']);
// Borrado destructivo solo admin: el DELETE genérico no restockea ni libera reservas,
// así que borrar una venta/producto rompe el inventario si lo hace cualquiera.
const ADMIN_ONLY_DELETE = new Set(['sales', 'products']);
['products','sales','quotes','clients','expenses','leads','conversations','tasks','cajas','suppliers','categories','cashflow','cp_rules','templates'].forEach(name => {
  const guard = ADMIN_ONLY_WRITE.has(name) ? [requireAdmin] : [];
  const delGuard = (ADMIN_ONLY_WRITE.has(name) || ADMIN_ONLY_DELETE.has(name)) ? [requireAdmin] : [];
  app.post(`/api/${name}`, ...guard, (req, res) => {
    const id = req.body.id ?? `local-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    const row = { id, ...req.body };
    db[name].push(row);
    save();
    res.json(row);
  });
  app.patch(`/api/${name}/:id`, ...guard, (req, res) => {
    const i = db[name].findIndex(x => x.id === req.params.id);
    if (i < 0) return res.sendStatus(404);
    db[name][i] = { ...db[name][i], ...req.body };
    if (name === 'cashflow') learnMpUser(db[name][i]);
    save();
    res.json(db[name][i]);
  });
  app.delete(`/api/${name}/:id`, ...delGuard, (req, res) => {
    db[name] = db[name].filter(x => x.id !== req.params.id);
    save();
    res.sendStatus(204);
  });
});

// ---------- Importar extractos (MP / BBVA / Banco de Comercio) ----------
// parse: decodifica el archivo, clasifica y deduplica contra el cashflow vivo,
// y devuelve un preview (NO inserta). commit: inserta los movimientos elegidos.
// Último movimiento cargado por caja de importación (mp/bbva/bdc) → para que el
// usuario sepa desde qué fecha bajar el resumen y no recargue/duplique fechas.
app.get('/api/import/last', requireAdmin, (_req, res) => {
  const out = {};
  for (const [src, c] of Object.entries(IMPORT_CAJA)) {
    let last = null, count = 0;
    for (const m of db.cashflow) {
      if (m.caja_id !== c.id) continue;
      count++;
      const d = (m.date || '').slice(0, 10);
      if (d && (!last || d > last)) last = d;
    }
    out[src] = { caja: c.name, last, count };
  }
  res.json(out);
});
app.post('/api/import/parse', requireAdmin, async (req, res) => {
  try {
    const { source, data_base64 } = req.body || {};
    if (!source || !IMPORT_CAJA[source]) return res.status(400).json({ error: 'fuente inválida (mp | bbva | bdc)' });
    if (!data_base64) return res.status(400).json({ error: 'falta el archivo' });
    const buffer = Buffer.from(String(data_base64), 'base64');
    await getBlueRate();   // refresca el TC Blue para la conversión ARS→USD
    const { movements, report } = parseStatement({ source, buffer, existing: db.cashflow, rules: db.cp_rules });
    res.json({ movements, report });
  } catch (e) {
    res.status(400).json({ error: e.message || 'no se pudo leer el archivo' });
  }
});
// Sincronizar con MP por API (OAuth). Async: los reportes tardan minutos.
//  start → crea el reporte y devuelve jobId; result → cuando está listo, da el preview.
app.post('/api/import/mp-sync/start', requireAdmin, async (req, res) => {
  try {
    const days = Math.min(Math.max(Number(req.body?.days) || 45, 1), 365);
    res.json(await startMpReport({ days }));
  } catch (e) { res.status(400).json({ error: e.message || 'no se pudo iniciar la sync con MP' }); }
});
// Importar el reporte de MP que llega por email a infoacudesign@gmail.com (CON nombres).
// Baja el adjunto del Gmail, lo pasa por el importador 'mp' (mismo formato que el .xlsx manual).
app.post('/api/import/mp-email', requireAdmin, async (_req, res) => {
  try {
    const r = await fetchLatestMpReport();
    if (!r.found) return res.json({ found: false, candidates: r.candidates, error: 'No encontré un reporte de MP con adjunto. Revisá que el reporte se mande adjunto (no link) a infoacudesign@gmail.com.' });
    // El email programado de MP adjunta el formato settlement (sin nombres); el
    // account_statement manual (con nombres, RELEASE_DATE) también se acepta.
    await getBlueRate();   // refresca el TC Blue
    const isAccountStatement = /account_statement/i.test(r.filename || '');
    const { movements, report } = isAccountStatement
      ? parseStatement({ source: 'mp', buffer: r.buffer, existing: db.cashflow, rules: db.cp_rules })
      : parseSettlementBuffer(r.buffer, db.cashflow);
    res.json({ found: true, filename: r.filename, subject: r.subject, movements, report });
  } catch (e) { res.status(400).json({ error: e.message || 'no se pudo importar el reporte de MP por email' }); }
});
app.post('/api/import/mp-sync/result', requireAdmin, async (req, res) => {
  try {
    if (!req.body?.jobId) return res.status(400).json({ error: 'falta jobId' });
    await getBlueRate();   // refresca el TC Blue para la conversión ARS→USD
    res.json(await getMpReport({ jobId: req.body.jobId, existing: db.cashflow, userMap: db.settings.mp_user_map || {} }));
  } catch (e) { res.status(400).json({ error: e.message || 'no se pudo obtener el reporte MP' }); }
});
// ---------- Sync automático diario de Mercado Pago ----------
// Corre solo (al arrancar y cada 6h, con guard de 20h → 1×/día): genera el reporte
// por API, espera a que esté listo, deduplica e inserta los movimientos nuevos.
// Los peajes entran clasificados; lo demás queda "a revisar" (la API no trae nombres).
let mpSyncRunning = false;
async function mpAutoSync() {
  if (mpSyncRunning) return;
  mpSyncRunning = true;
  try {
    const last = db.settings.mp_last_sync ? Date.parse(db.settings.mp_last_sync) : 0;
    if (Date.now() - last < 20 * 3600e3) return;
    // Retomar un reporte pendiente de una corrida anterior (MP tarda 10-20 min en generarlos)
    let jobId = db.settings.mp_pending_job;
    if (!jobId) {
      console.log('[mp-auto] iniciando sync…');
      ({ jobId } = await startMpReport({ days: 30 }));
      db.settings.mp_pending_job = jobId;
      save();
    } else {
      console.log('[mp-auto] retomando reporte pendiente', jobId);
    }
    await getBlueRate();   // refresca el TC Blue para la conversión ARS→USD
    let result = null;
    for (let i = 0; i < 60; i++) {                       // hasta ~10 min por corrida
      await new Promise((r) => setTimeout(r, 10000));
      result = await getMpReport({ jobId, existing: db.cashflow, userMap: db.settings.mp_user_map || {} });
      if (result.ready) break;
    }
    if (!result?.ready) { console.warn('[mp-auto] el reporte sigue generándose; lo retomo en la próxima corrida'); return; }
    db.settings.mp_pending_job = null;
    const nuevos = result.movements.filter((m) => !m._dupe);
    let seq = 0;
    for (const m of nuevos) {
      const { _dupe, _idx, id: _drop, ...rest } = m;
      db.cashflow.push({ ...rest, id: `MOV-MPAUTO-${Date.now().toString(36)}-${String(++seq).padStart(3, '0')}` });
    }
    db.settings.mp_last_sync = new Date().toISOString();
    save();
    console.log(`[mp-auto] ok: +${nuevos.length} nuevos (${result.report.duplicados} ya cargados, ${result.report.revisar} a revisar)`);
  } catch (e) { console.warn('[mp-auto] error:', e.message); }
  finally { mpSyncRunning = false; }
}
setTimeout(mpAutoSync, 90 * 1000);     // al arrancar (si no corrió en las últimas 20h)
setInterval(mpAutoSync, 6 * 3600e3);   // re-chequeo periódico

// ---------- Sync automático de Gmail (leads + conversaciones email) ----------
let gmailSyncRunning = false;
async function gmailAutoSync() {
  if (gmailSyncRunning || !process.env.GMAIL_REFRESH_TOKEN) return;
  gmailSyncRunning = true;
  try {
    const r = await syncGmailLeads(db, save);
    if (r.leads || r.conversaciones) console.log(`[gmail-auto] +${r.leads} leads, +${r.conversaciones} conversaciones (${r.nuevos} mails nuevos)`);
    const s = await syncGmailSent(db, save);   // espeja salientes en conversaciones existentes
    if (s.espejados) console.log(`[gmail-auto] +${s.espejados} salientes espejados`);
  } catch (e) { console.warn('[gmail-auto] error:', e.message); }
  finally { gmailSyncRunning = false; }
}
setTimeout(gmailAutoSync, 60 * 1000);
setInterval(gmailAutoSync, 15 * 60e3);   // cada 15 min

// ---------- Recordatorio semanal: subir extractos de los bancos ----------
// Viernes ~9:00 ART (12:00 UTC). Email (confiable) + intento WhatsApp (best-effort, puede
// no entregarse fuera de la ventana de 24h sin plantilla). Guard 1×/semana en db.settings.
function lastLoadedDate(cajaName) {
  let d = null;
  for (const m of db.cashflow) { if (m.caja_name === cajaName) { const x = (m.date || '').slice(0, 10); if (x && (!d || x > d)) d = x; } }
  return d ? d.split('-').reverse().join('/') : 'nunca';
}
async function weeklyUploadReminder() {
  try {
    db.settings = db.settings || {};
    if (db.settings.weekly_reminder_enabled === false) return;
    const now = new Date();
    if (!(now.getUTCDay() === 5 && now.getUTCHours() >= 12)) return;   // viernes, ≥9 ART
    const last = db.settings.last_weekly_reminder ? new Date(db.settings.last_weekly_reminder) : null;
    if (last && (now - last) < 6 * 24 * 3600e3) return;                // ya se mandó esta semana
    const bbva = lastLoadedDate('BBVA'), bdc = lastLoadedDate('Banco de Comercio - Cuenta Pesos');
    // MP: los movimientos entran solos por API, pero SIN nombre (la API no lo da). Los nombres
    // salen del export manual "Todas las transacciones" → recordarlo SEMANAL (no mensual) para que
    // no se acumulen sin asignar. Mostramos cuántos MP están sin nombre esperando ese export.
    const mpPend = (db.cashflow || []).filter(m => m.source === 'mp-api' && /sin nombre/i.test(m.counterparty || '')).length;
    const to = db.settings.reminder_email || 'info@pisospacific.com';
    const html = `<p>Hola Juan,</p><p>Recordatorio semanal para mantener la caja al día:</p>`
      + `<ul><li><b>Banco Francés (BBVA)</b> — último cargado: ${bbva}</li><li><b>Banco de Comercio</b> — último cargado: ${bdc}</li>`
      + `<li><b>Mercado Pago</b> — exportá <i>"Todas las transacciones"</i> de la semana${mpPend ? ` (hay <b>${mpPend}</b> movimientos de MP sin nombre esperando)` : ''}</li></ul>`
      + `<p>Entrá a <b>CashFlow → Importar extracto</b> y subí desde esas fechas en adelante (si se pisan días, no pasa nada: se detectan los duplicados). El de MP les completa los nombres solo.</p>`;
    try { await sendMail({ to, subject: '📥 Recordatorio: subí extractos + export de MP de la semana', html }); } catch (e) { console.warn('[weekly-reminder] email falló:', e.message); }
    const phone = db.settings.reminder_phone || '+54 11 51750097';
    try { await sendOutbound('whatsapp', phone, `📥 Recordatorio semanal: subí los extractos (BBVA último ${bbva}, Banco de Comercio último ${bdc}) y el export "Todas las transacciones" de MP${mpPend ? ` (${mpPend} de MP sin nombre)` : ''}. CashFlow → Importar extracto.`); } catch { /* best-effort */ }
    db.settings.last_weekly_reminder = now.toISOString();
    save();
    console.log('[weekly-reminder] enviado a', to);
  } catch (e) { console.warn('[weekly-reminder] error:', e.message); }
}
setTimeout(weeklyUploadReminder, 150 * 1000);
setInterval(weeklyUploadReminder, 60 * 60e3);   // chequea cada hora; dispara viernes 1×
// Disparo manual para probar el recordatorio ahora.
app.post('/api/admin/test-weekly-reminder', requireAdmin, async (_req, res) => {
  const bbva = lastLoadedDate('BBVA'), bdc = lastLoadedDate('Banco de Comercio - Cuenta Pesos');
  const to = db.settings?.reminder_email || 'info@pisospacific.com';
  try {
    await sendMail({ to, subject: '📥 (prueba) Recordatorio: subí los extractos de la semana',
      html: `<p>Prueba del recordatorio semanal.</p><ul><li>BBVA — último: ${bbva}</li><li>Banco de Comercio — último: ${bdc}</li></ul>` });
    res.json({ sent: true, to, bbva, bdc });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- Resumen diario de TAREAS por WhatsApp (bot de tareas, integrations/task-bot.mjs) ----------
// Cada mañana (~9 ART) le manda a cada vendedor SUS pendientes de hoy + vencidas. Si no tiene
// nada, no se le manda (no molesta). Best-effort (ventana de 24h de WhatsApp sin plantilla).
// Apagar con settings.daily_task_reminder_enabled=false.
async function dailyTaskReminder() {
  try {
    db.settings = db.settings || {};
    if (db.settings.daily_task_reminder_enabled === false) return;
    const now = new Date();
    if (now.getUTCHours() < 12) return;                 // ≥9:00 ART
    const today = todayArt();
    if (db.settings.last_daily_task_reminder === today) return;   // 1×/día
    let sent = 0;
    for (const s of db.settings.sellers || []) {
      if (!s.phone) continue;
      const digest = buildDailyDigest(db, s.name, s.phone);
      if (!digest) continue;
      try { await sendOutbound('whatsapp', s.phone, digest); sent++; } catch { /* best-effort */ }
    }
    db.settings.last_daily_task_reminder = today;
    save();
    if (sent) console.log('[daily-tasks] resumen enviado a', sent, 'vendedor(es)');
  } catch (e) { console.warn('[daily-tasks] error:', e.message); }
}
setTimeout(dailyTaskReminder, 180 * 1000);
setInterval(dailyTaskReminder, 60 * 60e3);
// ---------- Resumen diario de MENSAJES PENDIENTES por email (Fase 3 del triage) ----------
// Cada mañana (~9 ART): mail a info@ con las conversaciones que esperan NUESTRA respuesta
// (agrupadas por vendedor, la más vieja primero) + las que se enfriaron (sin respuesta del
// cliente hace ≥N días). Apagar con settings.daily_pending_digest_enabled=false.
function buildPendingDigest() {
  const days = waitingDays();
  const cutoff = new Date(Date.now() - days * 86400e3).toISOString();
  const leadIdx = new Map((db.leads || []).map((l) => [l.id, l]));
  const sellerOf = (c) => (c.linked_lead_id ? leadIdx.get(c.linked_lead_id)?.assigned_seller : '') || 'Sin asignar';
  const ageDays = (iso) => iso ? Math.floor((Date.now() - Date.parse(iso)) / 86400e3) : 0;
  const pend = [], cold = [];
  for (const c of db.conversations || []) {
    if (c.status === 'closed') continue;
    if (c.last_message_direction === 'in') pend.push(c);
    else if (c.last_message_direction === 'out' && (c.last_outbound_at || c.last_message_at || '') < cutoff) cold.push(c);
  }
  if (!pend.length && !cold.length) return null;
  pend.sort((a, b) => String(a.last_inbound_at || '').localeCompare(String(b.last_inbound_at || '')));
  cold.sort((a, b) => String(a.last_outbound_at || '').localeCompare(String(b.last_outbound_at || '')));
  const bySeller = {};
  for (const c of pend) (bySeller[sellerOf(c)] ||= []).push(c);
  const li = (c, t) => `<li><b>${c.contact_name || c.contact_id}</b> (${c.channel}) — hace ${ageDays(t)} día(s): <i>${String(c.last_message_preview || '').slice(0, 90)}</i></li>`;
  let html = `<p>Hola,</p><p><b>${pend.length}</b> conversación(es) esperan respuesta` +
    (pend.length ? ` (la más vieja hace ${ageDays(pend[0].last_inbound_at)} día(s))` : '') +
    (cold.length ? ` y <b>${cold.length}</b> se enfriaron (el cliente no contesta hace ≥${days} días)` : '') + `.</p>`;
  for (const [seller, list] of Object.entries(bySeller)) {
    html += `<p><b>${seller}</b> — ${list.length} pendiente(s):</p><ul>` + list.slice(0, 10).map((c) => li(c, c.last_inbound_at)).join('') + (list.length > 10 ? `<li>… y ${list.length - 10} más</li>` : '') + `</ul>`;
  }
  if (cold.length) html += `<p><b>Se enfriaron</b> (mandar un seguimiento):</p><ul>` + cold.slice(0, 10).map((c) => li(c, c.last_outbound_at)).join('') + (cold.length > 10 ? `<li>… y ${cold.length - 10} más</li>` : '') + `</ul>`;
  html += `<p>Verlas en <a href="https://pisos-pacific.onrender.com/mensajes">Mensajes</a> (filtros "Pendientes" y "Esperando").</p>`;
  return { html, pending: pend.length, cold: cold.length };
}
async function dailyPendingDigest() {
  try {
    db.settings = db.settings || {};
    if (db.settings.daily_pending_digest_enabled === false) return;
    const now = new Date();
    if (now.getUTCHours() < 12) return;                 // ≥9:00 ART
    const today = todayArt();
    if (db.settings.last_daily_pending_digest === today) return;   // 1×/día
    const digest = buildPendingDigest();
    db.settings.last_daily_pending_digest = today;
    if (!digest) { save(); return; }
    const to = db.settings.reminder_email || 'info@pisospacific.com';
    try { await sendMail({ to, subject: `📨 ${digest.pending} sin responder${digest.cold ? ` · ${digest.cold} enfriadas` : ''} — resumen diario de Mensajes`, html: digest.html }); console.log('[daily-pending] enviado a', to); } catch (e) { console.warn('[daily-pending] email falló:', e.message); }
    save();
  } catch (e) { console.warn('[daily-pending] error:', e.message); }
}
setTimeout(dailyPendingDigest, 210 * 1000);
setInterval(dailyPendingDigest, 60 * 60e3);
// Prueba: devuelve el digest (dry-run); con {send:true} lo manda por mail.
app.post('/api/admin/test-daily-pending', requireAdmin, async (req, res) => {
  const digest = buildPendingDigest();
  if (!digest) return res.json({ pending: 0, cold: 0, note: 'sin pendientes ni enfriadas — no se mandaría nada' });
  if (req.body?.send === true) {
    try { await sendMail({ to: db.settings?.reminder_email || 'info@pisospacific.com', subject: `📨 (prueba) ${digest.pending} sin responder — resumen de Mensajes`, html: digest.html }); } catch (e) { return res.status(400).json({ error: e.message }); }
  }
  res.json({ pending: digest.pending, cold: digest.cold, sent: req.body?.send === true, html: digest.html });
});

// Prueba: arma los digests SIN mandar (dry-run); con {send:true} los manda de verdad.
app.post('/api/admin/test-daily-tasks', requireAdmin, async (req, res) => {
  const out = [];
  for (const s of db.settings?.sellers || []) {
    const digest = buildDailyDigest(db, s.name, req.body?.send === true ? s.phone : undefined);
    if (!digest) continue;
    out.push({ seller: s.name, phone: s.phone || null, digest });
    if (req.body?.send === true && s.phone) { try { await sendOutbound('whatsapp', s.phone, digest); } catch { /* best-effort */ } }
  }
  res.json({ sellers: out.length, sent: req.body?.send === true, digests: out });
});
// Export read-only (admin) para analizar cómo respondemos por canal y armar plantillas de
// sugerencia diferenciadas. Anonimizado: solo canal/dirección/cuerpo/fecha — sin id de contacto,
// nombre, email ni id de conversación. Uso puntual de análisis.
app.get('/api/admin/messages-export', requireAdmin, (_req, res) => {
  const chOf = new Map((db.conversations || []).map(c => [c.id, c.channel]));
  const byChannel = {};
  const messages = [];
  for (const m of db.messages || []) {
    const channel = chOf.get(m.conversation_id);
    if (!channel) continue;
    byChannel[channel] = byChannel[channel] || { in: 0, out: 0 };
    byChannel[channel][m.direction === 'out' ? 'out' : 'in']++;
    const body = String(m.body || '').slice(0, 1500);
    if (body) messages.push({ channel, direction: m.direction, body, ts: m.ts });
  }
  // Plantillas actuales (para comparar) + fuentes de leads (contexto del canal email).
  const templates = (db.templates || []).map(t => ({ name: t.name, channel: t.channel, keywords: t.keywords || '', body: t.body }));
  const leadSources = {};
  for (const l of db.leads || []) leadSources[l.source || '—'] = (leadSources[l.source || '—'] || 0) + 1;
  res.json({ byChannel, leadSources, totalMessages: messages.length, templates, messages });
});
// Sembrar el mapa user id de MP → contraparte desde el HISTÓRICO ya clasificado (movimientos
// de MP con mp_op_id y nombre real). Resuelve cada operación contra la API (throttled) — los
// colocadores/proveedores recurrentes quedan aprendidos de una. Dry-run por defecto.
app.post('/api/import/mp-backfill-usermap', requireAdmin, async (req, res) => {
  try {
    const commit = !!req.body?.commit;
    const limit = Math.min(Number(req.body?.limit) || 400, 1000);
    const candidates = db.cashflow.filter((m) =>
      m.caja_id === 'CAJ-002' && m.mp_op_id && !m.needs_review && !m.transfer &&
      m.counterparty && !/sin nombre|mov entre cuentas|peaje/i.test(m.counterparty));
    if (!commit) return res.json({ candidates: candidates.length, map_size: Object.keys(db.settings.mp_user_map || {}).length, note: 'POST {commit:true} resuelve cada operación contra la API de MP y siembra el mapa' });
    if (!db.settings.mp_user_map || typeof db.settings.mp_user_map !== 'object') db.settings.mp_user_map = {};
    const r = await backfillMpUserMap({ movements: candidates.slice(0, limit), userMap: db.settings.mp_user_map });
    save();
    res.json(r);
  } catch (e) { res.status(400).json({ error: e.message || 'backfill falló' }); }
});
// Disparo manual (para probar o forzar): corre en background.
app.post('/api/import/mp-sync/auto-run', requireAdmin, (_req, res) => {
  db.settings.mp_last_sync = null;
  mpAutoSync();
  res.json({ started: true });
});

app.post('/api/import/commit', requireAdmin, (req, res) => {
  const movs = Array.isArray(req.body?.movements) ? req.body.movements : null;
  if (!movs || !movs.length) return res.status(400).json({ error: 'no hay movimientos para importar' });
  let inserted = 0, enriched = 0, seq = 0;
  for (const m of movs) {
    const { _dupe, _idx, _enrich, _maybe, _maybe_ref, id: _drop, ...rest } = m;
    if (_enrich) {
      // Actualiza el movimiento sin nombre del auto-sync con el nombre + clasificación.
      const i = db.cashflow.findIndex((x) => x.id === _enrich);
      if (i >= 0) {
        const keep = db.cashflow[i];
        db.cashflow[i] = {
          ...keep,
          counterparty: rest.counterparty, counterparty_type: rest.counterparty_type,
          category: rest.category, subcategory: rest.subcategory,
          expense_type: rest.expense_type, description: rest.description,
          fixed_variable: rest.fixed_variable, transfer: rest.transfer,
          needs_review: rest.needs_review, review_reason: rest.review_reason,
        };
        learnMpUser(db.cashflow[i]);   // el export con nombre alimenta el mapa de user ids
        enriched++;
        continue;
      }
      // si el original ya no existe, cae a insertar
    }
    db.cashflow.push({ ...rest, id: `MOV-IMP-${Date.now().toString(36)}-${String(++seq).padStart(3, '0')}` });
    inserted++;
  }
  save();
  res.json({ inserted, enriched });
});

// Canonicalize quote/sale status (data uses English; UI uses Spanish — accept both)
const QUOTE_STATUS = { Borrador: 'DRAFT', Enviado: 'SENT', Aceptado: 'ACCEPTED', Rechazado: 'REJECTED', DRAFT: 'DRAFT', SENT: 'SENT', ACCEPTED: 'ACCEPTED', REJECTED: 'REJECTED' };
const SALE_STATUS  = { Confirmado: 'Confirmado', Programado: 'Programado', 'En proceso': 'En proceso', Finalizado: 'Finalizado', Cancelado: 'Cancelado' };

// ---------- State machine: Quote transitions (DRAFT → SENT → ACCEPTED) ----------
// SENT is the moment we reserve stock (the user's rule: quote sent = invoice = reserve).
app.post('/api/quotes/:id/transition', (req, res) => {
  const q = db.quotes.find(x => x.id === req.params.id);
  if (!q) return res.sendStatus(404);
  const next = QUOTE_STATUS[String(req.body?.status ?? '')];
  if (!next) return res.status(400).json({ error: 'invalid status' });
  const prev = q.status;
  if (prev === next) return res.json(q);

  const isEnvNow = next === 'SENT'
  const wasEnv = prev === 'SENT'
  if (isEnvNow && !wasEnv) {
    for (const it of (q.items || [])) {
      const p = findProductByItem(it); if (!p) continue;
      const qty = Number(it.quantity) || 0;
      p.reservedStock = (Number(p.reservedStock) || 0) + qty;
      movement('quote_reserve', q.id, p.id, p.sku, qty);
    }
  } else if (wasEnv && !isEnvNow && next !== 'ACCEPTED') {
    for (const it of (q.items || [])) {
      const p = findProductByItem(it); if (!p) continue;
      const qty = Number(it.quantity) || 0;
      p.reservedStock = Math.max(0, (Number(p.reservedStock) || 0) - qty);
      movement('quote_release', q.id, p.id, p.sku, -qty);
    }
  }
  q.status = next;
  save();
  res.json(q);
});

// ---------- State machine: Sale transitions ----------
app.post('/api/sales/:id/transition', (req, res) => {
  const s = db.sales.find(x => x.id === req.params.id);
  if (!s) return res.sendStatus(404);
  const next = SALE_STATUS[String(req.body?.status ?? '')];
  if (!next) return res.status(400).json({ error: 'invalid status' });
  const prev = s.status;
  if (prev === next) return res.json(s);

  // Entering Finalizado → deduct from stock lo que FALTE entregar (lo ya entregado por
  // entregas de material parciales ya se descontó) y limpiar la reserva.
  if (next === 'Finalizado' && !s.stock_deducted) {
    const delivered = deliveredBySku(s);
    for (const it of (s.items || [])) {
      const p = findProductByItem(it); if (!p) continue;
      const remaining = Math.max(0, (Number(it.quantity) || 0) - (delivered[it.sku] || 0));
      if (remaining <= 0) continue;
      p.stock = Math.max(0, (Number(p.stock) || 0) - remaining);
      if (s.stock_reserved) p.reservedStock = Math.max(0, (Number(p.reservedStock) || 0) - remaining);
      movement('sale_deduct', s.id, p.id, p.sku, -remaining);
    }
    s.stock_reserved = false;
    s.stock_deducted = true;
  }

  // Cancelar: devolver al depósito lo que salió físicamente (entregas de material + finalización)
  // y liberar la reserva del resto. Un solo bloque que cubre los 3 casos: finalizada,
  // parcialmente entregada (no finalizada) y solo reservada.
  if (next === 'Cancelado') {
    const delivered = deliveredBySku(s);
    for (const it of (s.items || [])) {
      const p = findProductByItem(it); if (!p) continue;
      const ordered = Number(it.quantity) || 0;
      const out = s.stock_deducted ? ordered : (delivered[it.sku] || 0);   // físico que salió del stock
      const reservedPortion = Math.max(0, ordered - out);                   // lo que solo estaba reservado
      if (out > 0) {
        p.stock = (Number(p.stock) || 0) + out;
        movement('sale_cancel_restock', s.id, p.id, p.sku, out);
      }
      if (s.stock_reserved && reservedPortion > 0) {
        p.reservedStock = Math.max(0, (Number(p.reservedStock) || 0) - reservedPortion);
        movement('sale_cancel_release', s.id, p.id, p.sku, -reservedPortion);
      }
    }
    s.stock_reserved = false;
    s.stock_deducted = false;
  }

  s.status = next;
  save();
  res.json(s);
});

// ---------- Entrega de material (descuenta stock SIN finalizar la venta) ----------
// El piso se entrega a la obra antes de colocarlo: el material sale del depósito pero la venta sigue
// abierta hasta la colocación. Soporta entregas PARCIALES (entregar parte y el resto después).
// body: { items?: [{sku, quantity}], date?, note? }. Sin items → entrega todo lo pendiente.
app.post('/api/sales/:id/deliver-material', requireAdmin, (req, res) => {
  const s = db.sales.find(x => x.id === req.params.id);
  if (!s) return res.sendStatus(404);
  if (s.status === 'Cancelado') return res.status(409).json({ error: 'la venta está cancelada' });
  if (s.stock_deducted) return res.status(409).json({ error: 'ya se entregó todo el material de esta venta' });
  const date = (req.body?.date || new Date().toISOString().slice(0, 10));
  const note = req.body?.note || null;
  const reqItems = Array.isArray(req.body?.items) ? req.body.items : null;
  const delivered = deliveredBySku(s);
  const lines = [];
  for (const it of (s.items || [])) {
    if (!it || !it.sku) continue;
    const p = findProductByItem(it); if (!p || !p.stockTrack) continue;   // solo pisos con stock
    const pending = r2((Number(it.quantity) || 0) - (delivered[it.sku] || 0));
    if (pending <= 0) continue;
    let qty = pending;
    if (reqItems) {
      const r = reqItems.find(x => String(x.sku) === String(it.sku));
      if (!r) continue;
      qty = Math.min(pending, Math.max(0, Number(r.quantity) || 0));
    }
    if (qty <= 0) continue;
    lines.push({ p, sku: it.sku, product_id: p.id, quantity: r2(qty) });
  }
  if (!lines.length) return res.status(400).json({ error: 'no hay material pendiente para entregar' });
  for (const ln of lines) {
    ln.p.stock = Math.max(0, (Number(ln.p.stock) || 0) - ln.quantity);
    if (s.stock_reserved) ln.p.reservedStock = Math.max(0, (Number(ln.p.reservedStock) || 0) - ln.quantity);
    movement('sale_deduct', s.id, ln.p.id, ln.p.sku, -ln.quantity);
  }
  const rec = { id: 'DEL-' + Date.now().toString(36), date, note, by: req.user?.name || req.user?.email || null,
                items: lines.map(ln => ({ sku: ln.sku, product_id: ln.product_id, quantity: ln.quantity })) };
  s.material_deliveries = [...(s.material_deliveries || []), rec];
  s.material_delivery_date = s.material_delivery_date || date;   // fecha de la 1ra entrega
  // OJO: la entrega de material NO toca el estado de COLOCACIÓN (status/delivery_date) — son dos ejes
  // independientes. El estado de material se deriva de material_deliveries + stock_deducted.
  // ¿quedó TODO entregado? → marcar stock_deducted (el guard de Finalizar no lo vuelve a descontar).
  const after = deliveredBySku(s);
  const fully = (s.items || []).every(it => {
    if (!it || !it.sku) return true;
    const p = findProductByItem(it); if (!p || !p.stockTrack) return true;
    return (after[it.sku] || 0) + 1e-6 >= (Number(it.quantity) || 0);
  });
  if (fully) { s.stock_deducted = true; s.stock_reserved = false; }
  save();
  res.json(s);
});

// Deshacer una entrega de material (error de carga) → devuelve el stock físico.
app.post('/api/sales/:id/undo-material-delivery', requireAdmin, (req, res) => {
  const s = db.sales.find(x => x.id === req.params.id);
  if (!s) return res.sendStatus(404);
  const list = s.material_deliveries || [];
  if (!list.length) return res.status(404).json({ error: 'no hay entregas para deshacer' });
  const delId = req.body?.delivery_id;
  const idx = delId ? list.findIndex(d => d.id === delId) : list.length - 1;   // por defecto, la última
  if (idx < 0) return res.status(404).json({ error: 'entrega no encontrada' });
  const rec = list[idx];
  for (const ln of (rec.items || [])) {
    const p = db.products.find(x => x.id === ln.product_id) || db.products.find(x => x.sku === ln.sku);
    if (!p) continue;
    p.stock = (Number(p.stock) || 0) + (Number(ln.quantity) || 0);
    movement('sale_cancel_restock', s.id, p.id, p.sku, Number(ln.quantity) || 0);
  }
  s.material_deliveries = list.filter((_, i) => i !== idx);
  s.stock_deducted = false;   // ya no está todo entregado
  if (!s.material_deliveries.length) s.material_delivery_date = null;
  save();
  res.json(s);
});

// ---------- Record payment against a sale ----------
// ---------- T6.A — MercadoPago payment links ----------
// Generate a payment link for the open balance of a sale. When MercadoPago
// credentials are configured we POST to the real /checkout/preferences API;
// when not, we return a mock checkout URL backed by /mock-mp/:token so the
// flow is end-to-end demoable.
app.post('/api/sales/:id/payment-link', async (req, res) => {
  const s = db.sales.find(x => x.id === req.params.id);
  if (!s) return res.sendStatus(404);
  const amount = Number(req.body?.amount) || Number(s.financial_position?.balance_due) || 0;
  if (amount <= 0) return res.status(400).json({ error: 'amount must be > 0' });

  const id = `pl-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
  const mp = db.settings.integrations?.mercadopago;
  let init_point = `http://localhost:${process.env.PORT || 3000}/mock-mp/${id}`;
  let mode = 'mock';
  let provider_ref = null;

  if (mp?.enabled && mp.access_token) {
    try {
      const r = await fetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${mp.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ title: `Venta ${s.id} — ${s.title || ''}`.slice(0, 250), quantity: 1, currency_id: 'ARS', unit_price: amount }],
          external_reference: id,
          notification_url: `${req.protocol}://${req.get('host')}/api/mp/webhook`,
        }),
      });
      const j = await r.json();
      if (r.ok && j.init_point) { init_point = j.init_point; mode = 'live'; provider_ref = j.id; }
      else console.warn('MP preference failed, falling back to mock:', r.status, j);
    } catch (e) {
      console.warn('MP request error, falling back to mock:', e.message);
    }
  }

  const link = {
    id, sale_id: s.id, amount, status: 'pending', mode, provider_ref,
    init_point, client_name: s.client_name, created_at: new Date().toISOString(),
  };
  db.payment_links.push(link);
  save();
  res.json(link);
});

// List + lookup
app.get('/api/payment-links', (_, res) => res.json(db.payment_links));
app.get('/api/payment-links/:id', (req, res) => {
  const l = db.payment_links.find(x => x.id === req.params.id);
  return l ? res.json(l) : res.sendStatus(404);
});

// Dev helper: mark a mock payment link as paid (records a real payment on the sale).
app.post('/api/payment-links/:id/simulate-paid', (req, res) => {
  const l = db.payment_links.find(x => x.id === req.params.id);
  if (!l) return res.sendStatus(404);
  // Solo links en modo demo (mock) se pueden marcar pagados a mano. Los 'live'
  // registran cobros reales SOLO por el webhook de MP (este endpoint es público).
  if (l.mode !== 'mock') return res.status(403).json({ error: 'solo links en modo demo' });
  if (l.status === 'paid') return res.json(l);
  const s = db.sales.find(x => x.id === l.sale_id);
  if (!s) return res.sendStatus(404);
  s.financial_position = s.financial_position || { total_invoiced: s.contract_total || 0, total_paid: 0, balance_due: s.contract_total || 0 };
  s.financial_position.total_paid  = (Number(s.financial_position.total_paid) || 0) + l.amount;
  s.financial_position.balance_due = Math.max(0, (Number(s.financial_position.balance_due) || s.contract_total || 0) - l.amount);
  s.payments = s.payments || [];
  s.payments.push({ ts: new Date().toISOString(), amount: l.amount, method: 'mercadopago', notes: `link ${l.id} (simulado)` });
  l.status = 'paid'; l.paid_at = new Date().toISOString();
  save();
  res.json(l);
});

// MercadoPago IPN webhook — verifies + records a real payment.
// MP sends { type: "payment", data: { id } } and we'd then GET /v1/payments/:id
// to read the full payment. In mock mode this path is unused.
app.post('/api/mp/webhook', async (req, res) => {
  console.log('[mp:webhook]', JSON.stringify(req.body).slice(0, 400));
  const mp = db.settings.integrations?.mercadopago;
  const payment_id = req.body?.data?.id ?? req.query?.['data.id'];
  if (mp?.enabled && mp.access_token && payment_id) {
    try {
      const r = await fetch(`https://api.mercadopago.com/v1/payments/${payment_id}`, {
        headers: { 'Authorization': `Bearer ${mp.access_token}` },
      });
      const p = await r.json();
      if (r.ok && p.status === 'approved' && p.external_reference) {
        const l = db.payment_links.find(x => x.id === p.external_reference);
        if (l && l.status !== 'paid') {
          const s = db.sales.find(x => x.id === l.sale_id);
          if (s) {
            s.financial_position = s.financial_position || { total_invoiced: s.contract_total || 0, total_paid: 0, balance_due: s.contract_total || 0 };
            s.financial_position.total_paid  = (Number(s.financial_position.total_paid) || 0) + l.amount;
            s.financial_position.balance_due = Math.max(0, (Number(s.financial_position.balance_due) || s.contract_total || 0) - l.amount);
            s.payments = s.payments || [];
            s.payments.push({ ts: new Date().toISOString(), amount: l.amount, method: 'mercadopago', notes: `payment ${payment_id}` });
            l.status = 'paid'; l.paid_at = new Date().toISOString(); l.provider_payment_id = payment_id;
            save();
          }
        }
      }
    } catch (e) { console.warn('MP webhook lookup failed:', e.message); }
  }
  res.sendStatus(200);
});

// Mock checkout page — when MP isn't configured the payment link points here.
app.get('/mock-mp/:id', (req, res) => {
  const l = db.payment_links.find(x => x.id === req.params.id);
  if (!l) return res.status(404).send('Link no encontrado');
  res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Mock MercadoPago</title>
    <style>body{font-family:-apple-system,system-ui,sans-serif;background:#f5f5f7;padding:40px;max-width:480px;margin:0 auto;color:#18181b}
      .card{background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
      h1{font-size:18px;margin:0 0 4px}.muted{color:#71717a;font-size:13px}
      .amount{font-size:32px;font-weight:600;margin:16px 0;font-variant-numeric:tabular-nums}
      button{background:#009ee3;color:#fff;border:0;padding:12px 24px;border-radius:8px;font-size:15px;cursor:pointer;width:100%;font-weight:600}
      button:hover{background:#0084c1}.dev{margin-top:16px;font-size:11px;color:#a1a1aa;text-align:center}
    </style></head><body><div class="card">
    <h1>MercadoPago (modo demo)</h1><div class="muted">Pago hacia Pisos Pacific · Venta ${l.sale_id}</div>
    <div class="amount">$ ${Number(l.amount).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</div>
    <div class="muted">Cliente: ${l.client_name || ''}</div>
    ${l.status === 'paid'
      ? '<div style="background:#dcfce7;color:#15803d;padding:12px;border-radius:8px;margin-top:16px;text-align:center;font-weight:600">✓ Pagado</div>'
      : `<form method="POST" action="/api/payment-links/${l.id}/simulate-paid" style="margin-top:16px"><button type="submit">Simular pago aprobado</button></form>`}
    <div class="dev">Esta es una pasarela de prueba — no se realizó ningún cobro real.</div>
    </div></body></html>`);
});

app.post('/api/sales/:id/payment', (req, res) => {
  const s = db.sales.find(x => x.id === req.params.id);
  if (!s) return res.sendStatus(404);
  const amount = Number(req.body?.amount) || 0;
  if (amount <= 0) return res.status(400).json({ error: 'amount must be > 0' });
  s.financial_position = s.financial_position || { total_invoiced: s.contract_total || 0, total_paid: 0, balance_due: s.contract_total || 0 };
  s.financial_position.total_paid = (Number(s.financial_position.total_paid) || 0) + amount;
  s.financial_position.balance_due = Math.max(0, (Number(s.financial_position.balance_due) || s.contract_total || 0) - amount);
  s.payments = s.payments || [];
  s.payments.push({ ts: new Date().toISOString(), amount, method: req.body?.method ?? '', notes: req.body?.notes ?? '' });
  save();
  res.json(s);
});
// Linkear un MOVIMIENTO de caja (cobro que entró por banco/MP) a una VENTA: le pone el sale_ref y lo
// clasifica como cobro. El saldo de la venta se DERIVA de los movimientos con sale_ref (ver GET
// /api/sales: cashflow_paid = Σ amount_usd), así que no hay que tocar financial_position — el cobro
// queda registrado UNA sola vez (el movimiento es la fuente). Pasá sale_id:null para desvincular.
app.post('/api/cashflow/:id/link-sale', requireAdmin, (req, res) => {
  const m = db.cashflow.find(x => x.id === req.params.id);
  if (!m) return res.sendStatus(404);
  const saleId = req.body?.sale_id || null;
  if (!saleId) {
    m.linked_sale_id = null; m.sale_ref = null;
    save(); return res.json({ movement: m, sale: null });
  }
  const sale = db.sales.find(s => s.id === saleId);
  if (!sale) return res.status(404).json({ error: 'venta no encontrada' });
  m.linked_sale_id = saleId;
  m.sale_ref = sale.quote_number || sale.id;
  m.counterparty = sale.client_name || m.counterparty; m.counterparty_type = 'client';
  m.category = m.category && /venta/i.test(m.category) ? m.category : 'Venta - Pisos';
  m.needs_review = false; m.review_reason = null;
  learnMpUser(m);   // si el movimiento vino del sync MP, aprende cliente ← user id
  save();
  res.json({ movement: m, sale });
});

// ---------- Quote → Sale conversion (T1.G) ----------
// ---------- Duplicar cotización (T-Sales #9) ----------
app.post('/api/quotes/:id/duplicate', (req, res) => {
  const orig = db.quotes.find(x => x.id === req.params.id);
  if (!orig) return res.sendStatus(404);
  const id = `local-q-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
  const quote_number = `A${Math.floor(Math.random() * 9000 + 1000)}`;
  const copy = JSON.parse(JSON.stringify(orig));
  copy.id = id;
  copy.quote_number = quote_number;
  copy.status = 'DRAFT';
  copy.created_at = new Date().toISOString();
  delete copy.renewed_at;
  delete copy.sale_id;
  db.quotes.push(copy);
  save();
  res.json(copy);
});

// Shared helper — clones a quote into a new Confirmado sale and links them.
// Returns the sale (or null if already converted / quote not found).
function convertQuoteToSale(q) {
  if (!q || q.sale_id) return null;
  // CLIENTE: al concretar la venta es cuando un lead "se vuelve cliente". Find-or-create
  // deduplicado (por email/teléfono/nombre). Si la cotización ya tenía client_id (walk-in), se respeta.
  let clientId = q.client_id || '';
  if (!clientId) {
    const match = findClientMatch(db.clients, { name: q.client_name, email: q.client_email, phone: q.client_phone });
    if (match) clientId = match.id;
    else {
      const c = {
        id: `CLI-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, type: 'client', active: true,
        name: String(q.client_name || '').trim() || 'Cliente', dni: q.client_dni || '',
        emails: q.client_email ? [q.client_email] : [], phones: q.client_phone ? [q.client_phone] : [],
        addresses: q.client_address ? [q.client_address] : [], notes: null, updated_at: new Date().toISOString(),
      };
      db.clients.push(c);
      clientId = c.id;
    }
    q.client_id = clientId;   // backref en la cotización
  }
  // Completar datos faltantes del cliente desde la cotización (sin pisar lo que ya tiene).
  const cli = db.clients.find(c => c.id === clientId);
  if (cli) {
    if (q.client_email && !(cli.emails || []).some(e => String(e).toLowerCase() === String(q.client_email).toLowerCase())) cli.emails = [...(cli.emails || []), q.client_email];
    if (q.client_phone && !(cli.phones || []).length) cli.phones = [q.client_phone];
    if (q.client_address && !(cli.addresses || []).length) cli.addresses = [q.client_address];
  }
  const saleId = `local-sale-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
  const sale = {
    id: saleId,
    quote_id: q.id,
    quote_number: q.quote_number,
    title: q.title,
    description: q.description,
    internal_notes: q.internal_notes ?? '',
    public_notes: q.public_notes ?? '',
    payment_terms: q.payment_terms ?? '',
    client_id: clientId,
    client_name: q.client_name,
    client_dni: q.client_dni,
    client_email: q.client_email ?? '',
    client_phone: q.client_phone ?? '',
    client_address: q.client_address ?? '',
    contract_total: q.price,
    items: JSON.parse(JSON.stringify(q.items || [])),
    zoned: q.zoned,
    discount_total: q.discount_amount,
    status: 'Confirmado',
    created_at: new Date().toISOString(),
    has_iva: q.has_iva ?? false,
    iva_mode: (q.has_iva ?? false) ? 'full' : 'none',   // la venta arranca igual que la cotización; editable después
    financial_position: { total_invoiced: 0, total_paid: 0, balance_due: q.price },
    stock_reserved: q.status === 'Enviado' || q.status === 'Aceptado' || q.status === 'SENT' || q.status === 'ACCEPTED',
    stock_deducted: false,
    seller_name: q.seller_name ?? '',
  };
  db.sales.push(sale);
  q.sale_id = saleId;
  if (q.status !== 'ACCEPTED' && q.status !== 'Aceptado') q.status = 'Aceptado';
  return sale;
}

app.post('/api/quotes/:id/convert', (req, res) => {
  const q = db.quotes.find(x => x.id === req.params.id);
  if (!q) return res.sendStatus(404);
  if (q.sale_id) return res.status(409).json({ error: 'already converted', sale_id: q.sale_id });
  const sale = convertQuoteToSale(q);
  save();
  res.json(sale);
});

// ---------- Presupuesto PDF (motor Pacific en pdf/pacific_pdf.py) ----------
const IVA_RATE = 0.21;
const usdFmt = (n) => 'US$ ' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function presupuestoData(rec) {
  const fecha = rec.created_at ? new Date(rec.created_at).toLocaleDateString('es-AR') : new Date().toLocaleDateString('es-AR');
  const sellerPhone = (db.settings.sellers || []).find(s => s.name === rec.seller_name)?.phone || rec.seller_phone || '';
  const items = (rec.items || []).filter(it => it && it.product_id !== 'discount' && !/^descuento/i.test(it.description || ''));
  const lineTotal = (it) => Number(it.total) || (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
  const lineDisc = (it) => Math.max(0, Number(it.discount) || 0);
  const lineNet = (it) => lineTotal(it) - lineDisc(it);
  const rowOf = (it) => {
    const isEntrega = /entrega/i.test(it.description || '') || it.sku === 'SERV-131';
    const qty = Number(it.quantity) || 0;
    return [it.description || it.sku || '', isEntrega ? '—' : `${qty} m2`, isEntrega ? '—' : usdFmt(it.unit_price), usdFmt(lineTotal(it))];
  };
  // Descuento por ítem: el ítem a precio bruto + una sub-fila "Descuento" (solo si tiene).
  const rowsFor = (list) => list.flatMap(it => {
    const r = [rowOf(it)];
    const d = lineDisc(it);
    if (d > 0) { const pct = (it.disc_kind === 'pct' && it.disc_value) ? ` (${it.disc_value}%)` : ''; r.push([`Descuento${pct}`, '—', '—', '-' + usdFmt(d)]); }
    return r;
  });
  const hasItemDisc = items.some(it => lineDisc(it) > 0);
  const gross = items.reduce((s, it) => s + lineTotal(it), 0);
  const discount = Number(rec.discount_total || rec.discount_amount || 0);
  const net = Math.max(0, gross - discount);
  const iva = rec.has_iva ? net * IVA_RATE : 0;
  const zones = [...new Set(items.map(it => it.zone).filter(Boolean))];
  // Resumen del proyecto: m² de pisos (productos con stock), cantidad de ambientes e ítems.
  const isFloor = (it) => { const p = db.products.find(pr => pr.sku === it.sku); return p ? !!p.stockTrack : false; };
  const m2 = items.filter(isFloor).reduce((s, it) => s + (Number(it.quantity) || 0), 0);
  const validDays = rec.valid_days || 10;
  const venceDate = new Date(rec.created_at ? new Date(rec.created_at) : new Date());
  venceDate.setDate(venceDate.getDate() + validDays);
  const base = {
    fecha,
    numero: rec.quote_number || rec.id || '',
    vence: venceDate.toLocaleDateString('es-AR'),
    has_iva: !!rec.has_iva,
    forma_pago: rec.payment_terms || 'Anticipo 80% · Conforme 20%',
    vendedor: sellerPhone ? `${rec.seller_name || ''} · ${sellerPhone}` : (rec.seller_name || ''),
    vendedor_short: rec.seller_name || '',
    cliente: rec.client_name || '',
    obra: rec.title || rec.client_address || '',
    obs: rec.public_notes || '',
    resumen: { m2: Math.round(m2 * 10) / 10, ambientes: (rec.zoned && zones.length) ? zones.length : 1, items: items.length },
    vigencia_dias: rec.valid_days || 10,
    subtotal: usdFmt(net),
    iva: usdFmt(iva),
    total: usdFmt(net + iva),
  };
  if (rec.zoned && zones.length) {
    const sections = zones.map(z => {
      const zi = items.filter(it => it.zone === z);
      return { title: z, rows: rowsFor(zi), subtotal_label: `Subtotal ${z}`, subtotal_val: usdFmt(zi.reduce((s, it) => s + lineNet(it), 0)) };
    });
    const noZone = items.filter(it => !it.zone);
    if (noZone.length) sections.push({ title: 'Otros', rows: rowsFor(noZone), subtotal_label: 'Subtotal Otros', subtotal_val: usdFmt(noZone.reduce((s, it) => s + lineNet(it), 0)) });
    return { ...base, mode: 'sections', sections };
  }
  const rows = rowsFor(items);
  // Compat: cotizaciones viejas con descuento global (sin descuento por ítem).
  if (!hasItemDisc && discount > 0) rows.push(['Descuento', '—', '—', '-' + usdFmt(discount)]);
  return { ...base, mode: 'single', rows };
}
// Nombre de archivo seguro para Content-Disposition: sin acentos ni caracteres ilegales.
function pdfFilename(...parts) {
  const clean = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return parts.map(clean).filter(Boolean).join(' - ') + '.pdf';
}
function renderPdf(data, res, filename) {
  generatePdf(data)
    .then((buf) => {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      res.send(buf);
    })
    .catch((e) => {
      console.error('pdf engine:', e.message);
      res.status(500).json({ error: 'pdf generation failed', detail: String(e.message || e) });
    });
}
app.get('/api/quotes/:id/pdf', (req, res) => {
  const q = db.quotes.find(x => x.id === req.params.id);
  if (!q) return res.sendStatus(404);
  renderPdf(presupuestoData(q), res, pdfFilename(`Presupuesto N${q.quote_number || q.id}`, q.title, q.client_name));
});
app.get('/api/sales/:id/pdf', (req, res) => {
  const s = db.sales.find(x => x.id === req.params.id);
  if (!s) return res.sendStatus(404);
  renderPdf(presupuestoData(s), res, pdfFilename(`Presupuesto N${s.quote_number || s.id}`, s.title, s.client_name));
});

// ---------- Compartir presupuesto (WhatsApp PDF + link público para Instagram) ----------
// Link público (sin login) al PDF de la cotización; protegido por un token aleatorio.
app.get('/p/q/:id/:token', (req, res) => {
  const q = db.quotes.find(x => x.id === req.params.id);
  if (!q || !q.share_token || q.share_token !== req.params.token) return res.sendStatus(404);
  renderPdf(presupuestoData(q), res, pdfFilename(`Presupuesto N${q.quote_number || q.id}`, q.title, q.client_name));
});
const appBase = (req) => process.env.APP_URL || `${req.headers['x-forwarded-proto'] || 'https'}://${req.get('host')}`;
const toWa = (phone) => { const d = String(phone || '').replace(/\D/g, ''); if (!d) return ''; if (d.startsWith('54')) return d; if (d.length <= 10) return '549' + d; return d; };
// Genera (si falta) el link público y, opcional, manda el PDF por WhatsApp al cliente.
app.post('/api/quotes/:id/share', async (req, res) => {
  const q = db.quotes.find(x => x.id === req.params.id);
  if (!q) return res.sendStatus(404);
  if (!q.share_token) { q.share_token = crypto.randomBytes(12).toString('hex'); save(); }
  const link = `${appBase(req)}/p/q/${q.id}/${q.share_token}`;
  const message = String(req.body?.message || '').trim() || defaultQuoteMessage(q);
  const filename = pdfFilename(`Presupuesto N${q.quote_number || q.id}`, q.title, q.client_name);
  const buf = (req.body?.whatsapp || req.body?.email) ? await generatePdf(presupuestoData(q)) : null;
  let whatsapp = null;
  if (req.body?.whatsapp) {
    const to = toWa(q.client_phone);
    if (!to) whatsapp = { sent: false, reason: 'el cliente no tiene teléfono cargado' };
    else try {
      whatsapp = await sendWhatsAppDocument(to, buf, filename, message);
      if (whatsapp.sent) {   // reflejarlo en la conversación si existe
        // Match por número completo normalizado (no por 8 dígitos: dos clientes podrían compartirlos).
        const toDigits = String(to).replace(/\D/g, '');
        const conv = db.conversations.find(c => { if (c.channel !== 'whatsapp') return false; const d = String(c.contact_id || '').replace(/\D/g, ''); return d === toDigits || (d.length >= 10 && toDigits.length >= 10 && d.slice(-10) === toDigits.slice(-10)); });
        if (conv) {
          const ts = new Date().toISOString();
          db.messages.push({ id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, conversation_id: conv.id, direction: 'out', body: `📄 ${filename} (enviado)`, ts, status: 'sent', wa_id: whatsapp.id });
          touchConv(conv, 'out', ts, '📄 Presupuesto enviado'); conv.unread_count = 0;
        }
        save();
      }
    } catch (e) { whatsapp = { sent: false, reason: e.message }; }
  }
  let email = null;
  if (req.body?.email) {
    const to = q.client_email;
    if (!to) email = { sent: false, reason: 'el cliente no tiene email cargado' };
    else try {
      const html = emailHtml(message, signatureFor(req.user));
      email = await sendOutbound('email', to, message, { subject: `Presupuesto Pisos Pacific${q.title ? ' — ' + q.title : ''}`, html, attachments: [{ filename, content: buf, contentType: 'application/pdf' }] });
    } catch (e) { email = { sent: false, reason: e.message }; }
  }
  res.json({ link, whatsapp, email });
});
// Remito para el depósito: dirección de obra + materiales y cantidades, SIN precios.
function remitoData(rec) {
  // Si la inspección armó el remito (remito_items), se usa eso. Si no, se derivan de la venta.
  let rows;
  if (Array.isArray(rec.remito_items) && rec.remito_items.length) {
    rows = rec.remito_items.map(it => [it.description || '', `${Number(it.quantity) || 0} ${it.unit || ''}`.trim()]);
  } else {
    const items = (rec.items || []).filter(it => it && it.product_id !== 'discount' && !/^descuento/i.test(it.description || ''));
    const isService = (it) => /^SERV/i.test(it.sku || '') || /colocaci[oó]n|entrega|ajuste|medici[oó]n|reparaci[oó]n|servicio|mano de obra|flete/i.test(it.description || '');
    const isFloor = (it) => { const p = db.products.find(pr => pr.sku === it.sku); return p ? !!p.stockTrack : false; };
    const unit = (it) => isFloor(it) ? 'm²' : (/z[oó]calo|varilla|cuartaca[ñn]a|nariz|moldura|cubrecanto/i.test(it.description || '') ? 'ml' : 'u');
    rows = items.filter(it => !isService(it)).map(it => [it.description || it.sku || '', `${Number(it.quantity) || 0} ${unit(it)}`]);
  }
  const dlv = rec.delivery_date ? new Date(rec.delivery_date).toLocaleDateString('es-AR') + (rec.delivery_date_to && rec.delivery_date_to !== rec.delivery_date ? ' → ' + new Date(rec.delivery_date_to).toLocaleDateString('es-AR') : '') : '';
  return {
    doc_type: 'remito', fecha: new Date().toLocaleDateString('es-AR'),
    cliente: rec.client_name || '', obra: rec.title || rec.client_address || '',
    direccion: rec.client_address || '', equipo: rec.delivery_crew || '', entrega: dlv,
    obs: [rec.remito_confirmed ? 'CONFIRMADO POR INSPECCIÓN' : '', rec.delivery_notes || ''].filter(Boolean).join(' · '),
    rows,
  };
}
app.get('/api/sales/:id/remito', (req, res) => {
  const s = db.sales.find(x => x.id === req.params.id);
  if (!s) return res.sendStatus(404);
  renderPdf(remitoData(s), res, pdfFilename(`Remito N${s.quote_number || s.id}`, s.title, s.client_name));
});

// ---------- Brand logos (committed in assets/branding/) ----------
// Assets públicos de la firma de email (los clientes de correo los bajan sin login).
app.use('/firma', express.static(path.join(__dirname, 'assets/firma')));
// Archivos subidos que se comparten con clientes (links públicos, nombres aleatorios).
app.use('/uploads', express.static(UPLOAD_DIR));
const BRANDING = path.join(__dirname, 'assets/branding');
app.get('/LogoPacific.png',          (_, res) => res.sendFile(path.join(BRANDING, 'LogoPacific.png')));
app.get('/LogoPacificSmall.png',     (_, res) => res.sendFile(path.join(BRANDING, 'LogoPacificSmall.png')));
app.get('/LogoPacificDark.png',      (_, res) => res.sendFile(path.join(BRANDING, 'LogoPacificDark.png')));
app.get('/LogoPacificSmallDark.png', (_, res) => res.sendFile(path.join(BRANDING, 'LogoPacificSmallDark.png')));

// ---------- React + shadcn SPA bundle (dashboard-app) ----------
// Vite is configured with base: '/' so assets resolve from /assets/*.
// All "owned" SPA routes serve the same index.html and let react-router take over.
const DASHBOARD_DIST = path.join(__dirname, 'dashboard-app/dist');
app.use('/assets', express.static(path.join(DASHBOARD_DIST, 'assets')));
// Archivos de public/ que Vite copia a la raíz del dist (PWA: manifest, íconos, favicon).
// index:false → no auto-sirve index.html en '/'; si el archivo no existe, sigue al SPA.
app.use(express.static(DASHBOARD_DIST, { index: false, maxAge: '1h' }));
const SPA_ROUTES = ['/', '/login', '/reset', '/dashboard', '/inventario', '/galeria', '/cotizaciones', '/ventas', '/agenda', '/gastos', '/clientes', '/movimientos', '/leads', '/mensajes', '/reportes', '/configuracion', '/cajas', '/proveedores', '/cashflow'];
for (const r of SPA_ROUTES) {
  app.get(r, (_, res) => res.sendFile(path.join(DASHBOARD_DIST, 'index.html')));
}

// ---------- Remaining captured Vercel pages (only /configuracion for now) ----------
const ORIGIN = 'https://pisos-pacific-app.vercel.app';
const PAGES = {
  '/configuracion': 'configuracion.html',
};

function rewriteHtml(html, file) {
  // Point Vite asset paths at the Vercel CDN, but keep /api/* relative so it hits our mock.
  let out = html
    .replace(/(src|href)="\/assets\//g, `$1="${ORIGIN}/assets/`)
    .replace(/<head>/i, `<head><script>window.__LOCAL_CLONE__=true;</script>`);

  // Inject our SPA enhancements on every cloned page:
  //  - Swap the sidebar logo to a smaller mark when the sidebar is collapsed
  //  - Insert a "Resumen Financiero" sub-item under the Dashboard nav button
  //  - On the Dashboard view itself, add a "Ver detalle →" link to the Resumen card
  // React re-renders the DOM post-hydration, so we use a MutationObserver that re-applies
  // every change and self-deduplicates.
  const injector = `
<style>
  a[data-resumen-link] {
    align-items:center; gap:8px; padding:8px 12px 8px 38px;
    font-size:13px; text-decoration:none; border-radius:8px;
    border-left:2px solid transparent; color:#9a9a9a;
    display:flex;
  }
  aside.w-20 a[data-resumen-link] { display:none !important; }
</style>
<script>
(function(){
  const SMALL = '/LogoPacificSmall.png', BIG = '/LogoPacific.png';
  const SUB_HREF = '/dashboard/resumen-financiero';

  function updateLogo(){
    document.querySelectorAll('img[alt*="Logo" i]').forEach(img => {
      const aside = img.closest('aside') || document.querySelector('aside');
      if (!aside) return;
      const collapsed = aside.className.includes('w-20');
      const want = collapsed ? SMALL : BIG;
      if (!img.src.endsWith(want)) img.src = want;
    });
  }

  function addSubItem(){
    const dashBtn = [...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === 'Dashboard');
    if (!dashBtn) return;
    const nav = dashBtn.parentElement;
    if (!nav) return;
    const onPage = location.pathname === SUB_HREF;
    let a = nav.querySelector('a[href="' + SUB_HREF + '"]');
    if (!a){
      a = document.createElement('a');
      a.href = SUB_HREF;
      a.setAttribute('data-resumen-link','1');
      a.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<circle cx="12" cy="12" r="3"/><path d="M12 2v3"/><path d="M12 19v3"/>' +
        '</svg>' +
        '<span>Resumen Financiero</span>';
      dashBtn.insertAdjacentElement('afterend', a);
    }
    // Only update color/border (active state) — display visibility is handled by CSS
    a.style.color = onPage ? '#e4a368' : '#9a9a9a';
    a.style.borderLeftColor = onPage ? '#e4a368' : 'transparent';
  }

  function addCardLink(){
    document.querySelectorAll('h4').forEach(h => {
      if (h.textContent.trim() !== 'Resumen Financiero') return;
      if (h.dataset._linkAdded) return;
      h.dataset._linkAdded = '1';
      const a = document.createElement('a');
      a.href = SUB_HREF;
      a.textContent = 'Ver detalle →';
      a.style.cssText = 'font-size:12px;color:#e4a368;text-decoration:none;font-family:Inter,sans-serif;font-weight:500;margin-left:auto';
      h.style.display = 'flex';
      h.style.alignItems = 'center';
      h.appendChild(a);
    });
  }

  function decorate(){ updateLogo(); addSubItem(); addCardLink(); }
  new MutationObserver(decorate).observe(document.documentElement, { childList: true, subtree: true });
  decorate();
})();
</script>`;
  out = out.replace('</body>', injector + '</body>');
  return out;
}

for (const [route, file] of Object.entries(PAGES)) {
  app.get(route, (_, res) => {
    const html = fs.readFileSync(path.join(CLONE, 'html', file), 'utf8');
    res.type('html').send(rewriteHtml(html, file));
  });
}

// Index page that lists the routes (so the user can navigate without the SPA shell)
app.get('/_index', (_, res) => {
  res.type('html').send(`<!doctype html><meta charset=utf8><title>Pisos Pacific — Local Clone</title>
    <style>body{font-family:Inter,system-ui;background:#121212;color:#e5e5e5;padding:48px;max-width:720px;margin:auto}
    a{color:#7ab8ff;display:block;padding:10px 14px;border:1px solid #2a2a2a;border-radius:8px;margin:8px 0;text-decoration:none}
    a:hover{background:#1c1c1c}h1{margin:0 0 8px}small{opacity:.6}</style>
    <h1>Pisos Pacific — Local Clone</h1>
    <small>Data: ${db.products.length} products · ${db.quotes.length} quotes · ${db.sales.length} sales · ${db.clients.length} clients · ${db.expenses.length} expenses</small>
    ${Object.keys(PAGES).filter(p => p !== '/').map(p => `<a href="${p}">${p}</a>`).join('')}
    <a href="/api/products">/api/products (JSON)</a>
    <a href="/api/settings">/api/settings (JSON)</a>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nLocal clone running:`);
  console.log(`  http://localhost:${PORT}/_index   ← start here`);
  console.log(`  http://localhost:${PORT}/inventario`);
  console.log(`  http://localhost:${PORT}/dashboard`);
});
