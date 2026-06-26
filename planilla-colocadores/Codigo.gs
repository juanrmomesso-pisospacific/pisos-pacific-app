/**
 * Pagos a Colocadores — Pisos Pacific
 * ------------------------------------------------------------------
 * Pegá TODO este archivo en el editor de Apps Script de la planilla
 * (Extensiones → Apps Script), guardá, y corré la función  setup()  una vez.
 * Construye 3 pestañas: Tarifario, Liquidación y Resumen, con formato,
 * desplegables, fórmulas y un menú propio "🪵 Pisos Pacific".
 *
 * Volver a correr setup() reconstruye todo desde cero (pierde lo cargado
 * en Liquidación) — usalo solo para regenerar. Para el día a día NO hace falta.
 */

// ====== Paleta de marca ======
var BRAND = '#0b0b12';   // fondo oscuro (igual que la app)
var AMBER = '#f59e0b';   // acento ámbar
var INK   = '#11131a';
var SOFT  = '#f5f5f4';   // gris muy claro para bandas
var GREEN = '#e6f4ea';   // pagado
var GREENT= '#1a7f37';
var AMBERBG = '#fdf2dc'; // pendiente
var LINE  = '#e5e7eb';

var N_FILAS = 300;  // filas de carga en Liquidación

// ====== Tarifario (precio más reciente extraído de tu planilla; editable) ======
// [Categoría, Tarea, Unidad, Precio ARS, Nota]
var TARIFAS = [
  ['Pisos',          'Colocación piso vinílico sobre manta',          'm²',      9000,  ''],
  ['Pisos',          'Colocación piso prefinished sobre manta',       'm²',      11000, ''],
  ['Pisos',          'Colocación piso vinílico con masa niveladora',  'm²',      15000, ''],
  ['Pisos',          'Nivelación con materiales',                     'm²',      15000, ''],
  ['Pisos',          'Retiro de piso existente (alfombra)',           'm²',      6000,  ''],

  ['Zócalos',        'Colocación de zócalos pegados y clavados',      'm lineal',6000,  ''],
  ['Zócalos',        'Retiro y recolocación de zócalos',              'm lineal',6000,  ''],

  ['Revestimientos', 'Revestimiento s/ durlock — sin corte',          'm²',      20000, ''],
  ['Revestimientos', 'Revestimiento s/ durlock — con corte',          'm²',      25000, ''],
  ['Revestimientos', 'Revestimiento s/ mampostería — sin corte',      'm²',      25000, ''],
  ['Revestimientos', 'Revestimiento s/ mampostería — con corte',      'm²',      27000, ''],

  ['Escaleras',      'Conjunto pedada/frentín (vinílico)',            'escalón', 55000, 'por escalón'],
  ['Escaleras',      'Conjunto pedada/frentín (madera)',              'escalón', 60000, 'por escalón'],
  ['Escaleras',      'Compensados y descansos',                       'unidad',  110000,'cada uno'],
  ['Escaleras',      'Ajuste de nariz en balconeo',                   'unidad',  45000, ''],
  ['Escaleras',      'Fabricación de nariz recta 90 H2O',             'unidad',  15000, ''],
  ['Escaleras',      'Relleno de pisada con fenólico o masa',         'unidad',  16000, ''],
  ['Escaleras',      'Relleno de alzada o frente con fenólico',       'unidad',  8000,  ''],

  ['Puertas',        'Ajuste puerta placa',                           'puerta',  35000, ''],
  ['Puertas',        'Ajuste puerta blindada / medidas especiales',   'puerta',  65000, ''],
  ['Puertas',        'Ajuste o cepillado de puerta',                  'puerta',  8000,  ''],
  ['Puertas',        'Adicional por puerta invisible',                'unidad',  150000,''],

  ['Limpieza',       'Limpieza Pro Clean — vinílico',                 'm²',      5000,  ''],
  ['Limpieza',       'Limpieza Pro Clean — madera',                   'm²',      6000,  ''],
  ['Limpieza',       'Limpieza Pro Clean — deck',                     'm²',      6000,  ''],
  ['Limpieza',       'Pintado de deck con impregnante',               'm²',      6000,  ''],

  ['Jornales',       'Jornal (día de trabajo)',                       'jornal',  80000, 'precio por día; dejá Unidades vacío'],
  ['Jornales',       'Reparación (varios)',                           'jornal',  100000,'monto a confirmar por trabajo'],
  ['Otros',          '— Otro (monto manual) —',                       '—',       0,     'escribí el Precio a mano en la fila'],
];

// ====== Colocadores iniciales (editables en Resumen) ======
var COLOCADORES = ['Hugo', 'Ariel', 'Fabián', 'Victor'];

// ====================================================================
//  MENÚ
// ====================================================================
function onOpen() { buildMenu_(); }

function buildMenu_() {
  SpreadsheetApp.getUi()
    .createMenu('🪵 Pisos Pacific')
    .addItem('➕ Agregar 50 filas a Liquidación', 'agregarFilas')
    .addItem('✓ Marcar pagadas las filas seleccionadas (con fecha de hoy)', 'marcarPagadas')
    .addSeparator()
    .addItem('💸 Generar gasto en la app (próximamente)', 'generarGastoStub')
    .addSeparator()
    .addItem('♻️ Reconstruir planilla (borra Liquidación)', 'confirmReset')
    .addItem('ℹ️ Ayuda', 'ayuda')
    .addToUi();
}

// ====================================================================
//  SETUP — construye todo
// ====================================================================
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  buildResumen_(ss);      // primero: define la lista de colocadores que usan los desplegables
  buildTarifario_(ss);
  buildLiquidacion_(ss);
  // borrar la "Hoja 1" por defecto si quedó vacía
  var def = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1') || ss.getSheetByName('Hoja1');
  if (def && ss.getSheets().length > 3) { try { ss.deleteSheet(def); } catch (e) {} }
  ss.setActiveSheet(ss.getSheetByName('Liquidación'));
  buildMenu_();
  SpreadsheetApp.getUi().alert('✅ Planilla lista.\n\nPestañas: Tarifario · Liquidación · Resumen.\nEmpezá a cargar en Liquidación; el Resumen se actualiza solo.');
}

// ---------- TARIFARIO ----------
function buildTarifario_(ss) {
  var sh = reset_(ss, 'Tarifario', 0);
  sh.getRange('A1').setValue('TARIFARIO DE COLOCACIÓN');
  styleTitle_(sh, 'A1:E1', 'Precios en pesos. Editá la columna Precio cuando actualicen las tarifas — todo lo demás se recalcula.');

  var head = ['Categoría', 'Tarea', 'Unidad', 'Precio (ARS)', 'Nota'];
  sh.getRange(3, 1, 1, head.length).setValues([head]);
  styleHeader_(sh.getRange(3, 1, 1, head.length));

  sh.getRange(4, 1, TARIFAS.length, 5).setValues(TARIFAS);
  var last = 3 + TARIFAS.length;

  sh.getRange(4, 4, TARIFAS.length, 1).setNumberFormat('"$"#,##0');
  sh.getRange(4, 1, TARIFAS.length, 5).setFontSize(11).setVerticalAlignment('middle');
  banding_(sh, 4, last, 5);
  sh.getRange(4, 2, TARIFAS.length, 1).setFontWeight('bold');           // Tarea destacada
  sh.getRange(4, 4, TARIFAS.length, 1).setFontColor(GREENT).setFontWeight('bold');

  sh.setColumnWidth(1, 130); sh.setColumnWidth(2, 320); sh.setColumnWidth(3, 90);
  sh.setColumnWidth(4, 120); sh.setColumnWidth(5, 260);
  sh.setFrozenRows(3);
  gridBorders_(sh.getRange(3, 1, TARIFAS.length + 1, 5));
}

// ---------- RESUMEN ----------
function buildResumen_(ss) {
  var sh = reset_(ss, 'Resumen', 2);
  sh.getRange('A1').setValue('RESUMEN POR COLOCADOR');
  styleTitle_(sh, 'A1:E1', 'Lo que le tenés que pagar a cada uno = columna PENDIENTE. Tildá "Pagado" en Liquidación y baja solo.');

  // Tipo de cambio de referencia (manual)
  sh.getRange('G3').setValue('Dólar de referencia (TC):').setFontWeight('bold').setHorizontalAlignment('right');
  sh.getRange('H3').setValue(1400).setNumberFormat('"$"#,##0').setBackground('#fff7e6')
    .setBorder(true, true, true, true, false, false, AMBER, SpreadsheetApp.BorderStyle.SOLID)
    .setFontWeight('bold');
  sh.getRange('G4').setValue('(editá H3 para ver el equivalente en USD)').setFontColor('#888').setFontStyle('italic').setHorizontalAlignment('right');

  var head = ['Colocador', 'Devengado (ARS)', 'Pagado (ARS)', 'Pendiente (ARS)', 'Pendiente (USD)'];
  sh.getRange(3, 1, 1, head.length).setValues([head]);
  styleHeader_(sh.getRange(3, 1, 1, head.length));

  // filas de colocadores (dejamos lugar para agregar más)
  var maxC = 20;
  var rows = [];
  for (var i = 0; i < maxC; i++) rows.push([COLOCADORES[i] || '', '', '', '', '']);
  sh.getRange(4, 1, maxC, 5).setValues(rows);

  for (var r = 4; r < 4 + maxC; r++) {
    sh.getRange(r, 2).setFormula('=IF($A' + r + '="","",SUMIF(Liquidación!$C:$C,$A' + r + ',Liquidación!$H:$H))');
    sh.getRange(r, 3).setFormula('=IF($A' + r + '="","",SUMIFS(Liquidación!$H:$H,Liquidación!$C:$C,$A' + r + ',Liquidación!$I:$I,TRUE))');
    sh.getRange(r, 4).setFormula('=IF($A' + r + '="","",$B' + r + '-$C' + r + ')');
    sh.getRange(r, 5).setFormula('=IF(OR($A' + r + '="",$H$3=""),"",$D' + r + '/$H$3)');
  }
  var lastC = 3 + maxC;

  // Totales
  sh.getRange(lastC + 1, 1).setValue('TOTAL').setFontWeight('bold');
  sh.getRange(lastC + 1, 2).setFormula('=SUM(B4:B' + lastC + ')');
  sh.getRange(lastC + 1, 3).setFormula('=SUM(C4:C' + lastC + ')');
  sh.getRange(lastC + 1, 4).setFormula('=SUM(D4:D' + lastC + ')');
  sh.getRange(lastC + 1, 5).setFormula('=IF($H$3="","",D' + (lastC + 1) + '/$H$3)');
  sh.getRange(lastC + 1, 1, 1, 5).setBackground('#1f2430').setFontColor('#ffffff').setFontWeight('bold');

  sh.getRange(4, 2, maxC + 1, 3).setNumberFormat('"$"#,##0');
  sh.getRange(4, 5, maxC + 1, 1).setNumberFormat('"US$"#,##0');
  sh.getRange(4, 1, maxC, 1).setFontWeight('bold');
  sh.getRange(4, 1, maxC + 1, 5).setFontSize(11).setVerticalAlignment('middle');
  banding_(sh, 4, lastC, 5);

  // Pendiente > 0 resaltado en ámbar
  var rule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($A4<>"",$D4>0.5)')
    .setBackground(AMBERBG).setFontColor('#92400e').setBold(true)
    .setRanges([sh.getRange('D4:D' + lastC)]).build();
  var rules = sh.getConditionalFormatRules(); rules.push(rule); sh.setConditionalFormatRules(rules);

  sh.setColumnWidth(1, 150);
  for (var c = 2; c <= 5; c++) sh.setColumnWidth(c, 150);
  sh.setColumnWidth(6, 20); sh.setColumnWidth(7, 170); sh.setColumnWidth(8, 100);
  sh.setFrozenRows(3);
  gridBorders_(sh.getRange(3, 1, maxC + 2, 5));
}

// ---------- LIQUIDACIÓN ----------
function buildLiquidacion_(ss) {
  var sh = reset_(ss, 'Liquidación', 1);
  sh.getRange('A1').setValue('LIQUIDACIÓN SEMANAL');
  styleTitle_(sh, 'A1:K1', 'Elegí Colocador y Tarea (desplegables). El Precio y el Importe salen solos. Al pagar, tildá "Pagado".');

  var head = ['Fecha', 'Semana', 'Colocador', 'Obra / Cliente', 'Tarea', 'Unidades',
              'Precio unit. (ARS)', 'Importe (ARS)', 'Pagado', 'Fecha de pago', 'Notas'];
  sh.getRange(3, 1, 1, head.length).setValues([head]);
  styleHeader_(sh.getRange(3, 1, 1, head.length));

  var first = 4, n = N_FILAS, lastRow = first + n - 1;
  // Fórmulas por fila (Semana / Precio / Importe)
  var fSem = [], fPre = [], fImp = [];
  for (var r = first; r <= lastRow; r++) {
    fSem.push(['=IF($A' + r + '="","",$A' + r + '-WEEKDAY($A' + r + ',3))']);
    fPre.push(['=IF($E' + r + '="","",IFERROR(VLOOKUP($E' + r + ',Tarifario!$B$4:$D,3,FALSE),""))']);
    fImp.push(['=IF($E' + r + '="","",IF($F' + r + '="",$G' + r + ',$F' + r + '*$G' + r + '))']);
  }
  sh.getRange(first, 2, n, 1).setFormulas(fSem);
  sh.getRange(first, 7, n, 1).setFormulas(fPre);
  sh.getRange(first, 8, n, 1).setFormulas(fImp);

  // Formatos
  sh.getRange(first, 1, n, 1).setNumberFormat('dd/mm/yyyy');           // Fecha
  sh.getRange(first, 2, n, 1).setNumberFormat('dd/mm/yyyy').setFontColor('#888');  // Semana
  sh.getRange(first, 10, n, 1).setNumberFormat('dd/mm/yyyy');          // Fecha de pago
  sh.getRange(first, 7, n, 2).setNumberFormat('"$"#,##0');             // Precio + Importe
  sh.getRange(first, 8, n, 1).setFontWeight('bold');
  sh.getRange(first, 6, n, 1).setHorizontalAlignment('center');
  sh.getRange(first, 1, n, 11).setFontSize(11).setVerticalAlignment('middle');

  // Checkbox Pagado
  sh.getRange(first, 9, n, 1).insertCheckboxes().setHorizontalAlignment('center');

  // Desplegables
  var colocVals = SpreadsheetApp.newDataValidation()
    .requireValueInRange(ss.getSheetByName('Resumen').getRange('A4:A23'), true)
    .setAllowInvalid(false).build();
  sh.getRange(first, 3, n, 1).setDataValidation(colocVals);

  var tareaVals = SpreadsheetApp.newDataValidation()
    .requireValueInRange(ss.getSheetByName('Tarifario').getRange('B4:B' + (3 + TARIFAS.length)), true)
    .setAllowInvalid(false).build();
  sh.getRange(first, 5, n, 1).setDataValidation(tareaVals);

  // Bandas + bordes
  banding_(sh, first, lastRow, 11);
  gridBorders_(sh.getRange(3, 1, n + 1, 11));

  // Fila pagada → verde (toda la fila)
  var paid = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$I4=TRUE')
    .setBackground(GREEN).setFontColor('#14532d')
    .setRanges([sh.getRange('A4:K' + lastRow)]).build();
  // Pendiente (cargado y NO pagado) → borde/relleno ámbar suave en Importe
  var pend = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($E4<>"",$I4=FALSE)')
    .setBackground(AMBERBG)
    .setRanges([sh.getRange('H4:H' + lastRow)]).build();
  var rules = sh.getConditionalFormatRules(); rules.push(paid); rules.push(pend);
  sh.setConditionalFormatRules(rules);

  // Anchos
  sh.setColumnWidth(1, 95); sh.setColumnWidth(2, 95); sh.setColumnWidth(3, 110);
  sh.setColumnWidth(4, 200); sh.setColumnWidth(5, 300); sh.setColumnWidth(6, 80);
  sh.setColumnWidth(7, 120); sh.setColumnWidth(8, 130); sh.setColumnWidth(9, 70);
  sh.setColumnWidth(10, 110); sh.setColumnWidth(11, 200);
  sh.setFrozenRows(3); sh.setFrozenColumns(1);
}

// ====================================================================
//  ACCIONES DEL MENÚ
// ====================================================================
function agregarFilas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Liquidación');
  var add = 50;
  var lastRow = sh.getMaxRows();
  sh.insertRowsAfter(lastRow, add);
  var src = sh.getRange(4, 1, 1, 11);
  // copiar fórmulas/validaciones/formatos de la 1ª fila de datos a las nuevas
  var first = lastRow + 1;
  var fSem = [], fPre = [], fImp = [];
  for (var r = first; r < first + add; r++) {
    fSem.push(['=IF($A' + r + '="","",$A' + r + '-WEEKDAY($A' + r + ',3))']);
    fPre.push(['=IF($E' + r + '="","",IFERROR(VLOOKUP($E' + r + ',Tarifario!$B$4:$D,3,FALSE),""))']);
    fImp.push(['=IF($E' + r + '="","",IF($F' + r + '="",$G' + r + ',$F' + r + '*$G' + r + '))']);
  }
  sh.getRange(first, 2, add, 1).setFormulas(fSem);
  sh.getRange(first, 7, add, 1).setFormulas(fPre);
  sh.getRange(first, 8, add, 1).setFormulas(fImp);
  sh.getRange(4, 1, 1, 11).copyTo(sh.getRange(first, 1, add, 11), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  sh.getRange(first, 3, add, 1).copyTo(sh.getRange(first, 3, add, 1), SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  sh.getRange(4, 3, 1, 1).copyTo(sh.getRange(first, 3, add, 1), SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  sh.getRange(4, 5, 1, 1).copyTo(sh.getRange(first, 5, add, 1), SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  sh.getRange(first, 9, add, 1).insertCheckboxes();
  SpreadsheetApp.getActiveSpreadsheet().toast('Se agregaron ' + add + ' filas.');
}

function marcarPagadas() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  if (sh.getName() !== 'Liquidación') {
    SpreadsheetApp.getUi().alert('Seleccioná las filas a marcar en la pestaña Liquidación.');
    return;
  }
  var sel = sh.getActiveRange();
  var start = sel.getRow(), nRows = sel.getNumRows();
  if (start < 4) { SpreadsheetApp.getUi().alert('Seleccioná filas de datos (de la 4 para abajo).'); return; }
  var hoy = new Date();
  for (var i = 0; i < nRows; i++) {
    var r = start + i;
    if (sh.getRange(r, 5).getValue() === '') continue; // sin tarea = fila vacía
    sh.getRange(r, 9).setValue(true);
    if (sh.getRange(r, 10).getValue() === '') sh.getRange(r, 10).setValue(hoy);
  }
  SpreadsheetApp.getActiveSpreadsheet().toast('Marcadas como pagadas (' + nRows + ' filas).');
}

function generarGastoStub() {
  SpreadsheetApp.getUi().alert(
    '💸 Generar gasto en la app\n\n' +
    'Esta función va a mandar el pendiente de cada colocador como un gasto al CashFlow ' +
    'de Pisos Pacific (un gasto por colocador). Todavía no está conectada — la activamos ' +
    'cuando definamos la conexión a la app.\n\n' +
    'Por ahora: mirá la columna PENDIENTE en la pestaña Resumen y cargá el pago por WhatsApp como siempre.');
}

function confirmReset() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.alert('Reconstruir planilla',
    'Esto reconstruye Tarifario, Liquidación y Resumen desde cero. ' +
    'Se PIERDE todo lo cargado en Liquidación. ¿Continuar?', ui.ButtonSet.YES_NO);
  if (res === ui.Button.YES) setup();
}

function ayuda() {
  SpreadsheetApp.getUi().alert(
    'Cómo se usa\n\n' +
    '1) TARIFARIO: la lista de precios en pesos. Cuando actualicen una tarifa, cambiá solo la columna Precio.\n\n' +
    '2) LIQUIDACIÓN: cargá cada trabajo → Fecha, Colocador, Obra, Tarea (desplegable) y Unidades. ' +
    'El Precio y el Importe se calculan solos. Para un trabajo sin tarifa fija, elegí "— Otro (monto manual) —" y escribí el Precio a mano.\n\n' +
    '3) Cuando pagás: tildá "Pagado" (o usá el menú → Marcar pagadas). \n\n' +
    '4) RESUMEN: muestra por colocador lo Devengado, lo Pagado y lo PENDIENTE (lo que le tenés que pagar). ' +
    'Cargá ahí los nombres de los colocadores en la columna A.');
}

// ====================================================================
//  HELPERS DE FORMATO
// ====================================================================
function reset_(ss, name, idx) {
  var sh = ss.getSheetByName(name);
  if (sh) ss.deleteSheet(sh);
  sh = ss.insertSheet(name, idx);
  sh.setHiddenGridlines(true);
  return sh;
}
function styleTitle_(sh, range, subtitle) {
  sh.getRange(range).merge().setValue(sh.getRange(range.split(':')[0]).getValue())
    .setBackground(BRAND).setFontColor('#ffffff').setFontSize(15).setFontWeight('bold')
    .setVerticalAlignment('middle').setHorizontalAlignment('left');
  sh.setRowHeight(1, 40);
  sh.getRange(2, 1).setValue(subtitle).setFontColor('#6b7280').setFontStyle('italic').setFontSize(10);
}
function styleHeader_(rng) {
  rng.setBackground(INK).setFontColor('#ffffff').setFontWeight('bold')
     .setVerticalAlignment('middle').setHorizontalAlignment('left').setFontSize(11);
  rng.getSheet().setRowHeight(rng.getRow(), 32);
}
function banding_(sh, r1, r2, ncol) {
  for (var r = r1; r <= r2; r++) {
    if ((r - r1) % 2 === 1) sh.getRange(r, 1, 1, ncol).setBackground(SOFT);
    sh.setRowHeight(r, 26);
  }
}
function gridBorders_(rng) {
  rng.setBorder(true, true, true, true, true, true, LINE, SpreadsheetApp.BorderStyle.SOLID);
}
