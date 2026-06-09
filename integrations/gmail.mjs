// Integración Gmail para Leads (info@pisospacific.com): convierte emails entrantes
// en leads (source "Email") + conversación (channel "email"). Pensado para correr
// periódicamente o vía POST /api/integrations/gmail/sync.
//
// ENV requeridas (ver LAUNCH.md → "Conectar Gmail"):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET  (OAuth client de Google Cloud)
//   GMAIL_REFRESH_TOKEN      (refresh token de info@pisospacific.com — leads)
//   GMAIL_MP_REFRESH_TOKEN   (refresh token de infoacudesign@gmail.com — reportes de MP)
//   GMAIL_QUERY (opcional)

import { refreshGoogleToken } from './google-oauth.mjs';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

// Access token a partir de un refresh token (default = el de leads).
const accessToken = (refreshToken = process.env.GMAIL_REFRESH_TOKEN) => refreshGoogleToken(refreshToken);

const parseFrom = (raw) => {
  const m = String(raw || '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
  if (m) return { name: m[1].trim() || m[2], email: m[2].trim().toLowerCase() };
  return { name: String(raw || '').trim(), email: String(raw || '').trim().toLowerCase() };
};

// Convierte emails recientes en leads. db = la DB en memoria; save = persistir.
export async function syncGmailLeads(db, save) {
  const at = await accessToken();
  const q = process.env.GMAIL_QUERY || 'is:unread newer_than:7d -category:promotions -category:social';
  const H = { Authorization: `Bearer ${at}` };
  const list = await (await fetch(`${GMAIL}/messages?maxResults=25&q=${encodeURIComponent(q)}`, { headers: H })).json();
  const ids = (list.messages || []).map((m) => m.id);
  const existingEmails = new Set((db.leads || []).map((l) => String(l.email || '').toLowerCase()).filter(Boolean));
  // Detalle de cada mail en paralelo (no en serie).
  const msgs = await Promise.all(ids.map((id) =>
    fetch(`${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, { headers: H }).then((r) => r.json())));
  let created = 0;
  for (const msg of msgs) {
    const id = msg.id;
    const headers = Object.fromEntries((msg.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value]));
    const { name, email } = parseFrom(headers.from);
    if (!email || existingEmails.has(email)) continue;
    // ignorar correos internos / propios
    if (/pisospacific\.com$/i.test(email)) continue;
    existingEmails.add(email);
    const ts = headers.date ? new Date(headers.date).toISOString() : new Date().toISOString();
    db.leads.push({
      id: `lead-email-${id.slice(0, 10)}`, name: name || email, email, phone: '',
      source: 'Email', address: '', approx_m2: null, needs_placement: null, interested_products: [],
      notes: `Email: ${headers.subject || '(sin asunto)'} — ${msg.snippet || ''}`.slice(0, 280),
      status: 'New', assigned_seller: '', created_at: ts, last_touch_at: ts,
    });
    created++;
  }
  if (created) save();
  return { scanned: ids.length, created };
}

// ---- Reporte de MP por email (cuenta infoacudesign@gmail.com) ----
// Busca el mail de MP con el reporte adjunto (xlsx/csv) y devuelve el buffer para
// pasarlo a parseStatement('mp'). Si MP manda link en vez de adjunto, devuelve los
// candidatos para inspeccionar el formato real.
const b64urlToBuf = (s) => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
function walkParts(part, out = []) {
  if (!part) return out;
  if (part.filename && part.body?.attachmentId) out.push({ filename: part.filename, attachmentId: part.body.attachmentId, mime: part.mimeType });
  for (const p of part.parts || []) walkParts(p, out);
  return out;
}

export async function fetchLatestMpReport({ query } = {}) {
  const at = await accessToken(process.env.GMAIL_MP_REFRESH_TOKEN);
  const H = { Authorization: `Bearer ${at}` };
  const q = query || 'from:(mercadopago.com OR mercadolibre.com) (reporte OR informe OR report OR transacciones OR liquidaci) newer_than:30d';
  const list = await (await fetch(`${GMAIL}/messages?maxResults=15&q=${encodeURIComponent(q)}`, { headers: H })).json();
  const ids = (list.messages || []).map((m) => m.id);
  const candidates = [];
  for (const id of ids) {
    const msg = await (await fetch(`${GMAIL}/messages/${id}?format=full`, { headers: H })).json();
    const headers = Object.fromEntries((msg.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value]));
    const atts = walkParts(msg.payload).filter((a) => /\.(xlsx|xls|csv)$/i.test(a.filename));
    candidates.push({ id, subject: headers.subject, date: headers.date, attachments: atts.map((a) => a.filename), hasFile: atts.length > 0 });
    if (atts.length) {
      const a = atts[0];
      const att = await (await fetch(`${GMAIL}/messages/${id}/attachments/${a.attachmentId}`, { headers: H })).json();
      return { found: true, buffer: b64urlToBuf(att.data), filename: a.filename, subject: headers.subject, date: headers.date };
    }
  }
  // Sin adjunto: devolvemos candidatos (MP suele mandar link de descarga → revisar formato real).
  return { found: false, candidates };
}
