// Armado del remito a partir de la venta — ÚNICA definición (la usan VentasPage y AgendaPage).
// Regla del proceso: el remito SIEMPRE parte de los materiales de la venta (pisos y
// terminaciones, sin servicios ni descuentos); el inspector ajusta y suma extras.
export type RemitoItem = { description: string; quantity: number; unit: string }

const SERVICE_RE = /colocaci|entrega|ajuste|medici|reparaci|servicio|mano de obra|flete/i
const ML_RE = /z[oó]calo|varilla|cuartaca|nariz|moldura|perfil|cubrecanto/i

export const isServiceItem = (it: { sku?: string; description?: string }) =>
  /^SERV/i.test(it.sku || "") || SERVICE_RE.test(it.description || "")

/** Unidad para un material suelto (extras de medición, presets): terminaciones en ml, resto en u. */
export const looseUnit = (description: string) => (ML_RE.test(description) ? "ml" : "u")

/** Materiales de la venta listos para el remito (pisos en m², terminaciones en ml). */
export function saleMaterialsForRemito(items: { product_id?: string; sku?: string; description?: string; quantity?: number }[] | undefined): RemitoItem[] {
  return (items || [])
    .filter((it) => it && it.product_id !== "discount" && !/^descuento/i.test(it.description || "") && !isServiceItem(it))
    .map((it) => ({
      description: it.description || it.sku || "",
      quantity: Number(it.quantity) || 0,
      unit: ML_RE.test(it.description || "") ? "ml" : "m²",
    }))
}
