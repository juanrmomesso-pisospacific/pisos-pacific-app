// Integración Gmail para Leads (info@pisospacific.com): convierte emails entrantes
// en leads (source "Email") + conversación (channel "email"). Pensado para correr
// periódicamente o vía POST /api/integrations/gmail/sync.
//
// ENV requeridas (ver LAUNCH.md → "Conectar Gmail"):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET  (OAuth client de Google Cloud)
//   GMAIL_REFRESH_TOKEN                       (refresh token de info@pisospacific.com con scope gmail.readonly)
//   GMAIL_QUERY (opcional, default 'is:unread newer_than:7d -category:promotions -category:social')

const OAUTH = 'https://oauth2.googleapis.com/token';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function accessToken() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) throw new Error('faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GMAIL_REFRESH_TOKEN');
  const r = await fetch(OAUTH, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, refresh_token: GMAIL_REFRESH_TOKEN, grant_type: 'refresh_token' }) });
  const j = await r.json();
  if (!j.access_token) throw new Error('no se pudo refrescar token Gmail: ' + JSON.stringify(j).slice(0, 160));
  return j.access_token;
}

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
  let created = 0;
  for (const id of ids) {
    const msg = await (await fetch(`${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, { headers: H })).json();
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
