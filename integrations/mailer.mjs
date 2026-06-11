// Envío de emails (recuperación de contraseña, etc.) vía Gmail API.
// ENV: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_SEND_REFRESH_TOKEN
//      (refresh token de info@pisospacific.com con scope gmail.send)
//      GMAIL_FROM (opcional, default info@pisospacific.com)
// Si no está configurado, isMailerConfigured()=false y send() tira error claro.

import { refreshGoogleToken } from './google-oauth.mjs';

const SEND = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

export function isMailerConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GMAIL_SEND_REFRESH_TOKEN);
}

const accessToken = () => refreshGoogleToken(process.env.GMAIL_SEND_REFRESH_TOKEN);

const b64url = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// RFC 2047: los headers con no-ASCII (ñ, —, acentos) van como =?UTF-8?B?…?=
const encHeader = (s) => (/[^\x20-\x7e]/.test(s) ? `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=` : s);

export async function sendMail({ to, subject, html, text }) {
  if (!isMailerConfigured()) throw new Error('mailer no configurado (faltan GOOGLE_CLIENT_ID/SECRET + GMAIL_SEND_REFRESH_TOKEN)');
  const at = await accessToken();
  const from = process.env.GMAIL_FROM || 'info@pisospacific.com';
  const body = html || text || '';
  const mime = [
    `From: Pisos Pacific <${from}>`,
    `To: ${to}`,
    `Subject: ${encHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: ${html ? 'text/html' : 'text/plain'}; charset=UTF-8`,
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(body, 'utf8').toString('base64'),
  ].join('\r\n');
  const r = await fetch(SEND, { method: 'POST', headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: b64url(mime) }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Gmail send falló: ' + JSON.stringify(j).slice(0, 200));
  return { sent: true, id: j.id };
}
