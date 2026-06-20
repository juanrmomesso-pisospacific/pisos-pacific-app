// Matching / dedup de proveedores. Evita crear duplicados ("Ferretería" vs "ferreteria"
// vs "Ferreteria ABC") y permite ofrecer opciones cuando un nombre no existe exacto.
// Compartido por server.js (dedup en POST), meta.mjs (bot de efectivo) y el enriquecimiento.

export const normSup = (s) =>
  String(s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

// Conceptos que NO son proveedores (impuestos, peajes, transferencias, banco, personal,
// ajustes, intereses). Sirve para NO listarlos como "proveedor sin registrar".
const NON_SUPPLIER = /impuesto|peaje|ausol|aubasa|ausa\b|arba|afip|arca|rentas|dgr|sircreb|iibb|ley\s*25413|comision|transfer|mov\s+entre\s+cuentas|entre\s+cuentas|interes|ajuste|concili|banco de comercio|bbva|mercado\s*pago|^mp\b|juan\s*&\s*pipi|sin nombre|debito transf|pago a proveedores$/i;
export const isNonSupplier = (name) => !name || NON_SUPPLIER.test(String(name));

// Devuelve el proveedor con el MISMO nombre normalizado, o null.
export function findSupplierMatch(suppliers, name) {
  const n = normSup(name);
  if (!n) return null;
  for (const s of suppliers || []) if (normSup(s.name) === n) return s;
  return null;
}

// Devuelve los proveedores más parecidos a `name` (para ofrecer opciones A/B/C…).
// Ranking: igual > uno contiene al otro > solapamiento de palabras (Jaccard).
export function suggestSuppliers(suppliers, name, k = 5) {
  const n = normSup(name);
  if (!n) return [];
  const toks = new Set(n.split(' ').filter(Boolean));
  const scored = [];
  for (const s of suppliers || []) {
    const sn = normSup(s.name);
    if (!sn) continue;
    const st = new Set(sn.split(' ').filter(Boolean));
    let score;
    if (sn === n) score = 1;
    else if (sn.includes(n) || n.includes(sn)) score = 0.85;
    else {
      const inter = [...toks].filter((t) => st.has(t)).length;
      const uni = new Set([...toks, ...st]).size;
      score = uni ? inter / uni : 0;
    }
    if (score >= 0.3) scored.push({ s, score });   // comparten ≥1 palabra significativa
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((x) => x.s);
}
