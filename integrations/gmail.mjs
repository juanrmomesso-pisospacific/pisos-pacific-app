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

const ROBOT = /no[._-]?reply|noreply|notification|mailer-daemon|do[._-]?not[._-]?reply|security@|notice@|@email\.|@communications\.|@business-updates\.|@mail\.instagram|businessprofile/i;
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
export async function syncGmailLeads(db, save) {
  const at = await accessToken();
  const q = process.env.GMAIL_QUERY || 'in:inbox newer_than:14d -category:promotions -category:social';
  const H = { Authorization: `Bearer ${at}` };
  const list = await (await fetch(`${GMAIL}/messages?maxResults=40&q=${encodeURIComponent(q)}`, { headers: H })).json();
  const ids = (list.messages || []).map((m) => m.id);

  db.settings.gmail_seen_ids = db.settings.gmail_seen_ids || [];
  const seen = new Set(db.settings.gmail_seen_ids);
  const newIds = ids.filter((id) => !seen.has(id));
  const leadEmails = new Set((db.leads || []).map((l) => String(l.email || '').toLowerCase()).filter(Boolean));

  // Detalle de los mails nuevos en paralelo.
  const msgs = await Promise.all(newIds.map((id) =>
    fetch(`${GMAIL}/messages/${id}?format=full`, { headers: H }).then((r) => r.json()).catch(() => null)));

  let leads = 0, convs = 0;
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

    // --- Lead (si no existe) ---
    if (!leadEmails.has(contact.email)) {
      leadEmails.add(contact.email);
      db.leads.push({
        id: `lead-email-${msg.id.slice(0, 12)}`,
        name: contact.name, email: contact.email, phone: form?.phone || '',
        source: form ? 'Web' : 'Email',
        address: form?.address || '', approx_m2: form?.approx_m2 ?? null,
        needs_placement: form?.needs_placement ?? null, interested_products: [],
        notes: form ? form.notes : `Email: ${subject} — ${body.slice(0, 180)}`,
        status: 'New', assigned_seller: '', created_at: ts, last_touch_at: ts,
      });
      leads++;
    }

    // --- Conversación de canal email ---
    let conv = db.conversations.find((c) => c.channel === 'email' && c.contact_id === contact.email);
    if (!conv) {
      conv = {
        id: `conv-email-${msg.id.slice(0, 12)}`,
        channel: 'email', contact_id: contact.email, contact_name: contact.name,
        linked_client_name: null, status: 'open', unread_count: 0,
        last_message_at: ts, last_message_preview: '', email_subject: subject,
      };
      db.conversations.push(conv);
      convs++;
    }
    const preview = form
      ? `${form.notes}${form.address ? ' · ' + form.address : ''}`
      : body.slice(0, 1500);
    db.messages.push({
      id: `m-email-${msg.id.slice(0, 12)}`, conversation_id: conv.id,
      direction: 'in', body: `✉️ ${subject}\n\n${form ? preview : body.slice(0, 1500)}`, ts, status: 'received',
    });
    if (ts > (conv.last_message_at || '')) {
      conv.last_message_at = ts;
      conv.last_message_preview = (form ? preview : body).slice(0, 140);
    }
    conv.unread_count = (conv.unread_count || 0) + 1;
    if (conv.status === 'closed') conv.status = 'open';
  }

  db.settings.gmail_seen_ids = [...seen].slice(-800);    // cap del historial
  if (leads || convs || newIds.length) save();
  return { scanned: ids.length, nuevos: newIds.length, leads, conversaciones: convs };
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
