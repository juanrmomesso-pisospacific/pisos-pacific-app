// Plan B del Visualizador: inpainting con máscara + referencia, vía Replicate.
// A diferencia de Gemini (que re-genera TODA la escena y cambia encuadre/proporción),
// este pipeline REPINTA SOLO EL PISO y devuelve la MISMA foto (mismo tamaño):
//   1) Grounded-SAM  → máscara del piso a partir del texto "floor".
//   2) FLUX Fill     → rellena solo esa zona con el material (prompt derivado del diseño),
//                      dejando muebles/paredes/ventanas/luces intactos.
//
// Token en env REPLICATE_API_TOKEN (nunca al frontend). Las imágenes se mandan como data URI
// base64 (Replicate las acepta) → sin necesidad de hostear archivos.
//
// OJO: los nombres de campo de cada modelo se confirman contra el schema en vivo la primera vez
// (ver scripts/visualizador-replicate-test.mjs, que puede volcar el schema). Acá van los conocidos.

import { withTimeout } from './http.mjs';

const API = 'https://api.replicate.com/v1';
// Modelos (owner/name). La VERSIÓN se resuelve en runtime para no quedar pegado a un hash viejo.
const MODEL_SEGMENT = 'schananas/grounded_sam';        // texto → máscara
const MODEL_INPAINT = 'black-forest-labs/flux-fill-pro'; // imagen + máscara + prompt → imagen

export function replicateConfigured() {
  return !!process.env.REPLICATE_API_TOKEN;
}
function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`, 'Content-Type': 'application/json', ...extra };
}

// Resuelve la última versión de un modelo (owner/name → version id).
export async function latestVersion(model) {
  const r = await fetch(`${API}/models/${model}`, withTimeout({ headers: authHeaders() }, 20000));
  if (!r.ok) throw new Error(`no pude leer el modelo ${model}: HTTP ${r.status}`);
  const j = await r.json();
  const v = j?.latest_version?.id;
  if (!v) throw new Error(`el modelo ${model} no expone latest_version`);
  return v;
}

// Devuelve el schema de inputs de un modelo (para confirmar nombres de campo).
export async function modelInputSchema(model) {
  const r = await fetch(`${API}/models/${model}`, withTimeout({ headers: authHeaders() }, 20000));
  const j = await r.json();
  return j?.latest_version?.openapi_schema?.components?.schemas?.Input?.properties || null;
}

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

// Crea una predicción y espera el resultado (create + poll). Devuelve prediction.output.
// Reintenta ante throttling (cuentas con <US$5 de crédito quedan limitadas a 1 request por vez).
export async function runPrediction(version, input, { timeoutMs = 120000, label = 'replicate' } = {}) {
  const started = Date.now();
  let r, pred;
  for (let attempt = 0; attempt < 8; attempt++) {
    // 'Prefer: wait' pide respuesta sincrónica (hasta ~60s); igual hacemos poll por las dudas.
    r = await fetch(`${API}/predictions`, withTimeout({
      method: 'POST', headers: authHeaders({ Prefer: 'wait' }), body: JSON.stringify({ version, input }),
    }, 65000));
    pred = await r.json();
    if (r.ok) break;
    const detail = pred?.detail || pred?.title || `HTTP ${r.status}`;
    if (r.status === 429 || /throttl/i.test(detail)) {
      const secs = Number((/resets? in ~?(\d+)/i.exec(detail) || [])[1]) || 8;
      await sleep((secs + 1) * 1000);
      continue; // reintentar
    }
    throw new Error(`${label}: ${detail}`);
  }
  if (!r.ok) throw new Error(`${label}: sigue throttled tras varios reintentos`);

  while (pred.status && !['succeeded', 'failed', 'canceled'].includes(pred.status)) {
    if (Date.now() - started > timeoutMs) throw new Error(`${label}: timeout (${Math.round(timeoutMs / 1000)}s)`);
    await new Promise(res => setTimeout(res, 1500));
    const g = await fetch(pred.urls.get, withTimeout({ headers: authHeaders() }, 20000));
    pred = await g.json();
  }
  if (pred.status !== 'succeeded') throw new Error(`${label}: ${pred.error || pred.status}`);
  return { output: pred.output, ms: Date.now() - started };
}

// Baja una URL de salida de Replicate y la devuelve como data URI base64.
export async function urlToDataUri(url) {
  const r = await fetch(url, withTimeout({}, 30000));
  if (!r.ok) throw new Error('no pude bajar la salida: HTTP ' + r.status);
  const mime = r.headers.get('content-type') || 'image/png';
  const buf = Buffer.from(await r.arrayBuffer());
  return `data:${mime};base64,${buf.toString('base64')}`;
}
// Normaliza la salida de un modelo (string | [string] | {..}) a una sola URL.
function firstUrl(output) {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) return output.find(x => typeof x === 'string');
  if (output && typeof output === 'object') return output.url || Object.values(output).find(x => typeof x === 'string');
  return null;
}

// 1) Máscara del piso (grounded_sam). Devuelve { maskUri, ms, rawOutput } — rawOutput por si hay
//    que elegir cuál de las salidas es la máscara binaria (se inspecciona en la 1ra corrida).
export async function floorMask(imageDataUri, { maskPrompt = 'floor,carpet,rug,tile floor,ground', negative = 'wall,window,furniture,ceiling', dilate = 5 } = {}) {
  const version = await latestVersion(MODEL_SEGMENT);
  const input = { image: imageDataUri, mask_prompt: maskPrompt, negative_mask_prompt: negative, adjustment_factor: dilate };
  const { output, ms } = await runPrediction(version, input, { label: 'grounded_sam' });
  return { rawOutput: output, ms };
}

// 2) Inpaint del piso (flux-fill-pro). mask: blanco = zona a editar.
export async function inpaintFloor({ imageDataUri, maskDataUri, prompt }) {
  const version = await latestVersion(MODEL_INPAINT);
  const input = { image: imageDataUri, mask: maskDataUri, prompt, output_format: 'jpg', safety_tolerance: 2, prompt_upsampling: false };
  const { output, ms } = await runPrediction(version, input, { label: 'flux-fill' });
  const url = firstUrl(output);
  if (!url) throw new Error('flux-fill no devolvió imagen');
  return { url, ms };
}

// Descripción en inglés del tono por diseño (más fiel que el `tono` en español del catálogo;
// probado: mejora el matcheo de color del inpaint). Fallback al `tono` del catálogo.
const EN_TONE = {
  natural_oak_xl: 'light natural oak, soft pale warm tone, subtle straight grain',
  notte_xl: 'warm greige, greyish-taupe medium oak, matte, subtle straight grain',
  roble_eslavonia_xl: 'honey oak, warm golden-brown, pronounced grain',
  aspen_xl: 'very light oak, pale and airy, fine grain',
};
// Tonos de PARED (paneles acústicos AcuDesign, listones verticales de madera).
const EN_TONE_WALL = {
  natural_oak_w: 'light natural oak slats',
  natural_oak_b: 'medium warm brown oak slats',
  walnut: 'dark walnut brown slats',
  black_laca: 'black lacquered slats',
};
// Prompt del material a partir del diseño del catálogo. FLUX Fill es text-guided; describimos el
// material lo más fiel posible + reforzamos que solo rellene la zona enmascarada.
// Ancla de color EXACTO tomada de la muestra real del SKU (avg_hex/palette/color_desc, precomputados
// del banco). El texto solo no fija el tono → damos el color medio + claro + oscuro y prohibimos derivar.
function colorAnchor(design) {
  if (!design?.avg_hex) return '';
  const [dark, mid, light] = design.palette || [design.avg_hex, design.avg_hex, design.avg_hex];
  return `EXACT COLOR — match this real sample tone precisely: ${design.color_desc || ''}; ` +
    `predominant color ${mid}, with lighter ${light} and darker ${dark} in the grain. ` +
    `Do NOT make it warmer, more golden/orange, lighter or more saturated than these colors. `;
}
export function materialPrompt(design) {
  if (design?.superficie === 'pared') {
    const w = EN_TONE_WALL[design?.id] || design?.tono || 'wood slats';
    return `Vertical wood slat acoustic wall panels: thin vertical ${w} with narrow dark felt gaps ` +
      `between the slats, running floor-to-ceiling, following the wall's perspective. ${colorAnchor(design)}` +
      `Photorealistic and seamless, consistent with the room's lighting and shadows. Cover only the masked wall area; keep everything else unchanged.`;
  }
  const desc = EN_TONE[design?.id] || design?.tono || 'natural wood';
  return `Wide-plank engineered wood flooring, ${desc}. ${colorAnchor(design)}` +
    `Natural matte finish, realistic wood grain, planks laid following the room's perspective, ` +
    `photorealistic and seamless, consistent with the room's lighting and soft reflections. ` +
    `Blend the floor smoothly into the existing baseboards and walls — do NOT add any dark gap, ` +
    `shadow strip or trim line at the floor-wall junction. Replace only the masked floor area; keep everything else unchanged.`;
}

// Auto-detección de la superficie (asistente del pincel): grounded_sam por texto → máscara b/n
// (blanco = superficie) como DATA URI. El vendedor la retoca con el pincel. Sirve de "arranque".
export async function autoSurfaceMask(imageDataUri, superficie = 'piso') {
  const prompt = superficie === 'pared' ? 'wall' : 'floor';
  const { rawOutput } = await floorMask(imageDataUri, { maskPrompt: prompt, negative: '', dilate: 0 });
  const outs = (Array.isArray(rawOutput) ? rawOutput : [rawOutput]).filter(x => typeof x === 'string');
  // grounded_sam devuelve [anotada, cutout, MÁSCARA(blanco=objeto), invertida] → penúltima.
  const url = outs[outs.length - 2] || outs[outs.length - 1];
  if (!url) throw new Error('no se pudo detectar la superficie');
  return urlToDataUri(url);
}
