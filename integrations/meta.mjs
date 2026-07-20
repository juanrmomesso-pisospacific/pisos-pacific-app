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
import { findSupplierMatch, suggestSuppliers } from './supplier-match.mjs';
import { handleTaskMessage } from './task-bot.mjs';
import { touchConv } from './conv.mjs';
import { withTimeout } from './http.mjs';

const GRAPH = 'https://graph.facebook.com/v21.0';

// Resuelve el @usuario de una cuenta de Instagram a partir de su ID (best-effort).
async function igUsername(igId) {
  const token = process.env.IG_TOKEN;
  if (!token) return null;
  try {
    const r = await fetch(`https://graph.instagram.com/v21.0/${igId}?fields=username,name&access_token=${encodeURIComponent(token)}`, withTimeout());
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
    // Recibos de entrega: actualizar el estado del saliente (enviado→entregado→leído).
    const statuses = payload?.entry?.[0]?.changes?.[0]?.value?.statuses;
    if (Array.isArray(statuses) && statuses.length) {
      const rank = { sent: 1, delivered: 2, read: 3 };
      let changed = false;
      for (const st of statuses) {
        const m = db.messages.find((x) => x.wa_id === st.id);
        if (!m) continue;
        if (st.status === 'failed') { if (m.status !== 'failed') { m.status = 'failed'; changed = true; } }
        else if ((rank[st.status] || 0) > (rank[m.status] || 0)) { m.status = st.status; changed = true; }
      }
      if (changed) save();
      return null;
    }
  }
  // Instagram: "eco" de un mensaje que mandó el negocio (incluido desde la app del celular)
  // → espejarlo como SALIENTE en la conversación. Dedup: por mid ya registrado (lo mandó la
  // plataforma) o por un saliente reciente con el mismo texto (±2 min) para no duplicar.
  if (channel === 'instagram') {
    const e = payload?.entry?.[0]?.messaging?.[0];
    if (e?.message?.is_echo) {
      const mid = e.message.mid;
      const toId = e.recipient?.id;
      const text = e.message.text || (Array.isArray(e.message.attachments) && e.message.attachments.length ? '📎 Adjunto' : '');
      if (!text || !toId) return null;
      if (mid && db.messages.some((m) => m.wa_id === mid)) return null;   // ya lo registró la plataforma
      const conv = db.conversations.find((c) => c.channel === 'instagram' && c.contact_id === toId);
      if (!conv) return null;
      const ts = e.timestamp ? new Date(Number(e.timestamp)).toISOString() : new Date().toISOString();
      const tms = Date.parse(ts);
      const dup = db.messages.some((m) => m.conversation_id === conv.id && m.direction === 'out' && (m.body || '') === text && Math.abs(Date.parse(m.ts) - tms) < 2 * 60 * 1000);
      if (dup) return null;   // saliente equivalente reciente (lo mandó la app) → no duplicar
      const msg = { id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, conversation_id: conv.id, direction: 'out', body: text, ts, status: 'sent', wa_id: mid, via: 'ig-app' };
      db.messages.push(msg);
      touchConv(conv, 'out', ts, text); conv.unread_count = 0;
      save();
      return { conversation: conv, message: msg };
    }
  }
  // Anti-duplicados: Meta REINTENTA los webhooks → no procesar el mismo mensaje dos veces
  // (evita doble gasto de efectivo o mensaje repetido). Chequeo+marca son síncronos (sin await
  // en el medio) → a prueba de reintentos concurrentes. Va antes del bot de efectivo y del alta.
  const inId = channel === 'whatsapp'
    ? payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id
    : payload?.entry?.[0]?.messaging?.[0]?.message?.mid;
  if (inId) {
    db.settings = db.settings || {};
    const seen = db.settings.inbound_seen_ids = db.settings.inbound_seen_ids || [];
    if (seen.includes(inId)) return null;
    seen.push(inId);
    if (seen.length > 2000) db.settings.inbound_seen_ids = seen.slice(-2000);
  }
  if (channel === 'whatsapp') {
    // Mensajes del EQUIPO (allowlist): NUNCA crean lead/conversación. Router: si es un gasto
    // explícito o hay una carga de gasto en curso → bot de gastos (como siempre); todo lo demás
    // va al bot de TAREAS (lenguaje natural — integrations/task-bot.mjs).
    const m = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (m && isAllowed(db, m.from)) {
      const text = m.text?.body || '';
      if (isCashMessage(db, m.from, text)) return handleCashReport(db, save, m.from, text);
      return handleTaskMessage(db, save, m.from, text, {
        reply: (msg) => sendOutbound('whatsapp', m.from, msg).catch(() => { /* best-effort */ }),
        handleExpense: () => handleCashReport(db, save, m.from, text),
      });
    }
  }
  const parsed = channel === 'whatsapp' ? parseWhatsApp(payload) : parseInstagram(payload);
  if (!parsed) return null;
  const { contactId, ts } = parsed;
  // Atribución de campaña: si el mensaje vino de un anuncio (click-to-WhatsApp), dejarlo
  // VISIBLE en el hilo — el vendedor sabe al toque qué anuncio trajo al cliente.
  const text = parsed.referral
    ? `${parsed.text}\n🎯 Vino del anuncio${parsed.referral.headline ? `: "${parsed.referral.headline}"` : ''}`
    : parsed.text;
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
  // Atribución de campaña en el LEAD: la fuente pasa de la genérica ("WhatsApp") al anuncio
  // concreto. Vale también para conversaciones existentes (un contacto viejo que clickea el
  // anuncio nuevo cuenta para la campaña). El ctwa_clid queda para cruzar con Meta Ads.
  if (parsed.referral && conv.linked_lead_id) {
    const lead = db.leads.find((l) => l.id === conv.linked_lead_id);
    if (lead) {
      const tag = `Anuncio${parsed.referral.headline ? ` — "${parsed.referral.headline}"` : ''} (${parsed.referral.source_type || 'ad'})`;
      if (!lead.source || /^(whatsapp|instagram)$/i.test(lead.source)) lead.source = tag;
      const nota = `[${ts.slice(0, 10)}] Click en anuncio: ${parsed.referral.headline || '(sin título)'}${parsed.referral.source_url ? ` · ${parsed.referral.source_url}` : ''}${parsed.referral.ctwa_clid ? ` · ctwa:${parsed.referral.ctwa_clid}` : ''}`;
      if (!(lead.notes || '').includes(parsed.referral.ctwa_clid || nota)) lead.notes = [(lead.notes || ''), nota].filter(Boolean).join('\n');
    }
    conv.referral = parsed.referral;
  }

  const msg = {
    id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    conversation_id: conv.id, direction: 'in', body: text, ts, status: 'received',
    ...(parsed.media ? { media: parsed.media } : {}),   // descriptor temporal; server.js baja y guarda
    ...(parsed.raw ? { raw: parsed.raw } : {}),         // crudo de tipos no soportados (diagnóstico)
  };
  db.messages.push(msg);
  // Rescate de mensajes que Meta NO entrega por API (encuestas, fotos "ver una sola vez"):
  // sin esto el hilo queda mudo y el lead se pierde. Auto-respuesta pidiendo el reenvío,
  // 1 vez por día por conversación (throttle) y solo dentro de la ventana del entrante.
  if (channel === 'whatsapp' && parsed.unsupported) {
    const last = conv.last_unsupported_reply_at ? Date.parse(conv.last_unsupported_reply_at) : 0;
    if (Date.now() - last > 24 * 3600e3) {
      conv.last_unsupported_reply_at = new Date().toISOString();
      const disculpa = '¡Hola! Me llegó tu mensaje pero WhatsApp no me deja abrirlo (suele pasar con encuestas o fotos de "ver una sola vez" 🙈). ¿Me lo reenviás como texto o foto común? ¡Gracias!';
      sendOutbound('whatsapp', contactId, disculpa)
        .then(() => {
          // Registrar el saliente SIN touchConv: la conversación sigue PENDIENTE (el auto-reply
          // no cuenta como respuesta del vendedor — el seguimiento humano sigue debido).
          db.messages.push({ id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, conversation_id: conv.id, direction: 'out', body: disculpa, ts: new Date().toISOString(), status: 'sent', via: 'auto-unsupported' });
          save();
        })
        .catch(() => { /* best-effort */ });
    }
  }
  // Anti-enterrado: si el entrante llega FUERA DE ORDEN (ts viejo — típico de un webhook
  // demorado/reintentado por Meta durante un deploy), touchConv no lo subiría y quedaría
  // enterrado en la bandeja. En vivo igual tiene que verse: lo surfaceamos por hora de LLEGADA
  // y lo marcamos pendiente. El globo del chat sigue mostrando la hora real (msg.ts).
  const surfaced = !conv.last_message_at || ts >= conv.last_message_at;
  touchConv(conv, 'in', ts, text);
  if (!surfaced) {
    conv.last_message_at = new Date().toISOString();
    conv.last_message_preview = String(text).slice(0, 140);
    conv.last_message_direction = 'in';
  }
  conv.unread_count = (conv.unread_count || 0) + 1;
  // Reabrir al recibir — SALVO que se haya ignorado a mano (banco/robots): el mensaje se
  // registra igual pero la conversación no vuelve a la bandeja ni cuenta como pendiente.
  if (conv.status === 'closed' && !conv.ignored) conv.status = 'open';
  save();
  return { conversation: conv, message: msg };
}

// Etiqueta legible para mensajes que NO son texto (foto, audio, doc, etc.) — así el
// mensaje aparece en el hilo en vez de descartarse.
function waMediaLabel(m) {
  switch (m.type) {
    case 'image':    return '📷 Foto' + (m.image?.caption ? ': ' + m.image.caption : '');
    case 'document': return '📄 ' + (m.document?.filename || 'Documento') + (m.document?.caption ? ' — ' + m.document.caption : '');
    case 'audio':    return '🎤 Audio';
    case 'video':    return '🎥 Video' + (m.video?.caption ? ': ' + m.video.caption : '');
    case 'sticker':  return '🩷 Sticker';
    // Ubicación con link a Maps (útil para calificar por zona en campañas).
    case 'location': {
      const l = m.location || {};
      const link = (l.latitude != null && l.longitude != null) ? ` https://maps.google.com/?q=${l.latitude},${l.longitude}` : '';
      return '📍 Ubicación' + (l.name ? ': ' + l.name : '') + (l.address ? ` (${l.address})` : '') + link;
    }
    case 'contacts': {
      const c = Array.isArray(m.contacts) ? m.contacts[0] : null;
      const nm = c?.name?.formatted_name || '';
      const ph = c?.phones?.[0]?.phone || '';
      return '👤 Contacto compartido' + (nm ? `: ${nm}` : '') + (ph ? ` · ${ph}` : '');
    }
    // Respuestas a botones/listas (plantillas o mensajes interactivos): el texto elegido.
    case 'interactive': return m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '📎 Respuesta interactiva';
    case 'button':      return m.button?.text || '📎 Respuesta de botón';
    // Meta NO entrega el contenido de estos tipos por API (encuestas, fotos "ver una sola vez").
    case 'unsupported': return '📎 Mensaje que WhatsApp no entrega por API (encuesta / foto de una sola vez) — se le pidió al cliente que lo reenvíe';
    default:         return `📎 Mensaje (${m.type})`;
  }
}
function parseWhatsApp(payload) {
  try {
    const value = payload?.entry?.[0]?.changes?.[0]?.value;
    const m = value?.messages?.[0];
    if (!m) return null;   // p. ej. payloads de 'statuses' (entregado/leído) no traen messages
    const contact = value?.contacts?.[0];
    const text = m.type === 'text' ? (m.text?.body || '') : waMediaLabel(m);
    // Media de WhatsApp: viene como id → se resuelve/baja con el token (en server.js).
    const mediaNode = m.image || m.video || m.audio || m.document || m.sticker;
    const media = (mediaNode?.id) ? { source: 'wa-id', mediaId: mediaNode.id, mime: mediaNode.mime_type || '', kind: m.type } : null;
    // Atribución de anuncios click-to-WhatsApp (campañas IG/FB): Meta manda `referral` en el
    // PRIMER mensaje que llega desde el anuncio → de qué anuncio vino el lead.
    const r = m.referral;
    const referral = r ? { source_type: r.source_type || '', headline: r.headline || '', source_url: r.source_url || '', ctwa_clid: r.ctwa_clid || '' } : null;
    return {
      contactId: m.from,
      contactName: contact?.profile?.name || null,
      text, media, referral,
      unsupported: m.type === 'unsupported',
      raw: (m.type === 'unsupported' || !/^(text|image|document|audio|video|sticker|location|contacts|interactive|button|reaction)$/.test(m.type || '')) ? m : null,
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
// Compartidos entre el router (isCashMessage) y handleCashReport — una sola fuente para que
// el router y el bot de gastos no diverjan si se ajusta la regex o el TTL.
const CASH_TTL_MS = 5 * 60 * 1000;
const looksLikeNewExpense = (t) => /^\s*(gasto|gast[eé])\b/i.test(t) || /^\s*\$?\s*\d[\d.,]*\s*(usd|u\$s|pesos?|ars)?\s*$/i.test(t);
const cashSessionFresh = (s) => !!(s?.ts && Date.now() - s.ts < CASH_TTL_MS);
const cashInProgress = (s) => !!(s && !s.last_mov_id && (s.amount || s.description || s.cp_choosing));

// Router equipo: ¿este mensaje es para el bot de GASTOS? (gasto explícito, solo-monto,
// "cancelar" del último gasto, o una carga de gasto en curso). Lo demás → bot de tareas.
export function isCashMessage(db, from, text) {
  const t = String(text || '').trim();
  if (looksLikeNewExpense(t)) return true;                                    // gasto explícito o solo-monto
  const s = db.settings?.cash_sessions?.[normalizePhone(from)];
  if (cashSessionFresh(s) && cashInProgress(s)) return true;                  // carga de gasto a medias
  if (/^\s*cancelar\b/i.test(t) && cashSessionFresh(s) && s.last_mov_id) return true;   // deshacer el último gasto
  return false;
}

async function handleCashReport(db, save, from, rawText) {
  db.settings = db.settings || {};
  const sessions = db.settings.cash_sessions = db.settings.cash_sessions || {};
  const norm = normalizePhone(from);
  const text = String(rawText || '').trim();
  const reply = async (msg) => { try { await sendOutbound('whatsapp', from, msg); } catch { /* envío best-effort */ } return msg; };
  let s = sessions[norm] || {};
  // TTL: una carga incompleta que quedó >5 min sin actividad se descarta y se avisa por el chat
  // (evita que un mensaje nuevo se consuma como descripción/proveedor de un reporte abandonado).
  let expiredNotice = false;
  if (s.ts && cashInProgress(s) && !cashSessionFresh(s)) {
    expiredNotice = true; s = {};
  }

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

  if (expiredNotice) await reply('⏱️ Expiró la carga (pasaron más de 5 min sin respuesta). Arrancamos de nuevo.');

  // Un gasto NUEVO explícito (empieza con "gasto" o es SOLO un monto, ej. "$970.000") reinicia una
  // sesión a medio completar → así no se toma ese monto como la descripción o el proveedor de un
  // reporte anterior abandonado (bug reportado: "$970.000" preguntaba "No tengo a $970.000 registrado").
  if (looksLikeNewExpense(text) && !s.cp_choosing && (s.amount || s.description)) s = {};
  s.ts = Date.now();   // refrescar actividad (para el TTL)

  // Si estamos esperando que elija el proveedor entre opciones (A/B/C… / nuevo / ninguno).
  if (s.cp_choosing) {
    const a = text.trim().toLowerCase();
    if (/^(ninguno|ningun|nadie|no|-+|n\/?a|s\/?d)$/i.test(a)) {
      s.counterparty = null; s.supplier_id = null; s.cp_choosing = false;
    } else if (/^(nuevo|nueva|crear|crea|cre)$/i.test(a)) {
      const sup = findOrCreateSupplier(db, s.cp_typed);
      s.counterparty = sup.name; s.supplier_id = sup.id; s.cp_choosing = false;
    } else {
      const opts = s.cp_options || [];
      const idx = 'abcdefgh'.indexOf(a[0]);
      const chosen = idx >= 0 && opts[idx] ? db.suppliers.find((x) => x.id === opts[idx]) : null;
      if (chosen) { s.counterparty = chosen.name; s.supplier_id = chosen.id; s.cp_choosing = false; }
      else { sessions[norm] = s; save(); return reply(cpOptionsMsg(s.cp_typed, s.cp_options, db)); }
    }
    s.cp_typed = undefined; s.cp_options = undefined;
  }

  // Consumir el mensaje en el primer campo que falta: monto → descripción → proveedor.
  if (!s.amount) {
    const p = parseCashCommand(text);
    if (p.amount) { s.amount = p.amount; s.currency = p.currency || 'ARS'; }
    if (!s.description && p.description) s.description = p.description;   // primer mensaje combinado
  } else if (!s.description) {
    s.description = text.replace(/^\s*gasto\b[:\s]*/i, '').trim();
  } else if (s.counterparty === undefined && !s.cp_choosing) {
    const ans = text.trim();
    if (/^(ninguno|ningun|nadie|no|-+|n\/?a|s\/?d)$/i.test(ans)) {
      s.counterparty = null; s.supplier_id = null;
    } else {
      const match = findSupplierMatch(db.suppliers, ans);
      if (match) { s.counterparty = match.name; s.supplier_id = match.id; }   // existe exacto → usar
      else {
        // No existe: ofrecer opciones (parecidos) o crear nuevo → NO duplica sin que decida.
        const sugg = suggestSuppliers(db.suppliers, ans, 5);
        s.cp_choosing = true; s.cp_typed = ans; s.cp_options = sugg.map((x) => x.id);
        sessions[norm] = s; save();
        return reply(sugg.length
          ? cpOptionsMsg(ans, s.cp_options, db)
          : `No tengo a *${ans}* registrado ni encontré parecidos.\nRespondé *nuevo* para crearlo como proveedor, o *ninguno*.`);
      }
    }
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
  if (s.counterparty === undefined && !s.cp_choosing) {
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
    counterparty: s.counterparty || null, counterparty_type: 'supplier', client_id: null, supplier_id: s.supplier_id || null,
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

// Mensaje con las opciones de proveedor (A/B/C…) cuando el nombre tipeado no existe exacto.
function cpOptionsMsg(typed, optionIds, db) {
  const letters = 'ABCDEFGH';
  const lines = (optionIds || []).map((id, i) => {
    const s = db.suppliers.find((x) => x.id === id);
    return s ? `${letters[i]}) ${s.name}` : null;
  }).filter(Boolean);
  return `No tengo a *${typed}* registrado. ¿Cuál es? Respondé la letra:\n${lines.join('\n')}\n\nO *nuevo* para crearlo como proveedor, o *ninguno*.`;
}

// Busca un proveedor por nombre normalizado; si no existe, lo crea (sin duplicar).
function findOrCreateSupplier(db, name) {
  const existing = findSupplierMatch(db.suppliers, name);
  if (existing) return existing;
  const sup = { id: `PROV-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name: String(name || '').trim(), type: 'supplier', active: true, stock_code: null, category_default: null, notes: null };
  db.suppliers.push(sup);
  return sup;
}

function parseInstagram(payload) {
  try {
    const e = payload?.entry?.[0]?.messaging?.[0];
    if (!e || e.message?.is_echo) return null;   // sin evento, o eco de nuestros propios salientes
    const m = e.message;
    let text = m?.text || '';
    let media = null;
    // Fotos/videos/audios/historias compartidas: vienen como attachments con una URL
    // pública (firmada, TEMPORAL) → se baja y guarda en server.js para que quede en el chat.
    if (!text && Array.isArray(m?.attachments) && m.attachments.length) {
      const a = m.attachments[0];
      const url = a?.payload?.url || '';
      text = a.type === 'image' ? '📷 Foto'
        : a.type === 'video' ? '🎥 Video'
        : a.type === 'audio' ? '🎤 Audio'
        : a.type === 'share' ? '🔗 Publicación compartida'
        : a.type === 'story_mention' ? '📲 Te mencionó en una historia'
        : a.type === 'story_reply' ? '💬 Respuesta a tu historia'
        : (url ? '📷 Foto' : '📎 Adjunto');   // si hay URL, asumimos imagen (IG manda fotos así)
      if (url) media = { source: 'ig-url', url, kind: a.type || 'image' };
    }
    if (!text && e.reaction) text = `↩️ Reaccionó: ${e.reaction.emoji || ''}`;
    if (!text || !e.sender?.id) return null;
    return { contactId: e.sender.id, contactName: null, text, media, ts: e.timestamp ? new Date(Number(e.timestamp)).toISOString() : new Date().toISOString() };
  } catch { return null; }
}

// ---------- SALIENTE ----------
// Despacho único por canal (WhatsApp/Instagram por Meta, email por Gmail).
import { sendMail } from './mailer.mjs';
export async function sendOutbound(channel, to, text, opts = {}) {
  if (channel === 'whatsapp') return sendWhatsApp(to, text);
  if (channel === 'instagram') return sendInstagram(to, text);
  if (channel === 'email') return sendMail({ to, subject: opts.subject || 'Pisos Pacific', text, html: opts.html, attachments: opts.attachments });
  return { sent: false, reason: 'canal sin envío automático' };
}

async function sendWhatsApp(to, text) {
  const token = process.env.WHATSAPP_TOKEN, phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) return { sent: false, reason: 'faltan WHATSAPP_TOKEN / WHATSAPP_PHONE_ID' };
  const r = await fetch(`${GRAPH}/${phoneId}/messages`, withTimeout({
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
  }));
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
    const up = await fetch(`${GRAPH}/${phoneId}/media`, withTimeout({ method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd }));
    const uj = await up.json().catch(() => ({}));
    if (!uj.id) return { sent: false, reason: 'no se pudo subir el PDF: ' + JSON.stringify(uj).slice(0, 160) };
    const r = await fetch(`${GRAPH}/${phoneId}/messages`, withTimeout({
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'document', document: { id: uj.id, filename, caption } }),
    }));
    const j = await r.json().catch(() => ({}));
    return r.ok ? { sent: true, id: j.messages?.[0]?.id } : { sent: false, reason: JSON.stringify(j).slice(0, 200) };
  } catch (e) { return { sent: false, reason: e.message }; }
}

// Instagram con login de Instagram (tokens IGAA…) usa graph.instagram.com, no graph.facebook.com.
const IG_GRAPH = 'https://graph.instagram.com/v21.0';
async function sendInstagram(to, text) {
  const token = process.env.IG_TOKEN;
  if (!token) return { sent: false, reason: 'falta IG_TOKEN' };
  const r = await fetch(`${IG_GRAPH}/me/messages?access_token=${encodeURIComponent(token)}`, withTimeout({
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: to }, message: { text } }),
  }));
  const j = await r.json().catch(() => ({}));
  return r.ok ? { sent: true, id: j.message_id } : { sent: false, reason: JSON.stringify(j).slice(0, 200) };
}
