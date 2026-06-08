#!/usr/bin/env node
// Aplica el mapa canónico de contrapartes (data/counterparty-map.json) sobre la
// base viva (data/db.json): renombra contrapartes en cashflow, actualiza el
// colocador Ariel en settings/ventas, y deja el maestro de proveedores alineado
// (CUITs, alias, nuevos, notas). Repetible e idempotente.
//
// Uso:  node scripts/apply-counterparty-map.mjs           (dry-run: solo muestra)
//       node scripts/apply-counterparty-map.mjs --apply   (escribe, con backup)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const APPLY = process.argv.includes('--apply');
const db = JSON.parse(fs.readFileSync(path.join(DATA, 'db.json'), 'utf8'));
const map = JSON.parse(fs.readFileSync(path.join(DATA, 'counterparty-map.json'), 'utf8'));
const PER = map.PER;
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// nombre normalizado → entrada canónica
const byName = new Map();
for (const e of map.byName) for (const m of e.match) byName.set(norm(m), e);

const log = [];
let changed = 0;

// ---------- 1) Cashflow: renombrar contraparte / marcar personal ----------
const cfStats = {};
for (const mv of db.cashflow || []) {
  const e = byName.get(norm(mv.counterparty));
  if (!e) continue;
  if (e.personal) {
    if (mv.flow !== 'Egreso') continue;
    if (mv.counterparty === 'Juan & Pipi' && mv.category === 'Sueldos') continue;
    cfStats['→ personal (Juan & Pipi)'] = (cfStats['→ personal (Juan & Pipi)'] || 0) + 1; changed++;
    if (APPLY) { mv.counterparty = 'Juan & Pipi'; mv.category = 'Sueldos'; mv.subcategory = 'Retiro/Personal'; mv.expense_type = PER; if (!/^personal/i.test(mv.description || '')) mv.description = 'Personal — ' + (mv.description || ''); }
  } else if (e.counterparty && mv.counterparty !== e.counterparty) {
    const key = `${mv.counterparty} → ${e.counterparty}`;
    cfStats[key] = (cfStats[key] || 0) + 1; changed++;
    if (APPLY) mv.counterparty = e.counterparty;
  }
}
log.push('CASHFLOW:');
for (const [k, n] of Object.entries(cfStats).sort((a, b) => b[1] - a[1])) log.push(`  ${String(n).padStart(3)}×  ${k}`);
if (!Object.keys(cfStats).length) log.push('  (sin cambios)');

// ---------- 2) Settings: colocador Ariel ----------
const renameCrew = (arr) => (arr || []).map((c) => (norm(c) === 'ariel noruega' ? 'Ariel Ernesto Garcia' : c));
for (const key of ['crews', 'installers']) {
  if (!db.settings?.[key]) continue;
  const before = JSON.stringify(db.settings[key]);
  const after = renameCrew(db.settings[key]);
  if (before !== JSON.stringify(after)) { log.push(`SETTINGS.${key}: Ariel Noruega → Ariel Ernesto Garcia`); changed++; if (APPLY) db.settings[key] = after; }
}

// ---------- 3) Ventas: delivery_crew ----------
let salesN = 0;
for (const s of db.sales || []) if (norm(s.delivery_crew) === 'ariel noruega') { salesN++; changed++; if (APPLY) s.delivery_crew = 'Ariel Ernesto Garcia'; }
if (salesN) log.push(`VENTAS: ${salesN} con delivery_crew Ariel Noruega → Ariel Ernesto Garcia`);

// ---------- 4) Maestro de proveedores ----------
const sup = db.suppliers || [];
const findSup = (name) => sup.find((x) => norm(x.name) === norm(name));
const supLog = [];
const setSup = (name, patch, { rename } = {}) => {
  const s = findSup(name);
  if (s) { Object.assign(s, patch); if (rename) s.name = rename; supLog.push(`  upd ${rename ? name + ' → ' + rename : name}: ${JSON.stringify(patch)}`); changed++; }
  else { const id = 'PROV-CP-' + norm(rename || name).replace(/[^a-z0-9]/g, '').slice(0, 12); sup.push({ id, name: rename || name, type: patch.type || 'Otros', active: true, ...patch }); supLog.push(`  NEW ${rename || name}: ${JSON.stringify(patch)}`); changed++; }
};
if (APPLY || true) {
  // renombres
  setSup('Ariel', { type: 'Colocación / Mano de obra', notes: 'Colocador (equipo). Antes "Ariel Noruega".' }, { rename: 'Ariel Ernesto Garcia' });
  setSup('Charly Flete', { type: 'Logística', notes: 'Fletes Charly = Carlos Romualdo Vera.' }, { rename: 'Carlos Vera' });
  // CUIT + alias en existentes
  setSup('Matias Flete', { cuit: '27-32222372-6', aliases: ['Matias Trejo', 'Matias Gabriel Trejo', 'Matías'], type: 'Logística' });
  setSup('Soda Belen', { cuit: '30-52895171-2', notes: 'Agua depósito.' });
  setSup('Borassi', { type: 'Servicios / Admin', notes: 'Contador.' });
  setSup('Enrique Cabrera', { notes: 'Mecánico (autoelevador).' });
  setSup('COMEX', { aliases: ['Comex Cargo SRL'] });
  // nuevos
  setSup('Viem Distribuidora', { cuit: '30-71837051-1', type: 'Insumos', notes: 'Siliconas y selladores.' });
  setSup('Elias Cirigliano', { cuit: '20-35657060-0', type: 'Insumos', notes: 'Cintas / film de embalaje.' });
  setSup('Jose Ovejero', { type: 'Colocación / Mano de obra', notes: 'Equipo de Ariel (préstamo).' });
  setSup('Laferre', { type: 'Insumos', notes: 'Ferretería.' });
}
log.push('PROVEEDORES:'); log.push(...supLog);

// ---------- salida ----------
console.log(log.join('\n'));
console.log(`\n${APPLY ? 'APLICADO' : 'DRY-RUN'} — ${changed} cambios.`);
if (APPLY) {
  fs.copyFileSync(path.join(DATA, 'db.json'), path.join(DATA, 'db.json.bak-cpmap'));
  fs.writeFileSync(path.join(DATA, 'db.json'), JSON.stringify(db, null, 2));
  console.log('db.json escrito (backup en db.json.bak-cpmap). Reiniciá el server para verlo.');
} else {
  console.log('Repetí con --apply para escribir.');
}
