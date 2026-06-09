// Mintea un access token de Google a partir de un refresh token (Gmail API).
// Usado por gmail.mjs (lectura) y mailer.mjs (envío).
const OAUTH = 'https://oauth2.googleapis.com/token';

export async function refreshGoogleToken(refreshToken) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !refreshToken) throw new Error('faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / refresh token');
  const r = await fetch(OAUTH, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, refresh_token: refreshToken, grant_type: 'refresh_token' }) });
  const j = await r.json();
  if (!j.access_token) throw new Error('no se pudo refrescar token Google: ' + JSON.stringify(j).slice(0, 160));
  return j.access_token;
}
