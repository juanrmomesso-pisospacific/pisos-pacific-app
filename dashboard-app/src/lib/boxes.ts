// Equivalencia cajas ↔ m² para pisos. Los pisos vienen en cajas cerradas con una cantidad
// fija de m² por caja (`product.m2_por_caja`). Estos helpers muestran la equivalencia como
// AYUDA (no fuerzan): se puede cargar m² libres igual. Decisión del dueño (sep-2026).
import { appLocale } from "./utils"
import type { Product } from "./types"

/** m² por caja del producto, o null si no está definido / no aplica. */
export function m2PorCaja(p?: Pick<Product, "m2_por_caja"> | null): number | null {
  const v = Number(p?.m2_por_caja)
  return v > 0 ? v : null
}

/** Cuántas cajas equivalen a N m² (fraccionario), o null si no hay m²/caja. */
export function cajasDeM2(m2: number, m2caja?: number | null): number | null {
  if (!m2caja || m2caja <= 0) return null
  return m2 / m2caja
}

/** Formatea una cantidad de cajas: entero si es exacto, si no 1 decimal. */
export function fmtCajas(cajas: number): string {
  const loc = appLocale()
  const rounded = Math.round(cajas * 10) / 10
  const isWhole = Math.abs(rounded - Math.round(rounded)) < 0.05
  return rounded.toLocaleString(loc, { maximumFractionDigits: isWhole ? 0 : 1 })
}

/**
 * Texto de ayuda "≈ 8,3 cajas · 14,5 m²/caja" para poner al lado de un input de m².
 * Devuelve null si el producto no tiene m²/caja definido (no se muestra nada).
 */
export function cajasHint(m2: number, m2caja?: number | null): string | null {
  const cajas = cajasDeM2(m2, m2caja)
  if (cajas == null) return null
  const loc = appLocale()
  const perBox = (m2caja as number).toLocaleString(loc, { maximumFractionDigits: 2 })
  if (!m2 || m2 <= 0) return `${perBox} m²/caja`
  const exact = Math.abs(cajas - Math.round(cajas)) < 0.02
  const prefix = exact ? "" : "≈ "
  return `${prefix}${fmtCajas(cajas)} caja${Math.round(cajas) === 1 && exact ? "" : "s"} · ${perBox} m²/caja`
}

/** true si N m² no completa cajas enteras (para el aviso suave de "no es múltiplo de caja"). */
export function noEsMultiploDeCaja(m2: number, m2caja?: number | null): boolean {
  if (!m2caja || m2caja <= 0 || !m2 || m2 <= 0) return false
  const cajas = m2 / m2caja
  return Math.abs(cajas - Math.round(cajas)) > 0.02
}
