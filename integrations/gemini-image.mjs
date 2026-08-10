// Llamada al modelo de imagen de Google (Gemini 2.5 Flash Image, "Nano Banana") para el
// Visualizador de Ambientes. Edita una foto real usando imágenes de diseño como referencia.
//
// API REST estable (v1beta generateContent):
//   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
//   header x-goog-api-key: GEMINI_API_KEY
//   body { contents:[{ parts:[ {text}, {inline_data:{mime_type,data}}, ... ] }],
//          generationConfig:{ responseModalities:["TEXT","IMAGE"] } }
// La respuesta trae la imagen en candidates[0].content.parts[].inlineData.data (base64).
//
// La API key NUNCA se expone al frontend: este módulo corre solo en el server.

import { withTimeout } from './http.mjs';

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-image';
const RENDER_TIMEOUT_MS = 60000; // el brief pide 60s

export function geminiConfigured() {
  return !!process.env.GEMINI_API_KEY;
}

// foto: { data (base64 sin prefijo), mime }
// refs: [{ data, mime }, ...]  (muestras del/los diseño/s)
// Devuelve { imagen(base64), mime, modelo, ms }  o lanza Error con mensaje claro.
export async function renderVisualizacion({ foto, refs = [], prompt, model = DEFAULT_MODEL }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY no está configurada en el servidor');
  if (!foto?.data) throw new Error('falta la foto del ambiente');
  if (!prompt) throw new Error('falta el prompt de edición');

  const parts = [
    { text: prompt },
    { inline_data: { mime_type: foto.mime || 'image/jpeg', data: foto.data } },
    ...refs.filter(r => r?.data).map(r => ({ inline_data: { mime_type: r.mime || 'image/jpeg', data: r.data } })),
  ];
  const body = {
    contents: [{ parts }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const started = Date.now();
  let r;
  try {
    r = await fetch(url, withTimeout({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    }, RENDER_TIMEOUT_MS));
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new Error('el modelo tardó demasiado (timeout 60s)');
    throw new Error('no se pudo contactar al modelo: ' + (e?.message || e));
  }
  const ms = Date.now() - started;

  const json = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = json?.error?.message || `HTTP ${r.status}`;
    throw new Error('el modelo rechazó el pedido: ' + msg);
  }

  const respParts = json?.candidates?.[0]?.content?.parts || [];
  // v1beta REST devuelve inlineData (camelCase); aceptamos ambas por las dudas.
  const imgPart = respParts.find(p => p?.inlineData?.data || p?.inline_data?.data);
  if (imgPart) {
    const inline = imgPart.inlineData || imgPart.inline_data;
    // usage (tokens) sirve para medir el costo real por render en el spike.
    return { imagen: inline.data, mime: inline.mimeType || inline.mime_type || 'image/png', modelo: model, ms, usage: json?.usageMetadata || null };
  }

  // Si no hay imagen: el modelo suele explicar por qué (rechazo/seguridad) como texto.
  const texto = respParts.map(p => p?.text).filter(Boolean).join(' ').trim();
  const finish = json?.candidates?.[0]?.finishReason;
  const blocked = json?.promptFeedback?.blockReason;
  throw new Error(
    'el modelo no devolvió una imagen' +
    (texto ? `: ${texto}` : blocked ? ` (bloqueado: ${blocked})` : finish ? ` (${finish})` : '')
  );
}
