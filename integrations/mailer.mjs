// Envío de emails (recuperación de contraseña, etc.) vía Gmail API.
// ENV: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_SEND_REFRESH_TOKEN
//      (refresh token de info@pisospacific.com con scope gmail.send)
//      GMAIL_FROM (opcional, default info@pisospacific.com)
// Si no está configurado, isMailerConfigured()=false y send() tira error claro.

import { refreshGoogleToken } from './google-oauth.mjs';
import { withTimeout } from './http.mjs';

const SEND = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

export function isMailerConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GMAIL_SEND_REFRESH_TOKEN);
}

// Identidad del remitente por config de la operación (el server la setea al boot y al
// cambiar settings). Defaults = Pisos Pacific AR.
let identity = { name: 'Pisos Pacific', from: '' };
export function configureMailer({ name, from } = {}) {
  identity = { name: name || 'Pisos Pacific', from: from || '' };
}

const accessToken = () => refreshGoogleToken(process.env.GMAIL_SEND_REFRESH_TOKEN);

const b64url = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// RFC 2047: los headers con no-ASCII (ñ, —, acentos) van como =?UTF-8?B?…?=
const encHeader = (s) => (/[^\x20-\x7e]/.test(s) ? `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=` : s);

// attachments: [{ filename, content (Buffer o base64 string), contentType }]
export async function sendMail({ to, subject, html, text, attachments }) {
  if (!isMailerConfigured()) throw new Error('mailer no configurado (faltan GOOGLE_CLIENT_ID/SECRET + GMAIL_SEND_REFRESH_TOKEN)');
  const at = await accessToken();
  const from = process.env.GMAIL_FROM || identity.from || 'info@pisospacific.com';
  const wrap = (s) => (s.match(/.{1,76}/g) || []).join('\r\n');   // base64 a 76 cols (MIME)
  const ctype = `Content-Type: ${html ? 'text/html' : 'text/plain'}; charset=UTF-8`;
  const bodyB64 = wrap(Buffer.from(html || text || '', 'utf8').toString('base64'));
  const baseHeaders = [`From: ${encHeader(identity.name)} <${from}>`, `To: ${to}`, `Subject: ${encHeader(subject)}`, 'MIME-Version: 1.0'];
  let mime;
  if (attachments && attachments.length) {
    const bnd = 'pp_' + Math.random().toString(36).slice(2, 12);
    const lines = [...baseHeaders, `Content-Type: multipart/mixed; boundary="${bnd}"`, '',
      `--${bnd}`, ctype, 'Content-Transfer-Encoding: base64', '', bodyB64];
    for (const a of attachments) {
      const buf = Buffer.isBuffer(a.content) ? a.content : Buffer.from(String(a.content), 'base64');
      lines.push(`--${bnd}`, `Content-Type: ${a.contentType || 'application/octet-stream'}; name="${a.filename}"`,
        `Content-Disposition: attachment; filename="${a.filename}"`, 'Content-Transfer-Encoding: base64', '', wrap(buf.toString('base64')));
    }
    lines.push(`--${bnd}--`);
    mime = lines.join('\r\n');
  } else {
    mime = [...baseHeaders, ctype, 'Content-Transfer-Encoding: base64', '', bodyB64].join('\r\n');
  }
  const r = await fetch(SEND, withTimeout({ method: 'POST', headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: b64url(mime) }) }));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Gmail send falló: ' + JSON.stringify(j).slice(0, 200));
  return { sent: true, id: j.id };
}
