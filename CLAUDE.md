# CLAUDE.md — Pisos Pacific App

Guía para cualquier sesión nueva de Claude. Complementos: `Context.md` (negocio, modelo de datos, conciliación histórica) y `LAUNCH.md` (runbook del lanzamiento). **Este archivo es la fuente de verdad del estado del proyecto.**

> **REGLA DE MANTENIMIENTO (pedida por el dueño):** cada vez que cambie el estado del proyecto (feature nueva, decisión, deploy, bug importante), actualizá las secciones **"Decisiones tomadas"** y **"Estado actual y próximos pasos"** de este archivo SIN que te lo pidan.

---

## 1. Qué es la app

App de gestión de **Pisos Pacific**, importador argentino de pisos de madera de ingeniería y vinílicos (dueños: Juan Rodriguez Momesso y Pipi Collado). Opera en **USD + ARS** (consolidación a USD, TC 1400). Cubre: Dashboard P&L, CashFlow (6 cajas) con importación/conciliación de extractos, Ventas/Cotizaciones (con PDF), Clientes/Proveedores, Inventario, Agenda, Leads y Mensajes (WhatsApp/Instagram/Email unificados).

- **LIVE en producción:** https://pisos-pacific.onrender.com (datos reales).
- Login: `info@pisospacific.com` (usuarios en `db.json`).
- ACUDESIGN = entidad relacionada que vende Paneles; sus cobros entran como `Venta - No Pisos`. La cuenta de Mercado Pago es de ACU Design.

## 2. Arquitectura

```
server.js          Express ESM. DB en disco data/db.json (env DB_PATH; /var/data en Render).
                   CRUD genérico /api/*, auth por cookie pp_session, /healthz, /privacy.
                   Schedulers: mpAutoSync (boot+6h, guard 20h) y gmailAutoSync (boot+15min).
dashboard-app/     Vite + React 19 + TS + shadcn/ui + react-router. Hook useApi → /api/*.
import/            mp-api.mjs (sync MP por API, async start/poll) · statements.mjs (parsers
                   MP/BBVA/BdC + _enrich) · dedup.mjs (dedupKey + windowKeys fecha±3+monto) ·
                   report-stats.mjs.
integrations/      gmail.mjs (leads por email + parsing form Framer) · meta.mjs (webhooks
                   WhatsApp/IG + sendOutbound de los 3 canales) · mailer.mjs (envío SMTP-less
                   vía Gmail API, RFC2047) · google-oauth.mjs (refresh tokens).
pdf/               render.mjs (pdfkit Node puro — presupuesto "Cabezal Oscuro" + remito),
                   fonts/ (Inter OTF), assets/ (PNG con excepción en .gitignore).
scripts/           importadores históricos re-ejecutables (ver Context.md §8) + debug-e2e.mjs
                   (sweep Playwright de toda la app).
data/              *.seed.json, db.bootstrap.json (snapshot para primer boot en prod),
                   counterparty-map.json (auto-clasificación), sources/.mp-oauth.json (gitignored).
render.yaml        Blueprint de Render. Dockerfile alternativo para VPS.
```

Modelo de datos del cashflow, cajas y los 9 tipos de gasto canónicos: ver `Context.md` §3.

## 3. Correr, testear, deployar

```bash
export PATH="$HOME/.local/node-v22.12.0-darwin-arm64/bin:$PATH"   # Node 22 local
cd ~/pisos-pacific-app
PORT=4173 node server.js                 # backend local (sirve el SPA buildeado)
cd dashboard-app && npm run build        # build frontend (tsc -b && vite build)
node scripts/debug-e2e.mjs               # E2E Playwright de todas las páginas
```

- **Reseed local**: `rm -f data/db.json data/db.json.bak` y reiniciar (OJO: pisa ediciones runtime).
- **Git/Deploy**: repo privado `juanrmomesso-pisospacific/pisos-pacific-app` (token en osxkeychain, `git credential fill`). `main` = default y **auto-deploya a Render** al pushear. Patrón usado: trabajar en `feature/data-import-cashflow`, luego `git branch -f main HEAD && git push origin main` (+ push del feature branch).
- **Render**: servicio `srv-d8jsecjbc2fs73a16l40` (Starter, disco en /var/data). Health check **`/healthz`** (NO /api/auth/me — da 401 y rompe el deploy). ⚠️ Cambiar env vars por API NO redeploya solo → `POST /deploys`. API key de Render la tiene el dueño.
- Verificación post-deploy: `curl https://pisos-pacific.onrender.com/healthz` → 200, y login 200.

## 4. Integraciones externas

| Integración | Cómo está configurada |
|---|---|
| **Mercado Pago** | OAuth `client_credentials` (client_id `4818908689453036`; secret en env `MP_CLIENT_ID/SECRET` en prod, local en `data/sources/.mp-oauth.json` gitignored). Sync automático diario del settlement_report (`mpAutoSync`); los reportes tardan 10–25+ min → job persistente `mp_pending_job` + lock. **La API NO da nombres de contraparte** (veredicto cerrado, ver §Decisiones) → enriquecimiento retroactivo con el export manual mensual. Forzar: `POST /api/import/mp-sync/auto-run`. |
| **Instagram** | App Meta "Pacific" (developers de juanrmomesso@gmail.com), flujo "Instagram con login de Instagram": token IGAA + `graph.instagram.com/v21.0` (NO graph.facebook.com). Webhook `/api/instagram/webhook`, app en modo **Live** (obligatorio para recibir; requirió `/privacy`). Sin App Review (cuenta propia). Token IG ~60 días, refresh manual por ahora. |
| **WhatsApp** | ✅ CONECTADO (cloud-only, 13/6/2026). Número +54 9 11 2331-3914, Phone Number ID `1181454371716547`, WABA `1337819171010414`, App ID `2058184791766963`. Tokens `WHATSAPP_TOKEN` (permanente, System User) + `WHATSAPP_PHONE_ID` en Render. Webhook `/api/whatsapp/webhook` (verify `pisospacific2026`), campo `messages`, **WABA suscrita a la app vía `subscribed_apps`** (clave: si los entrantes no llegan, revisar esto). Modo cloud-only → NO instalar la app de WhatsApp con ese número. Detalle/troubleshooting en `WHATSAPP-SETUP.md` y memoria `whatsapp-integration`. |
| **Gmail** | OAuth in-app: `GET /api/integrations/google/connect?account=pacific|acudesign` → refresh_token a `db.settings.integrations.google` (hidratado a env al boot). `pacific` = info@pisospacific.com (leads + envío de mails, recuperación de contraseña); `acudesign` = infoacudesign@gmail.com (cuenta MP). Sync de leads cada 15 min, filtro de robots con excepción presupuesto/consulta, parsing del form web de Framer. |
| **Render** | Ver §3. Bootstrap de datos: `data/db.bootstrap.json` se carga en el primer boot si no hay db. |

Env vars completas: `LAUNCH.md` §6. Secretos: nunca en el código ni en este archivo; viven en env de Render / keychain / archivos gitignored.

## 5. Convenciones de código

- ESM en todo (`.mjs` para módulos sueltos). Sin framework de tests; verificación = build TS + `scripts/debug-e2e.mjs` + prueba manual en prod.
- Helpers compartidos antes que duplicar: `import/dedup.mjs` (dedupKey/windowKeys), `import/report-stats.mjs`, `integrations/google-oauth.mjs`, `lib/messaging.ts` (`channelIcon`), `components/FormError`.
- Dedup canónico de movimientos: **fecha ±3 días + monto** (`windowKeys`).
- Commits en español, descriptivos del cambio de negocio.
- UI en español; shadcn/ui; períodos vía `usePeriod()` global (no estado local por página).
- Al importar/cargar contrapartes, pasar por `data/counterparty-map.json`.
- Flujo de calidad usado: `/code-review` + `/simplify` + commit antes de features grandes.

## 6. Decisiones tomadas

**Negocio / datos**
- **Moneda de consolidación USD, TC 1400** — preferencia del dueño para unificar el P&L.
- **"Tipo de Gasto" (9 canónicos) es la dimensión primaria del P&L**, no Categoría — así lo lee el dueño.
- **Transferencias entre cuentas fuera del P&L** pero cuentan para saldo de caja.
- **Gastos personales se cargan** (Gastos de Personal, contraparte "Juan & Pipi") — para que el saldo de caja cierre.
- **Fletes de terceros → "Gastos de Instalaciones y Suministros" / Logística** (COGS); "Flota/Vehículos" = solo flota propia. **COMEX queda en COGS como costo de importación** (impacta directo al producto).
- Colocadores/staff/contrapartes: reglas confirmadas en `data/counterparty-map.json` (Ariel Noruega→Ariel Ernesto Garcia; Oso y Maldo NO son colocadores; etc.).
- **Peajes MP (<$6.000) se agrupan en 1 egreso de Flota por día** — ruido si van sueltos.
- **Rendimientos MP (interés) se filtran** del sync — no son operaciones.

**Mercado Pago**
- **Conexión por OAuth `client_credentials`** (el access token del panel da 401/403 PolicyAgent). MP rota el secret al tocar la config OAuth.
- **VEREDICTO CERRADO (11/6/2026): ninguna API/reporte programable de MP expone el nombre de la contraparte** (PAYER_NAME en egresos = uno mismo; METADATA = device_id). Los nombres solo están en el export manual "Todas las transacciones" (account_statement). El email programado de MP manda LINK, no adjunto → tampoco sirve.
- **Solución: enriquecimiento retroactivo (`_enrich`)** — el sync diario inserta sin nombre (needs_review); cuando el dueño sube el account_statement mensual, las filas con nombre ACTUALIZAN esos movimientos (match fecha±3+monto) con nombre+clasificación en vez de descartarse como duplicados. Elegido para eliminar el etiquetado manual.

**Infra / lanzamiento**
- **Render Starter (~$7,25/mes)** — la app es stateful (db.json en disco): Vercel/Firebase no sirven. Barato pero 100% funcional, criterio del dueño.
- **Bootstrap por `db.bootstrap.json` commiteado** (repo privado) en vez de subida manual — primer boot carga los datos solos.
- **Health check `/healthz` público** — /api/auth/me daba 401 y hacía fallar el deploy.
- **Seguridad del login**: sin credenciales visibles en la página; cambiar contraseña desde el menú; recuperación por email (token + `/reset`). Pedido explícito del dueño.

**Meta / Mensajes**
- **WhatsApp en modo cloud-only** (no Coexistence): el número vive en la Cloud API y se opera 100% desde la app; NO se usa en la app verde del celular (rompería la conexión). Se eligió por simplicidad/robustez; catálogo se gestiona desde Meta Commerce Manager, difusión por templates. El código de Coexistence (espejado `smb_message_echoes`) quedó en `meta.mjs` pero inactivo en este modo.
- **Lección de conexión WhatsApp:** la app de developers era de Juan pero el negocio Pacific es de **Vicky**; la app no se conectaba al portfolio. Se resolvió agregando a Vicky como admin de la app y conectando desde su sesión (la dueña del negocio). Y los entrantes NO llegan hasta hacer `POST {WABA}/subscribed_apps` (suscribir la WABA a la app) — el "verificar webhook" solo no alcanza.
- **Auto-refresh de Mensajes** (13/6/2026): la bandeja se actualiza sola por polling (`useApi` con `pollMs`; conversaciones cada 8s, mensajes de la conversación abierta cada 5s) — sin recargar la página, sin saltar el scroll. No hay websockets (stack con db.json en disco).
- **Instagram primero; WhatsApp después con un número NUEVO dedicado** (decisión del dueño).
- **La app Meta debe estar en modo "Live"** para recibir webhooks (en desarrollo no entrega); Live exigió página `/privacy`. No hizo falta App Review (cuenta propia del negocio).
- Juan configuró la app de developers solo (no pudo unirse al Business "Pacific" — saga de bloqueos documentada en la memoria; no re-pelear).
- **Canal Email dentro de Mensajes** (pestaña Mails): emails entrantes = conversaciones; el form web de Framer se parsea a lead enriquecido (m², radio); filtro de robots con excepción presupuesto/consulta.
- `sendOutbound()` en `meta.mjs` es el único despachador de salientes (whatsapp/instagram/email).

**PDF**
- **Motor pdfkit en Node puro** (`pdf/render.mjs`) — Python/reportlab no existe en Render ("pdf generation failed"). Diseño "Cabezal Oscuro" (handoff del diseñador, jun-2026).
- **Auto-fit a 1 página** (medir y escalar; truco `doc.page.height=1e6` para anular la auto-paginación de pdfkit). Fuentes **Inter OTF** embebidas (woff2 rompe fontkit). `.gitignore` necesita excepción `!pdf/assets/*.png`.
- **Columnas adaptativas al ancho de los montos** (valores grandes rompían el layout) y **sin fila de subtotal en presupuestos de una sola zona** — pedidos del dueño.
- Nombre de archivo: `Presupuesto N{nro} - {Obra} - {Cliente}.pdf`. Quote tiene `public_notes` (Observaciones) y `payment_terms` editable con default **"Anticipo 80% · Conforme 20%"**; ambos se copian a la venta al convertir.

**UI**
- **Filtro de período ÚNICO y GLOBAL** (`PeriodContext`): una sola fuente de verdad para Dashboard + CashFlow + Reportes; atajos `QuickPeriod` por página sincronizados al global; ✕ Limpiar cuando no es default; acento ámbar en Custom; NO se persiste entre sesiones (cada carga arranca en default). Default actual: **"Últimos 3 meses"** (`DEFAULT_PRESET` en `lib/period.ts`). El análisis devengado del Dashboard clampea desde 2026-01-01.

## 7. Estado actual y próximos pasos

_Actualizado: 2026-06-16. Producción deployada y verificada (healthz 200, webhook WA OK). Roadmap de 6 frentes aprobado en `~/.claude/plans/majestic-sniffing-gray.md`._

**Terminado y verificado en prod**
- Lanzamiento completo: GitHub + Render + bootstrap de datos reales.
- MP 100% automático (sync diario + enriquecimiento retroactivo mensual). Probado: "+10 nuevos".
- Instagram DMs entrantes/salientes funcionando (app Live).
- **WhatsApp conectado (cloud-only) y probado ida/vuelta** (Frente 1). Ver fila WhatsApp en §4 y memoria `whatsapp-integration`.
- **Auto-refresh de Mensajes** (polling, sin recargar) — probado con Playwright E2E.
- **Mensajes/Leads:** filtros por **No leídos** y **vendedor asignado / sin asignar** (vendedor = del lead vinculado); en el composer **Enter = salto de línea, Shift+Enter = enviar**. **Dedup de leads:** `integrations/lead-match.mjs` (`findLeadMatch` por email/teléfono/nombre) usado en meta.mjs + gmail.mjs → reusa el lead existente y vincula la conversación (no duplica por multicanal/repetido). Para los ya existentes: `POST /api/leads/:id/merge` + sección "Posibles duplicados" con **Unificar** en LeadsPage.
- **MP — arreglos base (revisión 15/6):** enriquecimiento matchea por **id de operación** (exacto, `mp_op_id`) con fallback a fecha±3+monto; egresos sin nombre → categoría **"Sin clasificar"** con `expense_type` definido; **TC Blue en vivo** compartido (`import/fx.mjs`). Verificado: la API de MP NO da nombres (los nombres vienen del export manual).
- **S2 — reglas de clasificación editables + que aprenden:** las reglas viven en `db.cp_rules` (sembradas 1 vez de counterparty-map.json), editables desde **Configuración → Reglas de clasificación** (`RulesManager`). Al **clasificar un movimiento** en el Libro (acción Tag → `ClassifyMovementForm`) se asigna proveedor/categoría/tipo y se **aprende la regla** (nombre→clasificación) para la próxima importación. `parseStatement` recibe `db.cp_rules`; `setRules`/`buildCpmap` en statements.mjs. Bot de gastos por WhatsApp ahora **pregunta el proveedor** (#4).
- **Libro diario** muestra **ARS y USD** (ambas columnas, ordenables).
- **IVA en ventas:** la cotización sale siempre con IVA 21% (default); la venta tiene un editor (Sin IVA / IVA 21% / **monto fijo** parcial) en el detalle que recalcula el total (`iva_mode`/`iva_amount` en Sale; `IvaEditor` en VentasPage). La conversión cotización→venta arranca con el IVA de la cotización.
- **Navegación cruzada:** click en cliente (Clientes) → detalle con sus cotizaciones + ventas + botón Chat; cotización/venta → "Abrir chat" (acciones de fila + detalle) que abre la conversación del contacto. Helper `lib/chat.ts` (`findConvId`); MensajesPage resuelve `/mensajes?client=&phone=&email=`.
- **Ventas tipo planilla:** la tabla de Ventas tiene headers ordenables (cliente, estado, fecha, total, saldo), como Clientes.
- **UX Tanda 2a — confirmaciones (17/6):** `ConfirmProvider`/`useConfirm()` (`components/ui/confirm.tsx`, modal radix-dialog, montado en App.tsx) reemplaza los `window.confirm`. Aplicado a las acciones peligrosas: **Cancelar venta**, **Finalizar (descontar stock)**, **Rechazar cotización**, **Renovar vigencia**, **Unificar leads** (muestra a qué lead fusiona), **Borrar regla** de clasificación. **(2b)** Compartir cotización ya NO usa `window.prompt`/`alert`: `ShareQuoteSheet` (RowActions) = panel con mensaje editable (textarea), botones WhatsApp/Email con feedback inline, y link público copiable. **(2c)** Estados en español: helper `statusLabel` (RowActions, traduce DRAFT/SENT/ACCEPTED/REJECTED) usado en ClientesPage y `LeadQuoteRow`; estado de entrega del mensaje traducido (`DELIVERY_LABEL`: enviado/entregado/leído). **(2d)** Estados de carga/error: componente `components/ui/data-state.tsx` (`DataState` — skeleton mientras carga, tarjeta "Reintentar" si falla, solo cuando NO hay datos aún) aplicado a Dashboard, Cajas, Ventas, CashFlow (las páginas con plata) → el cold-start ya no se ve como "sin datos". **Tanda 2 completa.**
- **Mensajes Tanda 3 (17/6):** (1) **Salientes de Gmail espejados**: `syncGmailSent` (gmail.mjs) lee la carpeta Enviados (`in:sent newer_than:90d`) y agrega los mails que mandamos como mensajes `direction:'out'` en las conversaciones de email existentes (NO crea conversaciones nuevas) → se ve el hilo completo, incluso lo respondido directo desde Gmail. Dedup por id de Gmail (`gmail_sent_seen_ids`) + heurística de tiempo (±3 min de un saliente ya registrado) para no duplicar lo que la app ya mandó (el mailer también deja copia en Enviados). Corre en `gmailAutoSync` (cada 15 min) y en el endpoint manual. (2) **Vincular a lead existente**: el ContactPanel ofrece un `SearchPicker` de leads (además de "Crear lead nuevo") → PATCH `linked_lead_id`, no duplica.
- **Mensajes — fotos/adjuntos entrantes (16/6):** los mensajes que no son texto (foto, audio, video, doc, sticker, reacción, respuesta a historia) ya NO se descartan. WhatsApp/IG mandan media como URL temporal (IG) o id (WA) → `parseWhatsApp/parseInstagram` devuelven un descriptor `media`, y `persistInboundMedia` en server.js la **baja y guarda en UPLOAD_DIR** (`/uploads/...`, permanente) seteando `media_url`/`media_type` en el mensaje. La burbuja (`Bubble` en MensajesPage) renderiza `<img>/<video>/<audio>`/link. WA necesita `WHATSAPP_TOKEN` para bajar la media (resuelve el id con Graph).
- **Mensajes — ciclo de vida + limpieza (16/6):** se puede **cerrar/archivar y reabrir** una conversación y **marcar como no leída** (menú ⋯ del header del chat → PATCH `/api/conversations/:id`). La lista **oculta las cerradas** por defecto (toggle Abiertas/Cerradas) y ordena por **fecha (más nuevo primero)** — estable, como una bandeja de mail; el no-leído se ve con el globito + el filtro "No leídos". (Se probó "no-leídas primero" pero confundía: mails viejos sin leer saltaban arriba y se reordenaban al abrirlos.) **Limpieza de bandeja de email** (Configuración, solo admin): `POST /api/admin/cleanup-email-leads` ({commit}) → (1) **revincula** conversaciones de email a su lead por email (arregla las que quedaron sin `linked_lead_id`), (2) marca **Contactado** los leads (en New) a los que ya respondimos desde Gmail (lee carpeta Enviados vía `listSentRecipients` en gmail.mjs), (3) limpia no-leídos. Dry-run por defecto, `commit:true` aplica. UI con preview en `ConfiguracionPage` (`EmailCleanupSection`).
- **Seguridad de datos (16/6, P0 del QC):** `save()` ahora es **atómico** (escribe `.tmp` + `rename`) y hay **flush en SIGTERM/SIGINT** (no perder cambios en deploys). Si `db.json` existe pero **no parsea**, el server **respalda (`.corrupt-<ts>`) y aborta** el arranque en vez de re-seedear encima (antes: un reinicio mal timed con DB truncada pisaba TODOS los datos reales con el bootstrap). Probado.
- **Inventario — export + orden + filtros (16/6):** botón **Exportar** (antes muerto) descarga `control-stock-AAAA-MM-DD.csv` como **planilla de relevamiento** (SKU/Nombre/Categoría/Stock sistema m²/Cotizado/Disponible + columnas **en blanco** Conteo físico/Diferencia/Observaciones para el depósito); Extras exporta SKU/Nombre/Categoría/Costo/Precio/Margen. Exporta lo que se ve (respeta categoría, búsqueda, Activos/Inactivos y orden). Headers ordenables en todas las columnas + filtro **Activos/Inactivos/Todos** + contador. Helper reusable `lib/export.ts` (`downloadCSV`, BOM UTF-8 + comillas escapadas). Probado E2E. **Pendiente:** el botón **Importar** sigue sin cablear (importar stock = parseo + match SKU, feature aparte).
- **Email con adjuntos:** `mailer.mjs sendMail` soporta `attachments` (multipart/mixed). Compartir presupuesto / enviar archivos por email manda el **PDF adjunto** + cuerpo + firma (un solo mail, no link pelado) — share-quote, send-file, /quotes/:id/share. El **mensaje al cliente es editable** (param `message`, default si vacío): textarea en el chat al compartir, prompt en el menú de la cotización. El prefill del lead toma el email del contacto en conversaciones de email.
- **Firmas de email:** los mails a clientes desde Mensajes salen en HTML con la firma del usuario que responde (Juan o Victoria, `signatureFor` por email/nombre). Firmas email-safe del handoff en `assets/firma/` (servidas en `/firma/`); el cuerpo va como HTML (`emailHtml`) + firma. Composer de Mensajes ahora redimensionable (`resize-y`, más alto) para ver el borrador completo.
- **Compartir presupuesto (B):** en la cotización → "Compartir por WhatsApp" (PDF como documento, `sendWhatsAppDocument`), "Enviar por email" (link al email del cliente + firma) y "Copiar link (Instagram)" (link público `GET /p/q/:id/:token`, token `quote.share_token`). Endpoint `POST /api/quotes/:id/share` ({whatsapp,email}). Desde el **chat**: sección "Compartir presupuesto" (`/api/conversations/:id/share-quote`) + **adjuntar/arrastrar archivos** (PDF/imagen) al thread → `/api/conversations/:id/send-file` (UPLOAD_DIR en disco, `/uploads` público, manda por el canal y lo registra en el chat).
- **Frente 2 — Efectivo:** form "Gasto en efectivo" + ajustes a "Nuevo movimiento" (Tipo de Gasto primero → cascada Categoría/Sub vía `lib/cashflow.ts`; Proveedor/Cliente buscable con crear-nuevo). **Bot de gastos por WhatsApp** (`import/cash-parse.mjs` + `handleCashReport` en meta.mjs): teléfonos en `CASH_ALLOWLIST` reportan `gasto 29000 ferretería` al número del negocio → conversación que repregunta → registra en Caja General (CAJ-005), `cancelar` deshace; **nunca** crea lead/conversación de cliente. Probado E2E.
- Gmail dual conectado: leads por email + canal Mails en Mensajes (29 leads web reales) + recuperación de contraseña.
- PDF nuevo (Cabezal Oscuro) con todos los pedidos del dueño.
- Filtro de período global unificado.
- Seguridad de login. Tres pasadas de `/simplify` + `/code-review` high + sweep E2E (14 páginas OK).
- **Limpieza (`/simplify` 16/6):** saludo por defecto del presupuesto en una sola fuente por lado (`defaultQuoteMessage` en server.js, `quoteShareMessage` en `lib/chat.ts`) — antes 4 copias que habían divergido (server sin número vs front con número); ahora el mail = lo que se ve en el textarea. PDF en `/api/quotes/:id/share` se genera una vez (no dos cuando WhatsApp+email); `digits` exportado y reusado; prop muerta `linkedLead` quitada de `LeadQuoteRow`. **Hotfix 16/6:** ese `/simplify` había envuelto `contactQuotes` en `useMemo` PERO ese bloque corre después del early-return `if (!conversation)` de `ContactPanel` → violaba las reglas de hooks y crasheaba **toda la página de Mensajes** al abrir una conversación ("Rendered more hooks than during the previous render"). Revertido a cálculo plano (sin hook). LECCIÓN: nunca poner un hook (useMemo/useState/etc.) después de un return condicional. _Pendientes recomendados (van con test local antes de deploy): unificar la triplicación de los endpoints de envío (`shareQuoteVia`/`recordOutbound`), centralizar el dedup de leads del front (`/api/leads/duplicates` reusando `findLeadMatch`), y `signatureFor` por campo de usuario en vez de string-match._

**A medias / rutinas del dueño**
- **Cambiar contraseñas**: admin sigue `admin123`; juan/vicky débiles (menú usuario → Cambiar contraseña).
- **Rutina mensual MP**: bajar "Todas las transacciones" del panel y subirla en CashFlow → Importar extracto → Mercado Pago (archivo) → enriquece los movimientos sin nombre (hoy hay 4).

**Seguridad backend — HECHO (16/6, commit del batch de seguridad):**
- ✅ Webhooks de Meta validan `X-Hub-Signature-256`. **WhatsApp: enforce** con `META_APP_SECRET` (sin firma válida → 403, confirmado). **Instagram firma con SU PROPIO secret** (gotcha Meta confirmado por logs: con `META_APP_SECRET` da "firma INVÁLIDA") → `metaSignatureOk(req, channel)` usa `IG_APP_SECRET` para IG. **Estado (17/6): IG enforce ACTIVO** — `IG_APP_SECRET` cargado en Render y verificado en prod (DM de prueba validó firma, sin "firma INVÁLIDA"). Instagram quedó 100%: entrantes texto+fotos+reacciones, salientes, y firma de webhook verificada. El Instagram App Secret se saca de developers.facebook.com → app Pacific → producto Instagram → configuración de la API (NO es el de Settings→Basic).
- ✅ `/api/payment-links/:id/simulate-paid` solo funciona para links `mode:'mock'` (los `live` solo se cobran por el webhook de MP).
- ✅ Control de rol: `requireAdmin` gatea escrituras financieras/config — CRUD de `cashflow/cajas/cp_rules/categories/expenses`, `PATCH /api/settings`, todos los `/api/import/*` y `gmail/sync`. Un vendedor NO puede tocar caja/reglas/imports pero SÍ crea cotizaciones/leads/clientes. Probado (admin 200 / vendor 403). El bot de efectivo por WhatsApp (CASH_ALLOWLIST) no usa sesión → sigue andando.

**Pendientes del Quality Check (16/6) — priorizar con el dueño**
- **SEGURIDAD (resto):** filtrar GET `/api/sales` y `/api/quotes` por `seller_name` para no-admin (necesita que el front maneje datos parciales: dashboard/reportes) y **ocultar la navegación financiera a vendedores** en el front (hoy el backend ya los bloquea con 403 pero la UI se los muestra).
- **CORRECTITUD P1 — HECHO (17/6):** ✅ timeouts en TODOS los `fetch` externos (helper `integrations/http.mjs` `withTimeout`, 20s, en meta/gmail/mailer/google-oauth/mp-api) → ya no cuelgan requests ni dejan un scheduler trabado. ✅ anti-duplicados de entrantes por id de Meta (`db.settings.inbound_seen_ids`, chequeo+marca síncronos antes del bot de efectivo y del alta) → Meta reintenta sin duplicar gasto/mensaje. ✅ estado de entrega WhatsApp: se procesa el webhook `statuses` (enviado→entregado→leído / failed) por `wa_id`. ✅ `share` matchea conversación por número completo (no sufijo de 8). **Pendiente menor:** reconciliación de cobros por `sale_ref` vs `quote_number` (revisar el contrato); inbound sigue fire-and-forget (si querés a prueba de fallos totales, falta una cola).
- **UX/UI (quick wins):** `useApi` ya expone `loading`/`error` pero todas las páginas los descartan → en cold start de Render se ve "sin datos" en vez de "cargando" (riesgo en app financiera); flujo de compartir cotización usa `window.prompt`/`alert` nativos (acción más usada y menos pulida) → pasar a Sheet con textarea; status en inglés crudos a la vista (usar `StatusBadge` que ya existe); acciones destructivas sin confirmar (Cancelar venta, Finalizar-descuenta-stock, Unificar leads) → `AlertDialog`; Mensajes/Agenda casi inusables en móvil; formateadores de moneda/fecha duplicados (unificar en `lib/utils`).
- **Mensajes (resto):** ingestar también salientes de Gmail (`from:me`) para ver el historial completo; "Vincular a lead existente" en el ContactPanel (hoy solo "Crear lead" → duplica); back-fillear lead en inbound cuando la conversación ya existe sin lead.

**Flujo de fondos / Estado de flujo de efectivo (pedido del dueño 17/6 — al roadmap)**
- **Directo: viable YA** con los datos actuales (2.320 movimientos de cashflow clasificados por caja/`expense_type`/categoría). Armar secciones Operación/Inversión/Financiación, ARS+USD (USD al blue), por período. Es la opción más fiel a la realidad (negocio mayormente de caja) y la de mayor valor inmediato.
- **Indirecto (método contable, parte de la ganancia devengada): NO sale completo hoy.** Faltan, en orden de importancia: (1) **Cuentas por pagar** a proveedores (hoy solo se registra el pago en efectivo, no la deuda devengada → `expenses` está vacío); (2) **bienes de uso + amortización** como registro contable (hoy "Depreciación y Amortización" se carga como egreso de caja, conceptualmente mal); (3) marcar **préstamos/aportes/retiros** para la sección Financiación; (4) **snapshots históricos** de cobrar/inventario/pagar (la DB guarda solo la foto actual → para los "Δ" del indirecto hay que reconstruir o empezar a snapshotear). Piezas que SÍ hay: ganancia aproximable (Σ `contract_total` − costos), cuentas por cobrar (ventas con `balance_due`), inventario (stock×costo).
- Cuando se encare: empezar por el **directo** (entrega valor solo); el indirecto recién después de sumar cuentas por pagar + bienes de uso.

**Próximos pasos** (roadmap completo en el plan aprobado)
1. Resto de frentes del roadmap: Mensajes templates/orden (Frente 3), banco de imágenes (Frente 4), vista simple Ventas (Frente 5), testear inspección (Frente 6). [Frente 1 WhatsApp ✅ · Frente 2 Efectivo ✅]
2. **WhatsApp**: si el saliente alguna vez falla por billing, agregar método de pago a la WABA. Token IG/WA pueden vencer → automatizar refresh.
3. Backlog viejo (Context.md §7): cuenta BdC USD sin movimientos; selector de plantillas PDF en UI; dashboard de márgenes; disparar imports desde mails del banco.
