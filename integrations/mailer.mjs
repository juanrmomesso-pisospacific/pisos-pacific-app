// Envío de emails (recuperación de contraseña, etc.) vía Gmail API.
// ENV: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_SEND_REFRESH_TOKEN
//      (refresh token de info@pisospacific.com con scope gmail.send)
//      GMAIL_FROM (opcional, default info@pisospacific.com)
// Si no está configurado, isMailerConfigured()=false y send() tira error claro.

const OAUTH = 'https://oauth2.googleapis.com/token';
const SEND = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

export function isMailerConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GMAIL_SEND_REFRESH_TOKEN);
}

async function accessToken() {
  const r = await fetch(OAUTH, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: process.env.GMAIL_SEND_REFRESH_TOKEN, grant_type: 'refresh_token' }) });
  const j = await r.json();
  if (!j.access_token) throw new Error('no se pudo refrescar token de envío Gmail: ' + JSON.stringify(j).slice(0, 160));
  return j.access_token;
}

const b64url = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function sendMail({ to, subject, html, text }) {
  if (!isMailerConfigured()) throw new Error('mailer no configurado (faltan GOOGLE_CLIENT_ID/SECRET + GMAIL_SEND_REFRESH_TOKEN)');
  const at = await accessToken();
  const from = process.env.GMAIL_FROM || 'info@pisospacific.com';
  const body = html || text || '';
  const mime = [
    `From: Pisos Pacific <${from}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: ${html ? 'text/html' : 'text/plain'}; charset=UTF-8`,
    '',
    body,
  ].join('\r\n');
  const r = await fetch(SEND, { method: 'POST', headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: b64url(mime) }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Gmail send falló: ' + JSON.stringify(j).slice(0, 200));
  return { sent: true, id: j.id };
}
