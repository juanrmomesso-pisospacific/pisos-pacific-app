// Integración Meta (WhatsApp Cloud API + Instagram Messaging) para Leads/Mensajes.
// - handleInbound: convierte el payload del webhook en conversación + mensaje (+ lead nuevo).
// - sendWhatsApp / sendInstagram: envío saliente (requiere tokens en env; si faltan, no-op).
//
// ENV requeridas para que funcione el envío e identificación:
//   WHATSAPP_TOKEN          (System User / permanent token)
//   WHATSAPP_PHONE_ID       (phone number id de WhatsApp Business)
//   IG_TOKEN                (page access token, para responder DMs de Instagram)
//   META_VERIFY_TOKEN       (string que elegís; se usa en el handshake del webhook)
// El entrante funciona sin tokens (Meta postea al webhook). El saliente los necesita.
//
// COEXISTENCE: el mismo número se usa en la app de WhatsApp Business del celular Y en la
// Cloud API a la vez. Cuando el dueño responde desde el celular, Meta manda un webhook
// `smb_message_echoes` → lo espejamos en la conversación como mensaje SALIENTE para que el
// dashboard quede sincronizado con lo que se contesta desde el teléfono.

import { parseCashCommand, inferType, normalizePhone } from '../import/cash-parse.mjs';
import { getBlueRate } from '../import/fx.mjs';
import { findLeadMatch } from './lead-match.mjs';

const GRAPH = 'https://graph.facebook.com/v21.0';

// Resuelve el @usuario de una cuenta de Instagram a partir de su ID (best-effort).
async function igUsername(igId) {
  const token = process.env.IG_TOKEN;
  if (!token) return null;
  try {
    const r = await fetch(`https://graph.instagram.com/v21.0/${igId}?fields=username,name&access_token=${encodeURIComponent(token)}`);
    const j = await r.json();
    return j.username ? '@' + j.username : (j.name || null);
  } catch { return null; }
}

// ---------- ENTRANTE ----------
// Devuelve {conversation, message} o null si el payload no trae un mensaje de texto.
export async function handleInbound(db, save, channel, payload) {
  // Coexistence: mensajes que el negocio mandó desde la app de WhatsApp del celular llegan
  // como "message echoes" → se espejan como salientes (no crean lead ni cuentan como no leído).
  if (channel === 'whatsapp') {
    const echo = parseWhatsAppEcho(payload);
    if (echo) return mirrorOutbound(db, save, channel, echo);
    // Reporte de gastos del equipo (allowlist): se rutea a Caja General, NUNCA crea lead/conversación.
    const m = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (m && isAllowed(db, m.from)) return handleCashReport(db, save, m.from, m.text?.body || '');
  }
  const parsed = channel === 'whatsapp' ? parseWhatsApp(payload) : parseInstagram(payload);
  if (!parsed) return null;
  const { contactId, text, ts } = parsed;
  let conv = db.conversations.find((c) => c.channel === channel && c.contact_id === contactId);
  // Resolver el nombre solo si hace falta: conversación nueva, o nombre todavía sin resolver
  // (Instagram solo manda el ID → buscamos el @usuario por API una sola vez).
  const needName = !conv || conv.contact_name === conv.contact_id;
  const contactName = needName ? (parsed.contactName || (channel === 'instagram' ? await igUsername(contactId) : null)) : null;

  if (!conv) {
    conv = {
      id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      channel, contact_id: contactId, contact_name: contactName || contactId,
      linked_client_name: null, linked_lead_id: null, status: 'open', unread_count: 0,
      last_message_at: ts, last_message_preview: '',
    };
    db.conversations.push(conv);
    // Reusar un lead existente (mismo teléfono/email/nombre) en vez de duplicar; si no hay, crear.
    const who = { name: contactName || contactId, phone: channel === 'whatsapp' ? contactId : '', email: '' };
    const match = findLeadMatch(db.leads, who);
    if (match) {
      conv.linked_lead_id = match.id;
      match.last_touch_at = ts;
    } else {
      const lead = {
        id: `lead-${channel}-${Date.now()}`, name: contactName || contactId,
        email: '', phone: channel === 'whatsapp' ? contactId : '',
        source: channel === 'whatsapp' ? 'WhatsApp' : 'Instagram',
        address: '', approx_m2: null, needs_placement: null, interested_products: [],
        notes: `Lead automático desde ${channel}`, status: 'New', assigned_seller: '',
        created_at: ts, last_touch_at: ts,
      };
      db.leads.push(lead);
      conv.linked_lead_id = lead.id;
    }
  } else if (contactName) {
    conv.contact_name = contactName;
  }

  const msg = {
    id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    conversation_id: conv.id, direction: 'in', body: text, ts, status: 'received',
  };
  db.messages.push(msg);
  conv.last_message_at = ts;
  conv.last_message_preview = text.slice(0, 140);
  conv.unread_count = (conv.unread_count || 0) + 1;
  if (conv.status === 'closed') conv.status = 'open';
  save();
  return { conversation: conv, message: msg };
}

function parseWhatsApp(payload) {
  try {
    const value = payload?.entry?.[0]?.changes?.[0]?.value;
    const m = value?.messages?.[0];
    if (!m || m.type !== 'text') return null;
    const contact = value?.contacts?.[0];
    return {
      contactId: m.from,
      contactName: contact?.profile?.name || null,
      text: m.text?.body || '',
      ts: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString(),
    };
  } catch { return null; }
}

// Coexistence: parsea el echo de un mensaje que el negocio envió desde la app del celular.
// `to` = teléfono del cliente al que se le respondió; `text.body` = contenido.
function parseWhatsAppEcho(payload) {
  try {
    const m = payload?.entry?.[0]?.changes?.[0]?.value?.message_echoes?.[0];
    if (!m || m.type !== 'text') return null;
    return {
      contactId: m.to,
      text: m.text?.body || '',
      ts: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString(),
      waId: m.id,
    };
  } catch { return null; }
}

// Inserta un mensaje saliente espejado (respuesta desde el celular). Deduplica por wa_id
// para tolerar reintentos del webhook. Si la conversación no existe (el negocio escribió
// primero desde el cel), la crea sin generar lead.
function mirrorOutbound(db, save, channel, { contactId, text, ts, waId }) {
  if (waId && db.messages.some((m) => m.wa_id === waId)) return null;
  let conv = db.conversations.find((c) => c.channel === channel && c.contact_id === contactId);
  if (!conv) {
    conv = {
      id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      channel, contact_id: contactId, contact_name: contactId,
      linked_client_name: null, status: 'open', unread_count: 0,
      last_message_at: ts, last_message_preview: '',
    };
    db.conversations.push(conv);
  }
  const msg = {
    id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    conversation_id: conv.id, direction: 'out', body: text, ts, status: 'sent',
    wa_id: waId, via: 'wa-app',
  };
  db.messages.push(msg);
  conv.last_message_at = ts;
  conv.last_message_preview = text.slice(0, 140);
  conv.unread_count = 0;   // responder (desde donde sea) deja la conversación al día
  save();
  return { conversation: conv, message: msg };
}

// ---------- REPORTE DE GASTOS POR WHATSAPP (allowlist del equipo) ----------
// Teléfonos habilitados: env CASH_ALLOWLIST (csv) + db.settings.cash_allowlist. Match por últimos 10 dígitos.
function isAllowed(db, from) {
  const norm = normalizePhone(from);
  if (!norm) return false;
  const fromDb = db.settings?.cash_allowlist || [];
  const fromEnv = (process.env.CASH_ALLOWLIST || '').split(',');
  const set = new Set([...fromDb, ...fromEnv].map(normalizePhone).filter(Boolean));
  return set.has(norm);
}

const fmtNum = (n) => Number(n).toLocaleString('es-AR');

// Conversación que repregunta hasta tener monto + descripción, registra en CAJ-005 y permite cancelar.
// Devuelve el texto de respuesta (también lo envía por WhatsApp). NUNCA crea lead ni conversación.
async function handleCashReport(db, save, from, rawText) {
  db.settings = db.settings || {};
  const sessions = db.settings.cash_sessions = db.settings.cash_sessions || {};
  const norm = normalizePhone(from);
  const text = String(rawText || '').trim();
  const reply = async (msg) => { try { await sendOutbound('whatsapp', from, msg); } catch { /* envío best-effort */ } return msg; };
  let s = sessions[norm] || {};

  if (/^\s*cancelar\b/i.test(text)) {
    if (s.last_mov_id) {
      const i = db.cashflow.findIndex((x) => x.id === s.last_mov_id);
      if (i >= 0) db.cashflow.splice(i, 1);
      delete sessions[norm]; save();
      return reply('🗑️ Listo, borré el último gasto.');
    }
    delete sessions[norm]; save();
    return reply('Cancelado. Cuando quieras: *gasto 29000 ferretería*');
  }

  if (s.last_mov_id) s = {};   // ya registró antes → nuevo mensaje arranca sesión limpia

  // Consumir el mensaje en el primer campo que falta: monto → descripción → proveedor.
  if (!s.amount) {
    const p = parseCashCommand(text);
    if (p.amount) { s.amount = p.amount; s.currency = p.currency || 'ARS'; }
    if (!s.description && p.description) s.description = p.description;   // primer mensaje combinado
  } else if (!s.description) {
    s.description = text.replace(/^\s*gasto\b[:\s]*/i, '').trim();
  } else if (s.counterparty === undefined) {
    const ans = text.trim();
    s.counterparty = /^(ninguno|ningun|nadie|no|-+|n\/?a|s\/?d)$/i.test(ans) ? null : (ans || null);
  }

  // Preguntar el primer campo que siga faltando.
  if (!s.amount) {
    sessions[norm] = s; save();
    return reply('¿Cuánto gastaste? Ej: *29000 ferretería* (agregá "usd" si fue en dólares).');
  }
  if (!s.description) {
    sessions[norm] = s; save();
    return reply(`Anoté $${fmtNum(s.amount)}${s.currency === 'USD' ? ' USD' : ''}. ¿En qué fue el gasto? (descripción)`);
  }
  if (s.counterparty === undefined) {
    sessions[norm] = s; save();
    return reply('¿A qué proveedor/quién se lo pagó? (nombre, o respondé *ninguno*)');
  }

  const currency = s.currency || 'ARS';
  const rate = await getBlueRate();
  const usd = currency === 'USD' ? s.amount : +(s.amount / rate).toFixed(2);
  const expense_type = inferType(s.description);
  const mov = {
    id: `mov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    date: new Date().toISOString(),
    flow: 'Egreso', caja_id: 'CAJ-005', caja_name: 'Caja General',
    category: null, subcategory: null,
    counterparty: s.counterparty || null, counterparty_type: 'supplier', client_id: null, supplier_id: null,
    description: s.description, sale_ref: null,
    currency, amount_ars: currency === 'USD' ? null : s.amount, amount_usd: usd,
    exchange_rate: currency === 'USD' ? null : rate,
    fixed_variable: 'Variable', expense_type,
    transfer: false, needs_review: false, review_reason: null,
    source: 'efectivo-whatsapp',
  };
  db.cashflow.push(mov);
  sessions[norm] = { last_mov_id: mov.id, ts: Date.now() };
  save();
  return reply(`✅ Registrado en Caja General: $${fmtNum(s.amount)}${currency === 'USD' ? ' USD' : ''} · ${s.description}${s.counterparty ? ' · ' + s.counterparty : ''} · ${expense_type}.\n(Si está mal, respondé *cancelar*.)`);
}

function parseInstagram(payload) {
  try {
    const e = payload?.entry?.[0]?.messaging?.[0];
    const text = e?.message?.text;
    if (!e || !text) return null;
    if (e.message?.is_echo) return null;   // eco de nuestros propios mensajes salientes
    return { contactId: e.sender?.id, contactName: null, text, ts: e.timestamp ? new Date(Number(e.timestamp)).toISOString() : new Date().toISOString() };
  } catch { return null; }
}

// ---------- SALIENTE ----------
// Despacho único por canal (WhatsApp/Instagram por Meta, email por Gmail).
import { sendMail } from './mailer.mjs';
export async function sendOutbound(channel, to, text, opts = {}) {
  if (channel === 'whatsapp') return sendWhatsApp(to, text);
  if (channel === 'instagram') return sendInstagram(to, text);
  if (channel === 'email') return sendMail({ to, subject: opts.subject || 'Pisos Pacific', text, html: opts.html });
  return { sent: false, reason: 'canal sin envío automático' };
}

async function sendWhatsApp(to, text) {
  const token = process.env.WHATSAPP_TOKEN, phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) return { sent: false, reason: 'faltan WHATSAPP_TOKEN / WHATSAPP_PHONE_ID' };
  const r = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
  });
  const j = await r.json().catch(() => ({}));
  return r.ok ? { sent: true, id: j.messages?.[0]?.id } : { sent: false, reason: JSON.stringify(j).slice(0, 200) };
}

// Envía un PDF (u otro documento) por WhatsApp: sube el media y manda el mensaje 'document'.
export async function sendWhatsAppDocument(to, buffer, filename, caption) {
  const token = process.env.WHATSAPP_TOKEN, phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) return { sent: false, reason: 'faltan WHATSAPP_TOKEN / WHATSAPP_PHONE_ID' };
  try {
    const fd = new FormData();
    fd.append('messaging_product', 'whatsapp');
    fd.append('type', 'application/pdf');
    fd.append('file', new Blob([buffer], { type: 'application/pdf' }), filename || 'documento.pdf');
    const up = await fetch(`${GRAPH}/${phoneId}/media`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    const uj = await up.json().catch(() => ({}));
    if (!uj.id) return { sent: false, reason: 'no se pudo subir el PDF: ' + JSON.stringify(uj).slice(0, 160) };
    const r = await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'document', document: { id: uj.id, filename, caption } }),
    });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { sent: true, id: j.messages?.[0]?.id } : { sent: false, reason: JSON.stringify(j).slice(0, 200) };
  } catch (e) { return { sent: false, reason: e.message }; }
}

// Instagram con login de Instagram (tokens IGAA…) usa graph.instagram.com, no graph.facebook.com.
const IG_GRAPH = 'https://graph.instagram.com/v21.0';
async function sendInstagram(to, text) {
  const token = process.env.IG_TOKEN;
  if (!token) return { sent: false, reason: 'falta IG_TOKEN' };
  const r = await fetch(`${IG_GRAPH}/me/messages?access_token=${encodeURIComponent(token)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: to }, message: { text } }),
  });
  const j = await r.json().catch(() => ({}));
  return r.ok ? { sent: true, id: j.message_id } : { sent: false, reason: JSON.stringify(j).slice(0, 200) };
}
