# Conectar WhatsApp empresa (modo Coexistence) — step-by-step

**Objetivo:** que los WhatsApp del número nuevo entren y se respondan **dentro de la app** (pantalla Mensajes), **sin perder** el uso del número en la app de WhatsApp Business del celular (catálogo, etiquetas, chat a mano). Eso es **Coexistence**: el mismo número funciona en el celular **y** en la Cloud API a la vez, con los chats espejados.

> Lo que YA está hecho (código): recepción y envío por WhatsApp (`integrations/meta.mjs`), webhook `/api/whatsapp/webhook`, y el **espejado de los mensajes que respondés desde el celular** (probado en local). Falta solo lo que requiere tus cuentas de Meta (abajo).

---

## Antes de empezar
- El número nuevo tiene que estar **activo en la app de WhatsApp Business** del celular (no el WhatsApp normal). Si todavía no lo configuraste como Business, hacelo primero (instalá "WhatsApp Business", registrá el número, completá el perfil).
- Vas a usar la app de Meta **"Pacific"** que ya creaste para Instagram (mismo developers de `juanrmomesso@gmail.com`). No hace falta una app nueva.

## Paso 1 — Agregar el producto WhatsApp a la app "Pacific"
1. Entrá a https://developers.facebook.com/apps → app **Pacific**.
2. En el panel izquierdo, "Add product" → **WhatsApp** → Set up.

## Paso 2 — Conectar el número en modo Coexistence
1. Dentro de WhatsApp → **API Setup** (o "Configuración de la API").
2. Botón **"Add phone number" / "Connect a number"**.
3. Cuando detecte que el número ya está en la **app de WhatsApp Business**, ofrece la opción **Coexistence** ("usar también en la app del celular"). Elegila.
4. Te va a pedir **escanear un QR**: en el celular, abrí WhatsApp Business → **Ajustes → Herramientas para la empresa / API** (según versión, "Vincular con la API") → escaneá el QR.
5. Confirmá. Queda vinculado: el número sigue andando en el celular y ahora también por la API.

> Si la opción Coexistence no aparece, avisame y revisamos: a veces depende de la versión de la app o de que el número recién registrado "asiente" unos minutos.

## Paso 3 — Anotar las 2 credenciales
En la misma pantalla **API Setup**:
- **Phone number ID** → es el `WHATSAPP_PHONE_ID` (un número largo, NO el teléfono).
- **Token**: el temporal sirve para probar 24h. Para producción generá uno **permanente**:
  - Business Settings → **System Users** → creá/usá un system user → **Generate token** → app Pacific → permisos `whatsapp_business_messaging` y `whatsapp_business_management` → ese es el `WHATSAPP_TOKEN`.

## Paso 4 — Configurar el Webhook
1. WhatsApp → **Configuration / Webhooks** → **Edit**.
2. **Callback URL:** `https://pisos-pacific.onrender.com/api/whatsapp/webhook`
3. **Verify token:** `pisospacific2026` (el mismo que ya usás para Instagram).
4. Verify and save (tiene que dar el tilde verde).
5. **Subscribir los campos** (Manage / Webhook fields):
   - `messages` ← imprescindible (mensajes de clientes).
   - `smb_message_echoes` ← imprescindible para Coexistence (espeja en la app lo que respondés desde el celular).

## Paso 5 — Cargar las credenciales en Render (lo hago yo cuando me las pases)
En Render (servicio `pisos-pacific`), Environment:
- `WHATSAPP_TOKEN` = (token permanente del Paso 3)
- `WHATSAPP_PHONE_ID` = (Phone number ID del Paso 3)
- `META_VERIFY_TOKEN` = `pisospacific2026` (ya debería estar; si no, agregalo)

> Ojo: cambiar envs por API **no redeploya solo** → hay que disparar un deploy. De eso me encargo yo.

## Paso 6 — App en modo Live
Igual que Instagram: la app **Pacific** tiene que estar en modo **Live** (ya lo está, con la página `/privacy`). Para recibir mensajes de clientes reales con tu propio número **no hace falta App Review**.

## Paso 7 — Prueba de fuego (la hacemos juntos)
1. Desde otro teléfono, mandá un WhatsApp al número nuevo → debe aparecer en **Mensajes** + un **lead** nuevo.
2. Respondé **desde la app** (pantalla Mensajes) → debe llegar al teléfono del cliente.
3. Respondé **desde el celular** (app WhatsApp Business) → ese mensaje debe **aparecer también** en Mensajes (eso es el espejado de Coexistence).

---

## Qué pasa con catálogo / difusión / campañas (tu requisito)
- **Catálogo:** seguís gestionándolo en la app de WhatsApp Business del celular. Coexistence lo conserva. (Más adelante podemos sincronizar el catálogo desde el Inventario + banco de imágenes de la app.)
- **Difusión / comunicaciones:** las "listas de difusión" del celular se deshabilitan en Coexistence, pero se reemplazan por **mensajes de plantilla (templates)** vía API — más potentes y medibles. Eso lo construimos en el Frente 3 (Mensajes).
- **Campañas con Instagram:** son anuncios "click-to-WhatsApp" que se arman en **Meta Ads / Business Suite**, independientes de esto. Te armo una guía aparte cuando quieras.

## Qué me tenés que pasar para terminar
1. `WHATSAPP_PHONE_ID`
2. `WHATSAPP_TOKEN` (permanente)
3. Confirmación de que el webhook quedó con tilde verde y los campos `messages` + `smb_message_echoes` suscritos.
