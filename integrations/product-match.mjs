// Matching de productos para la importación de contenedores (packing list / invoice).
// Los packings traen el nombre "un poco distinto" cada vez → resolvemos en cascada y
// APRENDEMOS la asociación (alias por descripción) para futuras importaciones.
// Compartido conceptualmente con dashboard-app/src/lib/product-match.ts (misma lógica en TS).

export const normProd = (s) =>
  String(s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

// Índice de alias aprendidos (descripción normalizada → product_id).
export function aliasIndex(aliases) {
  const m = new Map();
  for (const a of aliases || []) if (a && a.alias) m.set(String(a.alias), a.product_id);
  return m;
}

// Resuelve un ítem del packing/invoice a un producto existente. Orden:
// (1) alias aprendido por descripción, (2) SKU exacto normalizado (bonus si coincide),
// (3) nombre/shortName del producto ≈ descripción. Devuelve el producto o null.
export function findProductMatch(products, aliases, { sku, description } = {}) {
  const ndesc = normProd(description);
  const idx = aliases instanceof Map ? aliases : aliasIndex(aliases);
  if (ndesc && idx.has(ndesc)) {
    const pid = idx.get(ndesc);
    const p = (products || []).find((x) => x.id === pid);
    if (p) return p;
  }
  const nsku = normProd(sku);
  if (nsku) {
    const p = (products || []).find((x) => normProd(x.sku) === nsku);
    if (p) return p;
  }
  if (ndesc) {
    const p = (products || []).find((x) => normProd(x.name) === ndesc || normProd(x.shortName) === ndesc);
    if (p) return p;
  }
  return null;
}

// Productos más parecidos a la descripción (para precargar el buscador "Asociar producto").
// Ranking: igual > uno contiene al otro > solapamiento de palabras (Jaccard).
export function suggestProducts(products, description, k = 6) {
  const n = normProd(description);
  if (!n) return [];
  const toks = new Set(n.split(' ').filter(Boolean));
  const scored = [];
  for (const p of products || []) {
    const pn = normProd(p.name) || normProd(p.shortName);
    if (!pn) continue;
    const pt = new Set(pn.split(' ').filter(Boolean));
    let score;
    if (pn === n) score = 1;
    else if (pn.includes(n) || n.includes(pn)) score = 0.85;
    else {
      const inter = [...toks].filter((t) => pt.has(t)).length;
      const uni = new Set([...toks, ...pt]).size;
      score = uni ? inter / uni : 0;
    }
    if (score >= 0.2) scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((x) => x.p);
}
