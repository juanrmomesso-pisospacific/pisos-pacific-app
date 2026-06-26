# Planilla "Pagos a Colocadores" — Pisos Pacific

Planilla nueva, limpia, para liquidar los pagos semanales a los colocadores.
Reemplaza la pestaña desprolija de la planilla vieja.

## Qué hace
- **Tarifario**: lista única de precios en pesos por tarea (la fuente de verdad). Cuando suben una tarifa, cambiás **solo el Precio** y se recalcula todo.
- **Liquidación**: cargás cada trabajo (fecha, colocador, obra, tarea, unidades). El **precio y el importe salen solos**. Tildás **"Pagado"** cuando pagás.
- **Resumen**: por colocador, **Devengado − Pagado = Pendiente** (= lo que le tenés que pagar). Con equivalente en USD a un dólar de referencia editable.
- **Menú "🪵 Pisos Pacific"**: agregar filas, marcar pagadas (con fecha de hoy), ayuda, y el botón **"Generar gasto en la app"** (todavía no conectado — lo activamos después).

## Instalación (5 minutos, una sola vez)

La planilla ya está creada en tu Drive:
**https://docs.google.com/spreadsheets/d/1jesvvAf_yCoak9Qff_NPJJRhlrAzmFQBqwqS619cw3I/edit**

1. Abrila con ese link (estás logueado como info@pisospacific.com).
2. Menú **Extensiones → Apps Script**.
3. Borrá lo que haya y **pegá todo el contenido de `Codigo.gs`**.
4. Guardá (💾).
5. Arriba, en el selector de función elegí **`setup`** y apretá **▶ Ejecutar**.
6. La primera vez Google pide permiso → **Revisar permisos → tu cuenta → Permitir**. (Es tu propio script sobre tu propia planilla.)
7. Listo: se arman las 3 pestañas con formato. Volvé a la planilla.

## Uso diario
- Cargá los trabajos en **Liquidación** (los desplegables de Colocador y Tarea evitan tipear mal).
- Para un trabajo sin tarifa fija: elegí **"— Otro (monto manual) —"** y escribí el Precio a mano en esa fila.
- Cuando se acaban las filas: menú → **Agregar 50 filas**.
- Al pagar: tildá **Pagado** (o seleccioná las filas y usá el menú → **Marcar pagadas**).
- Mirá en **Resumen** la columna **Pendiente** = cuánto le debés a cada uno.

## Mantenimiento
- **Actualizar tarifas**: cambiá la columna *Precio* en **Tarifario**. No toques nada más.
- **Agregar un colocador**: escribilo en la columna A de **Resumen** (aparece solo en el desplegable).
- **Agregar una tarea nueva**: agregá una fila en **Tarifario** (Categoría, Tarea, Unidad, Precio).

## Pendiente (cuando quieras)
Conectar el botón **"Generar gasto en la app"** para que mande el pendiente de cada colocador
al CashFlow de la app (un gasto por colocador). Es un cambio chico; lo vemos cuando decidas
si el macro se loguea con tu usuario o con un token nuevo.
