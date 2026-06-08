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

const GRAPH = 'https://graph.facebook.com/v21.0';

// ---------- ENTRANTE ----------
// Devuelve {conversation, message} o null si el payload no trae un mensaje de texto.
export function handleInbound(db, save, channel, payload) {
  const parsed = channel === 'whatsapp' ? parseWhatsApp(payload) : parseInstagram(payload);
  if (!parsed) return null;
  const { contactId, contactName, text, ts } = parsed;

  let conv = db.conversations.find((c) => c.channel === channel && c.contact_id === contactId);
  if (!conv) {
    conv = {
      id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      channel, contact_id: contactId, contact_name: contactName || contactId,
      linked_client_name: null, status: 'open', unread_count: 0,
      last_message_at: ts, last_message_preview: '',
    };
    db.conversations.push(conv);
    // lead nuevo desde un primer contacto entrante
    db.leads.push({
      id: `lead-${channel}-${Date.now()}`, name: contactName || contactId,
      email: '', phone: channel === 'whatsapp' ? contactId : '',
      source: channel === 'whatsapp' ? 'WhatsApp' : 'Instagram',
      address: '', approx_m2: null, needs_placement: null, interested_products: [],
      notes: `Lead automático desde ${channel}`, status: 'New', assigned_seller: '',
      created_at: ts, last_touch_at: ts,
    });
  } else if (contactName && conv.contact_name === conv.contact_id) {
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

function parseInstagram(payload) {
  try {
    const e = payload?.entry?.[0]?.messaging?.[0];
    const text = e?.message?.text;
    if (!e || !text) return null;
    return { contactId: e.sender?.id, contactName: null, text, ts: e.timestamp ? new Date(Number(e.timestamp)).toISOString() : new Date().toISOString() };
  } catch { return null; }
}

// ---------- SALIENTE ----------
export async function sendOutbound(channel, to, text) {
  if (channel === 'whatsapp') return sendWhatsApp(to, text);
  if (channel === 'instagram') return sendInstagram(to, text);
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

async function sendInstagram(to, text) {
  const token = process.env.IG_TOKEN;
  if (!token) return { sent: false, reason: 'falta IG_TOKEN' };
  const r = await fetch(`${GRAPH}/me/messages?access_token=${token}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: to }, message: { text } }),
  });
  const j = await r.json().catch(() => ({}));
  return r.ok ? { sent: true, id: j.message_id } : { sent: false, reason: JSON.stringify(j).slice(0, 200) };
}
