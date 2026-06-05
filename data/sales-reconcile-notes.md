# Conciliación ventas ↔ ingresos (grilling 2026-06-05)

Regla base: payment_state como guía, PERO con excepciones caso por caso (confirmado por el dueño).
Cola <US$2000 Finalizado/Cobrado → saldo 0 (redondeo/contrato inflado).

## Decisiones confirmadas
- 0000082 Ciro/Sevilla (Silvi V.): pagaron TODO (2 pagos: $15.742 el 7/11 → en realidad va a 0000070, y $14.926 el 15/12 → 0000082). Ambas saldadas. → saldo 0 en 0000082 y 0000070.
- 0000007 Villa Ballester (Vale Laurito): el cobro de $8.900 del 16/10 estaba MAL — era de 0000006. Re-linkear a 0000006. La venta real de Vale era $1.899,75 y está saldada. → contract_total 0000007 = 1899.75, saldo 0; mover cobro a 0000006.
- 0000063 Deck Putrele (Agustina Lando): pagado todo ($4000 usd 2/10 + $1400 usd 31/10 = $5400). Contrato inflado. → saldo 0.
- 0000058 Barbarita (Estudio Aldave): cobrado todo; el saldo de $3.967 quizá NO se registró (pagos de Aquagroup SRL, o efectivo). → saldo 0; buscar/añadir ingreso faltante.

## Correcciones tras verificar
- 0000058 Barbarita: el cobro SÍ está registrado ($5.101 el 2/10 + $2.931 el 14/01 = $8.032). → saldo 0, sin acción en cashflow.
- 0000007 / 0000006: el re-link del $8.900 es delicado — 0000006 (Ana Blousson) ya está sobrepagada ($19.000/$17.540) y le falta agregar colocación. CONFIRMAR con el dueño antes de mover. 0000007 → contract 1.899,75 + saldo 0 igual.

## Batch 2 — patrón confirmado: Finalizado/Cobrado = 100% cobrado, valor real = lo cobrado
- 0000055 Carola: pagaron 2.968 de MÁS (ajustes obra + IVA). Cobrado total. → saldo 0.
- 0000102 Nordelta: cobrado todo, pagaron más por ajustes. Valor real = lo cobrado. → saldo 0.
- 0000104 Gurruchaga: cobrado el total; valor de venta = lo cobrado. → saldo 0.
- 0000095 Thames: cobro registrado; la transferencia incluye IVA (por eso el gap con el valor sin IVA). → saldo 0.

### REGLA: contract_total NO es confiable como valor de venta (incluye IVA / ajustes / inflado).
Para Finalizado/Cobrado: valor de venta real = cashflow_paid; saldo = 0.
Excepciones puntuales (errores de carga): 0000007 (cobro mal atribuido).

## Batch 3 — Finalizado/Adelanto
- 0000107 Tortugas Country: FALTA registrar cobro de US$5.350 (saldo), cobrado 7/05/2026. → AGREGAR ingreso US$5.350 fecha 2026-05-07 ref 0000107 (definir caja). saldo→0.
- 0000094 Diaz Velez: todo cobrado, presupuesto 5524 incluye IVA. → saldo 0.
- 0000092 Levene 936 (Dacharry): me deben $1.918. → PENDIENTE real.
- 0000100 Nuñez (Catalina): me deben $1.634. → PENDIENTE real.
- 3 chicas Fina/Adelanto (<US$1000): 0000078, 0000064, 0000118 → saldo 0 por default.

## Pendientes reales (cuentas por cobrar confirmadas)
- 0000092 Levene Dacharry $1.918
- 0000100 Nuñez Catalina $1.634
- (por confirmar) Confirmado/Programado: 0000098, 0000122, 0000112, 0000121, 0000086, 0000088

## Tandas 1-3 + consolidado (grilling)
SALDO 0 (cobradas, gap = IVA/ajustes): 0000029, 0000011, 0000060, 0000069, 0000028, 0000064, 0000118, 0000094, 0000055, 0000102, 0000104, 0000095, 0000058, 0000063, 0000082, 0000070
PENDIENTE real (me deben): 0000098, 0000122, 0000112, 0000121, 0000086, 0000088, 0000124, 0000131, 0000092, 0000100, 0000078
FALTA REGISTRAR COBRO (agregar ingreso): 
  - 0000107: US$5.350, 2026-05-07 (caja a definir)
  - 0000132: US$605, 2026-05-11 (caja a definir)
ESPECIAL: 0000007 → contract_total 1.899,75, saldo 0; el cobro $8.900 del 16/10 va a 0000006 (confirmar, 0000006 ya sobrepagada)

## RESULTADO FINAL ventas↔ingresos (53 revisadas)

### PENDIENTE real (cuentas por cobrar) — mantener saldo:
0000098 ($15.382), 0000122 ($10.240), 0000112 ($8.090), 0000121 ($7.258),
0000086 ($5.621), 0000088 ($2.969), 0000092 ($1.918), 0000100 ($1.634),
0000124 ($1.404), 0000131 ($966), 0000078 ($807)
TOTAL pendiente real ≈ US$56.289

### FALTA REGISTRAR COBRO (agregar ingreso al cashflow):
- 0000107 Tortugas Country: +US$5.350 el 2026-05-07
- 0000132 Av Corrientes/Alessio: +US$605 el 2026-05-11
- 0000120 Cami Fuks: +US$1.789 el 2026-04-10  Y un EGRESO asociado: comisión US$440 (Cami Fuks, Marketing/Ventas)
  (definir CAJA de cada uno)

### SALDO 0 (cobradas; el gap es IVA/ajustes de obra) → valor real de venta = lo cobrado:
todas las demás (~37): 0000005,0000011,0000021,0000028,0000029(x2),0000030,0000038,0000041,
0000045,0000047,0000050,0000053,0000055,0000058,0000060,0000062,0000063,0000064,0000065,
0000069,0000070,0000073,0000077,0000082,0000084,0000087,0000090,0000091,0000094,0000095,
0000099,0000102,0000104,0000110,0000113,0000117,0000118,0000120(post-cobro)
Implementación: set contract_total = cashflow_paid (saldo 0; valor venta = cobrado).

### ESPECIAL:
- 0000007 Villa Ballester (Vale Laurito): contract_total → US$1.899,75, saldo 0.
  El cobro $8.900 del 16/10 estaba mal atribuido → es de 0000006. PERO 0000006 ya está
  sobrepagada → CONFIRMAR con dueño antes de mover.
- 0000029: son 2 registros = misma venta, 2 productos distintos; pagado el total → ambos saldo 0.

## APLICADO (2026-06-05)
- Fase 1: cargados 3 cobros faltantes + comisión Cami Fuks (→ Caja General) y AJUSTES DE APERTURA
  por caja → las 6 cajas ahora COINCIDEN con el saldo real (total US$100.673).
  (scripts/import-reconcile.mjs → cashflow-reconcile-extra.seed.json)
- Fase 2: 40 ventas confirmadas saldo 0 → contract_total = cobrado (scripts/apply-sales-saldos.mjs).
  Pendiente de cobro real = US$56.289 (11 ventas) + 0000007 flageada (US$7.000).

## PENDIENTE para próxima ronda
- 0000007/0000006: re-link del cobro $8.900 (0000006 sobrepagada). CONFIRMAR.
- 22 ventas SOBREPAGADAS (cobrado > contrato, ~US$30k total): mismo patrón IVA, pero sin revisar.
  Las más grandes: 0000056 (-6103), 0000109 (-3944), 0000074 (-3310), 0000116 (-2742), 0000138 (-2502),
  0000106 (-2198). Revisar caso por caso (igual que las positivas) en otra sesión.

## Sobrepagadas — grilling (2026-06-05, ronda 2)
- 0000074 Hauston: agregaron zócalos → contract = cobrado (9039), saldo 0.
- 0000012 Belgrano: valor = cobrado (4100), saldo 0.
- 0000138 Highland: valor = cobrado (14415), saldo 0; AGREGAR egreso comisión Oppel US$1078 (Marketing/Ventas, ref 0000138).
- 0000056 Oficinas Agustina Lando: valor real = 19000 → PENDIENTE (+6103). "revisar la venta".
- 0000109 Praderas Conni: valor real = 12944 → PENDIENTE (+3944).
- 0000116 Mapuches Estefy: cobró 5916,05 (27/3), DEVOLVIÓ 2075,15 (23/5, incl IVA, desde USD) por -35m2.
  → agregar devolución -2075,15 (Caja General USD, 23/5, ref 0000116); contract = 3840,90 (saldo 0).
- 0000012... (ya)
- FALTA VALOR (contrato venía mal): 0000106 Ada Elflein (adelanto $2000, falta cobrar), 0000048 Michelle (falta cobrar), 0000079 Roble Gris (contrato negativo).

## Sobrepagadas chicas — valores exactos del dueño (ronda 3)
saldo 0 (valor=cobrado): 0000034(3500), 0000133(4576), 0000080(6060), 0000114(1938)
valor exacto (queda saldo chico pendiente): 0000020(2673), 0000014(7364,80), 0000013(9416),
  0000057(5216), 0000072(2974), 0000036(5071,50), 0000051(8757), 0000027(2453,85),
  0000075(8744,20), 0000093(6036,80), 0000085(5511)
RESULTADO: 0 sobrepagadas; pendiente de cobro = US$73.174 (30 ventas).

## Ventas sin cobro / errores de signo (grilling 2026-06-05, ronda 4)
Las 12 negativas = error de signo (qty×precio positivo, total quedó negativo). Valor real = absoluto.
- 0000018 Agro Oficinas: valor US$4.768, SALDADA POR CANJE (contra alquiler del depósito) → no pending, sin cobro de caja.
- 0000037 Oficinas PRG: igual que 0000018, US$4.440, canje alquiler.
- 0000097 Escalera (Rosario Novillo): es parte de Obra Tortugas (con 0000098). Usar info app vieja = cotización A0061. BORRAR 0000097; 0000098 queda con el detalle (total neto US$25.382).
- 0000049 Aspen (Pacific San Juan): ELIMINAR (no avanzó).

## Ronda 4 — tanda 2 (fusiones)
- 0000108: BORRAR. 0000107 (Francisco Rollo) es la venta única, ya cobrada $16.350. Corregir cliente → "Francisco Royo".
- 0000105: BORRAR. 0000104 (Sebastián Gurruchaga) es única, cobrado $4.200.
- 0000101: BORRAR. 0000100 (Nuñez / Estudio BOW) es única, valor $5.334. AGREGAR cobro US$1.634 el 3/5 → saldo 0. AGREGAR comisión egreso US$540 (Estudio BOW, 3/5, Marketing/Ventas) — compartida Nuñez+Gurruchaga.
- 0000067 Scalabrini (GGYA): valor $1.395, PENDIENTE.

## Ronda 4 — tanda 3
- 0000123 La Plata (Lea Rodriguez): cobro US$939 + egreso sueldo Juan&Pipi US$939 (salió directo como sueldo). valor 939, saldo 0.
- 0000081 Hall AgroAlimentos: cobro 755+IVA = US$913,55 → BBVA. contract=913,55, saldo 0.
- 0000032 Dorrego: cobro 720+IVA = US$871,20 → BBVA. contract=871,20, saldo 0.
- 0000068 Newman (Mariana): valor 246, PENDIENTE.
NOTA: tras agregar cobros, re-correr import-reconcile.mjs (cajas = saldo real).

## Ronda 4 — grupo B (positivas sin cobro)
- 0000125 Pereyra: cobro $3.147.000 ARS @TC1385 = US$2.272,20 + comisión egreso $147.000 ARS = US$106,14 (arquitecta, Marketing/Ventas). contract=2272, saldo 0. (caja a confirmar; asumo MP/BdC)
- 0000134 Suipacha (Connie Huergo): adelanto US$7.000 efectivo 7/5 (Caja General). valor 9132 → saldo US$2.132 pendiente.
- 0000129 Chacabuco (Beatriz): cobro US$2.400 efectivo (Caja General), saldo 0.
- 7 pendientes restantes: revisar una por una.

## Ronda 4 — grupo B (cierre)
- 0000135 Haras Capilla (Chloé): cobro $14.729.575,63 @1390 = US$10.597,54 → Banco de Comercio 1/06. valor 12861, saldo ~2263 pendiente.
- 0000136 Centauros (Kike): PENDIENTE.
- 0000137 Freire (Agustina Lando): adelanto US$2.100 efectivo 29/5 (Caja General). valor 2951, saldo ~851 pendiente.
- 0000126, 0000127, 0000128, 0000052: PENDIENTE (sin cobro).

## RESUMEN APLICACIÓN ronda 4
BORRAR: 0000097, 0000108, 0000105, 0000101, 0000049
SIGN-FLIP item.total+contract a positivo: 0000018,0000037,0000067,0000123,0000081,0000032,0000068
CLIENTE: 0000107 → "Francisco Royo"
CANJE (financial_position saldado, sin caja): 0000018 (4768), 0000037 (4440)
COBROS a cashflow (+ re-correr reconcile):
  0000100 US$1.634 (Caja General); 0000123 US$939 (Caja Gral) + egreso sueldo Juan&Pipi US$939
  0000081 US$913,55 BBVA; 0000032 US$871,20 BBVA
  0000125 US$2.272,20 BdC; 0000129 US$2.400 efectivo; 0000134 US$7.000 efectivo 7/5
  0000135 US$10.597,54 BdC 1/06; 0000137 US$2.100 efectivo 29/5
COMISIONES egreso: US$540 Estudio BOW (0000100); US$106,14 arq. Pereyra (0000125)
CONTRACT=cobrado (saldo 0): 0000081(913,55),0000032(871,20),0000123(939),0000125(2272,20),0000129(2400)
PENDIENTE: 0000067(1395),0000068(246),0000126,0000127,0000128,0000136,0000052,
  y parciales 0000134(saldo 2132),0000135(saldo 2263),0000137(saldo 851)
