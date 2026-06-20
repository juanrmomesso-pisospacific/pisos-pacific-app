// Parsing + clasificación de extractos para la carga desde la app.
// Soporta: 'mp' (Mercado Pago account_statement .xlsx), 'bbva' (Banco Francés /
// "Últimos movimientos" .xlsx) y 'bdc' (Banco de Comercio, .xlsx columnar).
// Devuelve movimientos en el mismo formato que el cashflow, con un flag _dupe
// (ya cargado: misma caja, fecha ±3 y |monto ARS|) para que la UI los muestre en
// un preview ANTES de insertar. No inserta nada: eso lo hace el server al confirmar.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reportStats } from './report-stats.mjs';
import { dedupKey, windowKeys } from './dedup.mjs';
import { lastBlue } from './fx.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '..', 'dashboard-app', 'package.json'));
const XLSX = require('xlsx');

const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// Reglas de clasificación: auto-mapean nombre/CUIT → proveedor + clasificación.
// Fuente: db.cp_rules (editables + aprendidas), pasadas a parseStatement. Fallback: el
// archivo legacy data/counterparty-map.json. Si una regla matchea, el movimiento queda "conocido".
const PER_DEFAULT = 'Gastos de Personal (HR y Mano de Obra)';
let CPMAP = { PER: PER_DEFAULT, byCuit: {}, byNameIdx: new Map() };

// Construye los índices (byCuit, byName) desde un array plano de reglas (db.cp_rules).
function buildCpmap(rules) {
  const byCuit = {}, idx = new Map();
  for (const r of rules || []) {
    if (r.cuit) byCuit[String(r.cuit).replace(/\D/g, '')] = r;
    for (const m of (r.match || [])) if (m) idx.set(norm(m), r);
  }
  return { PER: PER_DEFAULT, byCuit, byNameIdx: idx };
}
// parseStatement llama a esto con db.cp_rules antes de parsear.
export function setRules(rules) { if (Array.isArray(rules) && rules.length) CPMAP = buildCpmap(rules); }

// Fallback: cargar el archivo legacy si nadie setea reglas de la DB.
try {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'counterparty-map.json'), 'utf8'));
  const idx = new Map();
  for (const e of raw.byName || []) for (const m of e.match) idx.set(norm(m), e);
  CPMAP = { PER: raw.PER || PER_DEFAULT, byCuit: raw.byCuit || {}, byNameIdx: idx };
} catch { /* sin mapa: el importador usa solo sus reglas internas */ }

// Aplica el mapa a un record ya armado (mutándolo). cuit opcional (bancos).
function applyCpMap(rec, rawName, cuit) {
  const e = (cuit && CPMAP.byCuit[String(cuit).replace(/\D/g, '')]) || CPMAP.byNameIdx.get(norm(rawName)) || CPMAP.byNameIdx.get(norm(rec.counterparty));
  if (!e) return rec;
  if (e.personal && rec.flow === 'Egreso') {
    rec.counterparty = 'Juan & Pipi'; rec.category = 'Sueldos'; rec.subcategory = 'Retiro/Personal';
    rec.expense_type = CPMAP.PER; rec.counterparty_type = 'supplier';
    if (!/^personal/i.test(rec.description || '')) rec.description = 'Personal — ' + (rec.description || '');
    rec.needs_review = false; rec.review_reason = null;
    return rec;
  }
  if (e.counterparty) rec.counterparty = e.counterparty;
  if (rec.flow === 'Egreso') { if (e.category) rec.category = e.category; if (e.expense_type) rec.expense_type = e.expense_type; }
  rec.needs_review = false; rec.review_reason = null;   // contraparte conocida
  return rec;
}

export const CAJA = {
  mp:   { id: 'CAJ-002', name: 'Mercado Pago' },
  bbva: { id: 'CAJ-001', name: 'BBVA' },
  bdc:  { id: 'CAJ-003', name: 'Banco de Comercio - Cuenta Pesos' },
};

// ---- helpers de montos / fechas ----
// "$ 1.234,56" / "USD 22,00" / "$ -2.363.645,60" → { cur, val }
function parseMoney(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return { cur: 'ARS', val: raw };
  let s = String(raw).trim();
  if (!s) return null;
  const cur = /usd|u\$s|us\$/i.test(s) ? 'USD' : 'ARS';
  s = s.replace(/usd|u\$s|us\$|\$|ars|\s/gi, '');     // saca símbolos y espacios
  const neg = s.includes('-');
  s = s.replace(/[^0-9.,]/g, '');
  // formato AR: miles '.', decimal ','
  s = s.replace(/\./g, '').replace(',', '.');
  const val = parseFloat(s);
  if (isNaN(val)) return null;
  return { cur, val: neg ? -Math.abs(val) : val };
}
// dd/mm/yy o dd/mm/yyyy o yyyy-mm-dd o Date → yyyy-mm-dd
function parseDate(raw) {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date && !isNaN(+raw)) return raw.toISOString().slice(0, 10);
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) { let [, d, mo, y] = m; if (y.length === 2) y = '20' + y; return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`; }
  return null;
}

function readSheet(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: false });
}

// ===================== Clasificación bancaria genérica (BBVA / BdC) =====================
const PER = 'Gastos de Personal (HR y Mano de Obra)';
const SUM = 'Gastos de Instalaciones y Suministros';
const isPeaje = (t) => /ausol|\bausa\b|aubasa|telepase|autopista|au oeste|au del oeste|corredores viales|caminos del|\bpeaje/i.test(t);
const RETAIL = /carrefour|\bcoto\b|jumbo|\bdisco\b|\bdia\b|farmacia|chango|\bvea\b|starbucks|mcdonald|rappi|pedidosya|cabify|\buber\b|spotify|netflix|apple\.com/i;
const FLOTA = /ypf|appypf|shell|axion|puma|nafta|combust|gnc|estacion|sancor seguros|patente|peaje/i;
const MKT = /google|facebk|facebook|meta\b|instagram|framer|ads|tiktok/i;
const TRANSFER = /mov entre cuentas|transferencia a cuenta propia|cuenta propia|debin|su pago en pesos|pago de tarjeta|pago tarjeta visa/i;

function classifyBank(desc) {
  const t = norm(desc);
  if (TRANSFER.test(t)) return { transfer: true, category: 'Otros Gastos y Ajustes', subcategory: 'Ajuste', expense_type: 'Otros Gastos y Ajustes', counterparty: 'MOV ENTRE CUENTAS' };
  if (/arca|afip|arba|rentas|dgr|sircreb|iibb|ley 25413|impuesto|comision|iva|i\.v\.a/i.test(t)) return { category: 'Impuestos', expense_type: 'Impuestos y Tasas', fixed_variable: 'Fijo', counterparty: 'Impuestos / Banco' };
  if (isPeaje(t) || FLOTA.test(t)) return { category: 'Flota', expense_type: 'Gastos de Flota/Vehículos', counterparty: desc };
  if (MKT.test(t)) return { category: 'Marketing', expense_type: 'Gastos de Marketing y Comerciales', counterparty: desc };
  if (RETAIL.test(t)) return { category: 'Otros', expense_type: PER, counterparty: 'Juan & Pipi', description_override: 'Personal — ' + desc };
  if (/easy|sodimac|pinturer|ferreter|sanitarios/i.test(t)) return { category: 'Insumos', expense_type: SUM, counterparty: desc };
  return { category: 'Otros', expense_type: null, counterparty: desc };
}

// Localiza el índice de la fila de encabezado y el mapeo de columnas.
function findBankColumns(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const r = (rows[i] || []).map((c) => norm(c));
    const find = (re) => r.findIndex((c) => re.test(c));
    const cFecha = find(/fecha/);
    const cMonto = find(/^monto$|importe|^valor$/);
    // Columna combinada de dirección ("Débito/Crédito" como texto), con Monto positivo aparte.
    const cDir = find(/d[eé]bito\s*\/\s*cr[eé]dito|debe\s*\/\s*haber|^d\/c$/);
    // Columnas separadas de monto débito / crédito (otros bancos).
    const cDeb = find(/^d[eé]bitos?$|^debe$/);
    const cCred = find(/^cr[eé]ditos?$|^haber$/);
    const cDesc = find(/movimiento|descrip|detalle|concepto|referencia|tipo de transferencia|tipo de transf|transacci/);
    if (cFecha >= 0 && (cMonto >= 0 || (cDeb >= 0 && cCred >= 0)) && cDesc >= 0)
      return { headerRow: i, cFecha, cDesc, cMonto, cDeb, cCred, cDir };
  }
  return null;
}

// Parser bancario (BBVA / BdC). Convención de signo: monto>0 → Egreso, monto<0 → Ingreso
// (en el export negativo = crédito/pago, ej. "SU PAGO EN PESOS"). Todo queda needs_review
// hasta validar el formato real de cada banco.
function parseBank(rows, source) {
  const TC = lastBlue();
  const cols = findBankColumns(rows);
  if (!cols) throw new Error('No se reconoció el encabezado del extracto (esperaba columnas de Fecha, Descripción y Monto/Débito-Crédito).');
  const out = [];
  for (let i = cols.headerRow + 1; i < rows.length; i++) {
    const r = rows[i]; if (!r) continue;
    const date = parseDate(r[cols.cFecha]); if (!date) continue;
    const desc = String(r[cols.cDesc] || '').trim(); if (!desc) continue;
    let cur = 'ARS', val = null;
    if (cols.cMonto >= 0) {
      const m = parseMoney(r[cols.cMonto]); if (!m) continue; cur = m.cur; val = m.val;
      // Si el signo viene en una columna de texto "Débito/Crédito" (Monto positivo), aplicarlo.
      if (cols.cDir >= 0) {
        const dir = norm(r[cols.cDir]);
        if (/credito/.test(dir)) val = -Math.abs(val);        // crédito → Ingreso
        else if (/debito/.test(dir)) val = Math.abs(val);      // débito → Egreso
      }
      // BBVA: el "Importe" trae el signo del banco (positivo = acreditación/INGRESO, el
      // saldo SUBE; negativo = débito/EGRESO). La convención general de abajo es monto>0 →
      // Egreso, así que para BBVA invertimos el signo del Importe.  (BdC usa cDir, no entra acá.)
      else if (source === 'bbva') val = -val;
    }
    else { const d = parseMoney(r[cols.cDeb]), c = parseMoney(r[cols.cCred]); val = (d?.val ? Math.abs(d.val) : 0) - (c?.val ? Math.abs(c.val) : 0); }
    if (val == null || val === 0) continue;
    out.push({ date, desc, cur, val });
  }
  return out.map((m) => {
    const flow = m.val > 0 ? 'Egreso' : 'Ingreso';
    const c = classifyBank(m.desc);
    const amount_ars = m.cur === 'ARS' ? Math.abs(m.val) : Math.abs(m.val) * TC;
    const amount_usd = m.cur === 'USD' ? Math.abs(m.val) : Math.abs(m.val) / TC;
    return baseMov(source, {
      date: m.date, flow, category: c.category, subcategory: c.subcategory || null,
      counterparty: flow === 'Ingreso' ? m.desc : (c.counterparty || m.desc),
      description: c.description_override || m.desc,
      currency: m.cur, amount_ars: r2(amount_ars), amount_usd: r2(amount_usd),
      fixed_variable: c.fixed_variable || 'Variable', expense_type: flow === 'Egreso' ? (c.expense_type ?? null) : null,
      transfer: !!c.transfer, needs_review: true, review_reason: 'extracto bancario importado — verificar clasificación y signo',
    });
  });
}

// ===================== Mercado Pago (formato account_statement) =====================
const STAFF = /\b(hugo|huguito|ramirez|ariel|victor|leonardo|leo|fabian|fabián|martin|martín|mike)\b/i;
const OWNER = /rodriguez\s+juan|juan\s+rodriguez|momesso|collado|\bpipi\b/i;
const PERSONAL = /franco cafferata|oscar.*resburgo|andres bruno de luca|lil doctor|guido tasselli|gabriel.*avendano|rodrigo.*rosales|wc market plus|aeropuertos argentina|picca facundo/i;
const NAME_MAP = {
  'cristian adrian tevez': { cp: 'Oso', et: PER, cat: 'Mano de Obra', desc: 'Jornal Oso (depósito/personal)' },
  'gonzalez marina sofia': { cp: 'Via Cargo', et: SUM, cat: 'Insumos', desc: 'Flete / envíos Via Cargo' },
};
// Saca el prefijo de tipo y el conector "a"/"de" → deja el nombre limpio para matchear reglas.
const stripName = (t) => t.replace(/^(Transferencia (enviada|recibida)|Pago|Compra|Cobro)\s*(a|de)?\s+/i, '').trim();
const mpPersonal = (name, desc) => ({ kind: 'egreso', counterparty: 'Juan & Pipi', category: 'Sueldos', subcategory: 'Retiro/Personal', expense_type: PER, desc: 'Personal — ' + (name || desc) });
function classifyMP(m) {
  const t = m.type, name = stripName(t);
  if (m.amt > 0) {
    if (/rendimiento/i.test(t)) return { kind: 'skip' };
    if (/ingreso de dinero|liquidaci[oó]n de dinero/i.test(t)) return { kind: 'transfer', counterparty: 'MOV ENTRE CUENTAS', category: 'Otros Gastos y Ajustes', expense_type: 'Otros Gastos y Ajustes', subcategory: 'Ajuste', desc: 'Fondeo Mercado Pago' };
    if (/devoluci[oó]n/i.test(t)) return { kind: 'ingreso', counterparty: 'Mercado Libre', category: 'Otros', desc: t };
    if (PERSONAL.test(name) || PERSONAL.test(t)) return { kind: 'ingreso', counterparty: 'Juan & Pipi', category: 'Otros', desc: 'Personal — ' + (name || t) };
    return { kind: 'ingreso', counterparty: name || 'Mercado Pago', category: 'Venta - No Pisos', desc: t || 'Ingreso MP', review: 'ingreso MP a clasificar' };
  }
  if (isPeaje(t)) return { kind: 'peaje' };
  if (/ARCA|AFIP|ARBA|rentas|DGR|\bimpuesto/i.test(t)) return { kind: 'egreso', counterparty: 'ARCA', category: 'Impuestos', expense_type: 'Impuestos y Tasas', fv: 'Fijo', desc: t };
  const mapped = NAME_MAP[norm(name)];
  if (mapped) return { kind: 'egreso', counterparty: mapped.cp, category: mapped.cat, expense_type: mapped.et, desc: mapped.desc };
  if (PERSONAL.test(name) || PERSONAL.test(t)) return mpPersonal(name, t);
  if (OWNER.test(name)) return mpPersonal(name, t);
  if (RETAIL.test(t)) return mpPersonal(name, t);
  if (/\beasy\b|sodimac|pinturer|ferreter/i.test(t)) return { kind: 'egreso', counterparty: 'EASY', category: 'Insumos', expense_type: SUM, desc: t };
  if (/ceamse/i.test(t)) return { kind: 'egreso', counterparty: 'CEAMSE', category: 'Otros', expense_type: 'Otros Gastos y Ajustes', desc: 'CEAMSE — disposición de residuos' };
  if (/mercado libre/i.test(t)) return { kind: 'egreso', counterparty: 'Mercado Libre', category: 'Insumos', expense_type: SUM, desc: t };
  if (/^Transferencia enviada/i.test(t)) {
    if (STAFF.test(name)) return { kind: 'egreso', counterparty: name, category: 'Mano de Obra', expense_type: SUM, desc: 'Transferencia ' + name };
    return { kind: 'egreso', counterparty: name, category: 'Otros', expense_type: null, desc: 'Transferencia ' + name, review: 'transferencia MP — ¿trabajador, proveedor o personal?' };
  }
  return { kind: 'egreso', counterparty: name || t, category: 'Otros', expense_type: null, desc: t, review: 'pago MP a clasificar' };
}

function parseMP(rows, existing) {
  const TC = lastBlue();
  const num = (s) => { if (s == null) return null; const v = parseFloat(String(s).replace(/\./g, '').replace(',', '.')); return isNaN(v) ? null : v; };
  const hi = rows.findIndex((r) => r && r[0] === 'RELEASE_DATE');
  if (hi < 0) throw new Error('No se reconoció el extracto de Mercado Pago (falta el encabezado RELEASE_DATE).');
  const movs = rows.slice(hi + 1).filter((r) => r && r[0])
    .map((r) => ({ date: String(r[0]).split('-').reverse().join('-'), type: String(r[1] || ''), ref: String(r[2] || ''), amt: num(r[3]) }))
    .filter((m) => m.amt != null && parseDate(m.date));
  // meses con peajes ya cargados → no recargar peajes ahí
  const peajeMonths = new Set();
  for (const m of existing) if (/ausol|ausa|aubasa|telepase|autopista|corredores viales|peaje/i.test((m.description || '') + (m.counterparty || ''))) peajeMonths.add((m.date || '').slice(0, 7));
  const out = [];
  const peajeByDay = {};
  for (const m of movs) {
    const c = classifyMP(m);
    if (c.kind === 'skip') continue;
    if (c.kind === 'peaje') {
      const month = (parseDate(m.date) || '').slice(0, 7);
      if (peajeMonths.has(month)) continue;
      const dd = parseDate(m.date); peajeByDay[dd] = (peajeByDay[dd] || 0) + m.amt; continue;
    }
    const flow = m.amt > 0 ? 'Ingreso' : 'Egreso';
    out.push(baseMov('mp', {
      date: parseDate(m.date), flow, category: c.category, subcategory: c.subcategory || null,
      counterparty: c.counterparty, description: c.desc, currency: 'ARS',
      amount_ars: r2(Math.abs(m.amt)), amount_usd: r2(Math.abs(m.amt) / TC),
      fixed_variable: c.fv || 'Variable', expense_type: c.expense_type || null,
      transfer: c.kind === 'transfer', needs_review: !!c.review, review_reason: c.review || null,
      mp_op_id: m.ref || null,   // S1: id de operación para matchear el enriquecimiento de forma exacta
    }));
  }
  for (const [date, sum] of Object.entries(peajeByDay).sort()) {
    out.push(baseMov('mp', {
      date, flow: 'Egreso', category: 'Flota', subcategory: 'Peajes',
      counterparty: 'Peajes (AUSOL/AUSA/AUBASA)', description: 'Peajes Mercado Pago (agrupados del día)',
      currency: 'ARS', amount_ars: r2(Math.abs(sum)), amount_usd: r2(Math.abs(sum) / TC),
      fixed_variable: 'Variable', expense_type: 'Gastos de Flota/Vehículos', transfer: false, needs_review: false, review_reason: null,
    }));
  }
  return out;
}

// ---- record base (igual forma que el cashflow existente) ----
function baseMov(source, o) {
  const caja = CAJA[source];
  const rec = {
    id: null, source: source + '-upload',
    date: o.date + 'T00:00:00.000Z', flow: o.flow,
    caja_id: caja.id, caja_name: caja.name,
    category: o.category, subcategory: o.subcategory ?? null,
    counterparty: o.counterparty, counterparty_type: o.flow === 'Ingreso' ? 'client' : 'supplier',
    client_id: null, supplier_id: null, description: o.description, sale_ref: null,
    currency: o.currency, amount_ars: o.amount_ars, amount_usd: o.amount_usd, exchange_rate: lastBlue(),
    fixed_variable: o.fixed_variable ?? 'Variable', expense_type: o.expense_type ?? null,
    transfer: !!o.transfer, needs_review: !!o.needs_review, review_reason: o.review_reason ?? null,
    ...(o.mp_op_id ? { mp_op_id: o.mp_op_id } : {}),
  };
  return applyCpMap(rec, o.counterparty, o.cuit);
}

// ===================== API del módulo =====================
// Devuelve { movements, report }. movements traen _dupe (ya en el cashflow) y _idx.
export function parseStatement({ source, buffer, existing = [], rules = null }) {
  if (!CAJA[source]) throw new Error(`Fuente desconocida: ${source}`);
  setRules(rules);   // usa las reglas de la DB (editables/aprendidas); si no hay, queda el fallback del archivo
  const rows = readSheet(buffer);
  const sameCaja = existing.filter((m) => m.caja_id === CAJA[source].id);
  let movements = source === 'mp' ? parseMP(rows, sameCaja) : parseBank(rows, source);

  // Una sola pasada sobre lo ya cargado: claves de dedup (fecha ±3 + |monto|) y,
  // para MP, índice de movimientos SIN nombre del auto-sync (candidatos a enriquecer).
  // Contrato _enrich: el commit del server actualiza counterparty(+type), category,
  // subcategory, expense_type, description, fixed_variable, transfer y needs_review.
  const seen = new Set();
  const unnamed = new Map();        // fallback: windowKey (fecha±3 + monto) → id
  const unnamedById = new Map();    // S1: op-id exacto → id (preferido, sin colisiones)
  for (const m of sameCaja) {
    const dd = (m.date || '').slice(0, 10); if (!dd || m.amount_ars == null) continue;
    const enrichable = source === 'mp' && m.source === 'mp-api' && (m.needs_review || /sin nombre/i.test(m.counterparty || ''));
    if (enrichable && m.mp_op_id) unnamedById.set(String(m.mp_op_id), m.id);
    for (const key of windowKeys(dd, m.amount_ars)) {
      seen.add(key);
      if (enrichable && !unnamed.has(key)) unnamed.set(key, m.id);
    }
  }
  const claimed = new Set();
  movements = movements.map((m, i) => {
    const key = dedupKey(m.date.slice(0, 10), m.amount_ars);
    // S1: primero match EXACTO por id de operación; si no, fallback fecha±3 + monto.
    let enrichId = m.mp_op_id ? unnamedById.get(String(m.mp_op_id)) : null;
    if (!enrichId || claimed.has(enrichId)) enrichId = unnamed.get(key);
    if (enrichId && !claimed.has(enrichId)) { claimed.add(enrichId); return { ...m, _idx: i, _dupe: false, _enrich: enrichId }; }
    return { ...m, _idx: i, _dupe: seen.has(key) };
  });

  // Análisis de POSIBLES duplicados (fuzzy): un movimiento que NO es dupe duro pero
  // cuyo |monto| + flujo coinciden con algo ya cargado dentro de ±10 días — en
  // CUALQUIER caja — probablemente ya se cargó a mano (ej: un cobro registrado
  // manualmente con otra fecha o en otra cuenta). No se bloquea: se señala para que
  // el usuario decida (la UI no lo pre-selecciona y muestra a qué se parece).
  const byAmt = new Map();
  for (const m of existing) {
    const dd = (m.date || '').slice(0, 10); if (!dd || m.amount_ars == null) continue;
    const amt = Math.round(Math.abs(m.amount_ars)); if (!amt) continue;
    if (!byAmt.has(amt)) byAmt.set(amt, []);
    byAmt.get(amt).push({ date: dd, description: m.description || m.counterparty || '', caja_name: m.caja_name || m.caja_id || '', flow: m.flow });
  }
  const DAY = 86400000;
  movements = movements.map((m) => {
    if (m._dupe || m._enrich) return m;
    const amt = Math.round(Math.abs(m.amount_ars || 0)); if (!amt) return m;
    const cands = byAmt.get(amt); if (!cands) return m;
    const t = new Date(m.date.slice(0, 10)).getTime();
    let best = null, bestDiff = Infinity;
    for (const c of cands) {
      if (c.flow !== m.flow) continue;
      const diff = Math.abs(new Date(c.date).getTime() - t) / DAY;
      if (diff <= 10 && diff < bestDiff) { best = c; bestDiff = diff; }
    }
    return best ? { ...m, _maybe: true, _maybe_ref: { date: best.date, description: best.description, caja_name: best.caja_name } } : m;
  });

  return { movements, report: reportStats(movements, { source, caja: CAJA[source].name }) };
}
