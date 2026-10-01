// Revendedores (front). Mirror de integrations/reseller.mjs — misma matemática.
// Mayorista: descuento sobre lista (acuerdo fijo + tramos por volumen, aditivos, planos).
// Comisión: sobre pisos (product.stockTrack), a precio de lista. Base = SOLO pisos.
import type { Product } from "./types"

export type VolumeTier = { upto_m2: number | null; extra_pct: number }
export type CommissionTier = { upto_m2: number | null; per_m2: number }

export type ReventaConfig = {
  mode?: "descuento" | "lista"        // descuento sobre lista (SAMACO) | lista de precios fija (Julian)
  desc_acuerdo?: number
  tiers?: VolumeTier[]
  price_list?: Record<string, number> // sku → precio mayorista fijo (modo lista)
}
export type ComisionConfig = {
  type: "pct" | "per_m2" | "tiered_m2" | "price_list"
  pct?: number
  per_m2?: number
  tiers?: CommissionTier[]
  // Modo lista (Hugo): precio del revendedor por SKU. Comisión = (precio cotizado − precio revendedor) × cant.
  price_list?: Record<string, number>
}

// Campos que sumamos al registro de cliente (loose — clients no tienen tipo formal en la app).
export type ResellerFields = {
  reseller?: boolean
  reseller_mode?: "reventa" | "comision"
  reseller_reventa?: ReventaConfig
  reseller_comision?: ComisionConfig
}

export type LineLike = { product_id?: string; sku?: string; quantity: number; unit_price: number; disc_kind?: "pct" | "amount"; disc_value?: number; discount?: number }

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

/** Descuento resuelto ($) de una línea: desde disc_value/disc_kind (preview) o discount (guardado). */
export function lineDiscount(it: LineLike): number {
  const g = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0)
  if (it.disc_value && it.disc_value > 0) {
    const amt = it.disc_kind === "amount" ? Number(it.disc_value) : g * Number(it.disc_value) / 100
    return Math.min(g, r2(amt))
  }
  return Math.min(g, Math.max(0, Number(it.discount) || 0))
}

export function isFloorLine(it: LineLike, products: Product[]): boolean {
  const p = products.find((x) => (it.sku && x.sku === it.sku) || (it.product_id && x.id === it.product_id))
  return !!(p && p.stockTrack && p.kind !== "panel")   // paneles NO entran en acuerdos de revendedor
}

export function floorStats(items: LineLike[], products: Product[]): { m2: number; amount: number } {
  let m2 = 0, amount = 0
  for (const it of items) {
    if (!isFloorLine(it, products)) continue
    const qty = Number(it.quantity) || 0
    m2 += qty
    amount += qty * (Number(it.unit_price) || 0)
  }
  return { m2: r2(m2), amount: r2(amount) }
}

/** Tasa del tramo (aplicación plana) para `m2`. tiers ordenados por tope; último sin tope = ∞. */
export function tierRate(m2: number, tiers: { upto_m2: number | null; rate: number }[]): number {
  const list = tiers.filter((t) => Number.isFinite(Number(t.rate)))
  if (!list.length) return 0
  for (const t of list) {
    const top = Number(t.upto_m2)
    if (!top || top <= 0) return Number(t.rate) || 0
    if (m2 <= top) return Number(t.rate) || 0
  }
  return Number(list[list.length - 1].rate) || 0
}

/** Descuento mayorista efectivo (%) = acuerdo + volumen del tramo (aditivo). */
export function reventaDiscountPct(reventa: ReventaConfig | undefined, floorM2: number): number {
  return reventaBreakdown(reventa, floorM2).total
}

/** Precio mayorista de un piso: modo 'lista' → precio fijo del SKU (fallback a lista); modo
 *  'descuento' → lista × (1 − descuento efectivo por volumen). */
export function reventaFloorPrice(reventa: ReventaConfig | undefined, sku: string, listPrice: number, floorM2: number): number {
  if (!reventa) return listPrice
  if (reventa.mode === "lista") {
    const p = reventa.price_list?.[sku]
    return (p != null && p > 0) ? p : listPrice
  }
  const disc = reventaDiscountPct(reventa, floorM2)
  return Math.round(listPrice * (1 - disc / 100) * 100) / 100
}

/** Desglose para el banner del mayorista. */
export function reventaBreakdown(reventa: ReventaConfig | undefined, floorM2: number) {
  const acuerdo = Number(reventa?.desc_acuerdo) || 0
  const volumen = reventa ? tierRate(floorM2, (reventa.tiers || []).map((t) => ({ upto_m2: t.upto_m2, rate: t.extra_pct }))) : 0
  return { acuerdo, volumen, total: r2(acuerdo + volumen) }
}

// opts.splitDiscount: solo aplica a 'price_list' (valor fijo) — reparte el descuento del piso a
// medias con el revendedor. En 'pct' el % ya se calcula sobre el precio FINAL (con descuento), así
// que no necesita reparto. 'per_m2'/'tiered_m2' son por m² → un descuento de precio no los afecta.
export function computeCommission(comision: ComisionConfig | undefined, items: LineLike[], products: Product[], opts: { splitDiscount?: boolean } = {}) {
  const { m2, amount } = floorStats(items, products)
  let floorDisc = 0
  for (const it of items) if (isFloorLine(it, products)) floorDisc += lineDiscount(it)
  floorDisc = r2(floorDisc)
  if (!comision || !comision.type) return { amount: 0, type: null as ComisionConfig["type"] | null, m2, base: amount, floorDisc }
  let val = 0
  if (comision.type === "pct") val = Math.max(0, amount - floorDisc) * (Number(comision.pct) || 0) / 100   // % sobre el precio final (ya con descuento)
  else if (comision.type === "per_m2") val = m2 * (Number(comision.per_m2) || 0)
  else if (comision.type === "tiered_m2") {
    const rate = tierRate(m2, (comision.tiers || []).map((t) => ({ upto_m2: t.upto_m2, rate: t.per_m2 })))
    val = m2 * rate
  } else if (comision.type === "price_list") {
    // Comisión = diferencia entre lo cotizado y el precio del revendedor, por piso. Solo los que
    // están en su lista; nunca negativa (si se cotizó por debajo de su precio, comisión 0 en esa línea).
    const pl = comision.price_list || {}
    for (const it of items) {
      if (!isFloorLine(it, products)) continue
      const rp = pl[it.sku || ""]
      if (rp == null) continue
      let lineComm = Math.max(0, (Number(it.unit_price) || 0) - rp) * (Number(it.quantity) || 0)
      // Valor fijo: el descuento del piso se reparte a medias (si no, el revendedor cobra el total y
      // Pacific absorbe todo el descuento). Opcional por presupuesto.
      if (opts.splitDiscount) lineComm -= lineDiscount(it) * 0.5
      val += Math.max(0, lineComm)
    }
  }
  return { amount: r2(val), type: comision.type, m2, base: amount, floorDisc }
}

export const DEFAULT_REVENTA: ReventaConfig = {
  mode: "descuento",
  desc_acuerdo: 25,
  tiers: [
    { upto_m2: 100, extra_pct: 0 },
    { upto_m2: 300, extra_pct: 5 },
    { upto_m2: 500, extra_pct: 10 },
  ],
}
