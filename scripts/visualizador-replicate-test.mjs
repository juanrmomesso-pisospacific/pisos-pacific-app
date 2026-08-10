// Probador del Plan B (inpainting con máscara, vía Replicate) del Visualizador.
// Pipeline: Grounded-SAM (máscara del piso) → FLUX Fill (repinta solo el piso).
// Salida: renders-test/comparacion-replicate.html con Original | Máscara | Render, mismo tamaño.
//
// TOKEN: env REPLICATE_API_TOKEN → .env (REPLICATE_API_TOKEN=r8_...) → data/sources/.replicate-key
// (los tres gitignored; nunca se imprime).
//
// USO:
//   node scripts/visualizador-replicate-test.mjs schema            → vuelca el schema de los 2 modelos
//   node scripts/visualizador-replicate-test.mjs <foto|carpeta> [piso] [designId]
//
// Ej:  node scripts/visualizador-replicate-test.mjs ~/Desktop/foto.jpg piso notte_xl

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  replicateConfigured, modelInputSchema, floorMask, inpaintFloor, materialPrompt, urlToDataUri,
} from '../integrations/replicate-visualizador.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function loadToken() {
  if (process.env.REPLICATE_API_TOKEN) return;
  for (const f of [path.join(ROOT, '.env'), path.join(ROOT, 'data/sources/.replicate-key')]) {
    if (!fs.existsSync(f)) continue;
    const m = /REPLICATE_API_TOKEN\s*=\s*(.+)/.exec(fs.readFileSync(f, 'utf8'));
    if (m) { process.env.REPLICATE_API_TOKEN = m[1].trim().replace(/^["']|["']$/g, ''); return; }
  }
}
loadToken();
if (!replicateConfigured()) {
  console.error('✖ Falta REPLICATE_API_TOKEN. Poné el token en .env (REPLICATE_API_TOKEN=r8_...) o en data/sources/.replicate-key');
  process.exit(1);
}

const CATALOGO = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/visualizador-catalogo.json'), 'utf8'));
const byId = (id) => CATALOGO.designs.find(d => d.id === id);
const firstOf = (surf) => CATALOGO.designs.find(d => d.superficie === surf);
const IMG_EXT = /\.(jpe?g|png|webp)$/i;
const dataUri = (file) => `data:${file.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'};base64,${fs.readFileSync(file).toString('base64')}`;

const OUT = path.join(ROOT, 'renders-test');
fs.mkdirSync(OUT, { recursive: true });

const arg = process.argv[2];

// --- modo schema: confirmar nombres de campo de los 2 modelos ---
if (arg === 'schema') {
  for (const m of ['schananas/grounded_sam', 'black-forest-labs/flux-fill-pro']) {
    console.log(`\n=== ${m} ===`);
    try {
      const props = await modelInputSchema(m);
      for (const [k, v] of Object.entries(props || {})) console.log(`  ${k}: ${v.type || ''}${v.default !== undefined ? ` (default ${JSON.stringify(v.default)})` : ''}${v.description ? ' — ' + v.description.slice(0, 70) : ''}`);
    } catch (e) { console.log('  error:', e.message); }
  }
  process.exit(0);
}

if (!arg) { console.error('USO: node scripts/visualizador-replicate-test.mjs <foto|carpeta> [piso] [designId]  |  ... schema'); process.exit(1); }

const design = byId(process.argv[4]) || firstOf('piso');
const prompt = materialPrompt(design);
const stat = fs.statSync(arg);
const fotos = stat.isDirectory() ? fs.readdirSync(arg).filter(f => IMG_EXT.test(f)).map(f => path.join(arg, f)) : [arg];

console.log(`Plan B (inpainting) · ${fotos.length} foto(s) · diseño=${design.id} (${design.tono})`);
console.log(`prompt material: ${prompt}\n`);

const cards = [];
for (const foto of fotos) {
  const name = path.basename(foto).replace(IMG_EXT, '');
  process.stdout.write(`  · ${path.basename(foto)} … `);
  const imgUri = dataUri(foto);
  try {
    // 1) máscara
    const mask = await floorMask(imgUri, { maskPrompt: 'floor', dilate: 0 });
    // grounded_sam puede devolver varias salidas; guardamos todas para inspección y elegimos la máscara.
    const outs = Array.isArray(mask.rawOutput) ? mask.rawOutput : [mask.rawOutput];
    const maskUris = [];
    for (let i = 0; i < outs.length; i++) {
      if (typeof outs[i] !== 'string') continue;
      const uri = await urlToDataUri(outs[i]);
      fs.writeFileSync(path.join(OUT, `mask-${name}-${i}.png`), Buffer.from(uri.split(',')[1], 'base64'));
      maskUris.push(uri);
    }
    // grounded_sam devuelve [anotada, cutout, MÁSCARA(blanco=objeto), máscara_invertida].
    // Usamos la penúltima (blanco = piso), que es la que flux-fill necesita.
    const maskUri = maskUris[maskUris.length - 2] || maskUris[maskUris.length - 1];
    if (!maskUri) throw new Error('grounded_sam no devolvió máscara');

    // 2) inpaint
    const res = await inpaintFloor({ imageDataUri: imgUri, maskDataUri: maskUri, prompt });
    const renderUri = await urlToDataUri(res.url);
    fs.writeFileSync(path.join(OUT, `rep-render-${name}.jpg`), Buffer.from(renderUri.split(',')[1], 'base64'));
    console.log(`OK  máscara ${(mask.ms / 1000).toFixed(1)}s + inpaint ${(res.ms / 1000).toFixed(1)}s`);
    cards.push({ name: path.basename(foto), original: imgUri, mask: maskUri, render: renderUri });
  } catch (e) {
    console.log('ERROR: ' + e.message);
    cards.push({ name: path.basename(foto), original: imgUri, mask: null, render: null, err: e.message });
  }
}

const html = `<!doctype html><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Visualizador Plan B (inpainting)</title>
<style>
 body{font:15px/1.4 -apple-system,system-ui,sans-serif;margin:0;background:#0b0b12;color:#eee}
 h1{padding:16px;margin:0;font-size:18px}.sum{padding:0 16px 12px;color:#9aa}
 .card{padding:12px 16px 24px;border-top:1px solid #222}.name{font-weight:600;margin-bottom:8px}
 .row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}@media(max-width:760px){.row{grid-template-columns:1fr}}
 figure{margin:0}figcaption{font-size:12px;color:#9aa;margin:4px 0}img{width:100%;border-radius:8px;display:block}
 .err{color:#f88}
</style>
<h1>Visualizador — Plan B: inpainting (solo el piso, misma foto)</h1>
<div class=sum>Diseño ${design.id} · ${design.tono}. Grounded-SAM (máscara) → FLUX Fill. El render debe tener el MISMO tamaño que el original.</div>
${cards.map(c => `<div class=card><div class="name ${c.render ? '' : 'err'}">${c.name}${c.err ? ' — ' + c.err : ''}</div>
 <div class=row>
  <figure><figcaption>Original</figcaption><img src="${c.original}"></figure>
  ${c.mask ? `<figure><figcaption>Máscara del piso</figcaption><img src="${c.mask}"></figure>` : ''}
  ${c.render ? `<figure><figcaption>Render</figcaption><img src="${c.render}"></figure>` : ''}
 </div></div>`).join('\n')}`;
fs.writeFileSync(path.join(OUT, 'comparacion-replicate.html'), html);
console.log(`\n✓ listo. Abrí:  open "${path.join(OUT, 'comparacion-replicate.html')}"`);
