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

_Actualizado: 2026-06-13. Producción deployada y verificada (healthz 200, webhook WA OK). Roadmap de 6 frentes aprobado en `~/.claude/plans/majestic-sniffing-gray.md`._

**Terminado y verificado en prod**
- Lanzamiento completo: GitHub + Render + bootstrap de datos reales.
- MP 100% automático (sync diario + enriquecimiento retroactivo mensual). Probado: "+10 nuevos".
- Instagram DMs entrantes/salientes funcionando (app Live).
- **WhatsApp conectado (cloud-only) y probado ida/vuelta** (Frente 1). Ver fila WhatsApp en §4 y memoria `whatsapp-integration`.
- **Auto-refresh de Mensajes** (polling, sin recargar) — probado con Playwright E2E.
- Gmail dual conectado: leads por email + canal Mails en Mensajes (29 leads web reales) + recuperación de contraseña.
- PDF nuevo (Cabezal Oscuro) con todos los pedidos del dueño.
- Filtro de período global unificado.
- Seguridad de login. Dos pasadas de `/simplify` + `/code-review` high + sweep E2E (14 páginas OK).

**A medias / rutinas del dueño**
- **Cambiar contraseñas**: admin sigue `admin123`; juan/vicky débiles (menú usuario → Cambiar contraseña).
- **Rutina mensual MP**: bajar "Todas las transacciones" del panel y subirla en CashFlow → Importar extracto → Mercado Pago (archivo) → enriquece los movimientos sin nombre (hoy hay 4).

**Próximos pasos** (roadmap completo en el plan aprobado)
1. Resto de frentes del roadmap: efectivo separado (Frente 2), Mensajes templates/orden (Frente 3), banco de imágenes (Frente 4), vista simple Ventas (Frente 5), testear inspección (Frente 6).
2. **WhatsApp**: si el saliente alguna vez falla por billing, agregar método de pago a la WABA. Token IG/WA pueden vencer → automatizar refresh.
3. Backlog viejo (Context.md §7): cuenta BdC USD sin movimientos; selector de plantillas PDF en UI; dashboard de márgenes; disparar imports desde mails del banco.
