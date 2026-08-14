# VISUALIZADOR.md — Handoff del Visualizador de Ambientes (pisos)

> **Para la próxima sesión de Claude.** Este archivo tiene TODO el estado del visualizador de pisos.
> Leelo entero antes de tocar nada. Branch: `feature/visualizador-spike`. Última actualización: 12-ago-2026.

> **DECISIÓN 14/8 — ENFOQUE "FOTOS FÁCILES" (del dueño, tras ver resultados en fotos difíciles):**
> El dueño probó con fotos difíciles (pasillo angosto con luz dura, ambientes con muebles) y el
> resultado era **inadmisible para la marca**: el piso quedaba "pegado/fotomontaje" o con "manchas
> negras", y el render de IA curvaba las tablas ("acordeón"). Diagnóstico y arreglos:
> - **CAUSA de las "manchas": 3 efectos de realismo demasiado fuertes** (repro en cocina con banquetas):
>   mapa de luz que horneaba sombras/hotspots reales, brillo/reflejo, y AO (sombra de contacto) que
>   hacía un halo oscuro alrededor de CADA pata de mueble. Bajados los defaults + AO suave (commit a05cee2).
> - **CAUSA del "acordeón": el paso de IA "Renderizar" (magic-image-refiner)** re-dibujaba el piso y
>   curvaba las tablas rectas. **SACADO** — la proyección WebGL limpia es ahora el resultado final
>   (botón → "Compartir"). Los endpoints `refine*` del server quedan inertes.
> - **Tensión de fondo (honestidad técnica): el mapa de luz crudo o mete manchas (luz alta) o queda
>   plano/pegado (luz baja).** El punto justo es JUSTO lo difícil de Roomvo. Mitigado suavizando el blur
>   del mapa de luz (40px→16px): captura sólo el degradé amplio (que "apoya" el piso) sin las sombras
>   locales (manchas). Default de luz 38.
> - **DECISIÓN: scope a fotos fáciles** (ambiente despejado, luz pareja, piso visible, foto derecha) —
>   ahí el resultado es digno. Guía de foto agregada en el paso 1. Pasillos/luz dura/clutter quedan FUERA.
> - **Aprendizaje de proceso (mío): NO reiniciar el server viejo.** El dueño probó 2 días con un server
>   que arrancó ANTES de los endpoints nuevos → auto-perspective y render daban 404 ("hacía lo mismo" /
>   "error 404") y su veredicto negativo fue sobre features que ni corrían. SIEMPRE reiniciar el server
>   de prueba tras cambiar server.js (ver §4). Commit del enfoque: e45bca8.
> - **Pendiente si el dueño aprueba el caso fácil:** afinar variación de tono entre tablas (a veces una
>   columna sale más oscura = "raya"). Si NO aprueba ni el caso fácil → evaluar Fase 2 (relighting real,
>   GPU) o pausar. Fase 2 = descomposición intrínseca (albedo+sombra real) para manejar fotos difíciles.
>
> **AVANCE 12/8 (tarde) — PERSPECTIVA AUTOMÁTICA POR PROFUNDIDAD (Fase 1 headline) + 2 problemas más:**
> - ✅ **Perspectiva automática (problema #2 RESUELTO).** Botón **"📐 Perspectiva automática"** → `POST
>   /api/visualizador/auto-perspective` (Depth Anything v2 en Replicate, ~3-10s) devuelve el mapa de
>   profundidad; el proyector cruza profundidad+máscara y deduce el **horizonte del piso** (en un plano la
>   disparidad es lineal con la fila → extrapolando a disparidad 0 sale el horizonte, **sin FOV**) y siembra
>   el quad con la **convergencia correcta** (esquinas lejanas apuntando al punto de fuga). Validado offline
>   (overlay: el borde del quad sigue el zócalo) y end-to-end en el navegador con foto real. Reemplaza el
>   inset fijo 0,26 que ponía las esquinas lejanas flotando sobre la pared. Las 4 esquinas **siguen
>   ajustables** a mano. Código: `horizonFromDepthMask`/`perspectiveQuad` en `FloorProjector.tsx`.
> - ✅ **Slider "Perspectiva"** (manual, sin depender de profundidad): mueve el horizonte y recalcula la
>   convergencia manteniendo las esquinas cercanas → el vendedor arregla la convergencia con un gesto aunque
>   no corra la profundidad. Uniform de horizonte parametriza el quad.
> - ✅ **Slider "Integrar luz" (problema #1 mitigado):** la fuerza del mapa de luz ahora es ajustable
>   (uniform `uLight`, default 60/100·0,9 ≈ 0,54; 0 = piso plano). En vez de adivinar el valor, el dueño lo
>   baja/sube en el celular. Rango del clamp levemente más ancho (0,62–1,38).
> - ✅ **Render async server-side (problema #4 RESUELTO):** `POST /api/visualizador/refine-start` inicia el
>   job (corre en el server) y devuelve `jobId`; `GET /api/visualizador/refine-job/:id` para polling. Si se
>   apaga la pantalla del celular el trabajo igual termina en el server y se recupera al despertar (antes el
>   fetch del browser se cortaba). Jobs en memoria (Map, TTL 10min). **Verificado:** un refine de **155s**
>   sobrevivió start→polling→done. El `POST /api/visualizador/refine` viejo quedó (no se usa desde la UI).
> - **Queda abierto (necesita celular):** problema #3 (render IA difumina veta/bordes) — iteración de
>   prompt/creativity/combine, requiere prueba táctil. Cobertura: si el piso es asimétrico puede quedar un
>   triángulo sin cubrir a la derecha → se arrastra la esquina cercana (o mejorar el default de esquinas).
>   Y afinar en el celular: ¿el horizonte auto queda bien en fotos con ángulo/alfombra?

## 0. Qué es y objetivo
Herramienta para que el vendedor saque una **foto del ambiente** del cliente y vea el **piso Pacific elegido instalado**, fotorrealista y **fiel al producto exacto** (color, veta, tamaño/dirección de tabla), integrando la luz/sombras/perspectiva reales. Ruta `/visualizador`. Objetivo del dueño: **la mejor calidad del mundo** (costo no es límite).

## 1. Estado actual (qué funciona hoy)
Flujo del vendedor: **foto → elegir diseño → marcar el piso (pincel/Detectar) → Proyectar → 📐 Perspectiva automática (opcional, profundidad) → ajustar (4 esquinas, dirección, tamaño de tabla, brillo, perspectiva, integrar luz) → ✨ Renderizar (opcional, job server-side) → comparar (slider) → compartir**.

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
- **`integrations/replicate-visualizador.mjs`** — Replicate: `inpaintFloor` (FLUX Fill, IA rápida), `autoSurfaceMask` (grounded_sam), `refineRender` (magic-image-refiner), `depthMap` (Depth Anything v2, perspectiva auto), `runPrediction` (create+poll con reintento por throttle), `latestVersion`, `urlToDataUri`.
- **`integrations/gemini-image.mjs`** — Gemini 2.5 Flash Image (modo IA viejo).
- **`config/visualizador-prompts.js`** — prompts de la IA rápida.
- **`data/visualizador-textures/`** — **9 texturas reales HD** (fotos del producto del dueño, ~2256px) + `manifest.json` (id, serie H2O/Madera, size_mm, bevel, rgb stats). Servidas en **`/vis-tex/<id>.jpg`** (ruta estática en `server.js`).
- **`data/visualizador-catalogo.json`** — swatches viejos (solo paredes AcuDesign ahora).
- **server.js endpoints:** `GET /api/visualizador/catalogo` (pisos del manifest + paredes del catálogo viejo, con flags `configured`/`inpaint`), `POST /api/visualizador/render` (IA Gemini), `POST /api/visualizador/render-mask` (FLUX Fill), `POST /api/visualizador/auto-mask`, `POST /api/visualizador/auto-perspective` (Depth Anything v2 → mapa de profundidad para el horizonte), `POST /api/visualizador/refine-start` + `GET /api/visualizador/refine-job/:id` (render como job server-side, sobrevive pantalla apagada), `POST /api/visualizador/refine` (viejo, síncrono — sin uso en la UI).
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
1. ⚠️ **Luz exagerada** — MITIGADO 12/8: ahora es un **slider "Integrar luz"** (uniform `uLight`, default ≈0,54) → el dueño lo ajusta en el celular en vez de adivinar un valor. Rango del clamp 0,62–1,38. El mapa de luz sale de `uLum` (foto reducida a 40px = muy borroneada) normalizada por `uBase` (mediana de luminancia del piso). **Falta re-probar en el celular** (quizás bajar el default).
2. ✅ **Perspectiva: no cubría TODO el piso sin perder la forma** — RESUELTO 12/8 con **perspectiva automática por profundidad** (botón "📐 Perspectiva automática" → Depth Anything v2 → horizonte → quad con convergencia correcta) + **slider "Perspectiva"** manual. Ver el bloque de AVANCE arriba y §6. Descartado: punto de fuga manual (estiraba las tablas).
3. **Render (IA): veta no nítida + bordes/muebles difuminados + foto saturada/manchada.** El refinador (magic-image-refiner) difumina los encuentros con muebles y satura. Hay que: bajar más la luz, quizás bajar creativity, o mejorar el combine para no difuminar bordes (el blend de máscara). **SIGUE ABIERTO — necesita iteración en el celular.**
4. ✅ **El render tardaba ~40-96s y se cortaba con la pantalla apagada** — RESUELTO 12/8: job server-side (`refine-start` + `refine-job/:id` con polling). Verificado con un render de 155s. Ver el bloque de AVANCE arriba.

## 6. EL PLAN (investigación profunda ya hecha) — próximos pasos
**Documento del plan (artifact):** https://claude.ai/code/artifact/54a5084c-f89c-4ed7-8f18-f504dca84dd7

**Hallazgo clave (verificado vía patentes de Leap Tools/Roomvo — US 11.770.496 / 11.769.195 / 11.210.732):** el líder mundial **NO usa 3D ni IA generativa**. Usa EXACTAMENTE nuestro camino: segmentar piso 2D → **homografía** → **mapa de luz** (luminancia YUV de la foto **borroneada**, normalizada, **multiplicada** sobre la textura) → síntesis estocástica de tabla → blend de bordes. **Estamos al ~80%.**

**Fase 1 (HECHA):**
- ✅ **Mapa de luz** (técnica de Roomvo) — HECHO (commit `3eeea83`), suavizado el 12/8, ahora con slider "Integrar luz".
- ✅ **Perspectiva automática por profundidad** — HECHO 12/8. La clave que destrabó la "calibración": **NO hace falta el FOV.** En un plano, la disparidad (Depth Anything v2, `chenxwh/depth-anything-v2`) es **lineal con la fila de la imagen** → se ajusta `disp = a·fila + b` sobre las filas del piso (máscara) y se **extrapola a disp=0 → fila del horizonte**. Con el horizonte + el centro de fuga (centroide x del piso), el quad se construye con la convergencia geométricamente correcta (esquinas cercanas → esquinas lejanas apuntando al punto de fuga V=(cx,yH)). NO se reconstruye 3D ni se resuelve homografía por RANSAC — es 1 regresión lineal robusta. Validado offline (overlay pega en el zócalo) y en el navegador. Implementación: `horizonFromDepthMask` + `perspectiveQuad` en `FloorProjector.tsx`; endpoint `auto-perspective` en `server.js`; `depthMap` en `replicate-visualizador.mjs`. **Afinar:** el centro de fuga por centroide se sesga si el piso es asimétrico (pasaje/opening) → el dueño corrige con el slider "Perspectiva" o arrastrando; a futuro estimar cx por convergencia de los bordes izq/der del piso.

**Fase 2 (mejor que Roomvo, requiere GPU propio):**
- **Descomposición intrínseca** (Careaga & Aksoy — `compphoto/Intrinsic`, open weights, "Colorful Diffuse" TOG'24): separar la foto en **albedo + sombreado coloreado real** → `luz real × nuevo piso` → integración física perfecta (reemplaza el mapa de luz aproximado). Correr en Modal o deploy custom en Replicate.
- **PBR por piso:** normal + roughness reales (Material Palette, o fotos de tabla con luz rasante) → biseles/brillo verdaderos + veta nítida.

**Fase 3 (opcional):** difusión bloqueada (FLUX-Depth + FLUX-Redux/IP-Adapter) para pulido foto-real sin correr color/estructura (reemplaza magic-image-refiner que difumina).

**Descartado (no repetir):** 3D/AR (RoomPlan = LiDAR+iOS, pierde alcance), Gaussian Splatting/NeRF (experimental en web), img2img generativo a secas (destruye las tablas), punto de fuga manual (estira la textura).

## 7. Modelos/APIs (con qué corre cada cosa)
| Para | Modelo | Dónde |
|---|---|---|
| Profundidad (perspectiva auto) | `chenxwh/depth-anything-v2` | Replicate ✅ **en uso** (`auto-perspective`) |
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
