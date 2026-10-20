# Etapa 0 — Anillos de deploy + gate A/B de AR

_Infraestructura de seguridad para que el trabajo de nuevas operaciones (Panamá, Portugal, …) no pueda romper la instancia de Argentina (datos financieros vivos)._

## El modelo: AR es el canary, los socios reciben versiones probadas

```
   desarrollo (main + feature branches)
        │  ← antes de promover, corre el GATE A/B contra datos reales de AR
        ▼
   AR   (CANARY — rama `main` — Juan lo estrena y lo mira en vivo; si algo falla, se ve y se revierte)
        │  corrió limpio
        ▼
   git branch -f release-stable <sha> && git push origin release-stable
        │
        ▼
   Panamá + Portugal  (rama `release-stable` — SOLO versiones battle-tested)
```

- **AR** deploya de `main`. Es el canary: Juan lo usa a diario, nota una regresión al toque y puede hacer rollback de 1 click en Render.
- **Panamá / Portugal** deployan de `release-stable`, una rama que se avanza a mano **recién cuando AR validó la versión**. Un push a `main` NO puede tocar a los socios.
- **Regla de datos (la salvedad del canary):** el canary estrena **código**. Las operaciones que **tocan datos** (backfills, migraciones) NUNCA corren a ciegas sobre AR: primero dry-run contra la copia de `ar-data` + backup. Ningún backfill de otra operación debe correr en AR (gatear por config / `bootstrap_mode`).

## El gate A/B (una línea)

Compara el **perfil AR** entre lo que AR corre hoy (`origin/main`) y la rama candidata, usando la **DB real de AR** (rama `origin/ar-data`). Señales deterministas:
- `GET /api/config` — moneda / impuesto / locale / módulos de AR.
- `GET /api/sales` — derivación de cobrado/saldo de **todas** las ventas.
- `GET /p/q/:id/:token` — **render visual (PNG) de 10 presupuestos reales** (lo que ve el cliente; inmune a la basura binaria del PDF).

```bash
scripts/ab-gate.sh <rama-candidata>     # default: la rama actual (HEAD)
# ✓ GATE OK   → el perfil AR es idéntico → se puede promover a AR
# ✗ GATE FALLÓ → lista qué cambió. Si no debía tocar AR, es una regresión: NO promover.
```

Requiere macOS (usa `qlmanage` para rasterizar el PDF) + Node 22. Corre 100% local, no deploya nada.

## Flujo de una promoción

1. Trabajar en una feature branch. `npm run build` + sweep E2E como siempre.
2. **`scripts/ab-gate.sh feature/<rama>`** → tiene que dar **GATE OK** (o, si cambió el perfil AR, que sea un cambio *buscado* para AR).
3. Fast-forward `main` → AR deploya (canary). Verificar en prod: `/healthz` 200 + login + mirar el Dashboard.
4. Dejar correr AR limpio (un rato / un día según el cambio).
5. Promover a los socios: `git branch -f release-stable <sha-de-main-ya-validado> && git push origin release-stable`.

## Acción única en la consola de Render (la hace Juan, 1 vez)

**Repuntar Panamá a `release-stable`** (hoy deploya de `main` igual que AR → hay que separarlos):

1. Entrar a **https://dashboard.render.com** con la cuenta de Pisos Pacific.
2. En la lista de servicios, clickear **`pacific-panama`**.
3. Menú izquierdo → **Settings**.
4. Sección **Build & Deploy** → campo **Branch** (dice `main`).
5. Clickear **Edit**, cambiarlo a **`release-stable`**, y **Save Changes**.
6. Listo. Desde ahí Panamá solo cambia cuando se avanza `release-stable`.

> La instancia nueva de **Portugal**, cuando se cree, se configura con **Branch = `release-stable`** desde el arranque (mismo campo).

AR (`pisos-pacific`) **no se toca**: sigue en `main` (es el canary).
