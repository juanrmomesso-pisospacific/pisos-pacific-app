import express from 'express';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CLONE = path.join(ROOT, 'clone-source');

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(cookieParser());

// ---------- Disk-backed db (loads db.json, seeds from dump on first run) ----------
const DB_PATH = path.join(__dirname, 'data/db.json');

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
    { id: 'u-vicky', email: 'vicky@pisospacific.com',name: 'Victoria Gonzalez Collado', password: 'vicky',    role: 'vendor', seller_name: 'Victoria Gonzalez Collado' },
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
    cashflow:   [...(seedArr('cashflow.seed.json') || []), ...(seedArr('cashflow-bank-extra.seed.json') || []), ...(seedArr('cashflow-mp-extra.seed.json') || []), ...(seedArr('cashflow-cash-extra.seed.json') || []), ...(seedArr('cashflow-vf-extra.seed.json') || []), ...(seedArr('cashflow-reconcile-extra.seed.json') || [])],
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
      console.warn(`Could not parse db.json — re-seeding: ${e.message}`);
    }
  }
  const fresh = seedFromDump();
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(fresh, null, 2));
  console.log(`Seeded db.json from clone-source dump`);
  return fresh;
})();

let saveTimer = null;
function save() {
  // Debounce writes so a burst of mutations only writes once
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
    saveTimer = null;
  }, 50);
}

// Backfill collections added after the first seed so existing db.json files keep working.
if (!Array.isArray(db.leads)) db.leads = [];
// One-shot website-leads seed (matches the cotiza form schema). Idempotent: skipped
// once any lead with source === "Web" exists.
if (!db.leads.some(l => l.source === "Web")) {
  try {
    const webLeads = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/leads.seed.json'), 'utf8'));
    db.leads.push(...webLeads);
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
    console.log(`Seeded ${webLeads.length} website leads into db.json`);
  } catch (e) { console.warn('Website leads seed missing or invalid:', e.message); }
}
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
    db.settings.sellers = (db.users || []).filter(u => u.role === 'vendor' && u.seller_name).map(u => ({ name: u.seller_name, phone: phones[u.seller_name] || '' }));
    changed = true;
  }
  for (const s of db.settings.sellers) { if (phones[s.name] && s.phone !== phones[s.name]) { s.phone = phones[s.name]; changed = true; } }
  // Equipos de colocación activos (responsables a quienes se les paga).
  const crews = ['Hugo Ramirez', 'Gastón Aguilera', 'Ariel Noruega', 'Fabián Ortiz'];
  if (JSON.stringify(db.settings.crews || []) !== JSON.stringify(crews)) { db.settings.crews = crews; changed = true; }
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

// Ensure auth state exists on older db.json files (for users who seeded before auth landed)
if (!Array.isArray(db.users) || db.users.length === 0) {
  const seedUsers = [
    { id: 'u-admin', email: 'info@pisospacific.com', name: 'Admin User',                password: 'admin123', role: 'admin',  seller_name: '' },
    { id: 'u-juan',  email: 'juan@pisospacific.com', name: 'Juan Rodriguez Momesso',    password: 'juan',     role: 'vendor', seller_name: 'Juan Rodriguez Momesso' },
    { id: 'u-vicky', email: 'vicky@pisospacific.com',name: 'Victoria Gonzalez Collado', password: 'vicky',    role: 'vendor', seller_name: 'Victoria Gonzalez Collado' },
  ].map(u => ({ id: u.id, email: u.email, name: u.name, role: u.role, seller_name: u.seller_name, password_hash: bcrypt.hashSync(u.password, 10) }));
  db.users = seedUsers;
  db.sessions = db.sessions ?? {};
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  console.log('Seeded default users into existing db.json');
}
if (!db.sessions) db.sessions = {};

// Backfill the imported business collections (cajas/suppliers/categories/cashflow) on
// older db.json files. Each loads from its seed if missing or empty.
for (const [key, file] of [['cajas','cajas.seed.json'],['suppliers','suppliers.seed.json'],['categories','categories.seed.json'],['cashflow','cashflow.seed.json']]) {
  if (!Array.isArray(db[key]) || db[key].length === 0) {
    try { db[key] = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', file), 'utf8')); }
    catch { if (!Array.isArray(db[key])) db[key] = []; }
  }
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

// Gate all /api/* except the auth endpoints and the public webhooks (Meta/MP call them).
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  if (req.path.startsWith('/whatsapp/webhook')) return next();
  if (req.path.startsWith('/instagram/webhook')) return next();
  if (req.path.startsWith('/mp/webhook')) return next();
  if (req.path.startsWith('/payment-links/') && req.path.endsWith('/simulate-paid')) return next();
  return requireAuth(req, res, next);
});

// Helper: append a stock movement (kept short)
function movement(type, ref, productId, sku, qty) {
  db.stock_movements.push({ ts: new Date().toISOString(), type, ref, product_id: productId, sku, qty });
}
function findProductByItem(it) {
  return db.products.find(p => p.id === it.product_id) || db.products.find(p => p.sku === it.sku);
}

// ---------- Mock REST endpoints ----------
// Committed stock per SKU = qty in non-finalized sales (material reservado, sin entregar).
function committedBySku() {
  const m = {};
  for (const s of db.sales) {
    if (s.status === 'Finalizado') continue;
    for (const it of s.items || []) { if (it && it.sku) m[it.sku] = (m[it.sku] || 0) + (Number(it.quantity) || 0); }
  }
  return m;
}
app.get('/api/products', (_, res) => {
  const committed = committedBySku();
  // Only meaningful for stock-tracked products (floors); services/extras carry no stock.
  res.json(db.products.map(p => ({ ...p, committed: p.stockTrack ? Math.round((committed[p.sku] || 0) * 100) / 100 : 0 })));
});

// Margin per sale (for dashboards): venta_neta = Σ(item.total) − discount_total; COGS = Σ(qty × item.cost locked).
function saleMargin(s) {
  let net = 0, cogs = 0, hasSku = false;
  for (const it of s.items || []) {
    if (!it || it.product_id === 'discount') continue;
    net += Number(it.total) || 0;
    cogs += (Number(it.quantity) || 0) * (Number(it.cost) || 0);
    if (it.sku) hasSku = true;
  }
  // Sin detalle SKU no hay costo real → margen no calculable (evita un 100% engañoso en dashboards).
  if (!hasSku) return { venta_neta: null, cogs: null, margin: null, margin_pct: null, has_sku_detail: false };
  net -= Number(s.discount_total) || 0;
  const margin = net - cogs;
  return { venta_neta: Math.round(net * 100) / 100, cogs: Math.round(cogs * 100) / 100, margin: Math.round(margin * 100) / 100, margin_pct: net ? Math.round((margin / net) * 1000) / 10 : null, has_sku_detail: true };
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
app.get('/api/conversations', (_, res) => {
  // Ship the conversations sorted by most-recent-message-first for free
  const sorted = [...db.conversations].sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''));
  res.json(sorted);
});
app.get('/api/conversations/:id/messages', (req, res) => {
  const msgs = db.messages.filter(m => m.conversation_id === req.params.id).sort((a, b) => a.ts.localeCompare(b.ts));
  res.json(msgs);
});
app.post('/api/conversations/:id/messages', (req, res) => {
  const conv = db.conversations.find(c => c.id === req.params.id);
  if (!conv) return res.sendStatus(404);
  const body = String(req.body?.body ?? '').trim();
  if (!body) return res.status(400).json({ error: 'empty body' });
  const msg = {
    id: `m-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    conversation_id: conv.id,
    direction: 'out',
    body,
    ts: new Date().toISOString(),
    status: 'sent',
    template_name: req.body?.template_name ?? undefined,
  };
  db.messages.push(msg);
  conv.last_message_at = msg.ts;
  conv.last_message_preview = body.slice(0, 140);
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
app.get('/api/templates', (_, res) => res.json(db.templates));

// Webhook stubs — Meta posts here when integration goes live.
// For now: Meta verification challenge handler + a no-op POST that just logs.
app.get('/api/whatsapp/webhook', (req, res) => {
  // Meta verification handshake
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token && token === process.env.META_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});
app.post('/api/whatsapp/webhook',  (req, res) => { console.log('[whatsapp:inbound]', JSON.stringify(req.body).slice(0, 400)); res.sendStatus(200); });
app.get ('/api/instagram/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token && token === process.env.META_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});
app.post('/api/instagram/webhook', (req, res) => { console.log('[instagram:inbound]', JSON.stringify(req.body).slice(0, 400)); res.sendStatus(200); });
app.get('/api/settings', (_, res) => res.json(db.settings));
app.patch('/api/settings', (req, res) => {
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
app.post('/api/containers', (req, res) => {
  const c = { id: req.body.id ?? `local-${Date.now()}`, status: 'in_transit', items: [], ...req.body };
  db.containers.push(c);
  save();
  res.json(c);
});
app.patch('/api/containers/:id', (req, res) => {
  const i = db.containers.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.sendStatus(404);
  db.containers[i] = { ...db.containers[i], ...req.body };
  save();
  res.json(db.containers[i]);
});
app.post('/api/containers/:id/receive', (req, res) => {
  const c = db.containers.find(x => x.id === req.params.id);
  if (!c) return res.sendStatus(404);
  if (c.status === 'received') return res.status(409).json({ error: 'already received' });
  for (const item of (c.items || [])) {
    const p = findProductByItem(item);
    if (!p) continue;
    p.stock = (Number(p.stock) || 0) + (Number(item.quantity) || 0);
    movement('container_receive', c.id, p.id, p.sku, item.quantity);
  }
  c.status = 'received';
  c.received_at = new Date().toISOString();
  save();
  res.json(c);
});
app.get('/api/stock_movements', (_, res) => res.json(db.stock_movements));

// ---------- Generic CRUD (POST/PATCH/DELETE) with persistence ----------
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

['products','sales','quotes','clients','expenses','leads','conversations','tasks','cajas','suppliers','categories','cashflow'].forEach(name => {
  app.post(`/api/${name}`, (req, res) => {
    const id = req.body.id ?? `local-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    const row = { id, ...req.body };
    db[name].push(row);
    save();
    res.json(row);
  });
  app.patch(`/api/${name}/:id`, (req, res) => {
    const i = db[name].findIndex(x => x.id === req.params.id);
    if (i < 0) return res.sendStatus(404);
    db[name][i] = { ...db[name][i], ...req.body };
    save();
    res.json(db[name][i]);
  });
  app.delete(`/api/${name}/:id`, (req, res) => {
    db[name] = db[name].filter(x => x.id !== req.params.id);
    save();
    res.sendStatus(204);
  });
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

  // Entering Finalizado → deduct from stock, clear reservation
  if (next === 'Finalizado' && !s.stock_deducted) {
    for (const it of (s.items || [])) {
      const p = findProductByItem(it); if (!p) continue;
      const qty = Number(it.quantity) || 0;
      p.stock = Math.max(0, (Number(p.stock) || 0) - qty);
      if (s.stock_reserved) p.reservedStock = Math.max(0, (Number(p.reservedStock) || 0) - qty);
      movement('sale_deduct', s.id, p.id, p.sku, -qty);
    }
    s.stock_reserved = false;
    s.stock_deducted = true;
  }

  // Cancelling a non-finalized sale → release reservation
  if (next === 'Cancelado' && s.stock_reserved && !s.stock_deducted) {
    for (const it of (s.items || [])) {
      const p = findProductByItem(it); if (!p) continue;
      const qty = Number(it.quantity) || 0;
      p.reservedStock = Math.max(0, (Number(p.reservedStock) || 0) - qty);
      movement('sale_cancel_release', s.id, p.id, p.sku, -qty);
    }
    s.stock_reserved = false;
  }

  s.status = next;
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
  const saleId = `local-sale-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
  const sale = {
    id: saleId,
    quote_id: q.id,
    quote_number: q.quote_number,
    title: q.title,
    description: q.description,
    internal_notes: q.internal_notes ?? '',
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
  const base = {
    fecha,
    vendedor: sellerPhone ? `${rec.seller_name || ''} · ${sellerPhone}` : (rec.seller_name || ''),
    vendedor_short: rec.seller_name || '',
    cliente: rec.client_name || '',
    obra: rec.title || rec.client_address || '',
    obs: rec.public_notes || '',
    template: rec.pdf_template || db.settings.pdf_template || 'clasico',
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
function renderPdf(data, res, filename) {
  let done = false;
  const finish = (fn) => { if (done) return; done = true; clearTimeout(timer); fn(); };
  let py;
  try {
    py = spawn('python3', [path.join(__dirname, 'pdf', 'run_pdf.py')], { cwd: __dirname });
  } catch (e) {
    return res.status(500).json({ error: 'pdf engine unavailable', detail: String(e.message || e) });
  }
  const chunks = [], errs = [];
  // Kill a hung Python process so the request never blocks forever.
  const timer = setTimeout(() => { try { py.kill('SIGKILL'); } catch {} finish(() => res.status(504).json({ error: 'pdf generation timed out' })); }, 20000);
  py.on('error', (e) => finish(() => { console.error('pdf spawn error:', e.message); res.status(500).json({ error: 'pdf engine unavailable (python3/reportlab missing?)' }); }));
  py.stdout.on('data', d => chunks.push(d));
  py.stderr.on('data', d => errs.push(d));
  py.on('close', code => finish(() => {
    if (code !== 0) { console.error('pdf engine:', Buffer.concat(errs).toString()); return res.status(500).json({ error: 'pdf generation failed' }); }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(Buffer.concat(chunks));
  }));
  try { py.stdin.write(JSON.stringify(data)); py.stdin.end(); } catch { /* error event will fire */ }
}
app.get('/api/quotes/:id/pdf', (req, res) => {
  const q = db.quotes.find(x => x.id === req.params.id);
  if (!q) return res.sendStatus(404);
  renderPdf(presupuestoData(q), res, `Presupuesto_${(q.client_name || 'Pacific').replace(/[^\w]+/g, '_')}.pdf`);
});
app.get('/api/sales/:id/pdf', (req, res) => {
  const s = db.sales.find(x => x.id === req.params.id);
  if (!s) return res.sendStatus(404);
  renderPdf(presupuestoData(s), res, `Presupuesto_${(s.client_name || 'Pacific').replace(/[^\w]+/g, '_')}.pdf`);
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
    rows, template: rec.pdf_template || db.settings.pdf_template || 'clasico',
  };
}
app.get('/api/sales/:id/remito', (req, res) => {
  const s = db.sales.find(x => x.id === req.params.id);
  if (!s) return res.sendStatus(404);
  renderPdf(remitoData(s), res, `Remito_${(s.client_name || 'Pacific').replace(/[^\w]+/g, '_')}.pdf`);
});

// ---------- Brand logos (committed in assets/branding/) ----------
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
const SPA_ROUTES = ['/', '/dashboard', '/inventario', '/cotizaciones', '/ventas', '/agenda', '/gastos', '/clientes', '/movimientos', '/leads', '/mensajes', '/reportes', '/configuracion', '/cajas', '/proveedores', '/cashflow'];
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
