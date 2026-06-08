# 🚀 LAUNCH — Pisos Pacific (runbook para ejecutar)

Estado al cierre de la noche del 8/6/2026. Todo el **código** está construido, compila y el server corre local OK. Lo que falta son **acciones con tus credenciales/cuentas** (no se pueden hacer sin vos). Seguí los pasos en orden. Tiempo total estimado: ~1.5–2 h.

Branch: `feature/data-import-cashflow` · commits locales listos (ver `git log`).

---

## ✅ Lo que YA está hecho (código)
- **Importar extracto** (MP/BBVA/BdC): preview + dedup + commit, con auto-mapeo por `counterparty-map.json`.
- **Sincronizar con MP por API** (OAuth client_credentials): botón en CashFlow → baja el ledger, agrupa peajes, deduplica. *(Necesita client_secret nuevo, ver §1.)*
- **Meta (WhatsApp + Instagram)**: webhook entrante crea conversación + mensaje + lead; envío saliente por Cloud API. *(Necesita tokens, §4.)*
- **Gmail → Leads**: endpoint que convierte emails en leads. *(Necesita OAuth, §5.)*
- **Deploy**: `Dockerfile`, `render.yaml`, build script. `DB_PATH` configurable.
- Fixes de datos aplicados al `db.json` local (Ariel→Garcia, fletes→Logística, dedup Matias).

---

## 1) Mercado Pago — client_secret nuevo (5 min) ⚠️ BLOQUEANTE del sync
MP **rotó** el client_secret cuando tocamos la config OAuth, así que el sync dejó de mintear token.
1. Panel MP → **Tus integraciones → PacificApp → Credenciales de producción**.
2. Copiá el **Client Secret** actual (y verificá el Client ID `7108477716725096`).
3. Actualizá el archivo local (gitignored):
   ```bash
   # editá data/sources/.mp-oauth.json y reemplazá "client_secret"
   ```
4. Probá:
   ```bash
   node scripts/sync-mp.mjs   # o desde la app: CashFlow → Importar extracto → "Mercado Pago (API)"
   ```
   Si `users/me` y `payments/search` dan 200, quedó. *(El OAuth `client_credentials` YA funcionó antes con esta cuenta; solo cambió el secret.)*

**Opcional (nombres completos automáticos):** en MP → Informes → "Todas las transacciones", programá envío por **email a info@pisospacific.com**. Eso permite levantarlo del Gmail con nombres (la API no manda nombres). Si lo activás, avisame y armo el fetch del adjunto.

---

## 2) GitHub — crear/arreglar repo y pushear (10 min)
El push falló con "Repository not found" (el repo no existe o el token no tiene acceso).
1. Creá el repo en GitHub (privado): `juanrmomesso-pisospacific/pisos-pacific-app`.
   - Si ya existe, generá un **Personal Access Token** (classic, scope `repo`) y reautenticá:
     ```bash
     git remote set-url origin https://github.com/juanrmomesso-pisospacific/pisos-pacific-app.git
     # al pushear, usuario = juanrmomesso-pisospacific, password = el token
     ```
2. Pusheá:
   ```bash
   git push -u origin feature/data-import-cashflow
   # opcional: mergear a main
   git checkout -b main 2>/dev/null || git checkout main
   git merge feature/data-import-cashflow && git push -u origin main
   ```

---

## 3) Deploy a un servidor (20–30 min)
La app es **Node/Express** (sirve el SPA buildeado) + DB en disco → necesita un host con **proceso persistente y disco** (NO Vercel serverless). Recomendado: **Render** (`render.yaml` ya está listo).

### Render (recomendado)
1. render.com → New → **Blueprint** → conectá el repo de GitHub. Detecta `render.yaml`.
2. Plan **Starter** (el Free NO persiste disco). Crea el web service + disco `pisos-data` en `/var/data`.
3. Cargá las **env vars** (§6) en el dashboard de Render (las `sync:false`).
4. Deploy. Build = `npm install && npm run build`, start = `npm start`. Healthcheck `/api/auth/me`.
5. **Subí tu data real** (la local tiene todo; producción arranca vacía):
   - **Opción FÁCIL (recomendada):** commiteá un snapshot de tu DB actual como bootstrap. En el primer arranque el server lo carga solo.
     ```bash
     cp data/db.json data/db.bootstrap.json
     git add -f data/db.bootstrap.json && git commit -m "snapshot datos para bootstrap" && git push
     ```
     *(El repo es privado; contiene tus datos. Si no querés datos en git, usá la Opción B.)*
   - **Opción B (manual):** Render → Shell del servicio → escribí tu `db.json` en `/var/data/db.json` (scp/pegar).
   - *Si preferís arrancar de seeds:* dejá que seedee y corré `node scripts/apply-counterparty-map.mjs --apply` + `node scripts/unify-fletes.mjs --apply` (ojo: las seeds no tienen TODAS las ediciones runtime; el snapshot es lo más fiel).
6. Anotá la URL pública (ej. `https://pisos-pacific.onrender.com`) → la necesitás para los webhooks (§4).

### Alternativa: Docker en cualquier VPS
```bash
docker build -t pisos-pacific .
docker run -d -p 80:3000 -v /srv/pisos-data:/var/data \
  -e META_VERIFY_TOKEN=... -e WHATSAPP_TOKEN=... -e WHATSAPP_PHONE_ID=... \
  --name pisos pisos-pacific
# subí tu db.json a /srv/pisos-data/db.json
```

---

## 4) Meta — WhatsApp + Instagram (30 min)
Para que entren/salgan mensajes en **Mensajes** y se creen **leads** automáticos.
1. **developers.facebook.com** → creá una app tipo **Business**. Asociá tu cuenta de WhatsApp Business + tu página/IG.
2. **WhatsApp** → conseguí: `WHATSAPP_TOKEN` (System User token permanente), `WHATSAPP_PHONE_ID` (Phone number ID).
3. **Instagram** → `IG_TOKEN` (page access token con permisos de mensajería).
4. Elegí un `META_VERIFY_TOKEN` (string inventado, ej. `pisos-pacific-2026`).
5. Configurá los **Webhooks** apuntando a tu URL pública (§3):
   - WhatsApp: `https://TU-URL/api/whatsapp/webhook` · Verify token = `META_VERIFY_TOKEN` · subscribí el campo `messages`.
   - Instagram: `https://TU-URL/api/instagram/webhook` · mismo verify token · campo `messages`.
6. Cargá `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `IG_TOKEN`, `META_VERIFY_TOKEN` en las env del host y redeploy.
7. **Probá**: mandá un WhatsApp al número → debería aparecer en Mensajes + un lead nuevo. Respondé desde la app → debería llegar al teléfono.
   - *Sin tokens*, el entrante igual funciona (Meta postea) pero el saliente queda guardado local (no envía).

---

## 5) Gmail → Leads (20 min, opcional)
Convierte emails a `info@pisospacific.com` en leads.
1. **Google Cloud Console** → creá un proyecto → habilitá **Gmail API**.
2. Creá credenciales **OAuth client** (tipo "Desktop" o "Web") → `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
3. Conseguí un **refresh token** de `info@pisospacific.com` con scope `https://www.googleapis.com/auth/gmail.readonly` (usá OAuth Playground: developers.google.com/oauthplayground → ⚙ usá tus credenciales → autorizá Gmail readonly → "Exchange authorization code" → copiá el refresh_token) → `GMAIL_REFRESH_TOKEN`.
4. Cargá las 3 env vars y redeploy.
5. Probá: `POST /api/integrations/gmail/sync` (o agrego un botón en Leads si querés). Devuelve `{scanned, created}`.

---

## 6) Variables de entorno (resumen)
Cargalas en el host (Render dashboard / docker -e):
| Var | Para qué |
|---|---|
| `DB_PATH=/var/data/db.json` | DB persistente (ya en render.yaml) |
| `META_VERIFY_TOKEN` | handshake de webhooks Meta |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` | enviar WhatsApp |
| `IG_TOKEN` | responder DMs de Instagram |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` | Gmail → Leads |

> Login app: `info@pisospacific.com` / `admin123` → **cambiá la contraseña** post-deploy (usuarios en `db.json`).

---

## 7) Checklist final
- [ ] §1 client_secret MP nuevo → sync anda
- [ ] §2 repo en GitHub + push
- [ ] §3 deploy en Render + db.json subido + URL pública
- [ ] §4 Meta: webhooks verificados + tokens → test WhatsApp ida/vuelta
- [ ] §5 Gmail (opcional)
- [ ] cambiar contraseña de admin
- [ ] revisar cola "a revisar" del cashflow (movimientos MP API sin nombre)

## 8) Comandos útiles
```bash
PORT=4173 node server.js                         # correr local
node scripts/sync-mp.mjs                          # probar MP API
node scripts/apply-counterparty-map.mjs --apply   # re-aplicar mapeo a db.json (con backup)
node scripts/unify-fletes.mjs --apply             # unificar fletes (con backup)
cd dashboard-app && npm run build                 # buildear frontend
```
