// Integración Gmail (info@pisospacific.com): convierte emails entrantes en
// LEADS + CONVERSACIONES (canal "email") para la página Mensajes.
// - Formularios web de Framer ("Pedido de Presupuesto"): se parsea el cuerpo
//   (Nombre/Email/Direccion/M2/Radio) → lead completo + conversación con el
//   email REAL del cliente (responder desde la app le escribe a él).
// - Emails humanos: lead + conversación por remitente.
// - Notificaciones automáticas (noreply, ads, etc.): se ignoran.
//
// ENV: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_REFRESH_TOKEN (lectura+envío
// de info@pisospacific.com), GMAIL_MP_REFRESH_TOKEN (infoacudesign, reportes MP).

import { refreshGoogleToken } from './google-oauth.mjs';
import { findLeadMatch } from './lead-match.mjs';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

const accessToken = (refreshToken = process.env.GMAIL_REFRESH_TOKEN) => refreshGoogleToken(refreshToken);

const parseFrom = (raw) => {
  const m = String(raw || '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
  if (m) return { name: m[1].trim() || m[2], email: m[2].trim().toLowerCase() };
  return { name: String(raw || '').trim(), email: String(raw || '').trim().toLowerCase() };
};

const b64urlToBuf = (s) => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// Recorre las partes MIME juntando adjuntos y el cuerpo text/plain.
function walkParts(part, out = { atts: [], text: '' }) {
  if (!part) return out;
  if (part.filename && part.body?.attachmentId) out.atts.push({ filename: part.filename, attachmentId: part.body.attachmentId, mime: part.mimeType });
  if (part.mimeType === 'text/plain' && part.body?.data && !out.text) out.text = b64urlToBuf(part.body.data).toString('utf8');
  for (const p of part.parts || []) walkParts(p, out);
  return out;
}

// Limpia los caracteres invisibles que algunos mailers meten (͏ ­ ​ etc.).
const cleanText = (s) => String(s || '').replace(/[͏​­ ‌‍]/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

const ROBOT = /no[._-]?reply|noreply|notification|mailer-daemon|do[._-]?not[._-]?reply|security@|notice@|invoice|statements?@|billing|facturaci|envios?\d*@|@email\.|@communications\.|@business-updates\.|@mail\.|businessprofile/i;
const CONSULTA = /presupuesto|cotizaci|consulta|pedido/i;

// Parsea el formulario web de Framer: "Nombre: X\nEmail: y\nDireccion: …\nM2: …\nRadio: …"
function parseFramerForm(text) {
  const grab = (label) => { const m = text.match(new RegExp(`${label}:\\s*(.+)`, 'i')); return m ? m[1].trim() : ''; };
  const email = (grab('Email').match(/[\w.+-]+@[\w.-]+\.\w+/) || [''])[0].toLowerCase();
  if (!email) return null;
  const m2 = parseFloat(grab('M2').replace(',', '.')) || null;
  const radio = grab('Radio');
  return {
    name: grab('Nombre') || email,
    email,
    phone: grab('Telefono') || grab('Teléfono') || '',
    address: grab('Direccion') || grab('Dirección') || '',
    approx_m2: m2,
    needs_placement: radio ? !/sin\s+colocaci/i.test(radio) : null,
    notes: `Formulario web — ${m2 ? m2 + 'm² · ' : ''}${radio || ''}`.trim(),
  };
}

// Sincroniza el inbox → leads + conversaciones de canal email. Idempotente
// (gmail_seen_ids + dedup de leads por email). db/save = la DB viva del server.
export async function syncGmailLeads(db, save, customQuery) {
  const at = await accessToken();
  const q = customQuery || process.env.GMAIL_QUERY || 'in:inbox newer_than:14d -category:promotions -category:social';
  const H = { Authorization: `Bearer ${at}` };
  const list = await (await fetch(`${GMAIL}/messages?maxResults=60&q=${encodeURIComponent(q)}`, { headers: H })).json();
  const ids = (list.messages || []).map((m) => m.id);

  db.settings.gmail_seen_ids = db.settings.gmail_seen_ids || [];
  const seen = new Set(db.settings.gmail_seen_ids);
  const newIds = ids.filter((id) => !seen.has(id));
  const leadEmails = new Set((db.leads || []).map((l) => String(l.email || '').toLowerCase()).filter(Boolean));

  // Detalle de los mails nuevos en paralelo.
  const msgs = await Promise.all(newIds.map((id) =>
    fetch(`${GMAIL}/messages/${id}?format=full`, { headers: H }).then((r) => r.json()).catch(() => null)));

  let leads = 0, convs = 0;
  const convByEmail = new Map(db.conversations.filter((c) => c.channel === 'email').map((c) => [c.contact_id, c]));
  for (const msg of msgs) {
    if (!msg?.id) continue;
    seen.add(msg.id);
    const headers = Object.fromEntries((msg.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value]));
    const sender = parseFrom(headers.from);
    if (!sender.email || /pisospacific\.com$/i.test(sender.email)) continue;   // propios/salientes
    const subject = headers.subject || '(sin asunto)';
    const ts = headers.date ? new Date(headers.date).toISOString() : new Date().toISOString();
    const { text } = walkParts(msg.payload);
    const body = cleanText(text) || msg.snippet || '';

    // ¿Es un formulario web (Framer u otro reenvío con "Pedido/Presupuesto")?
    const isForm = /framer\.com$/i.test(sender.email) && CONSULTA.test(subject);
    const form = isForm ? parseFramerForm(body) : null;
    if (ROBOT.test(sender.email) && !form && !CONSULTA.test(subject)) continue;  // notificación

    // Contacto real: el del formulario si existe; si no, el remitente.
    const contact = form
      ? { name: form.name, email: form.email }
      : { name: sender.name, email: sender.email };

    // --- Lead: reusar uno existente (email/teléfono/nombre) en vez de duplicar ---
    let lead = findLeadMatch(db.leads, { name: contact.name, email: contact.email, phone: form?.phone });
    if (!lead) {
      lead = {
        id: `lead-email-${msg.id.slice(0, 12)}`,
        name: contact.name, email: contact.email, phone: form?.phone || '',
        source: form ? 'Web' : 'Email',
        address: form?.address || '', approx_m2: form?.approx_m2 ?? null,
        needs_placement: form?.needs_placement ?? null, interested_products: [],
        notes: form ? form.notes : `Email: ${subject} — ${body.slice(0, 180)}`,
        status: 'New', assigned_seller: '', created_at: ts, last_touch_at: ts,
      };
      db.leads.push(lead);
      leadEmails.add(contact.email);
      leads++;
    } else { lead.last_touch_at = ts; }

    // --- Conversación de canal email ---
    let conv = convByEmail.get(contact.email);
    if (!conv) {
      conv = {
        id: `conv-email-${msg.id.slice(0, 12)}`,
        channel: 'email', contact_id: contact.email, contact_name: contact.name,
        linked_client_name: null, linked_lead_id: lead.id, status: 'open', unread_count: 0,
        last_message_at: '', last_message_preview: '', email_subject: subject,   // ts queda al sumar el 1er mensaje
      };
      db.conversations.push(conv);
      convByEmail.set(contact.email, conv);
      convs++;
    } else if (!conv.linked_lead_id) { conv.linked_lead_id = lead.id; }
    const msgBody = form
      ? `${form.notes}${form.address ? ' · ' + form.address : ''}`
      : body.slice(0, 1500);
    db.messages.push({
      id: `m-email-${msg.id.slice(0, 12)}`, conversation_id: conv.id,
      direction: 'in', body: `✉️ ${subject}\n\n${msgBody}`, ts, status: 'received',
    });
    if (ts > (conv.last_message_at || '')) {
      conv.last_message_at = ts;
      conv.last_message_preview = msgBody.slice(0, 140);
    }
    conv.unread_count = (conv.unread_count || 0) + 1;
    if (conv.status === 'closed') conv.status = 'open';
  }

  db.settings.gmail_seen_ids = [...seen].slice(-800);    // cap del historial
  if (leads || convs || newIds.length) save();
  return { scanned: ids.length, nuevos: newIds.length, leads, conversaciones: convs };
}

// Espeja los emails que MANDAMOS (carpeta Enviados) como mensajes salientes en las
// conversaciones de email existentes → así se ve el hilo completo (lo que respondiste
// directo desde Gmail, no solo desde la app). NO crea conversaciones nuevas.
// Dedup: por id de Gmail (gmail_sent_seen_ids) + heurística de tiempo para no duplicar
// los mails que la app ya registró al enviarlos (mailer también deja copia en Enviados).
export async function syncGmailSent(db, save, customQuery) {
  const at = await accessToken();
  const q = customQuery || 'in:sent newer_than:90d';
  const H = { Authorization: `Bearer ${at}` };
  const list = await (await fetch(`${GMAIL}/messages?maxResults=80&q=${encodeURIComponent(q)}`, { headers: H })).json();
  const ids = (list.messages || []).map((m) => m.id);

  db.settings.gmail_sent_seen_ids = db.settings.gmail_sent_seen_ids || [];
  const seen = new Set(db.settings.gmail_sent_seen_ids);
  const newIds = ids.filter((id) => !seen.has(id));
  const convByEmail = new Map(db.conversations.filter((c) => c.channel === 'email').map((c) => [String(c.contact_id || '').toLowerCase(), c]));
  // tiempos de salientes ya registrados por conversación (para no duplicar los de la app)
  const outTimes = new Map();
  for (const m of db.messages) if (m.direction === 'out') { const a = outTimes.get(m.conversation_id) || []; a.push(Date.parse(m.ts)); outTimes.set(m.conversation_id, a); }

  const msgs = await Promise.all(newIds.map((id) =>
    fetch(`${GMAIL}/messages/${id}?format=full`, { headers: H }).then((r) => r.json()).catch(() => null)));

  let mirrored = 0;
  for (const msg of msgs) {
    if (!msg?.id) continue;
    seen.add(msg.id);
    const headers = Object.fromEntries((msg.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value]));
    const toEmail = (String(headers.to || '').match(/[\w.+-]+@[\w.-]+\.\w+/) || [''])[0].toLowerCase();
    if (!toEmail || /pisospacific\.com$/i.test(toEmail)) continue;
    const conv = convByEmail.get(toEmail);
    if (!conv) continue;   // solo espejamos en conversaciones existentes
    const ts = headers.date ? new Date(headers.date).toISOString() : new Date().toISOString();
    // ¿ya hay un saliente de la app a ~este horario? → es el mismo mail, no duplicar
    if ((outTimes.get(conv.id) || []).some((t) => Math.abs(t - Date.parse(ts)) < 3 * 60 * 1000)) continue;
    const { text } = walkParts(msg.payload);
    const subject = headers.subject || '';
    const body = (cleanText(text) || msg.snippet || '').slice(0, 1500);
    db.messages.push({
      id: `m-emailout-${msg.id.slice(0, 12)}`, conversation_id: conv.id,
      direction: 'out', body: `✉️ ${subject}\n\n${body}`.trim(), ts, status: 'sent',
    });
    (outTimes.get(conv.id) || outTimes.set(conv.id, []).get(conv.id)).push(Date.parse(ts));
    if (ts > (conv.last_message_at || '')) { conv.last_message_at = ts; conv.last_message_preview = body.slice(0, 140); }
    mirrored++;
  }
  db.settings.gmail_sent_seen_ids = [...seen].slice(-1500);
  if (mirrored) save();
  return { scanned: ids.length, nuevos: newIds.length, espejados: mirrored };
}

// Junta los destinatarios (To/Cc) de la carpeta ENVIADOS → set de emails a los
// que ya les escribimos desde Gmail. Sirve para marcar "Contactado" leads viejos
// que respondimos por Gmail antes de que existiera la plataforma.
export async function listSentRecipients({ max = 800 } = {}) {
  const at = await accessToken();
  const H = { Authorization: `Bearer ${at}` };
  const recipients = new Set();
  let pageToken = '', fetched = 0;
  do {
    const url = `${GMAIL}/messages?maxResults=100&q=${encodeURIComponent('in:sent')}` + (pageToken ? `&pageToken=${pageToken}` : '');
    const list = await (await fetch(url, { headers: H })).json();
    const ids = (list.messages || []).map((m) => m.id);
    const metas = await Promise.all(ids.map((id) =>
      fetch(`${GMAIL}/messages/${id}?format=metadata&metadataHeaders=To&metadataHeaders=Cc`, { headers: H })
        .then((r) => r.json()).catch(() => null)));
    for (const m of metas) {
      const hs = Object.fromEntries((m?.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value]));
      for (const field of ['to', 'cc']) {
        for (const e of String(hs[field] || '').match(/[\w.+-]+@[\w.-]+\.\w+/g) || []) {
          const em = e.toLowerCase();
          if (!/pisospacific\.com$/i.test(em)) recipients.add(em);
        }
      }
    }
    fetched += ids.length;
    pageToken = list.nextPageToken;
  } while (pageToken && fetched < max);
  return recipients;
}

// ---- Reporte de MP por email (cuenta infoacudesign@gmail.com) ----
// Busca el mail de MP con el reporte adjunto (xlsx/csv) y devuelve el buffer.
// Nota: el reporte programado de MP suele llegar con LINK (sin adjunto) → found:false.
export async function fetchLatestMpReport({ query } = {}) {
  const at = await accessToken(process.env.GMAIL_MP_REFRESH_TOKEN);
  const H = { Authorization: `Bearer ${at}` };
  const q = query || 'from:(mercadopago.com OR mercadolibre.com) (reporte OR informe OR report OR transacciones OR liquidaci OR conciliar) newer_than:30d';
  const list = await (await fetch(`${GMAIL}/messages?maxResults=15&q=${encodeURIComponent(q)}`, { headers: H })).json();
  const ids = (list.messages || []).map((m) => m.id);
  const candidates = [];
  for (const id of ids) {
    const msg = await (await fetch(`${GMAIL}/messages/${id}?format=full`, { headers: H })).json();
    const headers = Object.fromEntries((msg.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value]));
    const { atts } = walkParts(msg.payload);
    const files = atts.filter((a) => /\.(xlsx|xls|csv)$/i.test(a.filename));
    candidates.push({ id, subject: headers.subject, date: headers.date, attachments: files.map((a) => a.filename), hasFile: files.length > 0 });
    if (files.length) {
      const a = files[0];
      const att = await (await fetch(`${GMAIL}/messages/${id}/attachments/${a.attachmentId}`, { headers: H })).json();
      return { found: true, buffer: b64urlToBuf(att.data), filename: a.filename, subject: headers.subject, date: headers.date };
    }
  }
  return { found: false, candidates };
}
