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
  type: "pct" | "per_m2" | "tiered_m2"
  pct?: number
  per_m2?: number
  tiers?: CommissionTier[]
}

// Campos que sumamos al registro de cliente (loose — clients no tienen tipo formal en la app).
export type ResellerFields = {
  reseller?: boolean
  reseller_mode?: "reventa" | "comision"
  reseller_reventa?: ReventaConfig
  reseller_comision?: ComisionConfig
}

export type LineLike = { product_id?: string; sku?: string; quantity: number; unit_price: number }

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

export function isFloorLine(it: LineLike, products: Product[]): boolean {
  const p = products.find((x) => (it.sku && x.sku === it.sku) || (it.product_id && x.id === it.product_id))
  return !!(p && p.stockTrack)
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
  if (!reventa) return 0
  const acuerdo = Number(reventa.desc_acuerdo) || 0
  const vol = tierRate(floorM2, (reventa.tiers || []).map((t) => ({ upto_m2: t.upto_m2, rate: t.extra_pct })))
  return r2(acuerdo + vol)
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

export function computeCommission(comision: ComisionConfig | undefined, items: LineLike[], products: Product[]) {
  const { m2, amount } = floorStats(items, products)
  if (!comision || !comision.type) return { amount: 0, type: null as ComisionConfig["type"] | null, m2, base: amount }
  let val = 0
  if (comision.type === "pct") val = amount * (Number(comision.pct) || 0) / 100
  else if (comision.type === "per_m2") val = m2 * (Number(comision.per_m2) || 0)
  else if (comision.type === "tiered_m2") {
    const rate = tierRate(m2, (comision.tiers || []).map((t) => ({ upto_m2: t.upto_m2, rate: t.per_m2 })))
    val = m2 * rate
  }
  return { amount: r2(val), type: comision.type, m2, base: amount }
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
