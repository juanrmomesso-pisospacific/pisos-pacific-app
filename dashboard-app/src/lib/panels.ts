// Paneles (ACUDESIGN): productos que se venden POR UNIDAD (no m²) y van en su propia línea
// del P&L. Se distinguen de los pisos por product.kind === "panel".
import type { Product } from "./types"

export const isPanel = (p?: Pick<Product, "kind"> | null): boolean => p?.kind === "panel"

/** Unidad de venta/stock del producto: "u" (paneles) o "m2" (pisos, default). */
export const productUnit = (p?: Pick<Product, "unit" | "kind"> | null): string =>
  p?.unit || (isPanel(p) ? "u" : "m2")

/** Etiqueta corta de la unidad para la UI. */
export const unitLabel = (u?: string): string => (u === "u" ? "u" : "m²")

/** Etiqueta de la unidad de un producto (para inputs "Cantidad (m²/u)"). */
export const productUnitLabel = (p?: Pick<Product, "unit" | "kind"> | null): string =>
  unitLabel(productUnit(p))
