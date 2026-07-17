# Plan Internacional — Pisos Pacific como producto multi-operación

_Creado: 2026-07-15. Reescrito el mismo día tras refinamiento del dueño. Estado: **FASE 0 IMPLEMENTADA Y VERIFICADA (15/7)** — ver "Fase 0 — resultado" abajo. Siguiente: Fase 1 (levantar instancia Panamá) cuando el dueño confirme marca/banco/catálogo._

## Fase 0 — resultado (15/7)

Implementado completo y verificado en los DOS perfiles (E2E AR sin regresiones + ciclo Panamá core por API y UI):

- **Config de operación** en `db.settings` (backfill idempotente, defaults = AR): `company` (nombre/web/email/garantía/nota FX del PDF), `tax` {rate,label}, `currency` {local, fx_provider blue|fixed, fx_rate}, `locale`, `modules`. Expuesta al front por **`GET /api/config`** (subset seguro, sin tokens) → `ConfigContext` (`useConfig`/`useModules`/`moduleOn`/`taxWord`).
- **FX provider** (`import/fx.mjs configureFx`): 'blue' (AR) o 'fixed' (Panamá rate 1). `/api/fx/blue` responde tasa fija si corresponde.
- **Impuesto configurable** en QuoteForm/SaleForm/IvaEditor/PDF server (`taxRate()`/`taxLabel()`/`iva_label`). Editable por UI.
- **Gating de módulos**: backend (GETs de finanzas → vacío; escrituras → 403 vía `requireModule`; `MODULE_OF` en el CRUD genérico; schedulers salteados) + frontend (`MODULE_OF_PATH` en access.ts filtra nav y AccessGuard redirige).
- **Ventas sin finanzas**: cobro directo `POST /api/sales/:id/payment` (acepta `date`), historial Cobros desde `sale.payments`, GET /api/sales NO deriva `cashflow_paid` con finanzas off. **Dashboard modo ventas**: KPI m² en vez de Resultado neto; P&L corta en Ganancia bruta.
- **Empresa/locale**: PDF (presupuesto+remito), mailer (`configureMailer`), formateadores front (`appLocale()`/`setAppLocale` — barrido completo de es-AR).
- **Bootstrap vacío**: `BOOTSTRAP=empty` + `BOOTSTRAP_ADMIN_EMAIL/PASSWORD` → instancia sin ningún dato AR (guardas `bootstrap_mode==='empty'` en todos los backfills que re-siembran; flag protegido contra PATCH). Módulos default de instancia nueva: **núcleo + agenda**.
- **UI Configuración → "Operación"** (admin): empresa, impuesto, moneda/FX/locale, vendedores y toggles de módulos — todo editable por el socio desde la app.
- **Code review (8 ángulos)**: 8 hallazgos confirmados y arreglados (saldo con finanzas off, historial de cobros, regex bonificado del PDF por locale, defaults de instancia nueva, protección bootstrap_mode, fecha remito, blanqueo de textos, asimetría 403/vacío).

**Pendientes menores que dejó el review (para otra sesión):** el catálogo de módulos está en 4 listas (CONFIG_DEFAULTS server, DEFAULT_CONFIG front, MODULE_OF_PATH access.ts, MODULE_META ConfiguracionPage) → consolidar en un registro único; generalizar el gating backend con middleware por prefijo (`app.use('/api/import', …)`) para que endpoints futuros no queden sin gate por olvido; `/api/suppliers` no está gateado server-side (la nav lo oculta); `APP_LOCALE` es un mirror module-level del contexto (ventana breve es-AR al cargar).

## La visión (dueño, 15/7)

La app debe servir para **cualquier operación**: Argentina, Panamá, Paraguay, otro país, **e incluso otra operación dentro de Argentina**. Pero hay cosas muy locales — el CashFlow lo sigue Juan por decisión propia; Panamá no necesariamente lo va a usar. **El núcleo común a todos es: 1) Inventario, 2) Presupuesto, 3) Ventas, 4) Mensajes + Leads.** El resto es adopción opcional de cada operación.

**Conclusión de diseño: esto no es "clonar la app por país" — es convertir la app en un producto modular.** La unidad de despliegue no es el país sino la **operación** (un negocio que usa la app). Cada operación configura tres capas independientes:

| Capa | Qué define | Ejemplos |
|---|---|---|
| **País** (fiscal) | moneda local + proveedor de FX, impuesto (tasa+etiqueta), locale, formato de teléfono, ruleset fiscal de clasificación, parsers de banco disponibles | AR: ARS/blue, IVA 21%, ARCA/Ley 25413, MP/BBVA/BdC · PA: USD/fijo 1, ITBMS 7%, Banco General · PY: PYG, IVA 10% |
| **Empresa** (marca) | nombre, logo del PDF, web/dominio, textos legales (garantía, "dólar billete dos puntas"), firmas, remitente de email, cuentas Meta/Gmail | Pisos Pacific AR · marca del socio panameño |
| **Módulos** (adopción) | qué partes de la app usa esa operación | AR: todo · PA: núcleo + contenedores |

Las tres capas son independientes a propósito: dos operaciones del mismo país comparten capa fiscal pero no marca ni módulos.

## Arquitectura: una instancia por operación + sistema de módulos

**Mismo repo, una sola rama `main` que deploya a TODAS las instancias.** Cada operación = un servicio de Render + disco + db.json propio. Toda diferencia entre operaciones vive en configuración (`db.settings` + env vars) — **NUNCA `if (country === 'AR')` en el código; siempre `if (módulo activo)` / `config.tax.rate`**. Esa disciplina es la regla número 1 del proyecto de acá en adelante.

Por qué instancias separadas y no multi-tenant (decisión 15/7, sostenida):
- No existe `tenant_id` en ninguna de las 21 colecciones; agregarlo = refactor mayor + migración de 2.300+ movimientos financieros reales en prod.
- Socios locales ⇒ aislamiento de datos deseable (un bug de scoping filtraría números entre socios; con instancias es imposible por construcción).
- db.json single-writer no escala a varios negocios en un archivo; las integraciones (Meta/Gmail/MP) son credenciales por proceso → por instancia salen gratis.
- Riesgo cero para la prod argentina; ~US$7/mes por operación.
- "Otra operación dentro de Argentina" funciona igual: instancia nueva con capa país=AR, marca y módulos propios.

### Módulos

**Núcleo (siempre activo, es el producto):**
- **Inventario** (productos, stock, auditoría, conciliación física)
- **Cotizaciones** (+ PDF, compartir por WA/email/link)
- **Ventas** (conversión, estados, entrega de material, edición, **cobros simples**)
- **Clientes**
- **Mensajes + Leads** (WhatsApp/IG/Email unificados, plantillas, triage de pendientes, dedup)

**Opcionales (flags en `settings.modules`):**
- **`finanzas`** — CashFlow completo: Libro diario, Cajas, importación/conciliación de extractos, reglas de clasificación, flujo de fondos, bot de gastos por WhatsApp, link cobro↔extracto. _AR: ON. PA: OFF al inicio._
- **`contenedores`** — importaciones → acreditan inventario. _Probablemente ON en todos (todos importan)._
- **`agenda`** — calendario de colocaciones, equipos, reparaciones, bot de tareas. _Depende de si el socio coloca o solo vende._
- **`galeria`** — banco de imágenes Drive.
- **`reportes`** — reportes avanzados.
- **`dashboard-finanzas`** — los bloques del Dashboard que dependen del cashflow (gastos, saldos de caja, P&L devengado completo). Sin finanzas, el Dashboard queda en "modo ventas": facturación, m², margen bruto (costo bloqueado), saldos por cobrar.

**Mecanismo (ya hay patrón en el código):** `lib/access.ts` ya filtra navegación por rol (`RESTRICTED_PATHS`, `AccessGuard` redirige) → se extiende con un filtro por módulo (`canAccess(role, path) && moduleOn(path)`). Backend: los endpoints de un módulo apagado devuelven 403 y sus schedulers no corren (mpAutoSync etc. ya deben degradar limpio si la integración no está configurada). Default de todos los flags: **ON** → la instancia AR no cambia nada.

### La dependencia crítica: cobros de venta sin CashFlow — YA RESUELTA

Verificado en el código (15/7): el cobrado de una venta es `cashflow_paid ?? financial_position.total_paid` (`VentasPage.tsx:91`; server.js:682 solo setea `cashflow_paid` si hay movimientos de caja con ese `sale_ref`). `POST /api/sales/:id/payment` escribe `financial_position` directo y NO crea movimiento de caja. **Con `finanzas` OFF no hay extractos → registrar el cobro a mano en la venta es EL camino y no duplica nada** (la regla AR del 26/6 "no registrar cobros a mano" es del módulo finanzas, no del núcleo). Solo hace falta: con finanzas OFF, ocultar "link-sale"/"¿Es el cobro de una venta?" y dejar visible "Registrar cobro" en Ventas.

Mapa de dependencias restante (todas degradan bien):
- Ventas → Inventario (stock): núcleo↔núcleo, sin cambios.
- Contenedores → Inventario: opcional que alimenta núcleo, sin acople inverso.
- Dashboard → finanzas: se parte en dos (modo ventas / bloques financieros).
- Agenda → Ventas (colocaciones de ventas): opcional que lee núcleo, ok.
- Bot de gastos WhatsApp → finanzas (va con el flag). Bot de tareas → agenda.

## Inventario de hardcodeos AR (auditoría 15/7) — insumo de la Fase 0

| Área | Estado | Acción |
|---|---|---|
| Credenciales integraciones (MP/Meta/Gmail/Drive/IA) | ✅ Configurable (env) | Valores nuevos por instancia |
| Sellers, crews, allowlist, cp_rules | ✅ Configurable (db) | — |
| FX blue (dolarapi + fallback 1400: `import/fx.mjs`, `server.js:702`) | ❌ Hardcodeado | Provider FX por config país (`blue` \| `fixed:1` \| futuro por moneda) |
| `amount_ars`/`amount_usd` + `exchange_rate` estructurales | ⚠️ | NO renombrar: `amount_ars` = moneda local. País USD → ambos iguales, rate 1 |
| IVA 21% (`server.js:2442`, `pdf/render.mjs:216`) | ❌ | `config.tax = {rate, label}` (PA: 0.07 "ITBMS 7%") |
| Regex fiscales AR (ARCA/AFIP/IIBB/Ley 25413/peajes en statements.mjs, cash-parse.mjs, supplier-match.mjs) | ❌ | Ruleset fiscal por país (AR = el actual como default) |
| Parsers banco (MP/BBVA/BdC) + cajas CAJ-001..006 fijas | ❌ | Es parte del módulo `finanzas`: registry de parsers + cajas por config. PA arranca sin esto |
| Locale `es-AR` (utils.ts, period.ts, messaging.ts, pdf.tsx) | ❌ | `config.locale` |
| PDF/branding (logo `_arg`, garantía, "dólar billete dos puntas", pisospacific.com) | ❌ | `config.company` |
| `GMAIL_FROM` default, `currency_id:'ARS'` (server.js:2208), `normalizePhone` 10 dígitos (+507 usa 8) | ❌ | Config/env; teléfono por país |
| Seeds/bootstrap con datos AR | ⚠️ | Modo bootstrap vacío (admin + tipos de gasto canónicos + settings) |
| Multi-tenancy | No existe | No se hace: instancia por operación |

**Quick fix de seguridad (aparte, hacer ya):** `render.yaml:22` expone el `MP_CLIENT_ID` real en un comentario → borrarlo.

## Fases

### Fase 0 — Modularizar + des-argentinizar (AR no cambia NADA)
1. **`settings.modules`** + gating de navegación (extensión de `lib/access.ts`) + gating backend de endpoints/schedulers por módulo. Default todo ON.
2. **Ventas con finanzas OFF**: mostrar "Registrar cobro" (camino `financial_position`), ocultar link-sale. (El backend ya lo soporta.)
3. **Dashboard modo ventas** (sin bloques de caja/gastos cuando finanzas OFF).
4. **`config.company`** (marca → PDF, mailer, /privacy, firmas).
5. **`config.tax`** + **`config.currency`/provider FX** + **`config.locale`/teléfono**.
6. **Ruleset fiscal por país** (las regex AR se cargan como perfil AR).
7. **Bootstrap vacío** (`BOOTSTRAP=empty`).
8. **Schedulers tolerantes** a integraciones/módulos ausentes.

Verificación: (a) prod AR idéntica antes/después (dashboard, P&L, cotización PDF byte-similar); (b) instancia local con perfil "Panamá core" bootea vacía, en USD, ITBMS 7%, sin CashFlow en la nav, y el ciclo lead→cotización→venta→cobro→stock funciona completo; (c) E2E corre en LOS DOS perfiles (full-AR y core-PA) — la matriz de dos perfiles queda como parte permanente del sweep.

### Fase 1 — Levantar la instancia Panamá
Segundo servicio Render (mismo repo), disco/DB/envs propios, config país=PA + marca del socio + módulos núcleo (+contenedores si importan directo), usuarios del socio (roles existentes admin/vendor/logistica), catálogo (definir: partir del AR con precios propios vía export/import CSV, o de cero), dominio.

### Fase 2 — Integraciones Panamá
WhatsApp +507 (cloud-only, phone number nuevo — puede convivir en la misma app Meta con WABA/phone_id propios en las envs de PA) · Instagram del socio · Gmail propio (leads + envío) · SIN Mercado Pago (no opera en PA). Si más adelante el socio adopta `finanzas`: parser del banco que use (Banco General/Banistmo/BAC) cuando haya extractos reales, mismo patrón que BdC.

### Checklist: crear la instancia FREE de Panamá en Render (~10 min, la hace el dueño)
1. **Token de GitHub** (una vez): github.com → Settings → Developer settings → **Fine-grained tokens** → Generate: Repository access = SOLO `pisos-pacific-app`; Permissions = **Contents: Read and write**; expiración 1 año (anotar renovación). Copiar el token.
2. **Render** → New → **Web Service** → repo `pisos-pacific-app`, branch `main`.
3. Name: `pacific-panama` (define la URL). Instance type: **Free**.
4. Build: `npm install && npm run build` · Start: `npm start` · Health check path: `/healthz` (⚠️ NO /api/auth/me).
5. Environment variables:
   - `NODE_VERSION` = `22`
   - `BOOTSTRAP` = `empty`
   - `BOOTSTRAP_ADMIN_EMAIL` = email del socio (o `admin@pacificpanama` provisorio)
   - `BOOTSTRAP_ADMIN_PASSWORD` = contraseña inicial (la cambia en la app)
   - `DB_GITHUB_REPO` = `juanrmomesso-pisospacific/pisos-pacific-app`
   - `DB_GITHUB_BRANCH` = `pa-data`
   - `DB_GITHUB_TOKEN` = el token del paso 1
6. Create. Al terminar el primer deploy: pasar la URL — de acá se sigue por chat (seed del catálogo + configuración del perfil Panamá por API + verificación).

### Fase 3 — Consolidado multi-operación (cuando el dueño lo pida)
Endpoint `/api/summary` de solo lectura por instancia (ventas, margen, y caja si finanzas ON) + agregador liviano que consolida en USD. Sin unir bases.

### Futuro (anotado, no ahora)
- Catálogo maestro compartido con sync opcional (hoy: export/import CSV alcanza).
- Paraguay u otros países = solo un perfil fiscal nuevo (PYG + IVA 10% + ruleset) — la arquitectura ya lo absorbe.
- Si una operación externa crece mucho: revisar SLA/backup del db.json por instancia.

## Riesgos y cómo se mitigan
1. **Regresión en AR** (el riesgo real: datos financieros vivos). → Todos los defaults = comportamiento actual; verificación A/B del Dashboard/P&L; deploy de Fase 0 en tandas chicas con E2E doble perfil.
2. **Deriva de disciplina** (que aparezcan `if país`). → Regla en CLAUDE.md + revisarlo en cada `/code-review`.
3. **Soporte a socios** (contraseñas, tokens Meta que vencen, carga de datos). → Documentar runbook por instancia (LAUNCH.md por operación); decidir quién es admin de cada instancia.
4. **Divergencia de expectativas del socio** (querrá features propias). → El sistema de módulos es la válvula: se agregan módulos opcionales, no forks.

## Definiciones del dueño (15/7 — preguntas respondidas)
1. **Marca en Panamá = Pacific** (mismo logo; cambian email/web/textos legales por config de empresa).
2. **El socio vende Y coloca** → módulo `agenda` ON en PA.
3. **Catálogo PA — PRECARGADO POR NOSOTROS, editable por el socio (15/7)**: los 4 pisos XL en **5,5mm** + los 4 zócalos Pacific 2400×60×12mm viven en `data/catalogo.panama.json` y se siembran con `node scripts/seed-catalogo-panama.mjs <url> <admin> <pass>` (re-ejecutable, dedup por SKU — nunca pisa precios que el socio ya haya cargado). **Precios y costos van en 0 a propósito**: los carga el socio desde Inventario (sus precios son de ellos). Los **servicios** (entrega, colocación, etc.) los crean ellos desde la app.
   **Dominio/costos (15/7)**: NO hace falta comprar dominio — la instancia PA usa el subdominio gratis de Render (`*.onrender.com`, con SSL). Dominio propio = opcional a futuro (~US$10-15/año, lo puede pagar el socio).
   **HOSTING PA = GRATIS (decisión del dueño 16/7)**: nada de plata. La instancia PA corre en el plan **FREE de Render** (sin disco persistente) como **herramienta de cotizaciones** ("solo las cotizaciones, que salgan lindas como están"). La persistencia se resuelve con la capa **`DB_GITHUB_REPO/BRANCH/TOKEN`** en server.js: al bootear restaura el `db.json` desde la rama huérfana **`pa-data`** del repo privado, y cada guardado lo pushea (debounced 10s + flush en SIGTERM; si el pull falla ABORTA para no pisar datos; valida el JSON antes de escribir). **100% inerte para AR** (sin esas envs no ejecuta nada — verificado: boot AR sin ninguna línea db-remote, ventas/cobros idénticos). Trade-offs aceptados: cold-start ~1 min tras 15 min de inactividad; uploads no persisten (cotizaciones no los usa). Si el socio después quiere "más como Argentina" (stock real, mensajes, etc.) → upgrade a Starter US$7/mes con disco, mismos datos (se sube el db.json de la rama pa-data al disco).
4. **Impuestos, vendedores, precios y costos editables desde la app por el socio** → la Fase 0 suma UI en Configuración para impuesto/empresa/vendedores (precios/costos ya son editables en Inventario).
5. **Administración**: Pisos Pacific AR administra desde acá Y el socio tiene su propio usuario admin en su instancia (roles existentes alcanzan).
6. Contenedores en PA: a confirmar cuando arranque la operación (el módulo queda disponible).
