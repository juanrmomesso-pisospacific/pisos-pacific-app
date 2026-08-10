// Probador de calidad del Visualizador de Ambientes (spike).
// Renderiza una o varias fotos reales con Gemini y arma una comparación ORIGINAL vs RENDER
// (HTML autocontenido) para juzgar la calidad desde el celular. Mide latencia y tokens (costo).
//
// La KEY se toma de (en orden): env GEMINI_API_KEY  →  archivo .env  →  data/sources/.gemini-key
// (los tres están gitignored; NO se imprime nunca).
//
// USO:
//   node scripts/visualizador-test.mjs <foto.jpg> [piso|pared|ambos] [designId] [paredDesignId]
//   node scripts/visualizador-test.mjs <carpeta-con-fotos>        (todas las fotos, superficie piso)
//   node scripts/visualizador-test.mjs <carpeta> pared walnut     (todas, pared con ese diseño)
//
// Ejemplos:
//   node scripts/visualizador-test.mjs ~/Desktop/living.jpg piso notte_xl
//   node scripts/visualizador-test.mjs ~/Desktop/fotos-clientes/ piso
//
// Salida: crea la carpeta ./renders-test/ con el HTML de comparación (abrir en el navegador o
// mandarlo por AirDrop al celular) + los PNG de cada render.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderVisualizacion } from '../integrations/gemini-image.mjs';
import { promptFor } from '../config/visualizador-prompts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// --- cargar la key sin imprimirla ---
function loadKey() {
  if (process.env.GEMINI_API_KEY) return;
  for (const f of [path.join(ROOT, '.env'), path.join(ROOT, 'data/sources/.gemini-key')]) {
    if (!fs.existsSync(f)) continue;
    const txt = fs.readFileSync(f, 'utf8').trim();
    const m = /GEMINI_API_KEY\s*=\s*(.+)/.exec(txt);
    process.env.GEMINI_API_KEY = (m ? m[1] : txt).trim().replace(/^["']|["']$/g, '');
    if (process.env.GEMINI_API_KEY) return;
  }
}
loadKey();
if (!process.env.GEMINI_API_KEY) {
  console.error('✖ Falta GEMINI_API_KEY. Poné la key en un archivo .env (GEMINI_API_KEY=...) en la raíz del repo, o en data/sources/.gemini-key');
  process.exit(1);
}

const CATALOGO = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/visualizador-catalogo.json'), 'utf8'));
const byId = (id) => CATALOGO.designs.find(d => d.id === id);
const firstOf = (surf) => CATALOGO.designs.find(d => d.superficie === surf);

const IMG_EXT = /\.(jpe?g|png|webp|heic)$/i;
const mimeOf = (f) => f.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';

// --- args ---
const [target, superficieArg = 'piso', designArg, paredArg] = process.argv.slice(2);
if (!target) {
  console.error('USO: node scripts/visualizador-test.mjs <foto|carpeta> [piso|pared|ambos] [designId] [paredDesignId]');
  console.error('Diseños de piso: ', CATALOGO.designs.filter(d => d.superficie === 'piso').map(d => d.id).join(', '));
  console.error('Diseños de pared:', CATALOGO.designs.filter(d => d.superficie === 'pared').map(d => d.id).join(', '));
  process.exit(1);
}
const surf = ['piso', 'pared', 'ambos'].includes(superficieArg) ? superficieArg : 'piso';

// resolver diseños de referencia
let refs, refIds;
if (surf === 'ambos') {
  const dp = byId(designArg) || firstOf('piso');
  const dw = byId(paredArg) || firstOf('pared');
  refs = [{ data: dp.b64, mime: dp.mime }, { data: dw.b64, mime: dw.mime }];
  refIds = [dp.id, dw.id];
} else {
  const d = (byId(designArg) && byId(designArg).superficie === surf) ? byId(designArg) : firstOf(surf);
  refs = [{ data: d.b64, mime: d.mime }];
  refIds = [d.id];
}

// juntar fotos
const stat = fs.statSync(target);
const fotos = stat.isDirectory()
  ? fs.readdirSync(target).filter(f => IMG_EXT.test(f)).map(f => path.join(target, f))
  : [target];
if (!fotos.length) { console.error('No encontré fotos en', target); process.exit(1); }

const OUT = path.join(ROOT, 'renders-test');
fs.mkdirSync(OUT, { recursive: true });

console.log(`Probando ${fotos.length} foto(s) · superficie=${surf} · diseño(s)=${refIds.join('+')}`);

const cards = [];
let totalMs = 0, okCount = 0, totalImgTokens = 0;

for (const foto of fotos) {
  const name = path.basename(foto);
  process.stdout.write(`  · ${name} … `);
  const fotoB64 = fs.readFileSync(foto).toString('base64');
  try {
    const out = await renderVisualizacion({ foto: { data: fotoB64, mime: mimeOf(foto) }, refs, prompt: promptFor(surf) });
    const outFile = `render-${name.replace(IMG_EXT, '')}-${refIds.join('_')}.png`;
    fs.writeFileSync(path.join(OUT, outFile), Buffer.from(out.imagen, 'base64'));
    const imgTok = out.usage?.candidatesTokenCount || 0;
    totalImgTokens += imgTok; totalMs += out.ms; okCount++;
    console.log(`OK ${(out.ms / 1000).toFixed(1)}s${imgTok ? ` · ${imgTok} tok img` : ''}`);
    cards.push({
      name,
      original: `data:${mimeOf(foto)};base64,${fotoB64}`,
      render: `data:${out.mime};base64,${out.imagen}`,
      meta: `${(out.ms / 1000).toFixed(1)}s · ${out.modelo}${imgTok ? ` · ${imgTok} tok` : ''}`,
    });
  } catch (e) {
    console.log('ERROR: ' + e.message);
    cards.push({ name, original: `data:${mimeOf(foto)};base64,${fotoB64}`, render: null, meta: '✖ ' + e.message });
  }
}

// contact sheet HTML (original | render, apilados en móvil)
const html = `<!doctype html><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Visualizador — prueba</title>
<style>
 body{font:15px/1.4 -apple-system,system-ui,sans-serif;margin:0;background:#0b0b12;color:#eee}
 h1{padding:16px;margin:0;font-size:18px;position:sticky;top:0;background:#0b0b12}
 .sum{padding:0 16px 12px;color:#aaa}
 .card{padding:12px 16px 24px;border-top:1px solid #222}
 .name{font-weight:600;margin-bottom:2px}.meta{color:#9aa;font-size:13px;margin-bottom:10px}
 .pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}
 @media(max-width:640px){.pair{grid-template-columns:1fr}}
 figure{margin:0}figcaption{font-size:12px;color:#9aa;margin:4px 0}
 img{width:100%;border-radius:8px;display:block}
 .err{color:#f88}
</style>
<h1>Visualizador de Ambientes — prueba de calidad</h1>
<div class=sum>Superficie: <b>${surf}</b> · Diseño(s): <b>${refIds.join(' + ')}</b> · ${okCount}/${fotos.length} OK · promedio ${okCount ? (totalMs / okCount / 1000).toFixed(1) : '—'}s${totalImgTokens ? ` · ~${Math.round(totalImgTokens / okCount)} tok img/render` : ''}</div>
${cards.map(c => `<div class=card>
 <div class=name>${c.name}</div><div class="meta ${c.render ? '' : 'err'}">${c.meta}</div>
 <div class=pair>
  <figure><figcaption>Original</figcaption><img src="${c.original}"></figure>
  ${c.render ? `<figure><figcaption>Render</figcaption><img src="${c.render}"></figure>` : ''}
 </div></div>`).join('\n')}`;

const htmlPath = path.join(OUT, 'comparacion.html');
fs.writeFileSync(htmlPath, html);

console.log(`\n✓ ${okCount}/${fotos.length} renders OK · promedio ${okCount ? (totalMs / okCount / 1000).toFixed(1) : '—'}s`);
if (totalImgTokens && okCount) {
  // Gemini cobra la imagen por tokens de salida; imprimimos los tokens reales para estimar costo con el precio vigente.
  console.log(`  ~${Math.round(totalImgTokens / okCount)} tokens de imagen por render (multiplicá por el precio de output vigente para el costo).`);
}
console.log(`\nAbrí la comparación:  open "${htmlPath}"`);
console.log(`(o mandate ese HTML al celular por AirDrop para verlo en pantalla real)`);
