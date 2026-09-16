// Unidad de venta/stock de un producto: "m2" (pisos), "ml" (zócalos, varillas), "u" (narices,
// paneles ACUDESIGN, accesorios por unidad). Es un campo explícito del producto (product.unit);
// si falta, se infiere (paneles → u, resto → m²) por compatibilidad con lo cargado antes.
import type { Product } from "./types"

export type Unit = "m2" | "ml" | "u"

export const isPanel = (p?: Pick<Product, "kind"> | null): boolean => p?.kind === "panel"

/** Unidad efectiva del producto (con fallback para productos viejos sin `unit`). */
export const productUnit = (p?: Pick<Product, "unit" | "kind"> | null): Unit => {
  const u = p?.unit
  if (u === "m2" || u === "ml" || u === "u") return u
  return isPanel(p) ? "u" : "m2"
}

/** Etiqueta corta de una unidad para la UI ("m²" / "ml" / "u"). */
export const unitLabel = (u?: string): string => (u === "u" ? "u" : u === "ml" ? "ml" : "m²")

/** Etiqueta de la unidad de un producto (para inputs "Cantidad (m²/ml/u)"). */
export const productUnitLabel = (p?: Pick<Product, "unit" | "kind"> | null): string =>
  unitLabel(productUnit(p))

/** Opciones para el selector de unidad en el alta/edición de producto. */
export const UNIT_OPTIONS: { value: Unit; label: string }[] = [
  { value: "m2", label: "m² (pisos)" },
  { value: "ml", label: "ml — metro lineal (zócalos, varillas)" },
  { value: "u", label: "unidad (narices, paneles, accesorios)" },
]
