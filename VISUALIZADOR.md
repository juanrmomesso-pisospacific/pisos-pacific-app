# VISUALIZADOR.md — Handoff del Visualizador de Ambientes (pisos)

> **Para la próxima sesión de Claude.** Este archivo tiene TODO el estado del visualizador de pisos.
> Leelo entero antes de tocar nada. Branch: `feature/visualizador-spike`. Última actualización: 12-ago-2026.

## 0. Qué es y objetivo
Herramienta para que el vendedor saque una **foto del ambiente** del cliente y vea el **piso Pacific elegido instalado**, fotorrealista y **fiel al producto exacto** (color, veta, tamaño/dirección de tabla), integrando la luz/sombras/perspectiva reales. Ruta `/visualizador`. Objetivo del dueño: **la mejor calidad del mundo** (costo no es límite).

## 1. Estado actual (qué funciona hoy)
Flujo del vendedor: **foto → elegir diseño → marcar el piso (pincel/Detectar) → Proyectar → ajustar (4 esquinas, dirección, tamaño de tabla, brillo) → ✨ Renderizar (opcional, ~40-90s) → comparar (slider) → compartir**.

Dos modos (toggle "Textura real / IA rápida", solo piso):
- **Textura real (principal):** proyección WebGL de la textura real del producto + mapa de luz + biseles PBR + brillo. Es LOCAL (gratis, instantáneo).
- **IA rápida (secundario):** generativo (Gemini/FLUX) — aplana, se dejó como "vistazo".

## 2. Arquitectura del modo "Textura real" (el bueno)
1. **Máscara del piso:** pincel (`FloorPainter.tsx`) o botón "Detectar piso" (`/api/visualizador/auto-mask` → grounded_sam en Replicate). El vendedor retoca con el dedo.
2. **Proyección (WebGL):** `FloorProjector.tsx` — homografía cuadrado→quad de **4 esquinas manuales** (auto-propuestas desde la máscara, ajustables). Colocación **tabla por tabla** (cada tabla = una tabla entera de la textura, sin cruzar juntas), tablas largas, veta variada (espejado al azar), biseles con relieve (normal en V + luz direccional), **mapa de luz** (ver abajo), reflejo del ambiente + slider "Brillo".
3. **Render opcional (IA, preserva estructura):** botón "✨ Renderizar" → `getResult()` del canvas → `/api/visualizador/refine` → **magic-image-refiner** (ControlNet, creativity 0.25, resemblance 1.0) agrega realismo fotográfico SIN destruir las tablas → **combineRelight** (frontend): mantiene color/veta EXACTOS de la proyección y le aplica la iluminación del render.

## 3. Archivos clave
- **`dashboard-app/src/components/FloorProjector.tsx`** — el motor WebGL (homografía + shader: tabla-por-tabla + biseles + mapa de luz + reflejo). ⭐ el corazón.
- **`dashboard-app/src/components/FloorPainter.tsx`** — pincel raster para marcar el piso (+ botón Detectar).
- **`dashboard-app/src/lib/toneTransfer.ts`** — `combineRelight` (color proyección + luz render), `applyToneTransfer`, `floorStats`.
- **`dashboard-app/src/pages/VisualizadorPage.tsx`** — la página (flujo, toggle modo, proyector, renderizar, comparador slider).
- **`integrations/replicate-visualizador.mjs`** — Replicate: `inpaintFloor` (FLUX Fill, IA rápida), `autoSurfaceMask` (grounded_sam), `refineRender` (magic-image-refiner), `runPrediction` (create+poll con reintento por throttle), `latestVersion`, `urlToDataUri`.
- **`integrations/gemini-image.mjs`** — Gemini 2.5 Flash Image (modo IA viejo).
- **`config/visualizador-prompts.js`** — prompts de la IA rápida.
- **`data/visualizador-textures/`** — **9 texturas reales HD** (fotos del producto del dueño, ~2256px) + `manifest.json` (id, serie H2O/Madera, size_mm, bevel, rgb stats). Servidas en **`/vis-tex/<id>.jpg`** (ruta estática en `server.js`).
- **`data/visualizador-catalogo.json`** — swatches viejos (solo paredes AcuDesign ahora).
- **server.js endpoints:** `GET /api/visualizador/catalogo` (pisos del manifest + paredes del catálogo viejo, con flags `configured`/`inpaint`), `POST /api/visualizador/render` (IA Gemini), `POST /api/visualizador/render-mask` (FLUX Fill), `POST /api/visualizador/auto-mask`, `POST /api/visualizador/refine` (magic-image-refiner).
- **9 diseños:** aspen_xl, natural_oak_xl, notte_xl, roble_clasico_xl, roble_eslavonia_xl (H2O, bisel suave) · kitsilano, roble_handsculped, roble_veta_tallada, verona (Madera, bisel marcado).

## 4. Correr y testear
```bash
export PATH="$HOME/.local/node-v22.12.0-darwin-arm64/bin:$PATH"
cd ~/pisos-pacific-app/dashboard-app && npm run build      # build frontend
# server de prueba para el CELULAR (con las keys):
SP="/private/tmp/claude-501/-Users-juan-pisos-pacific-app/74bfcd0a-ba89-4f6f-93fb-7abdbcf2a023/scratchpad"
cd ~/pisos-pacific-app; set -a; . ./.env; set +a
DB_PATH="$SP/db.phone.json" UPLOAD_DIR="$SP/uploads.phone" PORT=4173 nohup node server.js > "$SP/server.phone.log" 2>&1 &
ipconfig getifaddr en0    # ⚠️ la IP CAMBIA con el WiFi — dársela al dueño cada vez
```
- URL celular: `http://<IP>:4173/visualizador` · login `info@pisospacific.com` / `admin123`. **Recarga fuerte** tras cada cambio (o cerrar/abrir pestaña) — el cache HTTP/textura engaña.
- **Keys en `.env`** (gitignored): `GEMINI_API_KEY`, `REPLICATE_API_TOKEN` (Replicate cobra crédito por adelantado; con <US$5 limita a 1 req/min → hay reintento por throttle en `runPrediction`).
- **Probar en el navegador (Claude):** truco para pintar el piso sin file_upload (que ya no acepta paths del host) — servir la foto en `uploads.phone/` y inyectarla vía `fetch → File → input.change`, luego dispatch de PointerEvents sintéticos en el canvas (con `cv.setPointerCapture=()=>{}` para evitar el throw). Ver historial de la sesión anterior.
- HEIC del iPhone: convertir con `sips -s format jpeg -Z 1568` antes.

## 5. PROBLEMAS ABIERTOS (lo que reportó el dueño, en orden de prioridad)
1. **Luz exagerada** (mapa de luz demasiado fuerte): quema el sol (blanco) y mancha las sombras (oscuro), sobre todo en fotos con sol duro. **Ya se suavizó** el 12/8 (rango 0.68–1.32, aplicación 0.7 + combine ratio 0.78–1.28) pero **falta re-probar en el celular** y quizás bajar más. El mapa de luz sale de `uLum` (foto reducida a 40px = muy borroneada) normalizada por `uBase` (mediana de luminancia del piso).
2. **Perspectiva: no se puede cubrir TODO el piso sin que pierda la forma.** Las 4 esquinas manuales no dan la convergencia correcta al punto de fuga sin estirar la textura. Se probó "punto de fuga" (estiraba las tablas) → revertido. **SOLUCIÓN EN CAMINO: perspectiva automática por profundidad** (ver §6).
3. **Render (IA): veta no nítida + bordes/muebles difuminados + foto saturada/manchada.** El refinador (magic-image-refiner) difumina los encuentros con muebles y satura. Hay que: bajar más la luz, quizás bajar creativity, o mejorar el combine para no difuminar bordes (el blend de máscara).
4. **El render tarda mucho (~40-96s) y si se apaga la pantalla del celular, se corta.** Es porque el render se dispara client-side (fetch desde el browser); iOS suspende la pestaña. **FIX pendiente: hacerlo un job server-side** (POST inicia → devuelve jobId → el cliente hace polling), así sobrevive a la pantalla apagada. Patrón: como `mp_pending_job` del cashflow.

## 6. EL PLAN (investigación profunda ya hecha) — próximos pasos
**Documento del plan (artifact):** https://claude.ai/code/artifact/54a5084c-f89c-4ed7-8f18-f504dca84dd7

**Hallazgo clave (verificado vía patentes de Leap Tools/Roomvo — US 11.770.496 / 11.769.195 / 11.210.732):** el líder mundial **NO usa 3D ni IA generativa**. Usa EXACTAMENTE nuestro camino: segmentar piso 2D → **homografía** → **mapa de luz** (luminancia YUV de la foto **borroneada**, normalizada, **multiplicada** sobre la textura) → síntesis estocástica de tabla → blend de bordes. **Estamos al ~80%.**

**Fase 1 (en curso):**
- ✅ **Mapa de luz** (técnica de Roomvo) — HECHO (commit `3eeea83`), suavizado el 12/8. Re-probar/ajustar.
- 🔬 **Perspectiva automática por profundidad** — Depth Anything v2 (`chenxwh/depth-anything-v2` en Replicate) da un **mapa de profundidad EXCELENTE** (probado, muy limpio). PERO el primer intento de ajustar el plano → homografía salió torcido (esquinas cercanas fuera de pantalla). **Necesita calibración:** FOV desconocido del celular, conversión disparidad→profundidad (`d=1/disp`), RANSAC robusto (no least-squares, la máscara con feather mete outliers), y validar en varias fotos. Script de validación en `scratchpad/depth-test.mjs` + el intento de plano en el historial. Objetivo: **auto-sembrar las 4 esquinas** desde el plano (siguen ajustables).

**Fase 2 (mejor que Roomvo, requiere GPU propio):**
- **Descomposición intrínseca** (Careaga & Aksoy — `compphoto/Intrinsic`, open weights, "Colorful Diffuse" TOG'24): separar la foto en **albedo + sombreado coloreado real** → `luz real × nuevo piso` → integración física perfecta (reemplaza el mapa de luz aproximado). Correr en Modal o deploy custom en Replicate.
- **PBR por piso:** normal + roughness reales (Material Palette, o fotos de tabla con luz rasante) → biseles/brillo verdaderos + veta nítida.

**Fase 3 (opcional):** difusión bloqueada (FLUX-Depth + FLUX-Redux/IP-Adapter) para pulido foto-real sin correr color/estructura (reemplaza magic-image-refiner que difumina).

**Descartado (no repetir):** 3D/AR (RoomPlan = LiDAR+iOS, pierde alcance), Gaussian Splatting/NeRF (experimental en web), img2img generativo a secas (destruye las tablas), punto de fuga manual (estira la textura).

## 7. Modelos/APIs (con qué corre cada cosa)
| Para | Modelo | Dónde |
|---|---|---|
| Profundidad (perspectiva auto) | `chenxwh/depth-anything-v2` | Replicate ✅ probado |
| Máscara auto | `schananas/grounded_sam` | Replicate ✅ (en uso) |
| IA rápida (inpaint) | `black-forest-labs/flux-fill-pro` | Replicate ✅ (en uso) |
| Render/refinado | `batouresearch/magic-image-refiner` | Replicate ✅ (en uso; difumina) |
| Intrinsic (Fase 2) | `compphoto/Intrinsic` | GPU propio (Modal) |
| PBR desde foto (Fase 2) | Material Palette | GPU propio |
| Pulido (Fase 3) | FLUX.1 Depth + Redux | Replicate/fal |

## 8. Historial de commits del visualizador (branch feature/visualizador-spike)
Buscar con `git log --oneline | grep -i visualiz`. Los últimos hitos: mapa de luz (`3eeea83`), combine-relight + más convergencia (`984e817`), revertir punto de fuga (`8c49bfb`), candado de color + punto de fuga (`b8353ab`), botón Renderizar/refinador (`9d1e0b3`), tablas largas (`0067501`), texturas HD + AO (`94bf54c`), PBR fase 1 (`0e9e40d`), motor de proyección WebGL (`a453221`), texturas del banco (`43c2abd`).

## 9. Preferencias del dueño (Juan) para esta feature
- Calidad **mundial**, costo no es límite. Fidelidad **exacta** del producto (color/veta) es innegociable.
- Iterativo, prueba en el **celular** con fotos reales. Manda capturas con feedback preciso.
- Le molesta: look "pegado/calco", luz exagerada, tablas cortas/en ladrillo, pixelado, bordes difuminados, color infiel.
- Le gusta: tablas largas como el producto real, integración de luz sutil, control de dirección.
