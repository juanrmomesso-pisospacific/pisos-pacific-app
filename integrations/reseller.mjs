// Revendedores: mayorista (descuento sobre lista) y comisión (sobre pisos).
// Modelo calcado de las Propuestas Comerciales (Plan Reventa):
//   Precio distribuidor = lista − (desc_acuerdo + desc_volumen)   ← descuentos ADITIVOS
//   Los descuentos por volumen se aplican de forma PLANA (todo el pedido al % del tramo).
//   Base = SOLO PISOS (product.stockTrack): servicios y accesorios quedan a lista.
// El mismo criterio de "pisos del pedido" alimenta el descuento mayorista y la comisión.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** ¿La línea es un piso? (el producto lleva stock). Servicios/accesorios → false. */
export function isFloorLine(it, products) {
  const p = (products || []).find((x) => (it.sku && x.sku === it.sku) || (it.product_id && x.id === it.product_id));
  return !!(p && p.stockTrack && p.kind !== 'panel');   // paneles NO entran en acuerdos de revendedor
}

/** m² y monto bruto (qty×precio) de las líneas de piso del pedido. */
export function floorStats(items, products) {
  let m2 = 0, amount = 0;
  for (const it of items || []) {
    if (!isFloorLine(it, products)) continue;
    const qty = Number(it.quantity) || 0;
    m2 += qty;
    amount += qty * (Number(it.unit_price) || 0);
  }
  return { m2: r2(m2), amount: r2(amount) };
}

/**
 * Tasa del tramo que corresponde a `m2` (aplicación PLANA). tiers: [{upto_m2, rate}]
 * ordenados por upto_m2; el último puede tener upto_m2 null/0 = sin tope (∞).
 * Devuelve la `rate` del primer tramo cuyo tope no se superó, o la del último.
 */
export function tierRate(m2, tiers) {
  const list = (tiers || []).filter((t) => t && Number.isFinite(Number(t.rate)));
  if (!list.length) return 0;
  for (const t of list) {
    const top = Number(t.upto_m2);
    if (!top || top <= 0) return Number(t.rate) || 0;   // tramo sin tope
    if (m2 <= top) return Number(t.rate) || 0;
  }
  return Number(list[list.length - 1].rate) || 0;        // más allá del último tope
}

// (reventaDiscountPct vive solo en el front lib/reseller.ts — el precio mayorista se aplica
// en la cotización, no en el backend. Acá alcanza con floorStats + computeCommission.)

/**
 * Comisión de una venta/cotización para un revendedor modo comisión.
 * Base = SOLO pisos (a precio de lista, que es lo que paga el cliente).
 *   type 'pct'       → pct % del monto de pisos
 *   type 'per_m2'    → per_m2 $ por m² de piso
 *   type 'tiered_m2' → escala por m²: $/m² del tramo (plano) × m² de piso
 * Devuelve { amount, type, m2, base } (amount en la moneda de los ítems).
 */
export function computeCommission(comision, items, products) {
  const { m2, amount } = floorStats(items, products);
  if (!comision || !comision.type) return { amount: 0, type: null, m2, base: amount };
  let val = 0;
  if (comision.type === 'pct') val = amount * (Number(comision.pct) || 0) / 100;
  else if (comision.type === 'per_m2') val = m2 * (Number(comision.per_m2) || 0);
  else if (comision.type === 'tiered_m2') {
    const rate = tierRate(m2, (comision.tiers || []).map((t) => ({ upto_m2: t.upto_m2, rate: t.per_m2 })));
    val = m2 * rate;
  } else if (comision.type === 'price_list') {
    // Comisión = (precio cotizado − precio del revendedor) × cant, por piso en su lista; nunca negativa.
    const pl = comision.price_list || {};
    for (const it of items || []) {
      if (!isFloorLine(it, products)) continue;
      const rp = pl[it.sku || ''];
      if (rp == null) continue;
      val += Math.max(0, (Number(it.unit_price) || 0) - rp) * (Number(it.quantity) || 0);
    }
  }
  return { amount: r2(val), type: comision.type, m2, base: amount };
}
