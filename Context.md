# Context — Pisos Pacific App

Documento de contexto para retomar el trabajo en cualquier sesión. Resume el negocio,
la arquitectura de la app, las convenciones del cashflow, el trabajo de conciliación
hecho, y lo que queda pendiente.

_Última actualización: 2026-06-05. Branch de trabajo: `feature/data-import-cashflow` (no pusheado a GitHub todavía)._

---

## 1. El negocio

**Pisos Pacific** — importador argentino de pisos de madera de ingeniería y vinílicos.
Opera en **USD + ARS**. Dueños: **Juan Rodriguez Momesso** y **Pipi Collado** ("Juan & Pipi").

- **Moneda del negocio = USD.** Los saldos se consolidan en USD; pesos → USD a **TC ≈ 1400**
  (el dueño prefería el promedio blue compra/venta de DolarHoy; en el chat de jun-2026 figura 1435).
- **ACUDESIGN** = entidad relacionada que vende **Paneles** (no Pisos). Sus cobros se registran en
  este cashflow como `Venta - No Pisos`. Clientes de paneles vistos: Arq. Ulises Salas, AgroAlimentos,
  Tribucreativa, SNF Argentina, DAYNA.

### Gente y entidades (glosario aprendido)
- **Colocadores / mano de obra** (→ `Gastos de Personal`): **Oso** (en MP aparece como _Cristian Adrian Tevez_),
  **Huguito/Hugo** (en MP: _Hugo Luis Ramirez_), **Ariel**, **Victor/Vic**, **Leo**, **Maldo**, **Fabian**, **Martin**,
  **Mike**, **Gastón** (obras/colocación), **José** (nylon/mantas).
- **Fletes / logística** (→ `Gastos de Instalaciones y Suministros`): **Via Cargo** (en MP: _Gonzalez Marina Sofia_),
  **Matías**, **Charly** (envíos).
- **Proveedores de insumos**: IMDO, KEKOL, Atrim, Prestigio, Mapei, Bona, Viem.
- **Comisiones**: **Mamo / Maximo Grether**, **Oppel**.
- **Autos**: **Taos** (vehículo del negocio — seguro Sancor, cuota "Mclaudia"), **T-Cross** (patente ARBA), Peugeot.
- **"Mclaudia"** = cuota del crédito del auto Taos.
- **Personal del dueño** → contraparte **"Juan & Pipi"** (o "Pipi & Juan").

---

## 2. Arquitectura y cómo correr

- **Backend**: `server.js` (Express, ESM). DB en disco `data/db.json`, seedeada desde `data/*.seed.json`
  vía `seedFromDump()`. CRUD genérico. Auth por cookie `pp_session`.
- **Frontend**: `dashboard-app/` (Vite 8 + React 19 + TS + shadcn/ui + react-router). Hook `useApi` → `/api/*`.
  Build: `tsc -b && vite build`.
- **PDF**: motor Python (ReportLab) en `pdf/pacific_pdf.py`, invocado desde Node vía `pdf/run_pdf.py`
  (stdin JSON → stdout PDF). Templates: clasico (default) / calido / moderno. Modos: single / sections (zonas).

### Correr local (macOS, sandbox)
```bash
export PATH="$HOME/.local/node-v22.12.0-darwin-arm64/bin:$PATH"   # Node v22.12 instalado acá
cd ~/pisos-pacific-app
PORT=4173 node server.js          # backend
# login: info@pisospacific.com / admin123
```
- **Reseed** (recargar seeds tras editar): `rm -f data/db.json data/db.json.bak` y reiniciar el server.
- `xlsx` está en `dashboard-app/node_modules` (usar `createRequire` apuntando ahí desde los scripts).
- Notas de sandbox: bajar binarios con curl del tool Bash; no modificar `~/.zshrc`; prefijar PATH por comando.

---

## 3. Modelo de datos del cashflow

Shape de un movimiento:
```
{ id, source, date(ISO), flow:'Ingreso'|'Egreso', caja_id, caja_name,
  category, subcategory, counterparty, counterparty_type, client_id, supplier_id,
  description, sale_ref, currency:'ARS'|'USD', amount_ars, amount_usd, exchange_rate,
  fixed_variable:'Fijo'|'Variable', expense_type, transfer:bool, needs_review, review_reason }
```

### Cajas (`data/cajas.seed.json`)
| id | nombre | moneda | notas |
|----|--------|--------|-------|
| CAJ-001 | BBVA | ARS | **Mixta** negocio+personal — solo se carga lo del negocio. "Mastercard BBVA" se pliega acá. |
| CAJ-002 | Mercado Pago | ARS | |
| CAJ-003 | Banco de Comercio - Cuenta Pesos | ARS | |
| CAJ-004 | Banco de Comercio - Cuenta USD | USD | **Sin movimientos cargados todavía.** |
| CAJ-005 | Caja General | USD | **ES la caja de EFECTIVO**, alimentada del WhatsApp. |
| CAJ-006 | Wise | USD | |

### Tipos de gasto canónicos (9) — dimensión primaria del P&L
COGS · Gastos de Instalaciones y Suministros · Gastos Administrativos ·
Gastos de Personal (HR y Mano de Obra) · Marketing y Ventas · Gastos de Flota/Vehículos ·
Depreciación y Amortización · Impuestos y Tasas · Otros Gastos y Ajustes.

> Se usa **Tipo de Gasto** como dimensión principal, no "Categoría" (decisión del dueño).
> Las **transferencias entre cuentas** (`transfer:true`) se excluyen del P&L pero cuentan para el saldo de caja.

### Convención de gastos PERSONALES
El dueño mezcla gastos personales en cuentas del negocio. Se cargan como
**`Gastos de Personal`**, contraparte **"Juan & Pipi"**, subcategoría "Retiro/Personal" (retiros de socio).
No se excluyen — así el saldo de la caja cierra. (Ej: pago del Jardín de Filipa, súper, gym, etc.)

---

## 4. Fuentes de datos y su "verdad"

| Dato | Fuente maestra | Importador / archivo |
|------|----------------|----------------------|
| **Cashflow** | Google Sheet "CashFlow - Pisos Pacific (VF)" (NO el viejo DataApp Excel) | `scripts/import-cashflow-vf.mjs` → `cashflow.seed.json` |
| **Ventas** | Planilla Ventas (Google Sheet). SKU/line-items de la app **Vercel** | — |
| **Resúmenes banco** | BdC (PDF), BBVA (.xls) | `scripts/import-bank-statements.mjs` → `cashflow-bank-extra.seed.json` |
| **Mercado Pago** | `account_statement-*.xlsx` | `scripts/import-mp-statements.mjs` → `cashflow-mp-extra.seed.json` |
| **Efectivo** | Chat WhatsApp "GASTOS PACIFIC" (`_chat.txt`) | `scripts/import-cash-whatsapp.mjs` → `cashflow-cash-extra.seed.json` |

**Merge al bootear** (`server.js` ~línea 54):
```js
cashflow: [...cashflow.seed.json, ...cashflow-bank-extra, ...cashflow-mp-extra, ...cashflow-cash-extra]
```

### Principios de conciliación (para no duplicar)
- **Dedup** por **fecha ±3 días + monto** contra lo ya cargado.
- **Pagos de tarjeta NO se cargan aparte**: las compras subyacentes ya están registradas; el pago solo las salda.
- **Cambios de divisa** ("Cambié 1000 a 1495") NO son gastos.
- Listas de "**tenemos que pagar**" y resúmenes "**PAGOS**" (re-statements de pagos ya itemizados por obra) → NO cargar.
- **Ventas de Vercel: IGNORAR LAS FECHAS** (están mal). Matchear por **obra (dirección) + cliente**.

---

## 5. Trabajo de conciliación hecho (commits recientes)

1. **Cashflow re-importado** del Google Sheet (≈2159 movs, 9 tipos canónicos, 0 sin categoría).
2. **Banco de Comercio mayo-2026** conciliado (`cashflow-bank-extra`): cobros, egreso, MOV entre cuentas,
   impuestos bancarios agrupados, y **3 cheques identificados** → 06/05 $941.605 Paneles, 08/05 $5.025.001
   AGIRA (Arq. Santiago/Proyecto Concreto) Pisos, 14/05 $768.275 SNF Argentina Paneles.
3. **BBVA (mixta)** conciliado: cobros de paneles/ACUDESIGN y gastos de auto (Sancor Taos, patente T-Cross).
   Se omiten alquileres, comidas, tarjetas, transferencias internas, sueldo/giros personales.
4. **Corrección sueldo→jardín**: el egreso BdC 04/05 de **$1.157.607 es el pago del Jardín de Filipa**
   (personal), NO un typo de sueldo. Se revirtió una corrección previa errónea a $1.557.607.
5. **Mercado Pago** (`cashflow-mp-extra`): el agujero era **mayo** (6 de 159); marzo/abril ya estaban.
   - Peajes (AUSOL/AUSA/AUBASA) → **1 egreso de Flota agrupado por día**; no se recargan en meses ya cubiertos.
   - "Ingreso de dinero"/"Liquidación" → **MOV entre cuentas** (fondeo, va como Ingreso — ojo el signo).
   - **Rendimientos omitidos** (interés, ~$156k, ruido).
   - Clasificación por nombre: staff conocido → Personal; ARCA → Impuestos; EASY/ML → Insumos;
     retiros del dueño y retail → personal (Juan & Pipi). Tevez→Oso, Gonzalez→Via Cargo.
     Los 11 restantes (amigos/gastos personales) → todos personal. **needs_review final = 0.**
6. **Efectivo de WhatsApp** (`cashflow-cash-extra`): la Caja General ya estaba transcripta hasta abril;
   se agregaron los **9 gastos de mayo-junio** que faltaban. Las listas-resumen de "PAGOS" NO se cargaron.

---

## 6. Saldos

### En la app (2026-06-05, USD)
| Caja | USD |
|------|-----|
| Caja General | 51.625 |
| Banco de Comercio - Cuenta Pesos | 28.075 |
| Wise | 16.629 |
| BBVA | 754 |
| Mercado Pago | −606 |
| Banco de Comercio - Cuenta USD | 0 |
| **Total** | **96.477** |

### Saldos REALES (arqueo del dueño, jun-2026) — para conciliar
| Caja | Real | = US$@1400 | App | Real − App |
|------|------|-----------|-----|-----------|
| BBVA (mixta) | $9.952.122 | 7.109 | 754 | +6.355 |
| BdC Cuenta Pesos | $46.411.012 | 33.151 | 28.075 | +5.076 |
| BdC Cuenta USD | US$1.812 | 1.812 | 0 | +1.812 |
| Mercado Pago | $4.698.605 | 3.356 | −606 | +3.962 |
| **Caja General (efectivo)** | US$37.900 + $1.002.000 | 38.616 | 51.625 | **−13.009** |
| Wise | _(pendiente)_ | — | 16.629 | — |

Patrón: en los **bancos/MP la app está por debajo** de la realidad (faltan saldos de apertura e ingresos);
en el **efectivo (Caja General) la app está por ENCIMA** US$13.009 (gastos en efectivo que no se registraron).
No hay **saldo de apertura** cargado en ninguna caja. Se cierra con un **ajuste de conciliación** por caja
(asiento de saldo, fuera del P&L) y/o investigando los huecos.

### Decisiones de conciliación (sesión grilling 2026-06-05)
- **TC**: 1400 para consolidar pesos→USD.
- **Saldos reales** (arqueo): Caja General US$37.900 + $1.002.000 (≈US$38.616); Wise coincide (US$16.629).
- **Regla ventas↔ingresos**: el `contract_total` NO es confiable (incluye IVA / ajustes de obra / inflado).
  Para Finalizado/Cobrado el **valor real de venta = lo cobrado** (cashflow), saldo 0. Detalle caso por caso
  en [`data/sales-reconcile-notes.md`](data/sales-reconcile-notes.md).
- **Cuentas por cobrar reales** (~US$56k): 0000098, 0000122, 0000112, 0000121, 0000086, 0000088, 0000092,
  0000100, 0000124, 0000131, 0000078. El resto de las Finalizadas → saldo 0.
- **Cobros faltantes a cargar** (→ Caja General, efectivo/USD): 0000107 US$5.350 (7/05), 0000132 US$605 (11/05),
  0000120 US$1.789 (10/04) + egreso comisión Cami Fuks US$440 (Marketing/Ventas).
- **BBVA** (mixta): se deja en su saldo real US$7.109; el excedente sobre el negocio (+US$6.355) entra como
  **ajuste de apertura personal (Juan & Pipi), fuera del P&L**. No se mueve nada a Banco de Comercio.
- **Método**: tras cargar los cobros faltantes, **ajuste de apertura por caja** (fuera del P&L) para que cada
  caja = saldo real. Ojo: Caja General necesitará un ajuste NEGATIVO grande (~US$20k de gastos en efectivo
  no registrados, porque además se le suman los cobros faltantes).
- **Especial pendiente**: 0000007 (cobro $8.900 mal atribuido → 0000006, que ya está sobrepagada) — CONFIRMAR.

---

## 7. Pendientes / próximas decisiones

1. **Conciliación de saldos (PENDIENTE decisión del dueño)**:
   - ¿Agregar ajuste de conciliación por caja para que la app = banco? (BdC Pesos +5.076, BdC USD +1.812, MP +3.962).
   - **BBVA mixta**: ¿saldo real completo ($9.95M, incluye personal) o solo-negocio (US$754)?
   - **TC** a usar (1400 vs 1435 vs blue DolarHoy).
   - Alternativa ofrecida: investigar los huecos antes de ajustar a ciegas (sobre todo BdC USD = 0 movs).
2. **Cuenta BdC USD (CAJ-004)** sin movimientos cargados.
3. **Automatización futura**: disparar los imports solos vía **parseo de mails de banco con Gmail**
   (ya conectado). Hoy el flujo es: exportás → corro el importador (deduplica) → reviso solo lo nuevo.
4. **Otros (de fases previas, no urgente)**: selector de plantillas PDF en la UI, fotos/thumbnails de
   productos en el PDF, dashboard de márgenes (margen por venta ya computado en backend, no se muestra en
   la página de Ventas), propagación de edición a ventas ya convertidas, y **pushear el branch a GitHub**.

---

## 8. Importadores reutilizables (resumen técnico)

- `scripts/import-cashflow-vf.mjs <xlsx>` — re-importa el cashflow del Google Sheet. Mapea cajas por nombre
  (Mastercard BBVA→CAJ-001), valida categorías, detecta transferencias, normaliza tipos de gasto.
- `scripts/import-bank-statements.mjs` — conciliación manual de resúmenes BdC + BBVA. Helpers `ing/egr` (BdC)
  y `bIng/bEgr` (BBVA). Genera `cashflow-bank-extra.seed.json`. Re-runnable (ids deterministas).
- `scripts/import-mp-statements.mjs <xlsx...>` — concilia extractos MP. Clasifica (peajes agrupados, fondeos→MOV,
  rendimientos omitidos, NAME_MAP, PERSONAL, staff/merchants). Dedup fecha±3+monto. Genera `cashflow-mp-extra.seed.json`.
- `scripts/import-cash-whatsapp.mjs` — gastos de efectivo del WhatsApp que faltaban (mayo-junio) → Caja General.
  Datos parseados a mano (encodados como data). Genera `cashflow-cash-extra.seed.json`.

> Todos deduplican contra lo ya cargado y son re-ejecutables. Los `.seed.json` que generan están committeados;
> los archivos fuente (xlsx/pdf/chat) viven fuera del repo (en `~/Downloads`).
