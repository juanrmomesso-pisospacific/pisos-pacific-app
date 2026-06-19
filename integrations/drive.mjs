// Integración Google Drive (solo lectura) para el banco de imágenes.
// Usa el token de la cuenta pacific (info@pisospacific.com) con scope drive.readonly.
// El Drive es PRIVADO → la app lista carpetas y sirve los archivos por proxy (con caché);
// nunca se expone públicamente.
import { refreshGoogleToken } from './google-oauth.mjs';
import { withTimeout } from './http.mjs';

const API = 'https://www.googleapis.com/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const accessToken = () => refreshGoogleToken(process.env.GDRIVE_REFRESH_TOKEN || process.env.GMAIL_REFRESH_TOKEN);

export const driveConfigured = () =>
  !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && (process.env.GDRIVE_REFRESH_TOKEN || process.env.GMAIL_REFRESH_TOKEN));

// Lista el contenido de una carpeta: subcarpetas + imágenes + otros.
export async function listFolder(folderId) {
  const token = await accessToken();
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const fields = encodeURIComponent('files(id,name,mimeType,size,modifiedTime)');
  const url = `${API}/files?q=${q}&fields=${fields}&orderBy=folder,name&pageSize=500&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const r = await fetch(url, withTimeout({ headers: { Authorization: `Bearer ${token}` } }));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Drive list: ' + JSON.stringify(j).slice(0, 200));
  const items = j.files || [];
  return {
    folders: items.filter((f) => f.mimeType === FOLDER_MIME).map((f) => ({ id: f.id, name: f.name })),
    images: items.filter((f) => /^image\//.test(f.mimeType || '')).map((f) => ({ id: f.id, name: f.name, mime: f.mimeType, size: Number(f.size) || 0 })),
    others: items.filter((f) => f.mimeType !== FOLDER_MIME && !/^image\//.test(f.mimeType || '')).map((f) => ({ id: f.id, name: f.name, mime: f.mimeType })),
  };
}

// Descarga los bytes de un archivo (para el proxy con caché).
export async function getFileMedia(fileId) {
  const token = await accessToken();
  const r = await fetch(`${API}/files/${fileId}?alt=media&supportsAllDrives=true`, withTimeout({ headers: { Authorization: `Bearer ${token}` } }, 30000));
  if (!r.ok) throw new Error('Drive media: ' + r.status);
  return { buf: Buffer.from(await r.arrayBuffer()), mime: r.headers.get('content-type') || 'application/octet-stream' };
}
